/**
 * Task 18 / TR-18.2 / AC-16 —— 离线发布包契约（先行失败）。
 *
 * 离线/内网发布包必须：
 *  - 包含按 engine_provider_version 隔离的引擎缓存（版本不符拒绝打包）；
 *  - 携带可运行入口（bin/dist/package.json）与打包清单；
 *  - 产物无明文凭据（复用 TR-8.1 扫描）；
 *  - 断网验收：用包内缓存走 replayVerify，SIR=0。
 */
import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOfflinePackage } from '../../src/runtime/offline-package.js';
import { writeEngineCache } from '../../src/runtime/replay/engine-cache.js';
import { scanFilesForSecrets } from '../../src/runtime/redaction.js';

const tmpRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'idwth-offline-pkg-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const SECRETS = [
  'sk-ant-api03-',
  'sk-proj-',
  'ghp_AbCdEfGh',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'AKIAIOSFODNN7',
  'xoxb-',
];

/** 最小可运行项目根：bin/ + package.json（dist 复制同路径，测试用小文件代替）。 */
async function seedProjectRoot(root: string): Promise<void> {
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'bin', 'idwth.js'), '#!/usr/bin/env node\n', 'utf8');
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'idwth', type: 'module', bin: { idwth: 'bin/idwth.js' } }, null, 2)}\n`,
    'utf8',
  );
}

describe('buildOfflinePackage：结构', () => {
  it('产出 manifest + 版本隔离缓存 + 可运行入口，files 清单与磁盘一致', async () => {
    const project = await freshRoot();
    const cacheRoot = await mkdtemp(join(tmpdir(), 'idwth-cache-'));
    tmpRoots.push(cacheRoot);
    await seedProjectRoot(project);
    const outDir = join(project, 'offline-package');

    await writeEngineCache(cacheRoot, 'e2e-1.2.0', [
      { key: 'login.submit:0', strategy: 'role', elementId: 'el-1' },
    ]);

    const result = await buildOfflinePackage({
      projectRoot: project,
      cacheRoot,
      version: 'e2e-1.2.0',
      outDir,
    });

    expect(result.outDir).toBe(outDir);
    expect(result.manifest.engineProviderVersion).toBe('e2e-1.2.0');
    expect(result.manifest.files).toEqual(result.files);
    expect(result.files).toContain('OFFLINE-PACKAGE-MANIFEST.json');
    expect(result.files).toContain(`engine-cache/e2e-1.2.0/manifest.json`);
    expect(result.files).toContain('bin/idwth.js');
    expect(result.files).toContain('package.json');

    // 磁盘真实存在
    expect(existsSync(join(outDir, 'OFFLINE-PACKAGE-MANIFEST.json'))).toBe(true);
    expect(existsSync(join(outDir, `engine-cache/e2e-1.2.0/manifest.json`))).toBe(true);
    // manifest schema 与版本绑定
    expect(result.manifest.schema).toBe('idwth.offline-package/1');
  });

  it('版本隔离：包内只含请求版本的缓存目录', async () => {
    const project = await freshRoot();
    const cacheRoot = await mkdtemp(join(tmpdir(), 'idwth-cache-'));
    tmpRoots.push(cacheRoot);
    await seedProjectRoot(project);
    await writeEngineCache(cacheRoot, 'e2e-1.0.0', [
      { key: 'a:0', strategy: 'role', elementId: 'x' },
    ]);
    await writeEngineCache(cacheRoot, 'e2e-2.0.0', [
      { key: 'b:0', strategy: 'role', elementId: 'y' },
    ]);

    const result = await buildOfflinePackage({
      projectRoot: project,
      cacheRoot,
      version: 'e2e-2.0.0',
      outDir: join(project, 'pkg'),
    });

    const cacheVersionDirs = result.files
      .filter((f) => f.startsWith('engine-cache/'))
      .map((f) => f.split('/')[1]);
    expect(new Set(cacheVersionDirs)).toEqual(new Set(['e2e-2.0.0']));
  });

  it('缓存缺失 / 版本不符 → 拒绝打包（不产出半成品）', async () => {
    const project = await freshRoot();
    const cacheRoot = await mkdtemp(join(tmpdir(), 'idwth-cache-'));
    tmpRoots.push(cacheRoot);
    await seedProjectRoot(project);
    await writeEngineCache(cacheRoot, 'e2e-1.0.0', [
      { key: 'a:0', strategy: 'role', elementId: 'x' },
    ]);

    await expect(
      buildOfflinePackage({
        projectRoot: project,
        cacheRoot,
        version: 'e2e-9.9.9',
        outDir: join(project, 'pkg'),
      }),
    ).rejects.toThrow(/e2e-9\.9\.9/);
    expect(existsSync(join(project, 'pkg'))).toBe(false);
  });

  it('产物无明文凭据（TR-8.1 扫描为空）', async () => {
    const project = await freshRoot();
    const cacheRoot = await mkdtemp(join(tmpdir(), 'idwth-cache-'));
    tmpRoots.push(cacheRoot);
    await seedProjectRoot(project);
    await writeEngineCache(cacheRoot, 'e2e-1.0.0', [
      { key: 'a:0', strategy: 'role', elementId: 'x' },
    ]);

    const result = await buildOfflinePackage({
      projectRoot: project,
      cacheRoot,
      version: 'e2e-1.0.0',
      outDir: join(project, 'pkg'),
    });
    expect(await scanFilesForSecrets(result.outDir, SECRETS)).toEqual([]);
  });
});

describe('断网验收：包内缓存回放 SIR=0', () => {
  it('用包内 engine-cache 走 replayVerify：outcome=match 且零模型', async () => {
    // 精简离线 fake（断网：L3/observe 一律抛错）。
    const { executeCase } = await import('../../src/runtime/executor.js');
    const { buildTraceFile } = await import('../../src/runtime/replay/trace.js');
    const { replayVerify } = await import('../../src/runtime/replay/verify.js');
    const { loadEngineCache } = await import('../../src/runtime/replay/engine-cache.js');
    type EngineProvider = Parameters<typeof executeCase>[1];
    const offlineEngine = (l1: unknown): EngineProvider => {
      const resolveCalls = { L3: 0 };
      return {
        id: 'offline-fake',
        version: 'e2e-1.0.0',
        observe: async () => {
          throw new Error('network down');
        },
        resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3') => {
          if (mode === 'L3') {
            resolveCalls.L3 += 1;
            throw new Error('network down: JEV endpoint unreachable');
          }
          return l1 as never;
        },
        act: async (action: { kind: string }) => ({
          kind: action.kind,
          status: 'ok',
          dispatched: true,
        }) as never,
        checkAssertion: async () => ({ kind: 'visible', passed: true, status: 'passed' }) as never,
        verifyFreshness: async () => true,
        screenshot: async () => {
          throw new Error('not needed');
        },
        trace: async () => {
          throw new Error('not needed');
        },
        dispose: async () => undefined,
        state: resolveCalls,
      } as unknown as EngineProvider;
    };

    const kase = {
      id: 'login.submit',
      steps: [
        {
          intent: '点击提交',
          action: 'click' as const,
          risk: 'reversible' as const,
          target: { role: 'button', name: '提交' },
          postcondition: [{ kind: 'visible' as const, expected: true }],
        },
      ],
    };

    const project = await freshRoot();
    const cacheRoot = await mkdtemp(join(tmpdir(), 'idwth-cache-'));
    tmpRoots.push(cacheRoot);
    await seedProjectRoot(project);
    await writeEngineCache(cacheRoot, 'e2e-1.0.0', [
      { key: 'login.submit:0', strategy: 'role', elementId: 'el-1' },
    ]);
    const result = await buildOfflinePackage({
      projectRoot: project,
      cacheRoot,
      version: 'e2e-1.0.0',
      outDir: join(project, 'pkg'),
    });

    // 断网环境：从包内缓存加载。
    const pkgCacheRoot = join(result.outDir, 'engine-cache');
    const loaded = await loadEngineCache(pkgCacheRoot, 'e2e-1.0.0');
    expect(loaded.status).toBe('hit');

    const records: unknown[] = [];
    await executeCase(kase as never, offlineEngine({
      status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role',
    }), { onStep: (r: unknown) => records.push(r) });
    const trace = buildTraceFile(records as never, {
      caseId: kase.id,
      engineProviderVersion: 'e2e-1.0.0',
      verdict: 'PASS',
    });

    const replay = await replayVerify({
      case: kase as never,
      trace,
      provider: offlineEngine({
        status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role',
      }),
      engineCache: { root: pkgCacheRoot, currentVersion: 'e2e-1.0.0' },
    });
    expect(replay.outcome).toBe('match');
    expect(replay.modelCalls).toBe(0); // SIR = 0
  });
});
