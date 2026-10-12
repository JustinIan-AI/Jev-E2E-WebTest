/**
 * Task 13 —— Recovery 审计单元测试（AC-07 / DD §8.3）。
 *
 * TR-13 审计面：每次语义 Recovery 留下一条 RecoveryRecord ——
 *   stepIndex / intent / case 级 attempt / fixed / mode /
 *   before/after fresh 快照（经观测脱敏）/ latency。
 * 快照采集：观测失败只记 error，不中断 Recovery 判定。
 */
import { describe, expect, it } from 'vitest';
import type {
  Action,
  ActionResult,
  AssertionResult,
  AssertionSpec,
  EngineProvider,
  Observation,
  ResolveResult,
} from '../../src/engine-provider/index.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';
import { executeCase, type ExecutorCase, type ExecutorStep } from '../../src/runtime/executor.js';
import {
  captureRecoverySnapshot,
  normalizeRecoveryOutcome,
  type RecoveryRecord,
} from '../../src/runtime/recovery-audit.js';

/* ───────────────────────── fake 引擎 ───────────────────────── */

const baseObservation: Observation = {
  observationId: 'obs-1',
  fingerprint: 'fp-1',
  url: 'https://sut.example/app',
  title: 'SUT',
  elements: [
    { id: 0, role: 'button', name: '提交', text: '提交', visible: true, enabled: true, guard: 'g0' },
  ],
  textExcerpt: '控制台',
} as unknown as Observation;

interface FakeSpec {
  actQueue: ActionResult[];
  postcondition?: AssertionResult;
  observation?: Observation;
  observeThrows?: string;
}

function fakeEngine(spec: FakeSpec): {
  provider: EngineProvider & FreshnessCapable;
  state: { actCalls: number; observeCalls: number };
  assertions: AssertionSpec[];
} {
  const state = { actCalls: 0, observeCalls: 0 };
  const assertions: AssertionSpec[] = [];
  let actIdx = 0;

  const provider = {
    id: 'fake',
    version: 'fake-0',
    observe: async (): Promise<Observation> => {
      state.observeCalls += 1;
      if (spec.observeThrows) throw new Error(spec.observeThrows);
      return spec.observation ?? baseObservation;
    },
    resolve: async (): Promise<ResolveResult> => ({
      status: 'resolved',
      mode: 'L1',
      elementId: 'el-1',
      strategy: 'role',
    }),
    verifyFreshness: async () => true,
    act: async (action: Action): Promise<ActionResult> => {
      state.actCalls += 1;
      const queue = spec.actQueue;
      const result = queue[Math.min(actIdx, queue.length - 1)]!;
      actIdx += 1;
      return result;
    },
    checkAssertion: async (s: AssertionSpec): Promise<AssertionResult> => {
      assertions.push(s);
      return spec.postcondition ?? { kind: 'visible', passed: true, status: 'passed' };
    },
    screenshot: async () => {
      throw new Error('not needed');
    },
    trace: async () => {
      throw new Error('not needed');
    },
    dispose: async () => undefined,
  } as unknown as EngineProvider & FreshnessCapable;

  return { provider, state, assertions };
}

function recoveryStep(): ExecutorStep {
  return {
    intent: '点击【提交】',
    action: 'click',
    risk: 'reversible',
    target: { role: 'button', name: '提交' },
    postcondition: [{ kind: 'visible' }],
  };
}

const okClick: ActionResult = { kind: 'click', status: 'ok', dispatched: true };
const notFound: ActionResult = { kind: 'click', status: 'not_found', dispatched: false };

function recoveriesOf(result: unknown): RecoveryRecord[] {
  return ((result as { recoveries?: RecoveryRecord[] }).recoveries ?? []) as RecoveryRecord[];
}

/* ─────────────────── 工具函数：outcome 归一 + 快照采集 ─────────────────── */

describe('recovery-audit 工具函数', () => {
  it('normalizeRecoveryOutcome：boolean 归一为 {ok}，对象透传', () => {
    expect(normalizeRecoveryOutcome(true)).toEqual({ ok: true });
    expect(normalizeRecoveryOutcome(false)).toEqual({ ok: false });
    expect(normalizeRecoveryOutcome({ ok: true, mode: 're-navigate' })).toEqual({
      ok: true,
      mode: 're-navigate',
    });
  });

  it('captureRecoverySnapshot：fresh 观测经脱敏（credential 键 → [REDACTED]）', async () => {
    const observation = {
      ...(baseObservation as unknown as Record<string, unknown>),
      meta: { authorization: 'Bearer secret-token' },
    };
    const snap = await captureRecoverySnapshot(
      { observe: async () => observation as unknown as Observation },
      ['secret-token'],
    );
    expect(snap.error).toBeUndefined();
    expect(snap.snapshot).toBeDefined();
    expect((snap.snapshot as Record<string, unknown>).meta).toEqual({
      authorization: '[REDACTED]',
    });
  });

  it('captureRecoverySnapshot：observe 抛错 → 记录 error，不抛出', async () => {
    const snap = await captureRecoverySnapshot(
      { observe: async () => {
        throw new Error('page closed');
      } },
      [],
    );
    expect(snap.snapshot).toBeUndefined();
    expect(snap.error).toBe('page closed');
  });
});

/* ─────────────────── Executor 审计记录（CaseResult.recoveries） ─────────────────── */

describe('Executor Recovery 审计记录（AC-07）', () => {
  it('recovery 成功：记录 stepIndex/intent/attempt/fixed/mode/before/after/latency', async () => {
    const engine = fakeEngine({ actQueue: [notFound, okClick] });
    const result = await executeCase(
      { id: 'a.b', steps: [recoveryStep()] },
      engine.provider,
      {
        recover: async () => ({ ok: true, mode: 're-navigate' }),
        secrets: ['secret-token'],
      },
    );
    expect(result.status).toBe('completed');
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      stepIndex: 0,
      intent: '点击【提交】',
      attempt: 1,
      fixed: true,
      mode: 're-navigate',
    });
    expect(recs[0]!.before).toBeDefined();
    expect(recs[0]!.after).toBeDefined();
    expect(recs[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('boolean 返回的旧钩子：记录 fixed，无 mode 字段', async () => {
    const engine = fakeEngine({ actQueue: [notFound, okClick] });
    const result = await executeCase(
      { id: 'a.b', steps: [recoveryStep()] },
      engine.provider,
      { recover: async () => true },
    );
    expect(result.status).toBe('completed');
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.fixed).toBe(true);
    expect(recs[0]!.mode).toBeUndefined();
  });

  it('recovery 失败：记录 fixed:false、有 before 无 after；BLOCKED(recovery) 不重派', async () => {
    const engine = fakeEngine({ actQueue: [notFound] });
    const result = await executeCase(
      { id: 'a.b', steps: [recoveryStep()] },
      engine.provider,
      { recover: async () => ({ ok: false, mode: 'dismiss-modal' }) },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(engine.state.actCalls).toBe(1);
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ attempt: 1, fixed: false, mode: 'dismiss-modal' });
    expect(recs[0]!.before).toBeDefined();
    expect(recs[0]!.after).toBeUndefined();
  });

  it('case 级 attempt 连续编号：3 次成功恢复 → attempts [1,2,3]；第 4 步失败超上限不再恢复', async () => {
    const steps: ExecutorStep[] = [
      ...Array.from({ length: 3 }, () => recoveryStep()),
      recoveryStep(),
    ];
    const engine = fakeEngine({
      actQueue: [
        notFound, okClick, // step0
        notFound, okClick, // step1
        notFound, okClick, // step2
        notFound, // step3：超 case 上限
      ],
    });
    const result = await executeCase({ id: 'a.b' as const, steps } as ExecutorCase, engine.provider, {
      recover: async () => true,
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    const recs = recoveriesOf(result);
    expect(recs.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(recs.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
    expect(engine.state.actCalls).toBe(7);
  });

  it('快照采集失败：beforeError/afterError 入档且不中断 Recovery 与判定', async () => {
    const engine = fakeEngine({
      actQueue: [notFound, okClick],
      observeThrows: 'page closed',
    });
    const result = await executeCase(
      { id: 'a.b', steps: [recoveryStep()] },
      engine.provider,
      { recover: async () => true },
    );
    expect(result.status).toBe('completed');
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.before).toBeUndefined();
    expect(recs[0]!.beforeError).toBe('page closed');
    expect(recs[0]!.after).toBeUndefined();
    expect(recs[0]!.afterError).toBe('page closed');
    expect(recs[0]!.fixed).toBe(true);
  });
});
