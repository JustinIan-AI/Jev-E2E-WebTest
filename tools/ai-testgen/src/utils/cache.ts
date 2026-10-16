import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './logger';

interface CacheEntry {
  response: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

interface CacheConfig {
  dir: string;
  ttlSeconds: number;
}

export class Cache {
  private dir: string;
  private ttlMs: number;

  constructor(config: CacheConfig) {
    this.dir = config.dir;
    this.ttlMs = config.ttlSeconds * 1000;
    try {
      if (!fs.existsSync(this.dir)) {
        fs.mkdirSync(this.dir, { recursive: true });
      }
    } catch {
      logger.warn(`Cannot create cache directory: ${this.dir}`);
    }
  }

  static buildKey(
    content: string,
    model: string,
    format: string,
    style: string,
    temperature: number,
  ): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${content}|${model}|${format}|${style}|${temperature}`);
    return hash.digest('hex');
  }

  get(key: string): { response: string; metadata: Record<string, unknown>; age: number } | null {
    const filePath = path.join(this.dir, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);
      const age = Date.now() - entry.createdAt;

      if (age >= this.ttlMs) {
        fs.unlinkSync(filePath);
        logger.debug(`Cache expired: ${key}`);
        return null;
      }

      logger.debug(`Cache hit: ${key} (${Math.round(age / 1000)}s old)`);
      return { response: entry.response, metadata: entry.metadata, age };
    } catch {
      return null;
    }
  }

  set(key: string, response: string, metadata: Record<string, unknown>): void {
    try {
      const entry: CacheEntry = { response, createdAt: Date.now(), metadata };
      const filePath = path.join(this.dir, `${key}.json`);
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
      logger.debug(`Cache saved: ${key}`);
    } catch {
      logger.warn(`Failed to write cache entry: ${key}`);
    }
  }

  clear(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const file of fs.readdirSync(this.dir)) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.dir, file));
      }
    }
    logger.info('Cache cleared');
  }
}
