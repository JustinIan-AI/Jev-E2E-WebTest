import { BaseLLMProvider, CallOptions, LLMResponse, StreamOptions } from './base.provider';
import { withRetry, RetryableError } from '../utils/retry';

interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider extends BaseLLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: AnthropicConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.defaultModel = config.defaultModel || 'claude-sonnet-4-5-20250514';
  }

  async call(prompt: string, options?: CallOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);
    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || 60000;

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.2,
    };

    if (options?.systemPrompt) {
      body.system = options.systemPrompt;
    }

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const { result, latencyMs } = await this.timedCall(async () => {
          try {
            const response = await fetch(`${this.baseUrl}/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });

            if (!response.ok) {
              const error = await response.text();
              throw new RetryableError(
                `Anthropic API error (${response.status}): ${error}`,
                response.status,
              );
            }
            return response.json() as Promise<AnthropicResponse>;
          } finally {
            clearTimeout(timer);
          }
        });

        const textContent = result.content?.find((c) => c.type === 'text');

        return {
          text: textContent?.text || '',
          model: result.model || model,
          tokens: {
            input: result.usage?.input_tokens || 0,
            output: result.usage?.output_tokens || 0,
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

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.2,
      stream: true,
    };
    if (options?.systemPrompt) body.system = options.systemPrompt;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const start = performance.now();
    let fullText = '';
    const tokens = { input: 0, output: 0 };

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new RetryableError(
          `Anthropic API error (${response.status}): ${error}`,
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
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.text) {
              fullText += data.delta.text;
              options?.onToken?.(data.delta.text);
            }
            if (data.type === 'message_start' && data.message?.usage) {
              tokens.input = data.message.usage.input_tokens || 0;
            }
            if (data.type === 'message_delta' && data.usage) {
              tokens.output = data.usage.output_tokens || 0;
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
