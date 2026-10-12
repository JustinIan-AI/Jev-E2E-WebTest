/**
 * Task 15 / DD §4.7 / AC-11 —— replay heal（显式模式）。
 *
 * --heal 必须显式开启（不是默认）：允许 L3 重新解析；定位漂移生成
 * 「候选」新版 strategy（待人确认），并留决策审计（resolveWithL3 的
 * DecisionRecord）。硬约束：
 *  - 未注入决策能力 → 拒绝执行（heal 是显式 recovery，不是静默路径）；
 *  - 候选恒为 status:'candidate'，绝不回写 Trace、绝不自动生效；
 *  - heal 产物不得被 CI 使用（ci-gate：mode==='heal' 一律 false）；
 *  - 动作失败按 §3.5 classifyFailure 唯一映射分流（heal 不自动 recovery）。
 */
import type { AssertionSpec, EngineProvider } from '../../engine-provider/index.js';
import {
  buildAction,
  classifyFailure,
  needsTarget,
  type CaseResult,
  type DecisionCapability,
  type ExecutorCase,
} from '../executor.js';
import { resolveDeterministic } from '../resolve.js';
import { resolveWithL3, type DecisionRecord } from '../resolve-l3.js';
import type { DriftPoint } from './verify.js';
import type { TraceFile } from './trace.js';

/** 候选新版 strategy：仅建议，待人确认；绝不回写 Trace、绝不进 CI。 */
export interface CandidateStrategy {
  stepIndex: number;
  from: { strategy?: string; elementId?: string | number };
  to: { strategy?: string; elementId?: string | number };
  status: 'candidate';
}

export interface ReplayHealOutcome {
  mode: 'heal';
  outcome: 'match' | 'healed' | 'blocked';
  driftPoints: DriftPoint[];
  candidateStrategies: CandidateStrategy[];
  caseResult: CaseResult;
  /** L3 决策审计（AC-07 同源；accepted/rejected/provider_error 均计一次模型调用）。 */
  decisions: DecisionRecord[];
  modelCalls: number;
}

export interface ReplayHealInput {
  case: ExecutorCase;
  trace: TraceFile;
  provider: Pick<EngineProvider, 'observe' | 'resolve' | 'act' | 'checkAssertion'>;
  /** 必填：heal 允许 L3 重新解析（显式 recovery）。 */
  decision: DecisionCapability;
}

const MODEL_TOUCHING_DECISIONS = new Set(['accepted', 'rejected', 'provider_error']);

export async function replayHeal(input: ReplayHealInput): Promise<ReplayHealOutcome> {
  const { case: c, trace, provider, decision } = input;
  if (!decision || !decision.provider) {
    throw new Error(
      'replay heal requires an explicit decision capability; heal is explicit recovery, never a silent path',
    );
  }

  if (trace.steps.length !== c.steps.length) {
    throw new Error(
      `replay heal: trace/case step count mismatch (trace=${trace.steps.length}, case=${c.steps.length})`,
    );
  }

  const driftPoints: DriftPoint[] = [];
  const candidateStrategies: CandidateStrategy[] = [];
  const decisions: DecisionRecord[] = [];
  const secrets = decision.secrets ?? [];

  const blockedOutcome = (reason: NonNullable<CaseResult['reason']>): ReplayHealOutcome => ({
    mode: 'heal',
    outcome: 'blocked',
    driftPoints,
    candidateStrategies,
    caseResult: { status: 'blocked', reason },
    decisions,
    modelCalls: decisions.filter((d) => MODEL_TOUCHING_DECISIONS.has(d.status)).length,
  });

  for (const [stepIndex, step] of c.steps.entries()) {
    const rec = trace.steps[stepIndex]!;
    let resolvedTarget: Parameters<typeof buildAction>[1] = null;

    if (needsTarget(step.action)) {
      if (!step.target) return blockedOutcome('decision');

      const replayed = await resolveDeterministic(provider, step.target);
      if (replayed.status === 'ambiguous') {
        // 歧义绝不自动选择候选（§8.1）；heal 也不豁免。
        return blockedOutcome('ambiguity');
      }

      if (replayed.status === 'resolved') {
        // 定位级漂移（录制 role / 回放 fingerprint 等）→ 候选，不硬终止。
        if (replayed.strategy !== rec.resolve?.strategy) {
          driftPoints.push({
            stepIndex,
            field: 'resolve.strategy',
            recorded: rec.resolve?.strategy,
            replayed: replayed.strategy,
          });
          candidateStrategies.push({
            stepIndex,
            from: {
              ...(rec.resolve?.strategy !== undefined ? { strategy: rec.resolve.strategy } : {}),
              ...(rec.resolve?.elementId !== undefined
                ? { elementId: rec.resolve.elementId }
                : {}),
            },
            to: {
              ...(replayed.strategy !== undefined ? { strategy: replayed.strategy } : {}),
              ...(replayed.elementId !== undefined ? { elementId: replayed.elementId } : {}),
            },
            status: 'candidate',
          });
        }
        resolvedTarget = replayed;
      } else {
        // L1/L2 未命中 → L3 重新解析（唯一模型介入点，每步至多一次）。
        const attempt = await resolveWithL3({
          provider,
          decision: decision.provider,
          ...(decision.budget ? { budget: decision.budget } : {}),
          target: step.target,
          ctx: {
            stepIndex,
            intent: step.intent,
            operation: step.action as Parameters<typeof resolveWithL3>[0]['ctx']['operation'],
            risk: step.risk,
          },
          ...(secrets.length > 0 ? { secrets } : {}),
        });
        decisions.push(attempt.record);
        if (attempt.outcome !== 'resolved') return blockedOutcome('decision');

        // L3 修复定位：matched 与录制一致（recorded/resolved 均 resolved），
        // 变化只体现在 strategy/elementId → 候选承载差异，不算 matched 漂移。
        candidateStrategies.push({
          stepIndex,
          from: {
            ...(rec.resolve?.strategy !== undefined ? { strategy: rec.resolve.strategy } : {}),
            ...(rec.resolve?.elementId !== undefined ? { elementId: rec.resolve.elementId } : {}),
          },
          to: {
            ...(attempt.resolved.strategy !== undefined
              ? { strategy: attempt.resolved.strategy }
              : {}),
            ...(attempt.resolved.elementId !== undefined
              ? { elementId: attempt.resolved.elementId }
              : {}),
          },
          status: 'candidate',
        });
        resolvedTarget = attempt.resolved;
      }
    }

    const action = buildAction(step, resolvedTarget);
    const ar = await provider.act(action);
    if (ar.status !== rec.actionResultStatus) {
      driftPoints.push({
        stepIndex,
        field: 'action_result.status',
        recorded: rec.actionResultStatus,
        replayed: ar.status,
      });
    }
    if (ar.status !== 'ok') {
      // 动作失败按 §3.5 唯一映射分流；heal 不自动 recovery（可恢复项同样终止，
      // 修复属 Authoring 行为——候选已记录，待人确认后重录）。
      const mapping = classifyFailure(ar, step.risk);
      return blockedOutcome(mapping.blockReason ?? 'recovery');
    }

    // Postcondition：与 executor 同语义（inconclusive 分层 / failed → postcondition）。
    const declared = step.postcondition ?? [];
    const replayedAssertions: Array<{ kind: string; passed: boolean; status: string }> = [];
    for (const raw of declared) {
      const spec: AssertionSpec = raw.target
        ? raw
        : { ...raw, ...(step.target ? { target: step.target } : {}) };
      const r = await provider.checkAssertion(spec);
      replayedAssertions.push({ kind: r.kind, passed: r.passed, status: r.status });
      if (r.status === 'inconclusive') {
        return blockedOutcome(r.blockedReason === 'decision' ? 'decision' : 'evidence');
      }
      if (!r.passed) return blockedOutcome('postcondition');
    }

    const recordedAssertions = rec.assertions ?? [];
    if (
      recordedAssertions.length !== replayedAssertions.length ||
      recordedAssertions.some(
        (a, i) =>
          a.kind !== replayedAssertions[i]!.kind ||
          a.passed !== replayedAssertions[i]!.passed ||
          a.status !== replayedAssertions[i]!.status,
      )
    ) {
      driftPoints.push({
        stepIndex,
        field: 'assertion_results',
        recorded: recordedAssertions,
        replayed: replayedAssertions,
      });
    }
  }

  return {
    mode: 'heal',
    outcome: candidateStrategies.length > 0 ? 'healed' : 'match',
    driftPoints,
    candidateStrategies,
    caseResult: { status: 'completed' },
    decisions,
    modelCalls: decisions.filter((d) => MODEL_TOUCHING_DECISIONS.has(d.status)).length,
  };
}
