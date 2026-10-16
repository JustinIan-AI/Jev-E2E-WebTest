import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Cache } from '../../src/utils/cache';

describe('Cache', () => {
  let tmpDir: string;
  let cache: Cache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-test-'));
    cache = new Cache({ dir: tmpDir, ttlSeconds: 60 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null on cache miss', () => {
    const result = cache.get('nonexistent-key');
    expect(result).toBeNull();
  });

  it('stores and retrieves cached response', () => {
    const key = 'test-key';
    const response = 'cached response content';
    const metadata = { model: 'gpt-4', tokens: 100 };

    cache.set(key, response, metadata);
    const result = cache.get(key);

    expect(result).not.toBeNull();
    expect(result!.response).toBe(response);
    expect(result!.metadata).toEqual(metadata);
    expect(result!.age).toBeGreaterThanOrEqual(0);
    expect(result!.age).toBeLessThan(5000);
  });

  it('returns null for expired entries', () => {
    const expiredCache = new Cache({ dir: tmpDir, ttlSeconds: 0 });
    expiredCache.set('expired-key', 'old data', {});

    const result = expiredCache.get('expired-key');
    expect(result).toBeNull();
  });

  it('generates consistent cache keys from same content', () => {
    const key1 = Cache.buildKey('content', 'gpt-4', 'gherkin', 'detailed', 0.7);
    const key2 = Cache.buildKey('content', 'gpt-4', 'gherkin', 'detailed', 0.7);
    expect(key1).toBe(key2);
  });

  it('generates different keys for different inputs', () => {
    const key1 = Cache.buildKey('content A', 'gpt-4', 'gherkin', 'detailed', 0.7);
    const key2 = Cache.buildKey('content B', 'gpt-4', 'gherkin', 'detailed', 0.7);
    expect(key1).not.toBe(key2);

    const key3 = Cache.buildKey('content A', 'gpt-4', 'gherkin', 'detailed', 0.7);
    const key4 = Cache.buildKey('content A', 'gpt-3.5', 'gherkin', 'detailed', 0.7);
    expect(key3).not.toBe(key4);
  });

  it('clears all cached entries', () => {
    cache.set('key1', 'response1', {});
    cache.set('key2', 'response2', {});

    expect(cache.get('key1')).not.toBeNull();
    expect(cache.get('key2')).not.toBeNull();

    cache.clear();

    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });

  it('deletes expired entry file on read (lazy cleanup)', () => {
    const expiredCache = new Cache({ dir: tmpDir, ttlSeconds: 0 });
    const key = 'lazy-delete-key';
    expiredCache.set(key, 'data', {});

    const filePath = path.join(tmpDir, `${key}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    expiredCache.get(key);

    expect(fs.existsSync(filePath)).toBe(false);
  });
});
