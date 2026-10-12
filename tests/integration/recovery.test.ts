/**
 * Task 13 —— Recovery 集成测试（AC-07 / DD §8.3）。
 *
 * TR-13.1：
 *   A4 修改断言被拒绝并审计终止 —— Recovery 钩子零参调用拿不到 Goal/Assertion
 *      句柄；派发前固化的 postcondition 副本在恢复后校验，运行期篡改不生效；
 *   A9 错误但看似合理的目标被步级 postcondition 捕获 —— L3 接受合理候选并派发，
 *      步级断言失败 → BLOCKED(postcondition)，零 recovery。
 * TR-13.2：同一步第二次恢复、超过 case 上限（3 次/case）均 BLOCKED(recovery)。
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
  ResolvedTarget,
} from '../../src/engine-provider/index.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';
import { executeCase, type ExecutorStep } from '../../src/runtime/executor.js';
import type { RecoveryRecord } from '../../src/runtime/recovery-audit.js';
import { MockDecisionProvider } from '../../src/adapters/jev/mock.js';
import type { DecisionRecord } from '../../src/runtime/resolve-l3.js';

/* ───────────────────────── 引擎 fake（跨模块集成：executor + resolve-l3 + redaction） ───────────────────────── */

interface L3Candidate {
  elementId: string | number;
  role?: string;
  name?: string;
  text?: string;
}

interface Spec {
  /** L1 定位结果（缺省 miss → 走 L2/L3）。 */
  l1?: ResolveResult;
  l3Candidates?: L3Candidate[];
  actQueue: ActionResult[];
  /** 引擎侧断言求值（可按断言内容区分原始声明与篡改声明）。 */
  checkAssertion?: (spec: AssertionSpec) => Promise<AssertionResult>;
  meta?: Record<string, unknown>;
}

function fakeEngine(spec: Spec): {
  provider: EngineProvider & FreshnessCapable;
  state: { actCalls: number; observeCalls: number; resolveByMode: Record<string, number> };
  assertions: AssertionSpec[];
} {
  const state = {
    actCalls: 0,
    observeCalls: 0,
    resolveByMode: { L1: 0, L2: 0, L3: 0 } as Record<string, number>,
  };
  const assertions: AssertionSpec[] = [];
  let actIdx = 0;

  const observation: Observation = {
    observationId: 'obs-1',
    fingerprint: 'fp-1',
    url: 'https://sut.example/app',
    title: 'SUT',
    elements: [
      { id: 0, role: 'button', name: '创建', text: '创建', visible: true, enabled: true, guard: 'g0' },
    ],
    textExcerpt: '工作负载控制台',
    ...(spec.meta ? { meta: spec.meta } : {}),
  } as Observation;

  const provider = {
    id: 'fake',
    version: 'fake-0',
    observe: async (): Promise<Observation> => {
      state.observeCalls += 1;
      return observation;
    },
    resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3'): Promise<ResolveResult> => {
      state.resolveByMode[mode] = (state.resolveByMode[mode] ?? 0) + 1;
      if (mode === 'L3')
        return {
          status: 'miss',
          candidates: (spec.l3Candidates ?? []) as unknown as ResolvedTarget[],
        };
      return spec.l1 ?? { status: 'miss' };
    },
    verifyFreshness: async () => true,
    act: async (action: Action): Promise<ActionResult> => {
      state.actCalls += 1;
      const queue = spec.actQueue;
      const result = queue[Math.min(actIdx, queue.length - 1)]!;
      actIdx += 1;
      return result;
    },
    checkAssertion:
      spec.checkAssertion ??
      (async (): Promise<AssertionResult> => ({ kind: 'visible', passed: true, status: 'passed' })),
    screenshot: async () => {
      throw new Error('not needed');
    },
    trace: async () => {
      throw new Error('not needed');
    },
    dispose: async () => undefined,
  } as unknown as EngineProvider & FreshnessCapable;

  const wrapped = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'checkAssertion') {
        return async (s: AssertionSpec): Promise<AssertionResult> => {
          assertions.push(s);
          return (spec.checkAssertion ?? (async () => ({ kind: 'visible', passed: true, status: 'passed' })))(s);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as EngineProvider & FreshnessCapable;

  return { provider: wrapped, state, assertions };
}

function stepWithPostcondition(): ExecutorStep {
  return {
    intent: '点击【创建】',
    action: 'click',
    risk: 'reversible',
    target: { role: 'button', name: '创建' },
    postcondition: [{ kind: 'visible' }],
  };
}

const okClick: ActionResult = { kind: 'click', status: 'ok', dispatched: true };
const notFound: ActionResult = { kind: 'click', status: 'not_found', dispatched: false };

const candidates: L3Candidate[] = [
  { elementId: 'el-7', role: 'button', name: '创建', text: '创建' },
  { elementId: 'el-9', role: 'button', name: '创建', text: '创建' },
];

const usage = { inputTokens: 120, outputTokens: 8, totalTokens: 128 };

function recoveriesOf(result: unknown): RecoveryRecord[] {
  return ((result as { recoveries?: RecoveryRecord[] }).recoveries ?? []) as RecoveryRecord[];
}

function decisionsOf(result: unknown): DecisionRecord[] {
  return ((result as { decisions?: DecisionRecord[] }).decisions ?? []) as DecisionRecord[];
}

/* ───────────────────────── TR-13.1：A4 修改断言被拒绝并审计终止 ───────────────────────── */

describe('TR-13.1 A4：Recovery 不得修改 Goal/Assertion', () => {
  it('recovery 运行期篡改 postcondition 不生效：仍按原始声明终止 BLOCKED(postcondition)', async () => {
    const engine = fakeEngine({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
      actQueue: [notFound, okClick],
      // 引擎按断言内容求值：原始 visible 声明失败；被篡改的 always_true 会通过。
      checkAssertion: async (s) =>
        s.kind === 'visible'
          ? { kind: 'visible', passed: false, status: 'failed' }
          : ({ kind: 'always_true', passed: true, status: 'passed' } as unknown as AssertionResult),
    });

    const stepObj: ExecutorStep = stepWithPostcondition();
    const recoverArgs: unknown[][] = [];
    const result = await executeCase({ id: 'a.b', steps: [stepObj] }, engine.provider, {
      recover: async (...args: unknown[]) => {
        recoverArgs.push(args);
        // 攻击面：运行期把步级断言换成必然通过的声明。
        stepObj.postcondition = [{ kind: 'always_true' } as unknown as AssertionSpec];
        return { ok: true, mode: 're-navigate' };
      },
    });

    // 钩子零参调用：Runtime 从不 handing Goal/Assertion 可写句柄。
    expect(recoverArgs).toHaveLength(1);
    expect(recoverArgs[0]).toHaveLength(0);
    // 原始声明被强制执行：断言失败 → 终止，而非拿着篡改后的断言假 PASS。
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('postcondition');
    // 审计终止：恢复记录已入档。
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ stepIndex: 0, attempt: 1, fixed: true, mode: 're-navigate' });
    // 引擎只被「派发前固化」的原始断言调用过（篡改版本从未被求值）。
    expect(engine.assertions.map((s) => s.kind)).toEqual(['visible']);
  });
});

/* ───────────────── TR-13.1：A9 错误但看似合理的目标被步级 postcondition 捕获 ───────────────── */

describe('TR-13.1 A9：步级 postcondition 捕获错误目标', () => {
  it('L3 接受看似合理但错误的候选并派发成功 → 步级断言失败 BLOCKED(postcondition)，零 recovery', async () => {
    const engine = fakeEngine({
      l3Candidates: candidates,
      actQueue: [okClick],
      checkAssertion: async () => ({ kind: 'visible', passed: false, status: 'failed' }),
    });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 1, confidence: 0.9 } },
      usage,
      latency_ms: 30,
    }));

    const result = await executeCase(
      { id: 'a.b', steps: [stepWithPostcondition()] },
      engine.provider,
      { decision: { provider: mock } },
    );

    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('postcondition');
    expect(engine.state.actCalls).toBe(1);
    expect(mock.decideCalls).toBe(1);
    expect(decisionsOf(result)[0]).toMatchObject({
      status: 'accepted',
      elementId: 'el-9',
      confidence: 0.9,
    });
    expect(result.recoveries).toBeUndefined();
  });
});

/* ───────────────────────── TR-13.2：Recovery 上限 ───────────────────────── */

describe('TR-13.2：Recovery 上限', () => {
  it('同一步第二次恢复：BLOCKED(recovery)，第二次 recover 不发生', async () => {
    const engine = fakeEngine({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
      actQueue: [notFound, notFound],
      checkAssertion: async () => ({ kind: 'visible', passed: true, status: 'passed' }),
    });
    const result = await executeCase(
      { id: 'a.b', steps: [stepWithPostcondition()] },
      engine.provider,
      { recover: async () => ({ ok: true, mode: 're-navigate' }) },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(engine.state.actCalls).toBe(2);
    // 仅第一次恢复入档；同一步的第二恢复被上限拦截、从未执行。
    const recs = recoveriesOf(result);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.attempt).toBe(1);
  });

  it('超过 case 上限（3 次/case）：第 4 次可恢复失败 → BLOCKED(recovery)，不再调用 recover', async () => {
    const steps: ExecutorStep[] = Array.from({ length: 4 }, () => stepWithPostcondition());
    const engine = fakeEngine({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
      actQueue: [notFound, okClick, notFound, okClick, notFound, okClick, notFound],
      checkAssertion: async () => ({ kind: 'visible', passed: true, status: 'passed' }),
    });
    const result = await executeCase({ id: 'a.b', steps }, engine.provider, {
      recover: async () => ({ ok: true, mode: 're-navigate' }),
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(engine.state.actCalls).toBe(7); // 2+2+2+1
    const recs = recoveriesOf(result);
    expect(recs.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(recs.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
    expect(recs.every((r) => r.fixed && r.mode === 're-navigate')).toBe(true);
    expect(recs.every((r) => r.before !== undefined && r.after !== undefined)).toBe(true);
  });
});
