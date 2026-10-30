/**
 * §4.2 / §8.1 Executor —— 逐步确定性执行状态机。
 *
 * 每步固定管线：resolveTarget（L1→L2→L3）→ verifyFreshness → dispatch
 * → （失败分流）→ postcondition。确定性路径（未注入 options.decision）绝不
 * 持有可调用 Provider（TR-12.2）；L3 仅在 L1/L2 均未命中时由 resolve-l3
 * 编排发起（唯一模型介入点，每 step 至多一次）。
 *
 * Mutation 安全铁律（TR-6.2）：
 *  - ambiguous / 已派发超时 / nav_blocked / irreversible 任一失败 → 立即 BLOCKED，
 *    绝不二次派发；
 *  - Recovery 仅对「未派发、可逆」失败开放，上限 1 次/步、3 次/case（§8.3）；
 *  - Recovery 后必须校验该步声明的 postcondition，未声明 → BLOCKED(postcondition)。
 *
 * Recovery 审计（AC-07 / Task 13）：
 *  - 每次 Recovery 留下 RecoveryRecord（case 级 attempt、mode、恢复前后 fresh
 *    快照、时延），随 CaseResult.recoveries 返回；
 *  - A4（semantic-recovery ①）：recover 钩子零参调用拿不到 Goal/Assertion 句柄，
 *    恢复后校验的 postcondition 以派发前固化的副本为准，运行期篡改不生效。
 */
import type {
  Action,
  ActionResult,
  ActionResultStatus,
  AssertionKind,
  AssertionResultStatus,
  AssertionSpec,
  EngineProvider,
  ResolveMode,
  ResolveResult,
  ResolveStatus,
  ResolvedTarget,
  SemanticTarget,
} from '../engine-provider/index.js';
import { resolveDeterministic } from './resolve.js';
import { ensureFresh, type FreshnessCapable } from './freshness.js';
import { resolveWithL3, type DecisionRecord } from './resolve-l3.js';
import {
  captureRecoverySnapshot,
  normalizeRecoveryOutcome,
  type RecoveryOutcome,
  type RecoveryRecord,
} from './recovery-audit.js';
import type { DecisionBudget } from '../adapters/jev/budget.js';
import type { DecisionOp, JevDecisionProvider } from '../adapters/jev/types.js';

/** Executor 消费的类型化步视图（Contract 加载产物在编排层映射为本形状）。 */
export interface ExecutorStep {
  intent: string;
  action: Action['kind'];
  /** 风险等级由 Contract 给出，模型/运行时均无权降低（§3.4）。 */
  risk: 'reversible' | 'irreversible';
  /** 元素交互动作（click/fill/select）必填；其余动作无目标。 */
  target?: SemanticTarget;
  value?: string;
  url?: string;
  ms?: number;
  deltaY?: number;
  /** 步级后置断言；recovery 成功后必须能据此确认系统真实状态。 */
  postcondition?: AssertionSpec[];
}

export interface ExecutorCase {
  id: string;
  steps: ExecutorStep[];
}

export type BlockReason =
  | 'ambiguity'
  | 'decision'
  | 'drift'
  | 'postcondition'
  | 'recovery'
  | 'env'
  | 'evidence'
  /** Issue #24：navigate 后应用未挂载（就绪门超时）——环境未就绪，快速失败。 */
  | 'app_not_mounted';

/** 单形态结果：completed 时无 reason；blocked 时必须携带唯一原因码。 */
export interface CaseResult {
  status: 'completed' | 'blocked';
  reason?: BlockReason;
  /** 受阻原因的可读明细（如 app_not_mounted 的 selector 与等待秒数）。 */
  reasonDetail?: string;
  /** Task 12：L3 决策审计（状态/拒绝原因/usage/latency）；仅发生决策尝试时携带。 */
  decisions?: DecisionRecord[];
  /** Task 13：Recovery 审计（attempt/mode/before-after 快照）；仅发生恢复时携带。 */
  recoveries?: RecoveryRecord[];
}

/** Task 12：L3 决策能力（显式注入；未注入 = 纯确定性路径，绝不持有 Provider）。 */
export interface DecisionCapability {
  provider: JevDecisionProvider;
  /** §7.4 预算（max_requests/max_cost，发请求前最坏情况预留）。 */
  budget?: DecisionBudget;
  /** 观测脱敏已知明文（进 decide state 前替换 [REDACTED]）。 */
  secrets?: readonly string[];
}

/**
 * Task 15：步级执行观测记录（onStep 观测钩子载荷；回放 trace 录制的原始输入）。
 * 仅完成步骤产出记录；BLOCKED 步骤不产出（trace 只记录完成路径）。
 */
export interface StepExecutionRecord {
  stepIndex: number;
  intent: string;
  action: Action['kind'];
  /** 目标步骤的定位结果（无目标步骤缺省）。 */
  resolve?: {
    status: ResolveStatus;
    mode?: ResolveMode;
    strategy?: ResolvedTarget['strategy'];
    elementId?: string | number;
  };
  actionResultStatus: ActionResultStatus;
  dispatched?: boolean;
  assertions?: Array<{ kind: AssertionKind; passed: boolean; status: AssertionResultStatus }>;
}

export interface ExecuteCaseOptions {
  /** Task 15：步级观测钩子（纯观测，不改变执行语义；回放 trace 录制入口）。 */
  onStep?: (record: StepExecutionRecord) => void;
  /**
   * Recovery 钩子：由编排层提供（重新展开导航/关闭弹层等）。
   * ★ 零参调用（A4）：Runtime 绝不递给钩子 Goal/Assertion 的可写句柄。
   * 返回 true（兼容旧钩子）或 { ok, mode? }；ok=true 表示环境已修复，
   * 允许在同一步重新派发一次。每次调用都会产生一条 RecoveryRecord。
   */
  recover?: () => Promise<boolean | RecoveryOutcome>;
  /** 观测脱敏已知明文：Recovery before/after 快照采集时替换 [REDACTED]。 */
  secrets?: readonly string[];
  /** L3 语义决策（唯一模型介入点）；缺省 → 纯 L1/L2 确定性执行（TR-12.2）。 */
  decision?: DecisionCapability;
}

/** §3.5 唯一映射：ActionResult × risk → 是否可 recovery / 否则的 BLOCKED 原因。 */
export function classifyFailure(
  ar: ActionResult,
  risk: 'reversible' | 'irreversible' = 'reversible',
): { recoverable: boolean; blockReason?: BlockReason } {
  const irreversible = risk === 'irreversible';

  switch (ar.status) {
    case 'ambiguous':
      // 歧义永远不允许自动选择候选 → BLOCKED(ambiguity)。
      return { recoverable: false, blockReason: 'ambiguity' };
    case 'nav_blocked':
      return { recoverable: false, blockReason: 'env' };
    case 'timeout':
      // Issue #24：navigate 的应用就绪门超时 —— 页面已加载但应用未挂载，
      // 属环境未就绪（不是 mutation 结果未知），不得 recovery（重试只会白等）。
      if (ar.kind === 'navigate' && ar.errorCode === 'app_not_mounted') {
        return { recoverable: false, blockReason: 'app_not_mounted' };
      }
      // 已派发的 mutation 结果未知：禁止重试（可能已生效）。
      if (ar.dispatched) return { recoverable: false, blockReason: 'decision' };
      return irreversible
        ? { recoverable: false, blockReason: 'decision' }
        : { recoverable: true };
    case 'not_found':
    case 'disabled':
    case 'covered':
      // 均为派发前失败；不可逆动作仍不允许 recovery（§8.2 唯一映射表）。
      return irreversible
        ? { recoverable: false, blockReason: 'decision' }
        : { recoverable: true };
    case 'error':
      if (irreversible || ar.dispatched) {
        return { recoverable: false, blockReason: 'decision' };
      }
      return { recoverable: true };
    case 'ok':
      return { recoverable: false };
  }
}

type ExecutorProvider = EngineProvider & FreshnessCapable;

const MAX_RECOVERY_PER_STEP = 1;
const MAX_RECOVERY_PER_CASE = 3;

function blocked(
  reason: BlockReason,
  decisions: DecisionRecord[] = [],
  recoveries: RecoveryRecord[] = [],
  detail?: string,
): CaseResult {
  return {
    status: 'blocked',
    reason,
    ...(detail !== undefined && detail.length > 0 ? { reasonDetail: detail } : {}),
    ...(decisions.length > 0 ? { decisions } : {}),
    ...(recoveries.length > 0 ? { recoveries } : {}),
  };
}

export function needsTarget(kind: Action['kind']): boolean {
  return kind === 'click' || kind === 'fill' || kind === 'select';
}

export function buildAction(step: ExecutorStep, resolved: ResolveResult | null): Action {
  switch (step.action) {
    case 'click':
      return {
        kind: 'click',
        risk: step.risk,
        target: {
          elementId: resolved?.elementId ?? '',
          strategy: resolved?.strategy ?? 'role',
        },
      };
    case 'fill':
    case 'select':
      return {
        kind: step.action,
        risk: step.risk,
        target: {
          elementId: resolved?.elementId ?? '',
          strategy: resolved?.strategy ?? 'role',
        },
        value: step.value ?? '',
      };
    case 'scroll':
      return { kind: 'scroll', risk: step.risk, deltaY: step.deltaY ?? 0 };
    case 'wait':
      return { kind: 'wait', risk: step.risk, ms: step.ms ?? 0 };
    case 'navigate':
      return { kind: 'navigate', risk: step.risk, url: step.url ?? '' };
    case 'assert_only':
      return { kind: 'assert_only', risk: step.risk };
    case 'done':
      return { kind: 'done', risk: step.risk };
  }
}

export async function executeCase(
  c: ExecutorCase,
  provider: ExecutorProvider,
  options: ExecuteCaseOptions = {},
): Promise<CaseResult> {
  let caseRecoveries = 0;
  /** Case 级 L3 决策审计（跨步骤累积）。 */
  const decisions: DecisionRecord[] = [];
  /** Case 级 Recovery 审计（跨步骤累积，AC-07）。 */
  const recoveries: RecoveryRecord[] = [];
  const secrets = options.secrets ?? [];

  for (const [stepIndex, step] of c.steps.entries()) {
    /** Task 15：本步观测记录素材（仅完成步骤 emit）。 */
    let recordedResolve: StepExecutionRecord['resolve'];
    const recordedAssertions: NonNullable<StepExecutionRecord['assertions']> = [];
    // ① 定位（L1→L2 确定性串行，均未命中才 L3）+ ② Freshness（失效只重解析一次）。
    let resolved: ResolveResult | null = null;
    if (needsTarget(step.action)) {
      if (!step.target) return blocked('decision', decisions, recoveries);

      const initial = await resolveDeterministic(provider, step.target);
      if (initial.status === 'ambiguous') return blocked('ambiguity', decisions, recoveries);

      let current: ResolveResult;
      if (initial.status === 'resolved') {
        current = initial;
      } else {
        // §8.1 L3：仅 L1/L2 均未命中时构造候选问题集调用决策 Provider。
        // 未注入 decision → 确定性路径直接 BLOCKED(decision)，零模型调用（TR-12.2）。
        if (!options.decision) return blocked('decision', decisions, recoveries);

        const attempt = await resolveWithL3({
          provider,
          decision: options.decision.provider,
          ...(options.decision.budget ? { budget: options.decision.budget } : {}),
          target: step.target,
          ctx: {
            stepIndex,
            intent: step.intent,
            operation: step.action as DecisionOp,
            risk: step.risk,
          },
          ...(options.decision.secrets ? { secrets: options.decision.secrets } : {}),
        });
        decisions.push(attempt.record);
        if (attempt.outcome !== 'resolved') return blocked('decision', decisions, recoveries);
        current = attempt.resolved;
      }

      const freshness = await ensureFresh(provider, step.target, current);
      if (freshness.outcome === 'drift') return blocked('drift', decisions, recoveries);
      resolved = freshness.resolved;
      recordedResolve = {
        status: resolved.status,
        ...(initial.mode !== undefined ? { mode: initial.mode } : {}),
        ...(resolved.strategy !== undefined ? { strategy: resolved.strategy } : {}),
        ...(resolved.elementId !== undefined ? { elementId: resolved.elementId } : {}),
      };
    }

    // ③ 派发。
    const action = buildAction(step, resolved);
    // A4（semantic-recovery ①）：派发前固化本步声明的 postcondition。
    // recover 钩子零参调用、拿不到可写句柄；钩子对断言的运行期篡改不生效——
    // 恢复后校验的永远是这份固化副本。
    const declared: AssertionSpec[] | undefined = step.postcondition
      ? structuredClone(step.postcondition)
      : undefined;
    let ar = await provider.act(action);

    // ④ 失败分流 + Recovery 循环（复用已解析目标，不再 resolve/freshness）。
    let recovered = false;
    if (ar.status !== 'ok') {
      let stepRecoveries = 0;
      while (ar.status !== 'ok') {
        const mapping = classifyFailure(ar, step.risk);
        if (!mapping.recoverable)
          return blocked(
            mapping.blockReason ?? 'decision',
            decisions,
            recoveries,
            // Issue #24：app_not_mounted 的可读明细（selector + 等待秒数）入档。
            mapping.blockReason === 'app_not_mounted' && ar.status === 'timeout'
              ? ar.message
              : undefined,
          );

        if (
          stepRecoveries >= MAX_RECOVERY_PER_STEP ||
          caseRecoveries >= MAX_RECOVERY_PER_CASE ||
          !options.recover
        ) {
          return blocked('recovery', decisions, recoveries);
        }

        // 审计：before 快照 → 恢复 → （成功才采 after 快照）→ RecoveryRecord 入档。
        const startedAt = Date.now();
        const before = await captureRecoverySnapshot(provider, secrets);
        const outcome = normalizeRecoveryOutcome(await options.recover());
        const after = outcome.ok ? await captureRecoverySnapshot(provider, secrets) : {};
        recoveries.push({
          stepIndex,
          intent: step.intent,
          attempt: caseRecoveries + 1,
          fixed: outcome.ok,
          ...(outcome.mode ? { mode: outcome.mode } : {}),
          ...(before.snapshot
            ? { before: before.snapshot }
            : before.error
              ? { beforeError: before.error }
              : {}),
          ...(after.snapshot
            ? { after: after.snapshot }
            : after.error
              ? { afterError: after.error }
              : {}),
          latencyMs: Date.now() - startedAt,
        });
        stepRecoveries += 1;
        caseRecoveries += 1;
        if (!outcome.ok) return blocked('recovery', decisions, recoveries);

        // Recovery 成功必须以「派发前固化」的 postcondition 兜底；未声明无法确认系统状态。
        if (!declared || declared.length === 0) {
          return blocked('postcondition', decisions, recoveries);
        }

        recovered = true;
        ar = await provider.act(action);
      }
    }

    // ⑤ Postcondition（对固化副本求值 —— A4：recovery 期间的篡改不生效）。
    //   - recovery 路径上声明非空已在循环内保证；
    //   - 正常路径仅在声明时求值；
    //   - 断言为否 → BLOCKED(postcondition)；断言无法求值 → BLOCKED(evidence)。
    if (declared && declared.length > 0) {
      for (const raw of declared) {
        const spec: AssertionSpec = raw.target
          ? raw
          : { ...raw, ...(step.target ? { target: step.target } : {}) };
        const r = await provider.checkAssertion(spec);
        // TR-14.2（DD-32）：引擎判不出来（上游 ASSERTION_INCONCLUSIVE 被吸附为
        // inconclusive + decision）→ BLOCKED(decision)，不得降级为 evidence、
        // 更不得记 FAIL；本层自身的断言无法求值仍为 BLOCKED(evidence)（§8.2）。
        if (r.status === 'inconclusive') {
          return blocked(
            r.blockedReason === 'decision' ? 'decision' : 'evidence',
            decisions,
            recoveries,
          );
        }
        if (!r.passed) return blocked('postcondition', decisions, recoveries);
        recordedAssertions.push({ kind: r.kind, passed: r.passed, status: r.status });
      }
    } else if (recovered) {
      // 理论不可达（循环内已拦截），保留防御性分支。
      return blocked('postcondition', decisions, recoveries);
    }

    // Task 15：步级观测（trace 录制原始输入；纯观测，不影响执行语义）。
    options.onStep?.({
      stepIndex,
      intent: step.intent,
      action: step.action,
      ...(recordedResolve ? { resolve: recordedResolve } : {}),
      actionResultStatus: ar.status,
      ...(ar.dispatched !== undefined ? { dispatched: ar.dispatched } : {}),
      ...(recordedAssertions.length > 0 ? { assertions: recordedAssertions } : {}),
    });
  }

  return {
    status: 'completed',
    ...(decisions.length > 0 ? { decisions } : {}),
    ...(recoveries.length > 0 ? { recoveries } : {}),
  };
}
