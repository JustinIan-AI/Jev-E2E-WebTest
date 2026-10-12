/**
 * Task 16 —— 运行指标（DD §9.2 / §9.3）。
 *
 *  - SIR（per case）= 发生 model 定位的 step 数 / 总 step 数。分母是 step 不是 case
 *    （DD-21：一个 10 步 case 只调 1 次模型，SIR 必须是 0.1 而非 1.0）；
 *  - 「发生 model 定位」= L3 决策 accepted（rejected / provider_error / no_candidates /
 *    budget_exhausted 均未定位成功，不计入）；
 *  - 决策延迟样本来自 DecisionRecord.latencyMs（口径：L3 段 + JEV 往返）；
 *  - 动作计数 / recovery 计数来自执行审计；suite 绿灯率仅观测输出。
 */
import type { CaseResult, StepExecutionRecord } from './executor.js';
import type { Verdict } from './judge/types.js';
import type { DecisionRecord } from './resolve-l3.js';

export interface CaseMetrics {
  caseId: string;
  totalSteps: number;
  /** 实际完成并产出执行记录的步数。 */
  executedSteps: number;
  /** 发生 model 定位（L3 accepted）的 step 数（按 step 去重）。 */
  modelLocatedSteps: number;
  /** SIR = modelLocatedSteps / totalSteps；totalSteps 为 0 时恒 0。 */
  sir: number;
  decisionLatency: {
    samples: number;
    medianMs: number | null;
    maxMs: number | null;
  };
  actions: {
    dispatched: number;
    ok: number;
    failed: number;
    byStatus: Record<string, number>;
  };
  recoveries: { attempts: number; fixed: number };
  decisions: { attempts: number; accepted: number; rejected: number; other: number };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function computeCaseMetrics(params: {
  caseId: string;
  totalSteps: number;
  result: Pick<CaseResult, 'decisions' | 'recoveries'>;
  stepRecords: readonly StepExecutionRecord[];
}): CaseMetrics {
  const { caseId, totalSteps, result, stepRecords } = params;
  const decisions = result.decisions ?? [];
  const recoveries = result.recoveries ?? [];

  // SIR 分子：accepted 决策的 stepIndex 去重（同一 step 多条 accepted 只算一次）。
  const locatedSteps = new Set(
    decisions.filter((d) => d.status === 'accepted').map((d) => d.stepIndex),
  );

  const latencies = decisions
    .map((d) => d.latencyMs)
    .filter((v): v is number => typeof v === 'number');

  const byStatus: Record<string, number> = {};
  let dispatched = 0;
  let ok = 0;
  for (const rec of stepRecords) {
    byStatus[rec.actionResultStatus] = (byStatus[rec.actionResultStatus] ?? 0) + 1;
    if (rec.dispatched === true) dispatched += 1;
    if (rec.actionResultStatus === 'ok') ok += 1;
  }

  let accepted = 0;
  let rejected = 0;
  let other = 0;
  for (const d of decisions) {
    if (d.status === 'accepted') accepted += 1;
    else if (d.status === 'rejected') rejected += 1;
    else other += 1;
  }

  return {
    caseId,
    totalSteps,
    executedSteps: stepRecords.length,
    modelLocatedSteps: locatedSteps.size,
    sir: totalSteps > 0 ? locatedSteps.size / totalSteps : 0,
    decisionLatency: {
      samples: latencies.length,
      medianMs: median(latencies),
      maxMs: latencies.length > 0 ? Math.max(...latencies) : null,
    },
    actions: {
      dispatched,
      ok,
      failed: stepRecords.length - ok,
      byStatus,
    },
    recoveries: {
      attempts: recoveries.length,
      fixed: recoveries.filter((r) => r.fixed === true).length,
    },
    decisions: { attempts: decisions.length, accepted, rejected, other },
  };
}

export interface SuiteMetrics {
  totalCases: number;
  verdictCounts: Record<Verdict, number>;
  /** suite 绿灯率观测值（PASS 比例）；空 suite 为 null。仅观测，不作阈值。 */
  greenRate: number | null;
}

export function computeSuiteMetrics(
  cases: ReadonlyArray<{ caseId: string; verdict: Verdict }>,
): SuiteMetrics {
  const verdictCounts: Record<Verdict, number> = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  for (const c of cases) verdictCounts[c.verdict] += 1;
  return {
    totalCases: cases.length,
    verdictCounts,
    greenRate: cases.length > 0 ? verdictCounts.PASS / cases.length : null,
  };
}

/* ── Task 17 / TR-17.2：双 Provider 对照指标 ───────────────────────────── */

export interface ProviderRunInput {
  caseId: string;
  verdict: Verdict;
  stepRecords: readonly StepExecutionRecord[];
  decisions?: readonly DecisionRecord[];
  stability?: { flaky: boolean };
}

export interface ProviderComparisonMetrics {
  providerId: string;
  casesRun: number;
  verdicts: Record<Verdict, number>;
  /** 定位尝试数（带目标且产出 resolve 记录的步）。 */
  resolveAttempts: number;
  /** resolved 数。 */
  resolveHits: number;
  /** 定位命中率 = resolveHits / resolveAttempts（attempts 为 0 时记 0）。 */
  hitRate: number;
  /** 误命中观测：resolved 但动作派发失败（定位到了错误/不可用目标的代理指标）。 */
  misfires: number;
  /** 误命中率 = misfires / resolveHits（hits 为 0 时记 0）。 */
  misfireRate: number;
  /** 成本观测：模型决策调用次数（确定性路径 ≡ 0）。 */
  modelInvocations: number;
  /** 决策延迟中位数（全部 case 的 latencyMs 样本；无样本为 null）。 */
  decisionLatencyMedianMs: number | null;
  /** stability 判定 flaky 的 case 数。 */
  flakyCases: number;
}

export function computeProviderComparison(
  providerId: string,
  runs: ReadonlyArray<ProviderRunInput>,
): ProviderComparisonMetrics {
  const verdicts: Record<Verdict, number> = { PASS: 0, FAIL: 0, BLOCKED: 0 };
  let resolveAttempts = 0;
  let resolveHits = 0;
  let misfires = 0;
  let modelInvocations = 0;
  let flakyCases = 0;
  const latencies: number[] = [];

  for (const run of runs) {
    verdicts[run.verdict] += 1;
    for (const rec of run.stepRecords) {
      if (rec.resolve === undefined) continue;
      resolveAttempts += 1;
      if (rec.resolve.status === 'resolved') {
        resolveHits += 1;
        if (rec.actionResultStatus !== 'ok') misfires += 1;
      }
    }
    for (const d of run.decisions ?? []) {
      modelInvocations += 1;
      if (typeof d.latencyMs === 'number') latencies.push(d.latencyMs);
    }
    if (run.stability?.flaky === true) flakyCases += 1;
  }

  return {
    providerId,
    casesRun: runs.length,
    verdicts,
    resolveAttempts,
    resolveHits,
    hitRate: resolveAttempts > 0 ? resolveHits / resolveAttempts : 0,
    misfires,
    misfireRate: resolveHits > 0 ? misfires / resolveHits : 0,
    modelInvocations,
    decisionLatencyMedianMs: median(latencies),
    flakyCases,
  };
}
