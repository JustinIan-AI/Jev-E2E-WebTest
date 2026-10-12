/**
 * Task 14 / DD-35 —— 引擎缓存版本隔离原语单测。
 *
 * 缓存按 engine_provider_version 分目录；版本不匹配 → 失效并告警，不得沿用
 * （§6.2 引擎缓存表）。Task 15 的 `.idwth/engine-cache/` 交付消费本原语。
 */
import { describe, expect, it } from 'vitest';
import {
  checkCacheVersion,
  engineCacheDir,
  sanitizeVersionSegment,
} from '../../src/engine-provider/e2e/engine-cache.js';

describe('engineCacheDir —— 按 engine_provider_version 隔离（DD-35）', () => {
  it('版本进目录名：不同版本 → 不同目录', () => {
    const a = engineCacheDir('/x/.idwth/engine-cache', '0.4.2');
    const b = engineCacheDir('/x/.idwth/engine-cache', '0.5.0');
    expect(a).toContain('0.4.2');
    expect(b).toContain('0.5.0');
    expect(a).not.toBe(b);
  });

  it('目录包含版本段且位于 root 之下', () => {
    const dir = engineCacheDir('/x/.idwth/engine-cache', '1.0.0');
    expect(dir.startsWith('/x/.idwth/engine-cache')).toBe(true);
    expect(dir).toBe('/x/.idwth/engine-cache/1.0.0');
  });

  it('版本段中的路径危险字符被净化（防目录穿越）', () => {
    expect(sanitizeVersionSegment('../../etc')).toBe('.._.._etc');
    expect(sanitizeVersionSegment('1.0.0-beta+exp')).toBe('1.0.0-beta_exp');
  });

  it('空版本拒绝（version 必须回传，硬约束④）', () => {
    expect(() => engineCacheDir('/x', '')).toThrow();
    expect(() => sanitizeVersionSegment('')).toThrow();
  });
});

describe('checkCacheVersion —— 版本不匹配不沿用（DD-35）', () => {
  it('一致 → compatible', () => {
    expect(checkCacheVersion({ stored: '0.4.2', current: '0.4.2' })).toEqual({
      compatible: true,
    });
  });

  it('不一致 → incompatible，附 stored/current 供告警', () => {
    const r = checkCacheVersion({ stored: '0.4.2', current: '0.5.0' });
    expect(r).toEqual({
      compatible: false,
      stored: '0.4.2',
      current: '0.5.0',
    });
  });
});
