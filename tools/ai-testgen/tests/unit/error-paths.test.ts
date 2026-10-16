import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.provider';
import { AnthropicProvider } from '../../src/providers/anthropic.provider';

// Mock the retry utility so tests don't wait for exponential backoff
vi.mock('../../src/utils/retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/retry')>();
  return {
    ...actual,
    withRetry: async <T>(fn: () => Promise<T>) => fn(),
  };
});

describe('Error paths', () => {
  const mockFetch = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('OpenAI: should include status code in error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('403');
  });

  it('OpenAI: should handle empty choices array', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [] }) });
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('');
  });

  it('Anthropic: should handle missing content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [], model: 'test', usage: {} }),
    });
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('');
  });

  it('OpenAI: should handle network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('fetch failed');
  });
});
