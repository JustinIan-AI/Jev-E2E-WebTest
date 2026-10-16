import { BaseLLMProvider, CallOptions, LLMResponse } from './base.provider';
import { withRetry, RetryableError } from '../utils/retry';

interface CustomProviderConfig {
  name?: string;
  endpoint: string;
  headers?: Record<string, string>;
  bodyTemplate: (prompt: string, options?: CallOptions) => Record<string, unknown>;
  parseResponse: (data: unknown) => { text: string; tokens?: { input: number; output: number } };
  defaultModel?: string;
  timeout?: number;
}

export class CustomProvider extends BaseLLMProvider {
  name: string;
  private endpoint: string;
  private headers: Record<string, string>;
  private bodyTemplate: CustomProviderConfig['bodyTemplate'];
  private parseResponse: CustomProviderConfig['parseResponse'];
  private defaultModel: string;
  private defaultTimeout: number;

  constructor(config: CustomProviderConfig) {
    super();
    this.name = config.name || 'custom';
    this.endpoint = config.endpoint;
    this.headers = config.headers || { 'Content-Type': 'application/json' };
    this.bodyTemplate = config.bodyTemplate;
    this.parseResponse = config.parseResponse;
    this.defaultModel = config.defaultModel || 'default';
    this.defaultTimeout = config.timeout || 60000;
  }

  async call(prompt: string, options?: CallOptions): Promise<LLMResponse> {
    if (!this.endpoint) {
      throw new Error('No endpoint configured for custom provider. Set baseUrl in your config.');
    }
    const timeout = options?.timeout || this.defaultTimeout;
    const body = this.bodyTemplate(prompt, options);

    return withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const { result, latencyMs } = await this.timedCall(async () => {
          try {
            const response = await fetch(this.endpoint, {
              method: 'POST',
              headers: this.headers,
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            if (!response.ok) {
              const error = await response.text();
              throw new RetryableError(
                `Custom API error (${response.status}): ${error}`,
                response.status,
              );
            }
            return response.json();
          } finally {
            clearTimeout(timer);
          }
        });

        const parsed = this.parseResponse(result);

        return {
          text: parsed.text,
          model: options?.model || this.defaultModel,
          tokens: parsed.tokens || { input: 0, output: 0 },
          latencyMs,
          raw: result,
        };
      },
      { maxRetries: 3, baseDelayMs: 1000 },
    );
  }
}
