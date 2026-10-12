/**
 * Task 16 —— 运行指标（DD §9.2 / §9.3）。
 *
 *  - SIR（per case）= 发生 model 定位的 step 数 / 总 step 数。分母是 step 不是 case（DD-21）；
 *  - 决策延迟取 L3 决策 latencyMs 样本的中位数（口径：L3 段 + JEV 往返）；
 *  - 动作计数与 recovery 计数来自执行审计；
 *  - suite 绿灯率 = PASS case 数 / 总 case 数，仅观测输出。
 */
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/runtime/judge/types.js';
import type { DecisionRecord } from '../../src/runtime/resolve-l3.js';
import type { RecoveryRecord } from '../../src/runtime/recovery-audit.js';
import type { CaseResult, StepExecutionRecord } from '../../src/runtime/executor.js';
import { computeCaseMetrics, computeSuiteMetrics } from '../../src/runtime/metrics.js';

function decision(partial: Partial<DecisionRecord> & { stepIndex: number }): DecisionRecord {
  return {
    intent: `step-${partial.stepIndex}`,
    operation: 'click',
    provider: 'jev',
    status: 'accepted',
    candidateCount: 1,
    targetIndex: 0,
    ...partial,
  } as DecisionRecord;
}

function step(partial: Partial<StepExecutionRecord> & { stepIndex: number }): StepExecutionRecord {
  return {
    intent: `step-${partial.stepIndex}`,
    action: 'click',
    actionResultStatus: 'ok',
    ...partial,
  } as StepExecutionRecord;
}

function recovery(partial: Partial<RecoveryRecord>): RecoveryRecord {
  return { stepIndex: 0, intent: 'x', attempt: 1, fixed: true, ...partial };
}

function caseResult(partial: Partial<CaseResult> = {}): CaseResult {
  return { status: 'completed', ...partial };
}

describe('computeCaseMetrics — SIR（分母是 step，DD-21）', () => {
  it('纯确定性路径（无 decisions）→ SIR = 0', () => {
    const m = computeCaseMetrics({
      caseId: 'c1',
      totalSteps: 8,
      result: caseResult(),
      stepRecords: Array.from({ length: 8 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.modelLocatedSteps).toBe(0);
    expect(m.sir).toBe(0);
  });

  it('10 步中 2 步发生 model 定位 → SIR = 0.2', () => {
    const m = computeCaseMetrics({
      caseId: 'c2',
      totalSteps: 10,
      result: caseResult({
        decisions: [decision({ stepIndex: 2 }), decision({ stepIndex: 5 })],
      }),
      stepRecords: Array.from({ length: 10 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.totalSteps).toBe(10);
    expect(m.modelLocatedSteps).toBe(2);
    expect(m.sir).toBeCloseTo(0.2, 10);
  });

  it('同一 step 多条 accepted 决策只计一次（按 step 去重）', () => {
    const m = computeCaseMetrics({
      caseId: 'c3',
      totalSteps: 4,
      result: caseResult({
        decisions: [
          decision({ stepIndex: 1 }),
          decision({ stepIndex: 1, operation: 'fill' }),
          decision({ stepIndex: 3 }),
        ],
      }),
      stepRecords: Array.from({ length: 4 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.modelLocatedSteps).toBe(2);
    expect(m.sir).toBeCloseTo(0.5, 10);
  });

  it('rejected / provider_error 决策不构成 model 定位，不计入 SIR', () => {
    const m = computeCaseMetrics({
      caseId: 'c4',
      totalSteps: 5,
      result: caseResult({
        decisions: [
          decision({ stepIndex: 0 }),
          decision({ stepIndex: 1, status: 'rejected', reason: 'low_confidence' }),
          decision({ stepIndex: 2, status: 'provider_error' }),
        ],
      }),
      stepRecords: Array.from({ length: 5 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.modelLocatedSteps).toBe(1);
    expect(m.sir).toBeCloseTo(0.2, 10);
    expect(m.decisions).toEqual({ attempts: 3, accepted: 1, rejected: 1, other: 1 });
  });

  it('totalSteps = 0 → SIR = 0（防除零）', () => {
    const m = computeCaseMetrics({
      caseId: 'c5',
      totalSteps: 0,
      result: caseResult(),
      stepRecords: [],
    });
    expect(m.sir).toBe(0);
  });
});

describe('computeCaseMetrics — 决策延迟（DD §9.3：L3 段 + JEV 往返）', () => {
  it('奇数样本取中位数；max 一并输出', () => {
    const m = computeCaseMetrics({
      caseId: 'l1',
      totalSteps: 3,
      result: caseResult({
        decisions: [
          decision({ stepIndex: 0, latencyMs: 100 }),
          decision({ stepIndex: 1, latencyMs: 300 }),
          decision({ stepIndex: 2, latencyMs: 200 }),
        ],
      }),
      stepRecords: Array.from({ length: 3 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.decisionLatency).toEqual({ samples: 3, medianMs: 200, maxMs: 300 });
  });

  it('偶数样本取中间两数平均', () => {
    const m = computeCaseMetrics({
      caseId: 'l2',
      totalSteps: 4,
      result: caseResult({
        decisions: [
          decision({ stepIndex: 0, latencyMs: 100 }),
          decision({ stepIndex: 1, latencyMs: 400 }),
          decision({ stepIndex: 2, latencyMs: 200 }),
          decision({ stepIndex: 3, latencyMs: 300 }),
        ],
      }),
      stepRecords: Array.from({ length: 4 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.decisionLatency.medianMs).toBe(250);
    expect(m.decisionLatency.maxMs).toBe(400);
  });

  it('无延迟样本（字段缺省）→ median/max 为 null', () => {
    const m = computeCaseMetrics({
      caseId: 'l3',
      totalSteps: 2,
      result: caseResult({
        decisions: [decision({ stepIndex: 0 }), decision({ stepIndex: 1 })],
      }),
      stepRecords: Array.from({ length: 2 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.decisionLatency).toEqual({ samples: 0, medianMs: null, maxMs: null });
  });
});

describe('computeCaseMetrics — 动作与 recovery 计数', () => {
  it('按 actionResultStatus 统计 dispatched / ok / failed / byStatus', () => {
    const m = computeCaseMetrics({
      caseId: 'a1',
      totalSteps: 4,
      result: caseResult(),
      stepRecords: [
        step({ stepIndex: 0 }),
        step({ stepIndex: 1, actionResultStatus: 'timeout', dispatched: true }),
        step({ stepIndex: 2, actionResultStatus: 'not_found' }),
        step({ stepIndex: 3, action: 'fill', actionResultStatus: 'ok', dispatched: true }),
      ],
    });
    expect(m.actions.dispatched).toBe(2);
    expect(m.actions.ok).toBe(2);
    expect(m.actions.failed).toBe(2);
    expect(m.actions.byStatus).toEqual({ ok: 2, timeout: 1, not_found: 1 });
  });

  it('recovery 计数：attempts 与 fixed 分开统计', () => {
    const m = computeCaseMetrics({
      caseId: 'r1',
      totalSteps: 3,
      result: caseResult({
        recoveries: [
          recovery({ stepIndex: 0, attempt: 1, fixed: true }),
          recovery({ stepIndex: 2, attempt: 2, fixed: false }),
        ],
      }),
      stepRecords: Array.from({ length: 3 }, (_, i) => step({ stepIndex: i })),
    });
    expect(m.recoveries).toEqual({ attempts: 2, fixed: 1 });
  });

  it('无 recoveries 字段 → 计数为 0', () => {
    const m = computeCaseMetrics({
      caseId: 'r2',
      totalSteps: 1,
      result: caseResult(),
      stepRecords: [step({ stepIndex: 0 })],
    });
    expect(m.recoveries).toEqual({ attempts: 0, fixed: 0 });
  });
});

describe('computeSuiteMetrics — suite 绿灯率仅观测', () => {
  it('2 PASS / 1 FAIL / 1 BLOCKED → 绿灯率 0.5，verdict 分布齐全', () => {
    const cases: Array<{ caseId: string; verdict: Verdict }> = [
      { caseId: 'a', verdict: 'PASS' },
      { caseId: 'b', verdict: 'PASS' },
      { caseId: 'c', verdict: 'FAIL' },
      { caseId: 'd', verdict: 'BLOCKED' },
    ];
    const s = computeSuiteMetrics(cases);
    expect(s.totalCases).toBe(4);
    expect(s.verdictCounts).toEqual({ PASS: 2, FAIL: 1, BLOCKED: 1 });
    expect(s.greenRate).toBeCloseTo(0.5, 10);
  });

  it('空 suite → 绿灯率 null（无观测值，不伪造 100%）', () => {
    const s = computeSuiteMetrics([]);
    expect(s.totalCases).toBe(0);
    expect(s.greenRate).toBeNull();
  });
});
