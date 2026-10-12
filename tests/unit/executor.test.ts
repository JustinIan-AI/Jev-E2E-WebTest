import { describe, expect, it, vi } from 'vitest';
import type {
  Action,
  ActionResult,
  AssertionResult,
  EngineProvider,
  ResolveResult,
} from '../../src/engine-provider/index.js';
import {
  classifyFailure,
  executeCase,
  type ExecutorCase,
  type ExecutorStep,
} from '../../src/runtime/executor.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';

/* ───────────────────────── TR-6.1 纯映射层 ───────────────────────── */

describe('TR-6.1: ActionResult → 唯一终态/恢复策略映射', () => {
  it('ambiguous：禁止 recovery，终态 BLOCKED(ambiguity)', () => {
    const m = classifyFailure({
      kind: 'click',
      status: 'ambiguous',
      dispatched: false,
      candidates: 2,
    });
    expect(m).toEqual({ recoverable: false, blockReason: 'ambiguity' });
  });

  it('timeout（dispatched=true）：禁止重试，终态 BLOCKED(decision)', () => {
    const m = classifyFailure({
      kind: 'click',
      status: 'timeout',
      dispatched: true,
      deadlineMs: 500,
    });
    expect(m.recoverable).toBe(false);
    expect(m.blockReason).toBe('decision');
  });

  it('nav_blocked：禁止 recovery，终态 BLOCKED(env)', () => {
    const m = classifyFailure({
      kind: 'navigate',
      status: 'nav_blocked',
      dispatched: false,
      url: 'http://evil.example/',
    });
    expect(m).toEqual({ recoverable: false, blockReason: 'env' });
  });

  it('not_found + reversible：可 recovery', () => {
    const m = classifyFailure({
      kind: 'click',
      status: 'not_found',
      dispatched: false,
      reason: 'detached',
    });
    expect(m.recoverable).toBe(true);
  });

  it('disabled / covered + reversible：可 recovery', () => {
    expect(classifyFailure({ kind: 'click', status: 'disabled', dispatched: false }).recoverable)
      .toBe(true);
    expect(classifyFailure({ kind: 'click', status: 'covered', dispatched: false }).recoverable)
      .toBe(true);
  });

  it('error + reversible + dispatched=false：可 recovery；dispatched=true 禁止', () => {
    expect(
      classifyFailure({ kind: 'fill', status: 'error', dispatched: false, message: 'x' })
        .recoverable,
    ).toBe(true);
    const m = classifyFailure({
      kind: 'fill',
      status: 'error',
      dispatched: true,
      message: 'unknown outcome',
    });
    expect(m.recoverable).toBe(false);
    expect(m.blockReason).toBe('decision');
  });

  it('不可逆步骤的任一失败均禁止 recovery → BLOCKED(decision)', () => {
    const irreversibleOutcomes: ActionResult[] = [
      { kind: 'click', status: 'not_found', dispatched: false },
      { kind: 'click', status: 'disabled', dispatched: false },
      { kind: 'click', status: 'covered', dispatched: false },
      { kind: 'fill', status: 'error', dispatched: false, message: 'x' },
    ];
    for (const ar of irreversibleOutcomes) {
      const m = classifyFailure(ar, 'irreversible');
      expect(m.recoverable).toBe(false);
      expect(m.blockReason).toBe('decision');
    }
  });
});

/* ───────────────────────── 状态机驱动层 fake ───────────────────────── */

interface ScriptEntry {
  resolve: ResolveResult;
  fresh: boolean;
  /**
   * 派发结果队列：同一步内每次 provider.act 顺序消费一项
   * （首次派发 / recovery 后重新派发各消费一项）。
   */
  act: ActionResult[];
  /** checkAssertion 的返回；缺省视为 passed。 */
  postcondition?: AssertionResult;
}

interface FakeRuntime {
  provider: EngineProvider & FreshnessCapable;
  resolveCalls: number;
  freshnessCalls: number;
  actCalls: number;
  assertionCalls: number;
  recoverCalls: number;
  dispatchedActions: Action[];
  /** 传给 executeCase 的 recovery 钩子（已包装 recoverCalls 计数）。 */
  recoverHook: () => Promise<boolean>;
}

/**
 * 脚本化 fake。
 *
 * 位置推进规则：一步的任何 act/checkAssertion 调用后置 stepDone 标记；
 * 下一次 resolve 看到标记才前移到下一脚本项。这样：
 *  - 同一步 Freshness 重解析（无 act）两次 resolve 都读到同一项；
 *  - recovery 在同一步内的第二次 act/checkAssertion 不会跳步。
 */
function scriptedRuntime(
  scripts: ScriptEntry[],
  options: { recover?: () => Promise<boolean> } = {},
): FakeRuntime {
  const rt: FakeRuntime = {
    resolveCalls: 0,
    freshnessCalls: 0,
    actCalls: 0,
    assertionCalls: 0,
    recoverCalls: 0,
    dispatchedActions: [],
  } as unknown as FakeRuntime;

  let committed = 0;
  let stepDone = false;
  /** 当前步内已派发次数（0=首次；1=recovery 重派）。 */
  let dispatchInStep = 0;

  const advance = () => {
    if (stepDone) {
      committed++;
      stepDone = false;
      dispatchInStep = 0;
    }
  };

  const resolve = vi.fn(async () => {
    rt.resolveCalls++;
    advance();
    return scripts[committed]!.resolve;
  });

  const verifyFreshness = vi.fn(async () => {
    rt.freshnessCalls++;
    return scripts[committed]!.fresh;
  });

  const act = vi.fn(async (action: Action) => {
    rt.actCalls++;
    rt.dispatchedActions.push(action);
    const queue = scripts[committed]!.act;
    const result = queue[Math.min(dispatchInStep, queue.length - 1)]!;
    dispatchInStep++;
    stepDone = true;
    return result;
  });

  const checkAssertion = vi.fn(async () => {
    rt.assertionCalls++;
    stepDone = true;
    return (
      scripts[committed]!.postcondition ?? {
        kind: 'visible' as const,
        passed: true,
        status: 'passed' as const,
      }
    );
  });

  // recover 钩子通过 executeCase options 传入；此处仅暴露调用次数。
  rt.recoverHook = vi.fn(async () => {
    rt.recoverCalls++;
    if (options.recover) return options.recover();
    return false;
  });

  rt.provider = {
    id: 'fake',
    version: 'fake-0.0.1',
    observe: vi.fn(),
    resolve,
    verifyFreshness,
    act,
    checkAssertion,
    screenshot: vi.fn(),
    trace: vi.fn(),
    dispose: vi.fn(),
  } as unknown as EngineProvider & FreshnessCapable;

  return rt;
}

function step(over: Partial<ExecutorStep> & Pick<ExecutorStep, 'action' | 'risk'>): ExecutorStep {
  return {
    intent: 'step',
    target: { role: 'button', name: '提交' },
    ...over,
  };
}

const okClick: ActionResult = { kind: 'click', status: 'ok', dispatched: true };

describe('TR-6.1: 逐步执行状态机', () => {
  it('全部成功：每步 resolve→freshness→act 恰好各一次，终态 completed', async () => {
    const rt = scriptedRuntime([
      { resolve: { status: 'resolved' }, fresh: true, act: [okClick] },
      { resolve: { status: 'resolved' }, fresh: true, act: [okClick] },
    ]);
    const c: ExecutorCase = {
      id: 'a.b',
      steps: [
        step({ action: 'click', risk: 'reversible' }),
        step({ action: 'click', risk: 'reversible' }),
      ],
    };
    const result = await executeCase(c, rt.provider);
    expect(result.status).toBe('completed');
    expect(rt.actCalls).toBe(2);
    expect(rt.freshnessCalls).toBe(2);
  });

  it('resolve ambiguous → BLOCKED(ambiguity)，零派发', async () => {
    const rt = scriptedRuntime([
      { resolve: { status: 'ambiguous', count: 2 }, fresh: true, act: [okClick] },
    ]);
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'reversible' })] },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('ambiguity');
    expect(rt.actCalls).toBe(0);
  });

  it('resolve miss → BLOCKED(decision)，零派发', async () => {
    const rt = scriptedRuntime([
      { resolve: { status: 'miss' }, fresh: true, act: [okClick] },
    ]);
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'reversible' })] },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(rt.actCalls).toBe(0);
  });

  it('Freshness 失效：重解析一次，仍失效 → BLOCKED(drift)，零派发', async () => {
    const rt = scriptedRuntime([
      { resolve: { status: 'resolved' }, fresh: false, act: [okClick] },
    ]);
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'reversible' })] },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('drift');
    expect(rt.resolveCalls).toBe(2); // 初次 + 重解析恰好一次
    expect(rt.actCalls).toBe(0);
  });

  it('dispatched timeout：只 BLOCKED(decision) 一次，act 恰好一次（禁止第二次派发）', async () => {
    const rt = scriptedRuntime([
      {
        resolve: { status: 'resolved' },
        fresh: true,
        act: [{ kind: 'click', status: 'timeout', dispatched: true, deadlineMs: 500 }],
      },
    ]);
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'reversible' })] },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(rt.actCalls).toBe(1);
    expect(rt.dispatchedActions).toHaveLength(1);
  });

  it('irreversible 失败：不 recovery、不重试，act 恰好一次 → BLOCKED(decision)', async () => {
    const rt = scriptedRuntime([
      {
        resolve: { status: 'resolved' },
        fresh: true,
        act: [{ kind: 'click', status: 'not_found', dispatched: false }],
      },
    ]);
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'irreversible' })] },
      rt.provider,
      { recover: rt.recoverHook },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    expect(rt.actCalls).toBe(1);
    expect(rt.recoverCalls).toBe(0);
  });

  it('reversible not_found：recovery 成功且声明 postcondition 通过 → completed，act 共 2 次', async () => {
    const rt = scriptedRuntime(
      [
        {
          resolve: { status: 'resolved' },
          fresh: true,
          act: [
            { kind: 'click', status: 'not_found', dispatched: false },
            okClick,
          ],
          postcondition: { kind: 'visible', passed: true, status: 'passed' },
        },
      ],
      { recover: async () => true },
    );
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
      { recover: rt.recoverHook },
    );
    expect(result.status).toBe('completed');
    expect(rt.actCalls).toBe(2); // 初次 + recovery 重新派发
    expect(rt.recoverCalls).toBe(1);
  });

  it('recovery 成功但步级 postcondition 未声明 → BLOCKED(postcondition)', async () => {
    const rt = scriptedRuntime(
      [
        {
          resolve: { status: 'resolved' },
          fresh: true,
          act: [
            { kind: 'click', status: 'not_found', dispatched: false },
            okClick,
          ],
        },
      ],
      { recover: async () => true },
    );
    const result = await executeCase(
      { id: 'a.b', steps: [step({ action: 'click', risk: 'reversible' })] },
      rt.provider,
      { recover: rt.recoverHook },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('postcondition');
  });

  it('recovery 钩子返回失败 → BLOCKED(recovery)，不重新派发', async () => {
    const rt = scriptedRuntime(
      [
        {
          resolve: { status: 'resolved' },
          fresh: true,
          act: [{ kind: 'click', status: 'not_found', dispatched: false }],
        },
      ],
      { recover: async () => false },
    );
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
      { recover: rt.recoverHook },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(rt.actCalls).toBe(1);
  });

  it('单 step recovery 上限 1 次：重新派发后仍失败 → BLOCKED(recovery)，act 共 2 次', async () => {
    const rt = scriptedRuntime(
      [
        {
          resolve: { status: 'resolved' },
          fresh: true,
          act: [
            { kind: 'click', status: 'not_found', dispatched: false },
            { kind: 'click', status: 'not_found', dispatched: false },
          ],
        },
      ],
      { recover: async () => true },
    );
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
      { recover: rt.recoverHook },
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(rt.actCalls).toBe(2);
  });

  it('单 case recovery 上限 3 次：第 4 次可恢复失败 → BLOCKED(recovery)，不再调 recover', async () => {
    // 前 3 步：首次 not_found、recovery 重派 ok；第 4 步：首次 not_found 即超 case 上限。
    const scripts: ScriptEntry[] = [
      ...Array.from({ length: 3 }, () => ({
        resolve: { status: 'resolved' as const },
        fresh: true,
        act: [
          { kind: 'click', status: 'not_found', dispatched: false } as ActionResult,
          okClick,
        ],
        postcondition: { kind: 'visible', passed: true, status: 'passed' } as AssertionResult,
      })),
      {
        resolve: { status: 'resolved' as const },
        fresh: true,
        act: [{ kind: 'click', status: 'not_found', dispatched: false } as ActionResult],
      },
    ];
    const rt = scriptedRuntime(scripts, { recover: async () => true });
    const c: ExecutorCase = {
      id: 'a.b',
      steps: Array.from({ length: 4 }, () =>
        step({
          action: 'click',
          risk: 'reversible',
          postcondition: [{ kind: 'visible' }],
        }),
      ),
    };
    const result = await executeCase(c, rt.provider, {
      recover: rt.recoverHook,
    });
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(rt.recoverCalls).toBe(3);
    expect(rt.actCalls).toBe(7); // 2+2+2+1
  });

  it('声明的 postcondition 在正常成功路径上不过 → BLOCKED(postcondition)', async () => {
    const rt = scriptedRuntime([
      {
        resolve: { status: 'resolved' },
        fresh: true,
        act: [okClick],
        postcondition: { kind: 'visible', passed: false, status: 'failed' },
      },
    ]);
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('postcondition');
  });

  it('postcondition 断言无法求值（inconclusive）→ BLOCKED(evidence)', async () => {
    const rt = scriptedRuntime([
      {
        resolve: { status: 'resolved' },
        fresh: true,
        act: [okClick],
        postcondition: { kind: 'visible', passed: false, status: 'inconclusive' },
      },
    ]);
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('evidence');
  });

  it('TR-14.2: 引擎判不出来（inconclusive + blockedReason=decision）→ BLOCKED(decision) 不降级 evidence', async () => {
    // 上游 ASSERTION_INCONCLUSIVE 被吸附器改判为 inconclusive + decision；
    // executor 必须尊重该标记（§8.2：上游判不出 ≠ 断言无法求值）。
    const rt = scriptedRuntime([
      {
        resolve: { status: 'resolved' },
        fresh: true,
        act: [okClick],
        postcondition: {
          kind: 'visible',
          passed: false,
          status: 'inconclusive',
          blockedReason: 'decision',
          upstreamErrorCode: 'ASSERTION_INCONCLUSIVE',
        } as AssertionResult,
      },
    ]);
    const result = await executeCase(
      {
        id: 'a.b',
        steps: [step({ action: 'click', risk: 'reversible', postcondition: [{ kind: 'visible' }] })],
      },
      rt.provider,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
  });
});
