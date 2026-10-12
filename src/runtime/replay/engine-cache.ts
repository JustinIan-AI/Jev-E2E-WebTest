/**
 * Task 15 / DD §6.2（DD-35）—— 引擎缓存交付层。
 *
 * 上游执行引擎的动作缓存是离线可跑能力的一部分，必须随版本交付：
 *  - 存放 `.idwth/engine-cache/`，按 engine_provider_version 分目录；
 *  - 加载时比对版本：不匹配 → 失效并告警，不得沿用（entries 绝不外泄）；
 *  - 内网/离线部署：联网录一轮 → packEngineCache 打包 → 产物随版本带入内网。
 * 消费 Task 14 原语：engineCacheDir（版本目录隔离）/ checkCacheVersion（版本比对）。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkCacheVersion, engineCacheDir } from '../../engine-provider/index.js';

export const ENGINE_CACHE_SCHEMA = 'idwth.engine-cache/1' as const;
export const ENGINE_CACHE_PACKAGE_SCHEMA = 'idwth.engine-cache-package/1' as const;

/** 引擎缓存条目：上游动作解析记录（key 形如 `<caseId>:<stepIndex>`）。 */
export interface EngineCacheEntry {
  key: string;
  strategy: string;
  elementId: string | number;
}

export interface EngineCacheManifest {
  schema: typeof ENGINE_CACHE_SCHEMA;
  engineProviderVersion: string;
  createdAt: string;
  entries: EngineCacheEntry[];
}

/** 联网录制落盘：按版本分目录写入 manifest.json。 */
export async function writeEngineCache(
  root: string,
  version: string,
  entries: readonly EngineCacheEntry[],
): Promise<{ dir: string; manifestPath: string }> {
  const dir = engineCacheDir(root, version);
  await mkdir(dir, { recursive: true });
  const manifest: EngineCacheManifest = {
    schema: ENGINE_CACHE_SCHEMA,
    engineProviderVersion: version,
    createdAt: new Date().toISOString(),
    entries: [...entries],
  };
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { dir, manifestPath };
}

export type EngineCacheLoad =
  | { status: 'hit'; entries: EngineCacheEntry[]; manifestPath: string }
  | { status: 'miss'; reason: 'not-found' }
  | { status: 'stale'; stored: string; current: string; warning: string };

/**
 * 加载当前版本的引擎缓存。版本不匹配 / schema 未知 / manifest 损坏 → stale
 * （失效并告警），调用方不得沿用，entries 不外泄（A11 / DD-35）。
 */
export async function loadEngineCache(
  root: string,
  currentVersion: string,
): Promise<EngineCacheLoad> {
  const manifestPath = join(engineCacheDir(root, currentVersion), 'manifest.json');
  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    return { status: 'miss', reason: 'not-found' };
  }

  let manifest: EngineCacheManifest;
  try {
    manifest = JSON.parse(raw) as EngineCacheManifest;
  } catch {
    return {
      status: 'stale',
      stored: '<unreadable>',
      current: currentVersion,
      warning: 'engine cache manifest is not valid JSON; invalidated and not reused (DD-35)',
    };
  }

  if (manifest.schema !== ENGINE_CACHE_SCHEMA) {
    return {
      status: 'stale',
      stored: `schema:${String(manifest.schema)}`,
      current: `schema:${ENGINE_CACHE_SCHEMA}`,
      warning: 'engine cache manifest schema mismatch; invalidated and not reused (DD-35)',
    };
  }

  const check = checkCacheVersion({
    stored: manifest.engineProviderVersion,
    current: currentVersion,
  });
  if (!check.compatible) {
    return {
      status: 'stale',
      stored: check.stored,
      current: check.current,
      warning: `engine cache version mismatch (${check.stored} != ${check.current}); invalidated and not reused (DD-35)`,
    };
  }

  return { status: 'hit', entries: manifest.entries, manifestPath };
}

/** 离线交付包描述：版本隔离目录 + 实际文件清单（随版本带入内网）。 */
export interface EngineCachePackage {
  schema: typeof ENGINE_CACHE_PACKAGE_SCHEMA;
  engineProviderVersion: string;
  cacheDir: string;
  manifestPath: string;
  files: string[];
}

/** 打包指定版本的引擎缓存为离线交付物；目录缺失或版本不符 → 报错。 */
export async function packEngineCache(
  root: string,
  version: string,
): Promise<EngineCachePackage> {
  const dir = engineCacheDir(root, version);
  const manifestPath = join(dir, 'manifest.json');

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(
      `engine cache for version '${version}' does not exist; nothing to pack (DD-35)`,
    );
  }

  const manifest = JSON.parse(raw) as EngineCacheManifest;
  if (manifest.engineProviderVersion !== version) {
    throw new Error(
      `engine cache manifest version '${manifest.engineProviderVersion}' does not match requested '${version}'; refusing to pack`,
    );
  }

  const files = (await readdir(dir)).sort();
  return {
    schema: ENGINE_CACHE_PACKAGE_SCHEMA,
    engineProviderVersion: version,
    cacheDir: dir,
    manifestPath,
    files,
  };
}
