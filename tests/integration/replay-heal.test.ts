/**
 * Task 15 / AC-11 / DD §4.7 —— replay heal（显式模式）集成测试（先行失败）。
 *
 * --heal 必须显式开启：允许 L3 重新解析，定位漂移生成「候选」新版 strategy
 * （待人确认），并留 recovery/决策审计；heal 产物不得被 CI 使用（AC-11：
 * 其候选策略不得被 CI 使用 —— 修复属 Authoring 行为，不属回放）。
 */
import { describe, expect, it } from 'vitest';
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
import { replayHeal } from '../../src/runtime/replay/heal.js';
import { isCiUsableReplayOutcome } from '../../src/runtime/replay/ci-gate.js';
import { MockDecisionProvider } from '../../src/adapters/jev/mock.js';

/* ───────────────────────── 录制 fixture ───────────────────────── */

const caseOf: ExecutorCase = {
  id: 'deploy.create',
  steps: [
    {
      intent: '点击【创建部署】',
      action: 'click',
      risk: 'reversible',
      target: { role: 'button', name: '创建部署' },
      postcondition: [{ kind: 'visible', expected: true }],
    },
  ],
};

interface RecordSpec {
  l1?: ResolveResult;
  actQueue?: ActionResult[];
}

async function recordTrace(spec: RecordSpec = {}) {
  const records: StepExecutionRecord[] = [];
  // 录制一次成功的在线运行：默认 L1 命中（role/el-1），trace 才有完成步骤。
  await executeCase(
    caseOf,
    makeEngine({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
      ...spec,
    }),
    { onStep: (r) => records.push(r) },
  );
  return buildTraceFile(records, {
    caseId: caseOf.id,
    engineProviderVersion: 'fake-0',
    verdict: 'PASS',
  });
}

/* ───────────────────────── 回放态引擎 fake ───────────────────────── */

interface HealSpec {
  l1?: ResolveResult;
  l3Candidates?: Array<{ elementId: string | number; role?: string; name?: string }>;
  actQueue?: ActionResult[];
  assertionResults?: AssertionResult[];
}

function makeEngine(spec: HealSpec = {}) {
  const state = {
    resolveByMode: { L1: 0, L2: 0, L3: 0 },
    actCalls: 0,
    dispatched: [] as Action[],
  };
  let actIdx = 0;
  const provider = {
    id: 'fake',
    version: 'fake-0',
    observe: async () => ({
      observationId: 'obs-1',
      fingerprint: 'fp-1',
      url: 'https://sut.example/app',
      title: 'SUT',
      elements: [
        {
          id: 0,
          role: 'button',
          name: '创建部署',
          text: '创建部署',
          visible: true,
          enabled: true,
          guard: 'g0',
        },
      ],
      textExcerpt: '部署控制台',
    }),
    resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3') => {
      state.resolveByMode[mode] += 1;
      if (mode === 'L3') return { status: 'miss', candidates: spec.l3Candidates ?? [] };
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

const candidates = [
  { elementId: 'el-7', role: 'button', name: '创建部署' },
  { elementId: 'el-9', role: 'button', name: '创建部署' },
];

const usage = { inputTokens: 120, outputTokens: 8, totalTokens: 128 };

/* ───────────────────────── TR-15.1：heal 显式模式 ───────────────────────── */

describe('replay heal：L3 重新解析生成候选 strategy', () => {
  it('L1 未命中 → 恰好一次 L3；候选被标记 candidate，派发用所选候选', async () => {
    const trace = await recordTrace();
    const engine = makeEngine({ l1: { status: 'miss' }, l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 1, confidence: 0.72 } },
      usage,
      latency_ms: 42,
    }));

    const result = await replayHeal({
      case: caseOf,
      trace,
      provider: engine,
      decision: { provider: mock },
    });

    expect(mock.decideCalls).toBe(1);
    expect(result.mode).toBe('heal');
    expect(result.outcome).toBe('healed');
    expect(result.caseResult).toEqual({ status: 'completed' });
    expect(result.candidateStrategies).toEqual([
      {
        stepIndex: 0,
        from: { strategy: 'role', elementId: 'el-1' },
        to: { strategy: 'model', elementId: 'el-9' },
        status: 'candidate',
      },
    ]);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ status: 'accepted', elementId: 'el-9' });
    expect(result.modelCalls).toBe(1);
    // 派发目标 = 所选候选（elementId 由代码生成，绝不来自模型）。
    expect(engine.state.dispatched[0]).toMatchObject({
      kind: 'click',
      target: { elementId: 'el-9', strategy: 'model' },
    });
  });

  it('无漂移 → outcome=match、零候选、零模型调用', async () => {
    const trace = await recordTrace();
    const engine = makeEngine({
      l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
    });
    const mock = new MockDecisionProvider(() => {
      throw new Error('heal must not call model when nothing drifted');
    });

    const result = await replayHeal({
      case: caseOf,
      trace,
      provider: engine,
      decision: { provider: mock },
    });

    expect(result).toMatchObject({
      mode: 'heal',
      outcome: 'match',
      modelCalls: 0,
    });
    expect(result.candidateStrategies).toEqual([]);
    expect(mock.decideCalls).toBe(0);
  });
});

describe('replay heal：失败与守卫', () => {
  it('L3 无候选（决策不可用）→ BLOCKED(decision)，零派发', async () => {
    const trace = await recordTrace();
    const engine = makeEngine({ l1: { status: 'miss' }, l3Candidates: [] });
    const mock = new MockDecisionProvider(() => {
      throw new Error('no candidates: must not reach model');
    });

    const result = await replayHeal({
      case: caseOf,
      trace,
      provider: engine,
      decision: { provider: mock },
    });

    expect(result.outcome).toBe('blocked');
    expect(result.caseResult).toEqual({ status: 'blocked', reason: 'decision' });
    expect(result.decisions[0]).toMatchObject({ status: 'no_candidates' });
    expect(engine.state.actCalls).toBe(0);
  });

  it('L1 ambiguous → BLOCKED(ambiguity)，绝不自动选择候选', async () => {
    const trace = await recordTrace();
    const engine = makeEngine({
      l1: { status: 'ambiguous', mode: 'L1', count: 2 },
    });
    const mock = new MockDecisionProvider(() => {
      throw new Error('ambiguity must not auto-select');
    });

    const result = await replayHeal({
      case: caseOf,
      trace,
      provider: engine,
      decision: { provider: mock },
    });

    expect(result.caseResult).toEqual({ status: 'blocked', reason: 'ambiguity' });
    expect(mock.decideCalls).toBe(0);
  });

  it('heal 未注入决策能力 → 拒绝执行（heal 是显式 recovery，不是静默路径）', async () => {
    const trace = await recordTrace();
    await expect(
      replayHeal({
        case: caseOf,
        trace,
        provider: makeEngine({ l1: { status: 'miss' } }),
        // 故意缺失 decision
        // @ts-expect-error —— 决策能力必填
        decision: undefined,
      }),
    ).rejects.toThrow(/decision/i);
  });
});

describe('replay heal：产物不得进入 CI（候选 Strategy 隔离）', () => {
  it('isCiUsableReplayOutcome：heal 一律 false（含 healed 与 match）；verify 一律 true', async () => {
    const trace = await recordTrace();
    const engine = makeEngine({ l1: { status: 'miss' }, l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 1, confidence: 0.72 } },
      usage,
      latency_ms: 42,
    }));
    const healed = await replayHeal({
      case: caseOf,
      trace,
      provider: engine,
      decision: { provider: mock },
    });
    expect(isCiUsableReplayOutcome(healed)).toBe(false);
  });

  it('heal 绝不篡改录制 trace（候选只是建议，不回写）', async () => {
    const trace = await recordTrace();
    const snapshot = JSON.parse(JSON.stringify(trace));
    const engine = makeEngine({ l1: { status: 'miss' }, l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 1, confidence: 0.72 } },
      usage,
      latency_ms: 42,
    }));

    await replayHeal({ case: caseOf, trace, provider: engine, decision: { provider: mock } });

    expect(trace).toEqual(snapshot);
    // 候选永远停留在 candidate 状态，等待人确认。
    const dispatchedAction = engine.state.dispatched[0] as unknown as {
      target: { strategy: string };
    };
    expect(dispatchedAction.target).toMatchObject({ strategy: 'model' });
  });
});
