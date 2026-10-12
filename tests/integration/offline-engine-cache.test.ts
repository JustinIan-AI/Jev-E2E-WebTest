/**
 * Task 15 / AC-16 / TR-15.2 —— 离线运行与引擎缓存（先行失败）。
 *
 * A7a：回放态（引擎缓存命中）断开 JEV 端点 → 确定性路径全部可跑，SIR=0；
 * A7b：首次态清空缓存 → L1/L2 步骤可跑，需要 L3 的步骤必须 BLOCKED(decision)
 *      （不假装执行、不静默调用模型）；
 * 缓存版本不匹配不得沿用（离线包 / 缓存测试）。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Action,
  ActionResult,
  AssertionResult,
  EngineProvider,
  ResolveResult,
} from '../../src/engine-provider/index.js';
import { executeCase } from '../../src/runtime/executor.js';
import type { ExecutorCase, StepExecutionRecord } from '../../src/runtime/executor.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';
import { buildTraceFile } from '../../src/runtime/replay/trace.js';
import { replayVerify } from '../../src/runtime/replay/verify.js';
import {
  loadEngineCache,
  writeEngineCache,
  type EngineCacheEntry,
} from '../../src/runtime/replay/engine-cache.js';

const tmpRoots: string[] = [];

async function freshRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'idwth-offline-'));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/* ───────────────────────── 离线引擎 fake（断网：L3 一律抛错） ───────────────────────── */

interface OfflineSpec {
  l1?: ResolveResult;
  actQueue?: ActionResult[];
  assertionResults?: AssertionResult[];
}

function offlineEngine(spec: OfflineSpec = {}) {
  const state = {
    resolveByMode: { L1: 0, L2: 0, L3: 0 },
    actCalls: 0,
    dispatched: [] as Action[],
    assertionCalls: 0,
  };
  let actIdx = 0;
  const provider = {
    id: 'offline-fake',
    version: 'fake-0',
    observe: async () => {
      throw new Error('network down');
    },
    resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3') => {
      state.resolveByMode[mode] += 1;
      if (mode === 'L3') throw new Error('network down: JEV endpoint unreachable');
      if (mode === 'L2') return { status: 'miss' };
      return spec.l1 ?? { status: 'miss' };
    },
    act: async (action: Action) => {
      state.actCalls += 1;
      state.dispatched.push(action);
      const r = spec.actQueue?.[actIdx] ?? { kind: action.kind, status: 'ok', dispatched: true };
      actIdx += 1;
      return r as ActionResult;
    },
    checkAssertion: async (): Promise<AssertionResult> =>
      spec.assertionResults?.[0] ?? { kind: 'visible', passed: true, status: 'passed' },
    verifyFreshness: async () => true,
    screenshot: async () => {
      throw new Error('not needed');
    },
    trace: async () => {
      throw new Error('not needed');
    },
    dispose: async () => undefined,
  } as unknown as EngineProvider & FreshnessCapable;
  return Object.assign(provider, { state }) as typeof provider & { state: typeof state };
}

/* ───────────────────────── A7a：回放态（缓存命中）断网 ───────────────────────── */

const caseOf: ExecutorCase = {
  id: 'login.submit',
  steps: [
    {
      intent: '点击提交',
      action: 'click',
      risk: 'reversible',
      target: { role: 'button', name: '提交' },
      postcondition: [{ kind: 'visible', expected: true }],
    },
  ],
};

async function recordTrace(spec: OfflineSpec = {}) {
  const records: StepExecutionRecord[] = [];
  await executeCase(caseOf, offlineEngine(spec), { onStep: (r) => records.push(r) });
  return buildTraceFile(records, {
    caseId: caseOf.id,
    engineProviderVersion: 'fake-0',
    verdict: 'PASS',
  });
}

describe('A7a：回放态引擎缓存命中 + 断开 JEV 端点', () => {
  it('确定性路径全部可跑，SIR=0（零模型调用）', async () => {
    const root = await freshRoot();
    // 联网录一轮：动作缓存随版本落盘（离线交付物的来源）。
    const entries: EngineCacheEntry[] = [
      { key: 'login.submit:0', strategy: 'role', elementId: 'el-1' },
    ];
    await writeEngineCache(root, 'fake-0', entries);
    // 缓存命中（版本一致）。
    expect((await loadEngineCache(root, 'fake-0')).status).toBe('hit');

    const trace = await recordTrace({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
    });

    const result = await replayVerify({
      case: caseOf,
      trace,
      provider: offlineEngine({
        l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
      }),
      engineCache: { root, currentVersion: 'fake-0' },
    });

    expect(result.outcome).toBe('match');
    expect(result.modelCalls).toBe(0); // SIR = 0
    expect(result.caseResult).toEqual({ status: 'completed' });
  });
});

/* ───────────────────────── A7b：首次态清空缓存 ───────────────────────── */

const firstRunCase: ExecutorCase = {
  id: 'deploy.create',
  steps: [
    {
      intent: '打开控制台',
      action: 'navigate',
      risk: 'reversible',
      url: 'https://sut.example/console',
    },
    {
      intent: '点击【创建部署】',
      action: 'click',
      risk: 'reversible',
      target: { role: 'button', name: '创建部署' }, // 无指纹：L1/L2 均未命中才需 L3
    },
  ],
};

describe('A7b：首次态清空缓存（离线）', () => {
  it('L1/L2 步骤可跑；需要 L3 的步骤 BLOCKED(decision)，零模型零派发', async () => {
    const root = await freshRoot();
    // 首次态：缓存为空。
    expect(await loadEngineCache(root, 'fake-0')).toEqual({ status: 'miss', reason: 'not-found' });

    const engine = offlineEngine({ l1: { status: 'miss' } }); // L1 miss、无指纹 → 无 L2 → 需 L3
    const result = await executeCase(firstRunCase, engine, {
      // 未注入 decision（离线断网：模型不可用）→ 纯确定性路径。
    });

    expect(result).toMatchObject({ status: 'blocked', reason: 'decision' });
    // L1/L2 步骤真实跑过：navigate 已派发。
    expect(engine.state.dispatched).toHaveLength(1);
    expect(engine.state.dispatched[0]).toMatchObject({ kind: 'navigate' });
    // 零模型：L3 未被触达（断网下 provider.resolve('L3') 若被调用会抛错）。
    expect(engine.state.resolveByMode.L3).toBe(0);
  });
});

/* ───────────────────────── 版本不匹配不复用 ───────────────────────── */

describe('引擎缓存版本不匹配不得沿用（离线交付）', () => {
  it('录制版本 e2e-1.0.0 的缓存，在 e2e-2.0.0 环境下不外露 entries', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'e2e-1.0.0', [
      { key: 'login.submit:0', strategy: 'role', elementId: 'el-1' },
    ]);

    const loaded = await loadEngineCache(root, 'e2e-2.0.0');
    // 版本目录隔离：新版本目录不存在 → miss（不沿用旧版本产物）。
    expect(loaded.status).toBe('miss');
    expect('entries' in loaded).toBe(false);
  });

  it('manifest 被篡改为旧版本 → stale（失效并告警），缓存条目不外露', async () => {
    const root = await freshRoot();
    const { manifestPath } = await writeEngineCache(root, 'e2e-1.0.0', [
      { key: 'login.submit:0', strategy: 'role', elementId: 'el-1' },
    ]);
    // 模拟「随包带入」的缓存实际记录了另一版本（交付错包）。
    const { readFile, writeFile } = await import('node:fs/promises');
    const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
    tampered.engineProviderVersion = 'e2e-0.9.0';
    await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');

    const loaded = await loadEngineCache(root, 'e2e-1.0.0');
    expect(loaded.status).toBe('stale');
    if (loaded.status === 'stale') {
      expect(loaded.stored).toBe('e2e-0.9.0');
      expect(loaded.current).toBe('e2e-1.0.0');
    }
    expect('entries' in loaded).toBe(false);
  });
});
