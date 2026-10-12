/**
 * Task 15 / DD §4.7 / AC-11 —— replay verify（默认模式，零模型）。
 *
 * 硬约束：
 *  - --verify 是真的默认（不是文档话术）；零模型调用——本模块不接收任何
 *    决策能力，重解析只走 L1/L2 确定性路径（resolveDeterministic）；
 *  - 逐步比对四项（任一不一致即 DRIFT）：resolve.strategy / resolve.matched /
 *    action_result.status / assertion results；
 *  - 任一漂移 → 报 DRIFT 并终止（漂移步不派发），BLOCKED(drift)（A6）；
 *  - A11：引擎缓存记录陈旧 → 默认命令报错终止（stale-cache），不得静默
 *    heal 后报通过；
 *  - verify 产物可入 CI（isCiUsableReplayOutcome）。
 */
import type {
  AssertionSpec,
  EngineProvider,
  ResolveResult,
} from '../../engine-provider/index.js';
import { buildAction, needsTarget, type CaseResult, type ExecutorCase } from '../executor.js';
import { resolveDeterministic } from '../resolve.js';
import { loadEngineCache } from './engine-cache.js';
import type { TraceFile } from './trace.js';

export type DriftField =
  | 'resolve.matched'
  | 'resolve.strategy'
  | 'action_result.status'
  | 'assertion_results';

/** 漂移点定位：哪一步、哪个比对项、录制值 vs 回放值。 */
export interface DriftPoint {
  stepIndex: number;
  field: DriftField;
  recorded: unknown;
  replayed: unknown;
}

export interface ReplayVerifyOutcome {
  mode: 'verify';
  outcome: 'match' | 'drift' | 'stale-cache';
  driftPoints: DriftPoint[];
  caseResult: CaseResult;
  /** verify 恒为 0（零模型硬保证：类型上不接收决策能力）。 */
  modelCalls: 0;
  /** 已完整比对通过的步数（漂移步不计入）。 */
  stepsExecuted: number;
  /** 仅 stale-cache 时携带。 */
  stale?: { stored: string; current: string };
}

export interface ReplayVerifyInput {
  case: ExecutorCase;
  trace: TraceFile;
  provider: Pick<EngineProvider, 'resolve' | 'act' | 'checkAssertion'>;
  /** 可选引擎缓存新鲜度前置检查（A11：陈旧 → 报错终止）。 */
  engineCache?: { root: string; currentVersion: string };
}

/** 比较断言结果三元组（kind/passed/status 按序对齐）。 */
function sameAssertion(
  a: { kind: string; passed: boolean; status: string },
  b: { kind: string; passed: boolean; status: string },
): boolean {
  return a.kind === b.kind && a.passed === b.passed && a.status === b.status;
}

export async function replayVerify(input: ReplayVerifyInput): Promise<ReplayVerifyOutcome> {
  const { case: c, trace, provider } = input;

  // A11：陈旧引擎缓存 → 默认命令报错终止；零执行、零派发、绝不静默 heal。
  if (input.engineCache) {
    const cache = await loadEngineCache(input.engineCache.root, input.engineCache.currentVersion);
    if (cache.status === 'stale') {
      return {
        mode: 'verify',
        outcome: 'stale-cache',
        driftPoints: [],
        caseResult: { status: 'blocked', reason: 'env' },
        modelCalls: 0,
        stepsExecuted: 0,
        stale: { stored: cache.stored, current: cache.current },
      };
    }
  }

  if (trace.steps.length !== c.steps.length) {
    throw new Error(
      `replay verify: trace/case step count mismatch (trace=${trace.steps.length}, case=${c.steps.length})`,
    );
  }

  const driftPoints: DriftPoint[] = [];
  let stepsExecuted = 0;

  for (const [stepIndex, step] of c.steps.entries()) {
    const rec = trace.steps[stepIndex]!;

    // ① 定位比对（仅目标步骤；verify 只允许 L1/L2 确定性重解析，零模型）。
    let replayedResolved: ResolveResult | null = null;
    if (needsTarget(step.action)) {
      if (!step.target) {
        throw new Error(`replay verify: step ${stepIndex} needs a target but none declared`);
      }
      const replayed = await resolveDeterministic(provider, step.target);
      const recResolve = rec.resolve;
      const matchedNow = replayed.status === 'resolved';
      const matchedRecorded = recResolve?.status === 'resolved';

      if (matchedNow !== matchedRecorded) {
        driftPoints.push({
          stepIndex,
          field: 'resolve.matched',
          recorded: recResolve?.status ?? 'none',
          replayed: replayed.status,
        });
        break;
      }
      if (matchedNow && recResolve?.strategy !== replayed.strategy) {
        driftPoints.push({
          stepIndex,
          field: 'resolve.strategy',
          recorded: recResolve?.strategy,
          replayed: replayed.strategy,
        });
        break;
      }
      if (matchedNow) replayedResolved = replayed;
    }

    // ② 动作结果比对（resolve 漂移已终止；此处用回放解析结果构建动作）。
    const ar = await provider.act(buildAction(step, replayedResolved));
    if (ar.status !== rec.actionResultStatus) {
      driftPoints.push({
        stepIndex,
        field: 'action_result.status',
        recorded: rec.actionResultStatus,
        replayed: ar.status,
      });
      break;
    }

    // ③ 断言结果比对（postcondition 声明固定 → 与录制记录按序对齐）。
    const declared = step.postcondition ?? [];
    const replayedAssertions: Array<{ kind: string; passed: boolean; status: string }> = [];
    for (const raw of declared) {
      const spec: AssertionSpec = raw.target
        ? raw
        : { ...raw, ...(step.target ? { target: step.target } : {}) };
      const r = await provider.checkAssertion(spec);
      replayedAssertions.push({ kind: r.kind, passed: r.passed, status: r.status });
    }
    const recordedAssertions = rec.assertions ?? [];
    const assertionsDrift =
      recordedAssertions.length !== replayedAssertions.length ||
      recordedAssertions.some((a, i) => !sameAssertion(a, replayedAssertions[i]!));
    if (assertionsDrift) {
      driftPoints.push({
        stepIndex,
        field: 'assertion_results',
        recorded: recordedAssertions,
        replayed: replayedAssertions,
      });
      break;
    }

    stepsExecuted += 1;
  }

  const drifted = driftPoints.length > 0;
  return {
    mode: 'verify',
    outcome: drifted ? 'drift' : 'match',
    driftPoints,
    caseResult: drifted ? { status: 'blocked', reason: 'drift' } : { status: 'completed' },
    modelCalls: 0,
    stepsExecuted,
  };
}
