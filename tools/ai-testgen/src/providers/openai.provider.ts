import { BaseLLMProvider, CallOptions, LLMResponse, StreamOptions } from './base.provider';
import { withRetry, RetryableError, NonRetryableError } from '../utils/retry';

const DEFAULT_TIMEOUT_MS = 300000;

export class LLMTimeoutError extends NonRetryableError {
  constructor(timeoutMs: number) {
    super(
      `LLM 请求超时（${timeoutMs}ms / ${Math.round(timeoutMs / 1000)}s）。` +
        `可用 --timeout <毫秒> 调大超时，或检查网络与模型响应速度。`,
    );
    this.name = 'LLMTimeoutError';
  }
}

function isAbortError(err: unknown, controller: AbortController): boolean {
  return controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
}

interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIProvider extends BaseLLMProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: OpenAIConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.defaultModel = config.defaultModel || 'gpt-4o-mini';
  }

  async call(prompt: string, options?: CallOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);
    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 8192,
    };

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const { result, latencyMs } = await this.timedCall(async () => {
          try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });

            if (!response.ok) {
              const error = await response.text();
              throw new RetryableError(
                `OpenAI API error (${response.status}): ${error}`,
                response.status,
              );
            }
            return response.json() as Promise<OpenAIResponse>;
          } catch (err) {
            if (isAbortError(err, controller)) {
              throw new LLMTimeoutError(timeout);
            }
            throw err;
          } finally {
            clearTimeout(timer);
          }
        });

        return {
          text: result.choices?.[0]?.message?.content || '',
          model: result.model || model,
          tokens: {
            input: result.usage?.prompt_tokens || 0,
            output: result.usage?.completion_tokens || 0,
          },
          latencyMs,
          finishReason: result.choices?.[0]?.finish_reason,
          raw: result,
        };
      },
      { maxRetries: 3, baseDelayMs: 1000 },
    );
  }

  async stream(prompt: string, options?: StreamOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);
    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 8192,
      stream: true,
      stream_options: { include_usage: true },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = performance.now();
    let fullText = '';
    let tokens = { input: 0, output: 0 };
    let finishReason: string | undefined;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new RetryableError(
          `OpenAI API error (${response.status}): ${error}`,
          response.status,
        );
      }

      if (!response.body) {
        throw new Error(`${this.name} streaming error: response body is null`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              options?.onToken?.(content);
            }
            const chunkFinishReason = data.choices?.[0]?.finish_reason;
            if (chunkFinishReason) {
              finishReason = chunkFinishReason;
            }
            if (data.usage) {
              tokens = {
                input: data.usage.prompt_tokens || 0,
                output: data.usage.completion_tokens || 0,
              };
            }
          } catch {
            /* skip malformed chunks */
          }
        }
      }
    } catch (err) {
      if (isAbortError(err, controller)) {
        throw new LLMTimeoutError(timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    return {
      text: fullText,
      model,
      tokens,
      latencyMs: Math.round(performance.now() - start),
      finishReason,
    };
  }
}
