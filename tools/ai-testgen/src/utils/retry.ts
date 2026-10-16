import { logger } from './logger';

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

export class RetryableError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableError) {
    if (error.statusCode && NON_RETRYABLE_STATUS_CODES.has(error.statusCode)) {
      return false;
    }
    // RetryableError with retryable status code OR no status code = retry
    return true;
  }
  // Plain errors (network failures) are retryable
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries || !isRetryable(err)) {
        throw lastError;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);

      if (options?.onRetry) {
        options.onRetry(attempt + 1, lastError, delayMs);
      } else {
        logger.warn(`Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms: ${lastError.message}`);
      }

      await delay(delayMs);
    }
  }

  throw lastError;
}
