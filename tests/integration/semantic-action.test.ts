/**
 * Task 12 —— L3 语义动作集成（§7 JEV Adapter / §8.1 resolveTarget L1→L2→L3）。
 *
 * TR-12.1：L1/L2 未命中才调 L3；模型应答经 validate_choice + 分级阈值校验，
 *          任一不合法 → 零派发 + BLOCKED(decision) + 记录拒绝原因；
 *          合法应答只允许选择代码给定的候选（elementId 由代码生成）。
 * TR-12.2：确定性执行路径不持有可调用 Provider——未接线 decide 钩子时，
 *          任何 provider（包括在作用域内构造好的 Mock）都不被调用；
 *          Mock/断网（provider 抛错）时同样零派发 BLOCKED(decision)。
 *
 * 预算（§7.4）：max_requests / max_cost 每 run，发请求前按最坏情况预留，
 * 额度不足 → 零请求零派发 BLOCKED(decision)。
 */
import { describe, expect, it } from 'vitest';
import type {
  Action,
  ActionResult,
  AssertionResult,
  EngineProvider,
  ObservedElement,
  Observation,
  ResolveResult,
  SemanticTarget,
} from '../../src/engine-provider/index.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';
import { executeCase } from '../../src/runtime/executor.js';
import type {
  CaseResult,
  ExecutorCase,
  ExecutorStep,
} from '../../src/runtime/executor.js';
import { MockDecisionProvider } from '../../src/adapters/jev/mock.js';
import { createDecisionBudget } from '../../src/adapters/jev/budget.js';
import type { ChoiceAnswer } from '../../src/adapters/jev/types.js';
import type { DecisionRecord } from '../../src/runtime/resolve-l3.js';

/* ───────────────────────── 引擎 fake ───────────────────────── */

interface L3Candidate {
  elementId: string | number;
  role?: string;
  name?: string;
  text?: string;
}

interface FakeSpec {
  l1?: ResolveResult;
  l2?: ResolveResult;
  l3Candidates?: L3Candidate[];
  fresh?: boolean;
  actQueue?: ActionResult[];
  /** 观测附加：credential 语义键 / password 控件，验证 decide state 脱敏。 */
  meta?: Record<string, unknown>;
  withPasswordElement?: boolean;
}

interface FakeEngineState {
  resolveByMode: Record<'L1' | 'L2' | 'L3', number>;
  observeCalls: number;
  actCalls: number;
  dispatched: Action[];
  assertionCalls: number;
}

function fakeEngine(spec: FakeSpec = {}): {
  provider: EngineProvider & FreshnessCapable;
  state: FakeEngineState;
} {
  const state: FakeEngineState = {
    resolveByMode: { L1: 0, L2: 0, L3: 0 },
    observeCalls: 0,
    actCalls: 0,
    dispatched: [],
    assertionCalls: 0,
  };
  let actIdx = 0;

  const passwordEl = {
    id: 9,
    role: 'textbox',
    name: 'password',
    text: '',
    visible: true,
    enabled: true,
    guard: 'g9',
    inputType: 'password',
  } as unknown as ObservedElement;

  const observation: Observation = {
    observationId: 'obs-1',
    fingerprint: 'fp-1',
    url: 'https://sut.example/app',
    title: 'SUT',
    elements: [
      { id: 0, role: 'button', name: '创建', text: '创建', visible: true, enabled: true, guard: 'g0' },
      ...(spec.withPasswordElement ? [passwordEl] : []),
    ],
    textExcerpt: '工作负载控制台',
    ...(spec.meta ? { meta: spec.meta } : {}),
  } as Observation;

  const provider = {
    id: 'fake',
    version: 'fake-0',
    observe: async () => {
      state.observeCalls += 1;
      return observation;
    },
    resolve: async (_t: SemanticTarget, mode: 'L1' | 'L2' | 'L3') => {
      state.resolveByMode[mode] += 1;
      if (mode === 'L3') {
        return { status: 'miss', candidates: spec.l3Candidates ?? [] };
      }
      if (mode === 'L2') return spec.l2 ?? { status: 'miss' };
      return spec.l1 ?? { status: 'miss' };
    },
    act: async (action: Action) => {
      state.actCalls += 1;
      state.dispatched.push(action);
      const queue = spec.actQueue ?? [];
      const result = queue[Math.min(actIdx, Math.max(queue.length - 1, 0))] ?? {
        kind: action.kind,
        status: 'ok',
        dispatched: true,
      };
      actIdx += 1;
      return result;
    },
    checkAssertion: async (): Promise<AssertionResult> => {
      state.assertionCalls += 1;
      return { kind: 'visible', passed: true, status: 'passed' };
    },
    verifyFreshness: async () => spec.fresh ?? true,
    screenshot: async () => {
      throw new Error('not needed');
    },
    trace: async () => {
      throw new Error('not needed');
    },
    dispose: async () => undefined,
  } as unknown as EngineProvider & FreshnessCapable;

  return { provider, state };
}

function step(over: Partial<ExecutorStep> & Pick<ExecutorStep, 'action' | 'risk'>): ExecutorStep {
  return {
    intent: '执行【创建部署】',
    target: { role: 'button', name: '创建' },
    ...over,
  };
}

const caseOf = (steps: ExecutorStep[]): ExecutorCase => ({ id: 'a.b', steps });

/** 两个代码生成的 L3 候选（含同名干扰项，DD §4.8.4 示例形态）。 */
const candidates: L3Candidate[] = [
  { elementId: 'el-7', role: 'button', name: '创建', text: '创建' },
  { elementId: 'el-9', role: 'button', name: '创建', text: '创建' },
];

const usage = { inputTokens: 120, outputTokens: 8, totalTokens: 128 };

function reversibleClick(): { provider: ReturnType<typeof fakeEngine>['provider']; state: FakeEngineState; mock: MockDecisionProvider } {
  const engine = fakeEngine({ l3Candidates: candidates });
  const mock = new MockDecisionProvider(() => ({
    answers: { q_resolve: { choice: 1, confidence: 0.72 } },
    usage,
    latency_ms: 42,
  }));
  return { provider: engine.provider, state: engine.state, mock };
}

/* ───────────── TR-12.1：L3 接线 / 合法应答只选代码候选 ───────────── */

describe('L3 语义动作：合法链路', () => {
  it('L1/L2 未命中 → 恰好一次 decide；派发目标 = 所选候选 elementId，strategy=model', async () => {
    const { provider, state, mock } = reversibleClick();
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('completed');
    expect(mock.decideCalls).toBe(1);
    expect(state.resolveByMode).toMatchObject({ L1: 1, L2: 0, L3: 1 });
    expect(state.actCalls).toBe(1);
    expect(state.dispatched[0]).toMatchObject({
      kind: 'click',
      target: { elementId: 'el-9', strategy: 'model' },
    });
  });

  it('决策问题集由代码生成：choices 序号 0..n-1，elementId 绝不来自模型', async () => {
    const { provider, mock } = reversibleClick();
    await executeCase(caseOf([step({ action: 'click', risk: 'reversible' })]), provider, {
      decision: { provider: mock },
    });
    const req = mock.requests[0]!;
    const q = req.questions['q_resolve']!;
    expect(q.choices.map((c) => c.index)).toEqual([0, 1]);
    expect(q.choices.map((c) => c.elementId)).toEqual(['el-7', 'el-9']);
    expect(q.prompt).toBe('执行【创建部署】');
  });

  it('usage 与 latency 进入决策记录（Task 12 记录要求）', async () => {
    const { provider, state, mock } = reversibleClick();
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      provider,
      { decision: { provider: mock } },
    );
    const rec = (result as CaseResult & { decisions?: DecisionRecord[] }).decisions?.[0];
    expect(rec).toMatchObject({
      status: 'accepted',
      provider: 'mock',
      operation: 'click',
      targetIndex: 1,
      confidence: 0.72,
      elementId: 'el-9',
      candidateCount: 2,
      usage,
      latencyMs: 42,
    });
  });

  it('decide 的 state 经脱敏：password 控件被剔除、credential 键值 [REDACTED]', async () => {
    const engine = fakeEngine({
      l3Candidates: candidates,
      meta: { authorization: 'Bearer secret-token' },
      withPasswordElement: true,
    });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.8 } },
      latency_ms: 1,
    }));
    await executeCase(caseOf([step({ action: 'click', risk: 'reversible' })]), engine.provider, {
      decision: { provider: mock, secrets: ['secret-token'] },
    });
    const state = mock.requests[0]!.state as Record<string, unknown>;
    expect((state as { meta?: Record<string, unknown> }).meta).toEqual({
      authorization: '[REDACTED]',
    });
    const elements = state.elements as Array<Record<string, unknown>>;
    expect(elements.some((e) => e.inputType === 'password')).toBe(false);
  });

  it('L1 命中 → decide 零调用（L3 仅在 L1/L2 未命中时触发）', async () => {
    const engine = fakeEngine({ l1: { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' } });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('completed');
    expect(mock.decideCalls).toBe(0);
    expect(engine.state.resolveByMode.L3).toBe(0);
  });

  it('L2 命中（携带指纹）→ decide 零调用', async () => {
    const engine = fakeEngine({
      l2: { status: 'resolved', mode: 'L2', elementId: 'el-2', strategy: 'fingerprint' },
    });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([
        step({
          action: 'click',
          risk: 'reversible',
          target: {
            role: 'button',
            name: '创建',
            fingerprint: { dom_path_hash: 'h', sibling_ordinal: 0, anchor_text: [] },
          },
        }),
      ]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('completed');
    expect(mock.decideCalls).toBe(0);
  });

  it('L1 ambiguous → BLOCKED(ambiguity)，不降级、decide 零调用', async () => {
    const engine = fakeEngine({ l1: { status: 'ambiguous', count: 2 } });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('ambiguity');
    expect(mock.decideCalls).toBe(0);
    expect(engine.state.actCalls).toBe(0);
  });
});

/* ────────── TR-12.1：非法应答 → 零派发 + BLOCKED(decision) ────────── */

describe('L3 语义动作：非法应答零派发', () => {
  async function runWithAnswer(
    answer: Record<string, unknown>,
    risk: 'reversible' | 'irreversible' = 'reversible',
  ): Promise<{ result: CaseResult & { decisions?: DecisionRecord[] }; actCalls: number }> {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: answer as unknown as ChoiceAnswer },
      latency_ms: 5,
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    return { result: result as CaseResult & { decisions?: DecisionRecord[] }, actCalls: engine.state.actCalls };
  }

  it('越界 index 99 → BLOCKED(decision)、零派发、拒绝原因入档', async () => {
    const { result, actCalls } = await runWithAnswer({ choice: 99, confidence: 0.9 });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]).toMatchObject({ status: 'rejected', reason: 'out_of_range' });
  });

  it('非法 operation 回填 eval_js → 零派发 + illegal_operation', async () => {
    const { result, actCalls } = await runWithAnswer({
      operation: 'eval_js',
      choice: 0,
      confidence: 0.9,
    });
    expect(result.status).toBe('blocked');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]?.reason).toBe('illegal_operation');
  });

  it('operation 回填与请求不一致（fill ≠ click）→ 零派发', async () => {
    const { result, actCalls } = await runWithAnswer({
      operation: 'fill',
      choice: 0,
      confidence: 0.9,
    });
    expect(result.status).toBe('blocked');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]?.reason).toBe('illegal_operation');
  });

  it('目标注入（answer 携带 selector 字段）→ 零派发 + unknown_field', async () => {
    const { result, actCalls } = await runWithAnswer({
      choice: 0,
      confidence: 0.9,
      selector: '#btn-submit',
    });
    expect(result.status).toBe('blocked');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]?.reason).toBe('unknown_field');
  });

  it('非法概率（Σp≠1）→ 零派发 + invalid_probability', async () => {
    const { result, actCalls } = await runWithAnswer({
      choice: 0,
      confidence: 0.9,
      probabilities: { 0: 0.5, 1: 0.4 },
    });
    expect(result.status).toBe('blocked');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]?.reason).toBe('invalid_probability');
  });

  it('低置信度（reversible 0.55 < 0.60）→ 零派发 + low_confidence', async () => {
    const { result, actCalls } = await runWithAnswer({ choice: 0, confidence: 0.55 });
    expect(result.status).toBe('blocked');
    expect(actCalls).toBe(0);
    expect(result.decisions?.[0]?.reason).toBe('low_confidence');
  });

  it('不可逆动作阈值 0.90：0.70 拒绝、0.90 恰好通过', async () => {
    const rejected = await runWithAnswer({ choice: 0, confidence: 0.7 }, 'irreversible');
    expect(rejected.result.status).toBe('blocked');
    expect(rejected.actCalls).toBe(0);
    expect(rejected.result.decisions?.[0]?.reason).toBe('low_confidence');

    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const ok = await executeCase(
      caseOf([step({ action: 'click', risk: 'irreversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(ok.status).toBe('completed');
    expect(engine.state.actCalls).toBe(1);
  });

  it('合法性优先于阈值：越界 + 低置信度 → 报 out_of_range', async () => {
    const { result } = await runWithAnswer({ choice: 42, confidence: 0.1 });
    expect(result.decisions?.[0]?.reason).toBe('out_of_range');
  });

  it('answers 缺少 q_resolve → 零派发 + missing_answer', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: {},
      latency_ms: 3,
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('blocked');
    expect(engine.state.actCalls).toBe(0);
    expect((result as CaseResult & { decisions?: DecisionRecord[] }).decisions?.[0]).toMatchObject({
      status: 'rejected',
      reason: 'missing_answer',
    });
  });

  it('未使用的 head：未请求 question 的应答被忽略、不产生副作用', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: {
        q_resolve: { choice: 1, confidence: 0.8 },
        q_extra: { choice: 42, confidence: -3 },
      },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('completed');
    expect(engine.state.actCalls).toBe(1);
    expect(engine.state.dispatched[0]).toMatchObject({ target: { elementId: 'el-9' } });
  });
});

/* ─────────── TR-12.2：确定性路径零 Provider / Mock / 断网 ─────────── */

describe('TR-12.2：确定性执行路径不持有可调用 Provider', () => {
  it('未接线 decision 时：作用域内的 Mock 也绝不被调用；miss → BLOCKED(decision)', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      // 注意：故意不传 options.decision —— 确定性路径
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(mock.decideCalls).toBe(0);
    expect(engine.state.actCalls).toBe(0);
    expect(engine.state.resolveByMode.L3).toBe(0);
  });

  it('A7b 离线：provider 抛错（断网）→ BLOCKED(decision)，零派发、不假装跑过', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => {
      throw new Error('JEV endpoint unreachable');
    });
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(engine.state.actCalls).toBe(0);
    expect((result as CaseResult & { decisions?: DecisionRecord[] }).decisions?.[0]).toMatchObject({
      status: 'provider_error',
    });
  });

  it('零候选（引擎无模糊命中）→ 零请求零派发 BLOCKED(decision)', async () => {
    const engine = fakeEngine({ l3Candidates: [] });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock } },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(mock.decideCalls).toBe(0);
    expect(engine.state.actCalls).toBe(0);
  });
});

/* ───────────────── 预算控制：发请求前最坏情况预留 ───────────────── */

describe('预算控制（§7.4）', () => {
  it('max_requests=1：第一步消耗后，第二步发请求前被拦截（decide 仅 1 次）', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([
        step({ action: 'click', risk: 'reversible' }),
        step({ action: 'click', risk: 'reversible' }),
      ]),
      engine.provider,
      { decision: { provider: mock, budget: createDecisionBudget({ maxRequests: 1 }) } },
    );
    expect(mock.decideCalls).toBe(1);
    expect(engine.state.actCalls).toBe(1); // 第一步已正常派发
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    const decisions = (result as CaseResult & { decisions?: DecisionRecord[] }).decisions ?? [];
    expect(decisions[0]).toMatchObject({ status: 'accepted' });
    expect(decisions[1]).toMatchObject({ status: 'budget_exhausted' });
  });

  it('max_cost：estimateCost 超过剩余额度 → 发请求前拒绝', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock, budget: createDecisionBudget({ maxCost: 1 }) } },
    );
    expect(mock.decideCalls).toBe(0); // 预留失败 → 零请求
    expect(engine.state.actCalls).toBe(0);
    expect(result.status).toBe('blocked');
    expect((result as CaseResult & { decisions?: DecisionRecord[] }).decisions?.[0]).toMatchObject({
      status: 'budget_exhausted',
    });
  });

  it('额度充足时预留成功并正常决策', async () => {
    const engine = fakeEngine({ l3Candidates: candidates });
    const mock = new MockDecisionProvider(() => ({
      answers: { q_resolve: { choice: 0, confidence: 0.9 } },
    }));
    const result = await executeCase(
      caseOf([step({ action: 'click', risk: 'reversible' })]),
      engine.provider,
      { decision: { provider: mock, budget: createDecisionBudget({ maxRequests: 5, maxCost: 100 }) } },
    );
    expect(result.status).toBe('completed');
    expect(mock.decideCalls).toBe(1);
  });
});
