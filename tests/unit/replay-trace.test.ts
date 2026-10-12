/**
 * Task 15 / DD §4.7 —— 回放 Trace 录制（先行失败）。
 *
 * Trace 是 verify/heal 回放的数据来源（Trace 里记录的 resolved_target + actions）。
 * 逐步记录：resolve（status/mode/strategy/elementId）、action kind、
 * action_result.status、assertion results —— 即四项逐步比对的原始素材。
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
import type {
  ExecutorCase,
  ExecutorStep,
  StepExecutionRecord,
} from '../../src/runtime/executor.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';
import { buildTraceFile } from '../../src/runtime/replay/trace.js';

interface FakeSpec {
  l1?: ResolveResult;
  actQueue?: ActionResult[];
  assertionResults?: AssertionResult[];
}

function fakeEngine(spec: FakeSpec = {}): EngineProvider & FreshnessCapable {
  let actIdx = 0;
  let assertIdx = 0;
  return {
    id: 'fake',
    version: 'fake-0',
    observe: async () => {
      throw new Error('not needed');
    },
    resolve: async (_t: unknown, mode: 'L1' | 'L2' | 'L3') => {
      if (mode !== 'L1') return { status: 'miss' };
      return spec.l1 ?? { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' };
    },
    act: async (action: Action) => {
      const queue = spec.actQueue ?? [];
      const r = queue[actIdx] ?? { kind: action.kind, status: 'ok', dispatched: true };
      actIdx += 1;
      return r as ActionResult;
    },
    checkAssertion: async (): Promise<AssertionResult> => {
      const r =
        spec.assertionResults?.[assertIdx] ?? { kind: 'visible', passed: true, status: 'passed' };
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
}

const clickThenNavigate: ExecutorCase = {
  id: 'login.submit',
  steps: [
    {
      intent: '点击提交',
      action: 'click',
      risk: 'reversible',
      target: { role: 'button', name: '提交' },
      postcondition: [{ kind: 'visible', expected: true }],
    },
    { intent: '打开首页', action: 'navigate', risk: 'reversible', url: 'https://sut.example/' },
  ] satisfies ExecutorStep[],
};

describe('Task 15: executor onStep 观测钩子（trace 录制原始输入）', () => {
  it('每个完成步骤产出一条记录：resolve / action_result.status / assertions', async () => {
    const records: StepExecutionRecord[] = [];
    const result = await executeCase(clickThenNavigate, fakeEngine(), {
      onStep: (r) => records.push(r),
    });

    expect(result.status).toBe('completed');
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      stepIndex: 0,
      intent: '点击提交',
      action: 'click',
      resolve: { status: 'resolved', mode: 'L1', strategy: 'role', elementId: 'el-1' },
      actionResultStatus: 'ok',
      dispatched: true,
      assertions: [{ kind: 'visible', passed: true, status: 'passed' }],
    });
    // 无目标步骤（navigate）不携带 resolve。
    expect(records[1]).toMatchObject({
      stepIndex: 1,
      intent: '打开首页',
      action: 'navigate',
      actionResultStatus: 'ok',
      dispatched: true,
    });
    expect(records[1]!.resolve).toBeUndefined();
  });

  it('未注入 onStep 时不观测，执行行为不变', async () => {
    const result = await executeCase(clickThenNavigate, fakeEngine(), {});
    expect(result.status).toBe('completed');
  });

  it('断言失败被 BLOCKED 的步骤不产出记录（trace 只记录完成路径）', async () => {
    const records: StepExecutionRecord[] = [];
    const result = await executeCase(
      clickThenNavigate,
      fakeEngine({ assertionResults: [{ kind: 'visible', passed: false, status: 'failed' }] }),
      { onStep: (r) => records.push(r) },
    );
    expect(result).toMatchObject({ status: 'blocked', reason: 'postcondition' });
    expect(records).toEqual([]);
  });
});

describe('Task 15: buildTraceFile（TraceFile 组装）', () => {
  it('schema/caseId/engineProviderVersion/recordedAt/steps 逐字段成形', () => {
    const records: StepExecutionRecord[] = [
      {
        stepIndex: 0,
        intent: '点击提交',
        action: 'click',
        resolve: { status: 'resolved', mode: 'L1', strategy: 'role', elementId: 'el-1' },
        actionResultStatus: 'ok',
        dispatched: true,
        assertions: [{ kind: 'visible', passed: true, status: 'passed' }],
      },
    ];

    const trace = buildTraceFile(records, {
      caseId: 'login.submit',
      engineProviderVersion: 'fake-0',
      verdict: 'PASS',
    });

    expect(trace.schema).toBe('idwth.trace/1');
    expect(trace.caseId).toBe('login.submit');
    expect(trace.engineProviderVersion).toBe('fake-0');
    expect(trace.verdict).toBe('PASS');
    expect(Number.isNaN(Date.parse(trace.recordedAt))).toBe(false);
    expect(trace.steps).toEqual(records);
  });

  it('verdict 可缺省（录制时未知判定结果）', () => {
    const trace = buildTraceFile([], { caseId: 'c', engineProviderVersion: 'v' });
    expect(trace.steps).toEqual([]);
    expect(trace.verdict).toBeUndefined();
  });
});
