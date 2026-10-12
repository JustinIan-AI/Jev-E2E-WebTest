/**
 * Task 12 —— §8.1 resolveTarget 的 L3 段：JEV 语义决策编排。
 *
 * ★ 唯一模型介入点：仅当 L1/L2 均未命中时调用；每 step 至多一次。
 *
 * 管线（全部失败路径 → 零派发，BLOCKED(decision) 由 executor 映射）：
 *   ① L3 候选：provider.resolve(target,'L3') —— 候选与编号由引擎代码生成；
 *   ② 观测：provider.observe() → redactObservation（password/file/hidden 剔除、
 *      credential 键 [REDACTED]）→ decide state；
 *   ③ 预算：发请求前按最坏情况预留（estimateCost），不足 → 零请求；
 *   ④ decide（异常 → provider_error，绝不重试）；
 *   ⑤ validate_choice（合法性优先于分级阈值）；
 *   ⑥ 转换层：应答 → ResolvedTarget{strategy:'model'}（绝不经模型直连 act）。
 */
import type {
  EngineProvider,
  Observation,
  ResolveResult,
  ResolvedTarget,
  SemanticTarget,
} from '../engine-provider/index.js';
import { redactObservation } from './redaction.js';
import type {
  ChoiceQuestion,
  DecisionOp,
  DecisionRequest,
  DecisionResponse,
  DecisionUsage,
  JevDecisionProvider,
} from '../adapters/jev/types.js';
import { validateChoiceAnswer } from '../adapters/jev/validate.js';
import type { DecisionBudget } from '../adapters/jev/budget.js';

export const L3_QUESTION_ID = 'q_resolve';

/** L3 候选（引擎代码枚举）在 ResolvedTarget 之外可附带的语义提示。 */
export interface L3CandidateHint {
  role?: string;
  name?: string;
  text?: string;
}

export type DecisionRecordStatus =
  | 'accepted'
  | 'rejected'
  | 'no_candidates'
  | 'budget_exhausted'
  | 'provider_error';

/** L3 决策审计记录（拒绝原因 / usage / latency 一并进入 CaseResult.decisions）。 */
export interface DecisionRecord {
  stepIndex: number;
  intent: string;
  operation: DecisionOp;
  provider: string;
  status: DecisionRecordStatus;
  reason?: string;
  detail?: string;
  targetIndex?: number;
  confidence?: number;
  elementId?: string | number;
  candidateCount: number;
  usage?: DecisionUsage;
  latencyMs?: number;
}

export type L3Attempt =
  | { outcome: 'resolved'; resolved: ResolveResult; record: DecisionRecord }
  | { outcome: 'rejected'; record: DecisionRecord };

export interface L3AttemptContext {
  stepIndex: number;
  intent: string;
  operation: DecisionOp;
  risk: 'reversible' | 'irreversible';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function resolveWithL3(params: {
  provider: Pick<EngineProvider, 'observe' | 'resolve'>;
  decision: JevDecisionProvider;
  budget?: DecisionBudget;
  target: SemanticTarget;
  ctx: L3AttemptContext;
  secrets?: readonly string[];
}): Promise<L3Attempt> {
  const { provider, decision, target, ctx } = params;
  const secrets = params.secrets ?? [];
  const base = {
    stepIndex: ctx.stepIndex,
    intent: ctx.intent,
    operation: ctx.operation,
    provider: decision.id,
  };

  // ① L3 候选（引擎代码枚举；候选编号绝不来自模型）。
  let l3: ResolveResult;
  try {
    l3 = await provider.resolve(target, 'L3');
  } catch (error) {
    return {
      outcome: 'rejected',
      record: { ...base, status: 'provider_error', reason: messageOf(error), candidateCount: 0 },
    };
  }
  const candidates = (l3.candidates ?? []) as ReadonlyArray<ResolvedTarget & L3CandidateHint>;
  if (candidates.length === 0) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'no_candidates',
        reason: 'engine returned no L3 candidates',
        candidateCount: 0,
      },
    };
  }

  // ② 观测 → 脱敏 state（AC-05 观测面：password/file/hidden 剔除 + credential [REDACTED]）。
  let observation: Observation;
  try {
    observation = await provider.observe();
  } catch (error) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'provider_error',
        reason: messageOf(error),
        candidateCount: candidates.length,
      },
    };
  }

  const question: ChoiceQuestion = {
    id: L3_QUESTION_ID,
    prompt: ctx.intent,
    choices: candidates.map((c, i) => ({
      index: i,
      elementId: c.elementId,
      role: c.role ?? '',
      name: c.name ?? '',
      ...(c.text !== undefined ? { text: c.text } : {}),
    })),
  };

  const request: DecisionRequest = {
    state: redactObservation({ ...observation }, secrets),
    questions: { [L3_QUESTION_ID]: question },
  };

  // ③ 预算：发请求前按最坏情况预留额度；不足 → 零请求零派发。
  const cost = decision.estimateCost?.(request) ?? 0;
  if (params.budget && !params.budget.reserve(1, cost)) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'budget_exhausted',
        reason: `worst-case estimate ${cost} exceeds remaining budget`,
        candidateCount: candidates.length,
      },
    };
  }

  // ④ 模型调用（异常 → provider_error；绝不自动重试）。
  let response: DecisionResponse;
  try {
    response = await decision.decide(request);
  } catch (error) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'provider_error',
        reason: messageOf(error),
        candidateCount: candidates.length,
      },
    };
  }

  const latencyMs = response.latency_ms;
  const usage = response.usage;

  // ⑤ 应答校验（合法性优先于阈值；missing answer 同样拒绝）。
  const answer = response.answers[L3_QUESTION_ID];
  if (answer === undefined) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'rejected',
        reason: 'missing_answer',
        candidateCount: candidates.length,
        ...(usage ? { usage } : {}),
        latencyMs,
      },
    };
  }
  const validated = validateChoiceAnswer({
    answer,
    requestedOperation: ctx.operation,
    candidateCount: candidates.length,
    risk: ctx.risk,
  });
  if (!validated.ok) {
    return {
      outcome: 'rejected',
      record: {
        ...base,
        status: 'rejected',
        reason: validated.reason,
        detail: validated.detail,
        candidateCount: candidates.length,
        ...(usage ? { usage } : {}),
        latencyMs,
      },
    };
  }

  // ⑥ Action 转换层：只允许选择代码给定候选；elementId 来自候选集，不来自模型。
  const chosen = candidates[validated.decision.targetIndex]!;
  return {
    outcome: 'resolved',
    resolved: {
      status: 'resolved',
      mode: 'L3',
      elementId: chosen.elementId,
      strategy: 'model',
      confidence: validated.decision.confidence,
    },
    record: {
      ...base,
      status: 'accepted',
      candidateCount: candidates.length,
      targetIndex: validated.decision.targetIndex,
      confidence: validated.decision.confidence,
      elementId: chosen.elementId,
      ...(usage ? { usage } : {}),
      latencyMs,
    },
  };
}
