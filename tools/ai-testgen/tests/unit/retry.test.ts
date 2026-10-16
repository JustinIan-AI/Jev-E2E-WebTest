import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, RetryableError } from '../../src/utils/retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 10 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 (RetryableError) and succeeds on 2nd call', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('rate limited', 429))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 10 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError('server error', 500))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 10 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 401', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('unauthorized', 401));

    await expect(withRetry(fn, { baseDelayMs: 10 })).rejects.toThrow('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 400', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('bad request', 400));

    await expect(withRetry(fn, { baseDelayMs: 10 })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries and throws last error', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('server error', 500));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('server error');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('uses exponential backoff delays', async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new RetryableError('fail', 500));

    const onRetry = vi.fn((_attempt: number, _error: Error, delayMs: number) => {
      delays.push(delayMs);
    });

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 100, onRetry })).rejects.toThrow(
      'fail',
    );

    // Exponential: 100 * 2^0 = 100, 100 * 2^1 = 200, 100 * 2^2 = 400
    expect(delays).toEqual([100, 200, 400]);
  });

  it('retries non-RetryableError (plain Error from network failure)', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 10 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
