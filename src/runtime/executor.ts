/**
 * §4.2 / §8.1 Executor —— 逐步确定性执行状态机。
 *
 * 每步固定管线：resolveTarget → verifyFreshness → dispatch → （失败分流）
 * → postcondition。确定性路径禁止 JEV（本模块不持有任何模型引用；L3 由
 * Task 12 在解析层接入）。
 *
 * Mutation 安全铁律（TR-6.2）：
 *  - ambiguous / 已派发超时 / nav_blocked / irreversible 任一失败 → 立即 BLOCKED，
 *    绝不二次派发；
 *  - Recovery 仅对「未派发、可逆」失败开放，上限 1 次/步、3 次/case（§8.3）；
 *  - Recovery 后必须校验该步声明的 postcondition，未声明 → BLOCKED(postcondition)。
 */
import type {
  Action,
  ActionResult,
  AssertionSpec,
  EngineProvider,
  ResolveResult,
  SemanticTarget,
} from '../engine-provider/index.js';
import { resolveDeterministic } from './resolve.js';
import { ensureFresh, type FreshnessCapable } from './freshness.js';

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
  | 'evidence';

/** 单形态结果：completed 时无 reason；blocked 时必须携带唯一原因码。 */
export interface CaseResult {
  status: 'completed' | 'blocked';
  reason?: BlockReason;
}

export interface ExecuteCaseOptions {
  /**
   * Recovery 钩子：由编排层提供（重新展开导航/关闭弹层等）。
   * 返回 true 表示环境已修复，允许在同一步重新派发一次。
   */
  recover?: () => Promise<boolean>;
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

function blocked(reason: BlockReason): CaseResult {
  return { status: 'blocked', reason };
}

function needsTarget(kind: Action['kind']): boolean {
  return kind === 'click' || kind === 'fill' || kind === 'select';
}

function buildAction(step: ExecutorStep, resolved: ResolveResult | null): Action {
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

  for (const step of c.steps) {
    // ① 定位（L1→L2 确定性串行）+ ② Freshness（失效只重解析一次）。
    let resolved: ResolveResult | null = null;
    if (needsTarget(step.action)) {
      if (!step.target) return blocked('decision');

      const initial = await resolveDeterministic(provider, step.target);
      if (initial.status === 'ambiguous') return blocked('ambiguity');
      if (initial.status !== 'resolved') return blocked('decision');

      const freshness = await ensureFresh(provider, step.target, initial);
      if (freshness.outcome === 'drift') return blocked('drift');
      resolved = freshness.resolved;
    }

    // ③ 派发。
    const action = buildAction(step, resolved);
    let ar = await provider.act(action);

    // ④ 失败分流 + Recovery 循环（复用已解析目标，不再 resolve/freshness）。
    let recovered = false;
    if (ar.status !== 'ok') {
      let stepRecoveries = 0;
      while (ar.status !== 'ok') {
        const mapping = classifyFailure(ar, step.risk);
        if (!mapping.recoverable) return blocked(mapping.blockReason ?? 'decision');

        if (
          stepRecoveries >= MAX_RECOVERY_PER_STEP ||
          caseRecoveries >= MAX_RECOVERY_PER_CASE ||
          !options.recover
        ) {
          return blocked('recovery');
        }

        const fixed = await options.recover();
        stepRecoveries += 1;
        caseRecoveries += 1;
        if (!fixed) return blocked('recovery');

        // Recovery 成功必须以声明的 postcondition 兜底；未声明无法确认系统状态。
        if (!step.postcondition || step.postcondition.length === 0) {
          return blocked('postcondition');
        }

        recovered = true;
        ar = await provider.act(action);
      }
    }

    // ⑤ Postcondition。
    //   - recovery 路径上声明非空已在循环内保证；
    //   - 正常路径仅在声明时求值；
    //   - 断言为否 → BLOCKED(postcondition)；断言无法求值 → BLOCKED(evidence)。
    if (step.postcondition && step.postcondition.length > 0) {
      for (const raw of step.postcondition) {
        const spec: AssertionSpec = raw.target
          ? raw
          : { ...raw, ...(step.target ? { target: step.target } : {}) };
        const r = await provider.checkAssertion(spec);
        if (r.status === 'inconclusive') return blocked('evidence');
        if (!r.passed) return blocked('postcondition');
      }
    } else if (recovered) {
      // 理论不可达（循环内已拦截），保留防御性分支。
      return blocked('postcondition');
    }
  }

  return { status: 'completed' };
}
