export interface CallOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  timeout?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  tokens: { input: number; output: number };
  latencyMs: number;
  raw?: unknown;
}

export interface StreamOptions extends CallOptions {
  onToken?: (token: string) => void;
}

export interface LLMProvider {
  name: string;
  call(prompt: string, options?: CallOptions): Promise<LLMResponse>;
  stream(prompt: string, options?: StreamOptions): Promise<LLMResponse>;
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract name: string;
  abstract call(prompt: string, options?: CallOptions): Promise<LLMResponse>;

  async stream(prompt: string, options?: StreamOptions): Promise<LLMResponse> {
    return this.call(prompt, options);
  }

  protected validateApiKey(apiKey: string): void {
    if (!apiKey || apiKey.startsWith('$')) {
      throw new Error(
        `No API key configured for ${this.name}. Set ${this.name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} environment variable or add apiKey to your config.`,
      );
    }
  }

  protected async timedCall<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
    const start = performance.now();
    const result = await fn();
    const latencyMs = Math.round(performance.now() - start);
    return { result, latencyMs };
  }
}
