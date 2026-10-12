/**
 * Task 9 — Judge 纯函数类型契约（详设 §3.2 / §3.6 / §4.8.7，AC-09/AC-10）。
 *
 * Judge 只接受结构化证据（不直接依赖浏览器/Provider），在 Node 侧可离线求值。
 * 模型信号恒为 candidate，类型上与断言/证据分离，不能直接产生 PASS/FAIL。
 */

export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED';
export type BlockedReason = 'evidence' | 'ambiguity';

/** DOM 七原语（§3.2 行 391-399）。 */
export interface DomAssertionSpec {
  kind: 'visible' | 'absent' | 'count' | 'value' | 'checked' | 'url' | 'number';
  /** 匹配目标（role 不参与，按 name/text 子串 case-insensitive；match:exact 收紧）。 */
  target?: string;
  equals?: string | number | boolean;
  text_contains?: string;
  match?: 'substring' | 'exact';
  allow_multiple?: boolean;
}

export interface HttpAssertionSpec {
  kind: 'http';
  method: string;
  /** 前缀匹配（去 query 的 pathname）；与 path_equals 互斥。 */
  path_prefix?: string;
  /** 精确匹配（去 query 的 pathname）。 */
  path_equals?: string;
  status_equals: number;
  /** true 时只取 timestamp >= run_started_at 的响应。 */
  within_run?: boolean;
}

export interface BackendAssertionSpec {
  kind: 'backend';
  key: string;
  equals: unknown;
}

export interface StateAssertionSpec {
  kind: 'state';
  key: string;
  equals: unknown;
}

export interface JudgeAssertions {
  dom: DomAssertionSpec[];
  http?: HttpAssertionSpec[];
  backend?: BackendAssertionSpec[];
  state?: StateAssertionSpec[];
}

/** 可观测 DOM 元素快照（纯数据）。 */
export interface JudgeElement {
  id: number;
  role: string;
  name: string;
  text: string;
  visible: boolean;
  enabled: boolean;
  value?: string | undefined;
  checked?: boolean | undefined;
}

/** 网络响应记录。 */
export interface JudgeHttpRecord {
  id: string;
  method: string;
  url: string;
  status: number;
  timestamp: string;
  body: unknown;
}

/** Backend EvidenceProvider 查询结果。 */
export interface JudgeBackendRecord {
  key: string;
  value: unknown;
  scope: 'run' | string;
}

export interface JudgeEvidence {
  elements: JudgeElement[];
  url: string;
  /** run 起始时间（ISO），within_run 时间窗下界。 */
  runStartedAt?: string;
  http: JudgeHttpRecord[];
  backend: JudgeBackendRecord[];
}

/** 模型候选信号：仅记录，永不直接决定 verdict。 */
export interface JudgeCandidate {
  role: string;
  content: string;
  confidence?: number;
}

export interface JudgeInput {
  assertions: JudgeAssertions;
  evidence: JudgeEvidence;
  candidates?: JudgeCandidate[];
  evaluatedAt: string;
}

/** 单条断言求值结果。result 为三态：passed / failed / unevaluable / ambiguous。 */
export interface AssertionEvaluation {
  kind: string;
  passed: boolean;
  result: 'passed' | 'failed' | 'unevaluable' | 'ambiguous';
  /** 证据引用（artifact URI 或内联描述，始终为 string）。 */
  evidenceRef: string;
  /** 实际命中的 HTTP/backend 证据 id（可回溯）。 */
  evidenceId?: string;
  blockedReason?: BlockedReason;
}

/** judge_result：唯一权威源（§3.6 行 591-597），仅 Runtime 可写。 */
export interface JudgeResult {
  verdict: Verdict;
  blockedReason: BlockedReason | null;
  assertionResults: AssertionEvaluation[];
  evaluatedAt: string;
  judgeVersion: string;
}
