import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.provider';
import { OpenAIProvider } from '../../src/providers/openai.provider';
import { CustomProvider } from '../../src/providers/custom.provider';

describe('AnthropicProvider', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send the correct anthropic-version header (2023-06-01)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call('hello');

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('should use the correct default model (claude-sonnet-4-5-20250514)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call('hello');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('claude-sonnet-4-5-20250514');
  });

  it('should return correct response on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'generated tests' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call('generate tests');

    expect(result.text).toBe('generated tests');
    expect(result.model).toBe('claude-sonnet-4-5-20250514');
    expect(result.tokens).toEqual({ input: 100, output: 200 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should send the x-api-key header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const provider = new AnthropicProvider({ apiKey: 'my-secret-key' });
    await provider.call('hello');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('my-secret-key');
  });
});

describe('OpenAIProvider', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return correct response on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'openai response' } }],
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 50, completion_tokens: 150 },
      }),
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.call('generate tests');

    expect(result.text).toBe('openai response');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.tokens).toEqual({ input: 50, output: 150 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should send Authorization bearer header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'response' } }],
        model: 'gpt-4o-mini',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const provider = new OpenAIProvider({ apiKey: 'my-openai-key' });
    await provider.call('hello');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer my-openai-key');
  });

  it('should clear timeout even when API returns error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('OpenAI API error (400)');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('AnthropicProvider - clearTimeout on error', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clear timeout even when API returns error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('Anthropic API error (400)');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('CustomProvider - clearTimeout on error', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clear timeout even when API returns error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    const provider = new CustomProvider({
      endpoint: 'https://example.com/api',
      bodyTemplate: (prompt) => ({ prompt }),
      parseResponse: (data: any) => ({ text: data.text }),
    });
    await expect(provider.call('hello')).rejects.toThrow('Custom API error (400)');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe('OpenAI API key validation', () => {
  it('should throw on missing API key', async () => {
    const provider = new OpenAIProvider({ apiKey: '' });
    await expect(provider.call('hello')).rejects.toThrow(/API key/i);
  });

  it('should throw on $-prefixed API key', async () => {
    const provider = new OpenAIProvider({ apiKey: '$OPENAI_API_KEY' });
    await expect(provider.call('hello')).rejects.toThrow(/API key/i);
  });
});

describe('OpenAI retry behavior', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should retry on 429 and succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limited' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'response' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('response');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('should NOT retry on 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });
    const provider = new OpenAIProvider({ apiKey: 'bad-key' });
    await expect(provider.call('hello')).rejects.toThrow('401');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAIProvider - streaming', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should yield tokens from SSE stream', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const chunks: string[] = [];

    const result = await provider.stream('hello', {
      onToken: (token) => chunks.push(token),
    });

    expect(chunks.join('')).toBe('Hello world!');
    expect(result.text).toBe('Hello world!');
  });

  it('should handle stream error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Server error',
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.stream('hello')).rejects.toThrow('OpenAI API error (500)');
  });
});

describe('AnthropicProvider - streaming', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should yield tokens from Anthropic SSE stream', async () => {
    const sseData = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const chunks: string[] = [];

    const result = await provider.stream('hello', {
      onToken: (token) => chunks.push(token),
    });

    expect(chunks.join('')).toBe('Hello world');
    expect(result.text).toBe('Hello world');
    expect(result.tokens).toEqual({ input: 10, output: 5 });
  });

  it('should handle stream error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await expect(provider.stream('hello')).rejects.toThrow('Anthropic API error (401)');
  });
});

describe('Anthropic API key validation', () => {
  it('should throw on missing Anthropic API key', async () => {
    const provider = new AnthropicProvider({ apiKey: '' });
    await expect(provider.call('hello')).rejects.toThrow(/API key/i);
  });
});
