/**
 * Task 15 / DD §6.2（DD-35）—— 引擎缓存交付（先行失败）。
 *
 * 缓存存放 `.idwth/engine-cache/`，按 engine_provider_version 分目录；
 * 加载时比对版本：不匹配 → 失效并告警，不得沿用；
 * 内网/离线部署时缓存产物随包交付（联网录一轮 → 产物随版本带入内网）。
 * 消费 Task 14 原语：engineCacheDir / checkCacheVersion / sanitizeVersionSegment。
 */
import { mkdtemp, readFile, rm, cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { engineCacheDir } from '../../src/engine-provider/index.js';
import {
  loadEngineCache,
  packEngineCache,
  writeEngineCache,
  type EngineCacheEntry,
} from '../../src/runtime/replay/engine-cache.js';

const tmpRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'idwth-engine-cache-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const entries: EngineCacheEntry[] = [
  { key: 'login.submit:1', strategy: 'role', elementId: 'el-1' },
  { key: 'login.submit:2', strategy: 'fingerprint', elementId: 7 },
];

describe('Task 15: writeEngineCache（联网录制落盘）', () => {
  it('按版本分目录写入 manifest.json，内容含 schema/version/entries', async () => {
    const root = await freshRoot();
    const { dir, manifestPath } = await writeEngineCache(root, 'e2e-1.0.0', entries);

    expect(dir).toBe(engineCacheDir(root, 'e2e-1.0.0'));
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(raw.schema).toBe('idwth.engine-cache/1');
    expect(raw.engineProviderVersion).toBe('e2e-1.0.0');
    expect(raw.entries).toEqual(entries);
    expect(Number.isNaN(Date.parse(raw.createdAt))).toBe(false);
  });

  it('版本段净化：非法字符不产生目录穿越（消费 sanitizeVersionSegment）', async () => {
    const root = await freshRoot();
    const { dir } = await writeEngineCache(root, '../../evil', entries);
    // 目录必须是 root 的直接子目录（无穿越、无嵌套逃逸）。
    expect(dirname(dir)).toBe(root);
    expect(basename(dir)).not.toMatch(/[/\\]/);
  });
});

describe('Task 15: loadEngineCache（命中 / 缺失 / 版本不匹配失效）', () => {
  it('版本一致 → hit，entries 原样返回', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'e2e-1.0.0', entries);

    const loaded = await loadEngineCache(root, 'e2e-1.0.0');
    expect(loaded.status).toBe('hit');
    if (loaded.status === 'hit') expect(loaded.entries).toEqual(entries);
  });

  it('目录不存在 → miss（not-found），首次态空缓存', async () => {
    const root = await freshRoot();
    const loaded = await loadEngineCache(root, 'e2e-1.0.0');
    expect(loaded).toEqual({ status: 'miss', reason: 'not-found' });
  });

  it('manifest 版本与当前不匹配 → stale（失效并告警），entries 绝不外泄', async () => {
    const root = await freshRoot();
    const { manifestPath } = await writeEngineCache(root, 'e2e-1.0.0', entries);
    // 模拟陈旧：目录在，但 manifest 记录的是旧版本（手工拷贝/损坏场景）。
    const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
    tampered.engineProviderVersion = 'e2e-0.9.0';
    await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');

    const loaded = await loadEngineCache(root, 'e2e-1.0.0');
    expect(loaded.status).toBe('stale');
    if (loaded.status === 'stale') {
      expect(loaded.stored).toBe('e2e-0.9.0');
      expect(loaded.current).toBe('e2e-1.0.0');
      expect(typeof loaded.warning).toBe('string');
    }
    expect('entries' in loaded).toBe(false);
  });

  it('manifest schema 未知 → 同样视为 stale，不得沿用', async () => {
    const root = await freshRoot();
    const { manifestPath } = await writeEngineCache(root, 'e2e-1.0.0', entries);
    const foreign = JSON.parse(await readFile(manifestPath, 'utf8'));
    foreign.schema = 'someone-else/9';
    await writeFile(manifestPath, JSON.stringify(foreign), 'utf8');

    expect((await loadEngineCache(root, 'e2e-1.0.0')).status).toBe('stale');
  });
});

describe('Task 15: packEngineCache（离线包打包）', () => {
  it('产出版本隔离的离线包描述：cacheDir/manifestPath/files', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'e2e-1.0.0', entries);

    const pkg = await packEngineCache(root, 'e2e-1.0.0');
    expect(pkg.schema).toBe('idwth.engine-cache-package/1');
    expect(pkg.engineProviderVersion).toBe('e2e-1.0.0');
    expect(pkg.cacheDir).toBe(engineCacheDir(root, 'e2e-1.0.0'));
    expect(pkg.files).toContain('manifest.json');
  });

  it('打包不存在的缓存 → 报错（不能交付没有的产物）', async () => {
    const root = await freshRoot();
    await expect(packEngineCache(root, 'e2e-1.0.0')).rejects.toThrow();
  });

  it('离线包带入内网（新根目录）后：同版本 hit、异版本不沿用', async () => {
    const onlineRoot = await freshRoot();
    await writeEngineCache(onlineRoot, 'e2e-1.0.0', entries);
    const pkg = await packEngineCache(onlineRoot, 'e2e-1.0.0');

    // 内网环境：新根目录，拷入离线包的版本目录。
    const offlineRoot = await freshRoot();
    await mkdir(offlineRoot, { recursive: true });
    await cp(pkg.cacheDir, engineCacheDir(offlineRoot, 'e2e-1.0.0'), { recursive: true });

    const hit = await loadEngineCache(offlineRoot, 'e2e-1.0.0');
    expect(hit.status).toBe('hit');

    // 引擎升级后（e2e-2.0.0）不得沿用旧版本缓存。
    const stale = await loadEngineCache(offlineRoot, 'e2e-2.0.0');
    expect(['miss', 'stale']).toContain(stale.status);
    expect('entries' in stale).toBe(false);
  });
});
