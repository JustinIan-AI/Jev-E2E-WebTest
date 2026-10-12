/**
 * Task 12 —— JEV 决策 Provider 契约类型（DD §7.1 / 行 1034）。
 *
 * 候选问题集与编号一律由代码生成；模型只见 choices[].index（0 起始序号），
 * 绝不接触 elementId / selector / xpath。决策应答经 validate.ts 校验后才允许
 * 转换为 §3.4 Action。
 */

/** L3 语义动作白名单（§4.8.4 web-semantic-action；与 needsTarget 三动作一致）。 */
export const DECISION_OPERATIONS = ['click', 'fill', 'select'] as const;
export type DecisionOp = (typeof DECISION_OPERATIONS)[number];

/** 单个候选（代码生成）：index 为问题集内序号；elementId 为引擎侧编号，模型不可见。 */
export interface ChoiceChoice {
  index: number;
  elementId: string | number;
  role: string;
  name: string;
  text?: string;
}

/** 一次 L3 决策的问题（当前每步恰一个：目标解析）。 */
export interface ChoiceQuestion {
  id: string;
  prompt: string;
  choices: ChoiceChoice[];
}

/** Token 用量（usage 记录要求；字段缺失由具体 Provider 决定）。 */
export interface DecisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** 模型对单个问题的应答（严格 schema；未知字段 → 拒绝）。 */
export interface ChoiceAnswer {
  /** 若模型回填，必须 ∈ DECISION_OPERATIONS 且与请求 operation 一致。 */
  operation?: string;
  /** 候选序号（0..choices.length-1）。 */
  choice: number;
  /** [0,1]；分级阈值 reversible ≥0.60 / irreversible ≥0.90。 */
  confidence: number;
  /** 可选完整分布：键 = String(index)，须覆盖全部候选、Σ≈1、p[choice]=max。 */
  probabilities?: Record<string, number>;
}

export interface DecisionRequest {
  /** 已脱敏页面状态（redactObservation 之后；password/file/hidden 已剔除）。 */
  state: Record<string, unknown>;
  questions: Record<string, ChoiceQuestion>;
}

export interface DecisionResponse {
  answers: Record<string, ChoiceAnswer>;
  usage?: DecisionUsage;
  latency_ms: number;
}

/**
 * 决策 Provider（DD §7.1）。确定性执行路径绝不持有本接口的实现（TR-12.2）；
 * 仅 L1/L2 未命中时由 resolve-l3 编排调用（每 step 至多一次）。
 */
export interface JevDecisionProvider {
  /** 审计用来源标识（如 'mock' / 'typesafe-jev'）。 */
  readonly id: string;
  decide(input: DecisionRequest): Promise<DecisionResponse>;
  /** 最坏情况成本估计（发请求前预算预留用）；无实现按 0 计。 */
  estimateCost?(input: DecisionRequest): number;
}
