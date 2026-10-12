/**
 * Task 15 / AC-11 / TR-15.1 —— replay verify（默认模式）集成测试（先行失败）。
 *
 * DD §4.7：--verify 为默认、零模型调用；数据来源为 Trace 记录的
 * resolved_target + actions；逐步比对四项（任一不一致即 DRIFT）：
 *   resolve.strategy / resolve.matched / action_result.status / assertion results
 * 任一漂移 → 报 DRIFT 并终止，BLOCKED(drift)（A6），产物可入 CI。
 * A11：引擎缓存记录陈旧时以默认命令回放 → 报错终止，不得静默 heal 后报通过。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { writeEngineCache } from '../../src/runtime/replay/engine-cache.js';
import { isCiUsableReplayOutcome } from '../../src/runtime/replay/ci-gate.js';

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/* ───────────────────────── 被回放的 case 与录制 trace ───────────────────────── */

const caseOf: ExecutorCase = {
  id: 'login.submit',
  steps: [
    {
      intent: '打开登录页',
      action: 'navigate',
      risk: 'reversible',
      url: 'https://sut.example/login',
    },
    {
      intent: '点击提交',
      action: 'click',
      risk: 'reversible',
      target: { role: 'button', name: '提交' },
      postcondition: [{ kind: 'visible', expected: true }],
    },
  ],
};

const goodRun = {
  l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' } as ResolveResult,
  actQueue: [
    { kind: 'navigate', status: 'ok', dispatched: true },
    { kind: 'click', status: 'ok', dispatched: true },
  ] as ActionResult[],
};

async function recordGoodTrace(): Promise<ReturnType<typeof buildTraceFile>> {
  const records: StepExecutionRecord[] = [];
  await executeCase(caseOf, makeEngine(goodRun), { onStep: (r) => records.push(r) });
  return buildTraceFile(records, {
    caseId: caseOf.id,
    engineProviderVersion: 'fake-0',
    verdict: 'PASS',
  });
}

/* ───────────────────────── 回放态引擎 fake ───────────────────────── */

interface ReplaySpec {
  l1?: ResolveResult;
  actQueue?: ActionResult[];
  assertionResults?: AssertionResult[];
  /** L3 断网模拟：resolve('L3') 抛错（回放态绝不触网）。 */
  l3Throws?: string;
}

interface ReplayState {
  resolveByMode: Record<'L1' | 'L2' | 'L3', number>;
  actCalls: number;
  assertionCalls: number;
  dispatched: Action[];
}

function makeEngine(
  spec: ReplaySpec = {},
): EngineProvider & FreshnessCapable & { state: ReplayState } {
  const state: ReplayState = {
    resolveByMode: { L1: 0, L2: 0, L3: 0 },
    actCalls: 0,
    assertionCalls: 0,
    dispatched: [],
  };
  let actIdx = 0;
  let assertIdx = 0;
  const provider = {
    id: 'fake',
    version: 'fake-0',
    observe: async () => {
      throw new Error('not needed');
    },
    resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3') => {
      state.resolveByMode[mode] += 1;
      if (mode === 'L3') {
        if (spec.l3Throws) throw new Error(spec.l3Throws);
        return { status: 'miss', candidates: [] };
      }
      if (mode === 'L2') return { status: 'miss' };
      return spec.l1 ?? { status: 'miss' };
    },
    act: async (action: Action) => {
      state.actCalls += 1;
      state.dispatched.push(action);
      const r =
        spec.actQueue?.[actIdx] ?? { kind: action.kind, status: 'ok', dispatched: true };
      actIdx += 1;
      return r as ActionResult;
    },
    checkAssertion: async (): Promise<AssertionResult> => {
      state.assertionCalls += 1;
      const r = spec.assertionResults?.[assertIdx] ?? {
        kind: 'visible',
        passed: true,
        status: 'passed',
      };
      assertIdx += 1;
      return r;
    },
    verifyFreshness: async () => true,
    screenshot: async () => {
      throw new Error('not needed');
    },
    trace: async () => {
      throw new Error('not needed');
    },
    dispose: async () => undefined,
  } as unknown as EngineProvider & FreshnessCapable;
  return Object.assign(provider, { state }) as EngineProvider &
    FreshnessCapable & { state: ReplayState };
}

/* ───────────────────────── TR-15.1 ───────────────────────── */

describe('replay verify（默认）：一致回放', () => {
  it('与录制 trace 逐项一致 → outcome=match / completed / modelCalls=0', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine(goodRun);

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result).toMatchObject({
      mode: 'verify',
      outcome: 'match',
      modelCalls: 0,
      stepsExecuted: 2,
    });
    expect(result.driftPoints).toEqual([]);
    expect(result.caseResult).toEqual({ status: 'completed' });
    // verify 产物可入 CI。
    expect(isCiUsableReplayOutcome(result)).toBe(true);
  });

  it('零模型硬保证：resolve 只走 L1/L2，L3 永不被触达', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine({ l1: { status: 'miss' } });

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result.outcome).toBe('drift');
    expect(engine.state.resolveByMode.L3).toBe(0);
    expect(result.modelCalls).toBe(0);
  });
});

describe('replay verify：四项逐步比对（任一不一致即 DRIFT 并终止）', () => {
  it('A6 resolve.matched 漂移：页面改版后 L1 未命中 → BLOCKED(drift)，立即终止', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine({ l1: { status: 'miss' } }); // 按钮位置变化：不再命中

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result.mode).toBe('verify');
    expect(result.outcome).toBe('drift');
    expect(result.caseResult).toEqual({ status: 'blocked', reason: 'drift' });
    expect(result.driftPoints).toHaveLength(1);
    expect(result.driftPoints[0]).toMatchObject({
      stepIndex: 1,
      field: 'resolve.matched',
      recorded: 'resolved',
      replayed: 'miss',
    });
    // 终止：漂移步不再派发动作（只有 step0 的 navigate）。
    expect(engine.state.actCalls).toBe(1);
    expect(result.stepsExecuted).toBe(1);
    expect(isCiUsableReplayOutcome(result)).toBe(true); // verify 产物可入 CI
  });

  it('resolve.strategy 漂移：命中但定位级变化 → DRIFT，不得静默换级派发', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine({
      l1: { status: 'resolved', mode: 'L2', elementId: 'el-1', strategy: 'fingerprint' },
    });

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result.outcome).toBe('drift');
    expect(result.driftPoints[0]).toMatchObject({
      stepIndex: 1,
      field: 'resolve.strategy',
      recorded: 'role',
      replayed: 'fingerprint',
    });
    expect(engine.state.actCalls).toBe(1); // 漂移步未派发
  });

  it('action_result.status 漂移：录制 ok / 回放 not_found → DRIFT', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine({
      ...goodRun,
      actQueue: [
        { kind: 'navigate', status: 'ok', dispatched: true },
        { kind: 'click', status: 'not_found', dispatched: false },
      ],
    });

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result.outcome).toBe('drift');
    expect(result.caseResult).toEqual({ status: 'blocked', reason: 'drift' });
    expect(result.driftPoints[0]).toMatchObject({
      stepIndex: 1,
      field: 'action_result.status',
      recorded: 'ok',
      replayed: 'not_found',
    });
  });

  it('assertion results 漂移：录制 passed / 回放 failed → DRIFT', async () => {
    const trace = await recordGoodTrace();
    const engine = makeEngine({
      ...goodRun,
      assertionResults: [{ kind: 'visible', passed: false, status: 'failed' }],
    });

    const result = await replayVerify({ case: caseOf, trace, provider: engine });

    expect(result.outcome).toBe('drift');
    expect(result.driftPoints[0]).toMatchObject({
      stepIndex: 1,
      field: 'assertion_results',
    });
    const dp = result.driftPoints[0]! as {
      recorded: Array<{ passed: boolean }>;
      replayed: Array<{ passed: boolean }>;
    };
    expect(dp.recorded[0]!.passed).toBe(true);
    expect(dp.replayed[0]!.passed).toBe(false);
  });
});

describe('replay verify：A11 陈旧引擎缓存（默认命令报错终止）', () => {
  it('缓存版本不匹配 → stale-cache 报错：零执行、零模型、不得静默 heal 后 PASS', async () => {
    const trace = await recordGoodTrace();
    const root = await mkdtemp(join(tmpdir(), 'idwth-replay-cache-'));
    tmpRoots.push(root);
    const { manifestPath } = await writeEngineCache(root, 'fake-0', [
      { key: 'login.submit:1', strategy: 'role', elementId: 'el-1' },
    ]);
    const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
    tampered.engineProviderVersion = 'fake-old';
    await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');

    const engine = makeEngine(goodRun);
    const result = await replayVerify({
      case: caseOf,
      trace,
      provider: engine,
      engineCache: { root, currentVersion: 'fake-0' },
    });

    expect(result.outcome).toBe('stale-cache');
    expect(result.stepsExecuted).toBe(0);
    expect(result.modelCalls).toBe(0);
    expect(result.caseResult.status).toBe('blocked');
    expect(engine.state.actCalls).toBe(0); // 一个动作都未派发
    if (result.outcome === 'stale-cache') {
      expect(result.stale).toEqual({ stored: 'fake-old', current: 'fake-0' });
    }
  });

  it('缓存版本一致（hit）→ 正常回放', async () => {
    const trace = await recordGoodTrace();
    const root = await mkdtemp(join(tmpdir(), 'idwth-replay-cache-'));
    tmpRoots.push(root);
    await writeEngineCache(root, 'fake-0', [
      { key: 'login.submit:1', strategy: 'role', elementId: 'el-1' },
    ]);

    const result = await replayVerify({
      case: caseOf,
      trace,
      provider: makeEngine(goodRun),
      engineCache: { root, currentVersion: 'fake-0' },
    });

    expect(result.outcome).toBe('match');
  });
});

describe('replay verify：结构性守卫', () => {
  it('trace 与 case 步数不一致 → 报配置错误（不属于页面漂移）', async () => {
    const trace = await recordGoodTrace();
    const shorter: ExecutorCase = { ...caseOf, steps: caseOf.steps.slice(0, 1) };
    await expect(
      replayVerify({ case: shorter, trace, provider: makeEngine(goodRun) }),
    ).rejects.toThrow(/step/i);
  });
});
