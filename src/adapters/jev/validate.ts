/**
 * Task 12 —— validate_choice：合法性校验优先于置信度阈值（DD §7.3 / DD-15）。
 *
 * 校验次序（任一不满足 → 零动作派发，BLOCKED(decision)）：
 *   ① answer 严格 schema（对象 + 白名单键；未知键 = 目标注入 → 拒绝）
 *   ② operation（若模型回填）∈ 白名单且与请求一致
 *   ③ choice 为整数且 ∈ [0, candidateCount)
 *   ④ confidence 为 [0,1] 有限数值
 *   ⑤ probabilities（若携带）键集合 == 全部候选、值 ∈[0,1]、|Σp−1|<1e-6、
 *      p[choice]==max(p)
 *   ⑥ 分级阈值：reversible ≥ 0.60 / irreversible ≥ 0.90
 */
import type { ChoiceAnswer, DecisionOp } from './types.js';
import { DECISION_OPERATIONS } from './types.js';

export { DECISION_OPERATIONS };

/** 分级置信度阈值（DD §7.2，V1.1 DD-15）。 */
export const CONFIDENCE_THRESHOLDS = {
  reversible: 0.6,
  irreversible: 0.9,
} as const;

export type RiskLevel = 'reversible' | 'irreversible';

export type DecisionRejectionReason =
  | 'invalid_structure'
  | 'unknown_field'
  | 'illegal_operation'
  | 'out_of_range'
  | 'invalid_probability'
  | 'low_confidence';

export type ChoiceValidation =
  | {
      ok: true;
      decision: { operation: DecisionOp; targetIndex: number; confidence: number };
    }
  | { ok: false; reason: DecisionRejectionReason; detail: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** ① 严格键白名单 —— 任何携带 selector/xpath/js/坐标 的应答在此拦截。 */
const ANSWER_KEYS = new Set(['operation', 'choice', 'confidence', 'probabilities']);

export function validateChoiceAnswer(params: {
  answer: unknown;
  requestedOperation: DecisionOp;
  candidateCount: number;
  risk: RiskLevel;
}): ChoiceValidation {
  const { answer, requestedOperation, candidateCount, risk } = params;

  // ① 对象与键白名单。
  if (!isPlainObject(answer)) {
    return { ok: false, reason: 'invalid_structure', detail: 'answer must be an object' };
  }
  for (const key of Object.keys(answer)) {
    if (!ANSWER_KEYS.has(key)) {
      return {
        ok: false,
        reason: 'unknown_field',
        detail: `unexpected answer field: ${key}`,
      };
    }
  }

  // ② operation 白名单 + 与请求一致（模型无权改派别的动作）。
  if (answer.operation !== undefined) {
    const op = answer.operation;
    const legal =
      (DECISION_OPERATIONS as readonly string[]).includes(op as string) &&
      op === requestedOperation;
    if (!legal) {
      return {
        ok: false,
        reason: 'illegal_operation',
        detail: `model operation ${JSON.stringify(op)} not allowed (requested: ${requestedOperation})`,
      };
    }
  }

  // ③ choice：缺字段 → invalid_structure；数值但越界/非整数 → out_of_range。
  const choice = answer.choice;
  if (typeof choice !== 'number') {
    return {
      ok: false,
      reason: 'invalid_structure',
      detail: 'answer.choice must be a number',
    };
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= candidateCount) {
    return {
      ok: false,
      reason: 'out_of_range',
      detail: `choice ${String(choice)} outside candidate range [0, ${candidateCount})`,
    };
  }

  // ④ confidence 数值域。
  const confidence = answer.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return {
      ok: false,
      reason: 'invalid_structure',
      detail: `confidence ${String(confidence)} not a number in [0,1]`,
    };
  }

  // ⑤ 概率分布（可选；DD §7.3 ②③④）。
  if (answer.probabilities !== undefined) {
    const p = answer.probabilities;
    if (!isPlainObject(p)) {
      return { ok: false, reason: 'invalid_probability', detail: 'probabilities must be an object' };
    }
    const expectedKeys = new Set(
      Array.from({ length: candidateCount }, (_, i) => String(i)),
    );
    const actualKeys = new Set(Object.keys(p));
    const sameKeys =
      expectedKeys.size === actualKeys.size && [...expectedKeys].every((k) => actualKeys.has(k));
    if (!sameKeys) {
      return {
        ok: false,
        reason: 'invalid_probability',
        detail: 'probability keys must exactly cover all candidates',
      };
    }
    let sum = 0;
    for (const value of Object.values(p)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        return { ok: false, reason: 'invalid_probability', detail: `probability ${String(value)} out of [0,1]` };
      }
      sum += value;
    }
    if (Math.abs(sum - 1) >= 1e-6) {
      return { ok: false, reason: 'invalid_probability', detail: `Σp=${sum} deviates from 1` };
    }
    const chosen = p[String(choice)] as number;
    const max = Math.max(...Object.values(p) as number[]);
    if (chosen !== max) {
      return { ok: false, reason: 'invalid_probability', detail: 'p[choice] must be max(p)' };
    }
  }

  // ⑥ 分级阈值（仅在全部合法性校验通过后生效）。
  const threshold = CONFIDENCE_THRESHOLDS[risk];
  if (confidence < threshold) {
    return {
      ok: false,
      reason: 'low_confidence',
      detail: `confidence ${confidence} < ${threshold} (${risk})`,
    };
  }

  return {
    ok: true,
    decision: { operation: requestedOperation, targetIndex: choice, confidence },
  };
}
