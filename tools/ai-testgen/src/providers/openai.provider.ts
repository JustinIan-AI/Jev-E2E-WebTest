import { BaseLLMProvider, CallOptions, LLMResponse, StreamOptions } from './base.provider';
import { withRetry, RetryableError } from '../utils/retry';

interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
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
    const timeout = options?.timeout || 60000;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 4096,
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
          raw: result,
        };
      },
      { maxRetries: 3, baseDelayMs: 1000 },
    );
  }

  async stream(prompt: string, options?: StreamOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);
    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || 120000;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = performance.now();
    let fullText = '';
    let tokens = { input: 0, output: 0 };

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
    } finally {
      clearTimeout(timer);
    }

    return { text: fullText, model, tokens, latencyMs: Math.round(performance.now() - start) };
  }
}
