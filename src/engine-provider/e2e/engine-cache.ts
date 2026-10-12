/**
 * Task 14 / DD-35 —— 引擎缓存版本隔离原语。
 *
 * 上游执行引擎的动作缓存是离线可跑能力的一部分（§6.2 引擎缓存表）：
 * 存放于 `.idwth/engine-cache/`，按 `engine_provider_version` 分目录；
 * 加载时比对版本，**不匹配 → 失效并告警，不得沿用**。
 * Task 15 的缓存命中/离线包交付消费本原语。
 */
import { join } from 'node:path';

/** 版本目录段净化：仅保留字母/数字/点/下划线/连字符，其余替换为 `_`。 */
export function sanitizeVersionSegment(version: string): string {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('engine provider version must be a non-empty string (binding item ⑥)');
  }
  return version.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** 按引擎版本隔离的缓存目录（防目录穿越：版本段先净化）。 */
export function engineCacheDir(root: string, version: string): string {
  return join(root, sanitizeVersionSegment(version));
}

export type CacheVersionCheck =
  | { compatible: true }
  | { compatible: false; stored: string; current: string };

/** 加载缓存时比对版本；不匹配 → incompatible（调用方必须失效并告警，不得沿用）。 */
export function checkCacheVersion(input: { stored: string; current: string }): CacheVersionCheck {
  return input.stored === input.current
    ? { compatible: true }
    : { compatible: false, stored: input.stored, current: input.current };
}
