/**
 * Task 11 — 报告数据模型（FR-8 / AC-12，DD-48 / E-Q4）。
 *
 * report.json 是五要素的权威结构化载体：
 *   1 测试用例（case + steps）
 *   2 测试截图（screenshots 索引：相对路径 + sha256）
 *   3 verdict（是否通过）
 *   4 未通过原因（failure_reason；PASS 时显式 null）
 *   5 可复现过程（reproduction.rerun_command 必须对人可见）
 *
 * report.html 为该数据的单文件、零脚本、可离线渲染视图。
 */

export const REPORT_SCHEMA_VERSION = '1.0';

export type ReportVerdict = 'PASS' | 'FAIL' | 'BLOCKED';

export interface ReportCase {
  id: string;
  name: string;
  goal: string;
  base_url: string;
}

export interface ReportStep {
  index: number;
  intent: string;
  action: string;
  target?: string;
  risk?: string;
}

/** 单条断言判定的对外呈现状态（对齐 judge AssertionEvaluation.result）。 */
export type AssertionState = 'passed' | 'failed' | 'unevaluable' | 'ambiguous';

export interface ReportAssertionResult {
  kind: string;
  description: string;
  passed: boolean;
  state: AssertionState;
  /** artifact:// 引用，指向 judgement_set 证据。 */
  evidence_ref: string;
}

export interface ReportReproduction {
  contract_path: string;
  provider: string;
  /** 可直接复制执行的复跑命令。 */
  rerun_command: string;
}

export interface ReportScreenshot {
  /** 相对 run 目录的路径，如 screenshots/final.png。 */
  path: string;
  sha256: string;
  caption?: string;
}

export interface ReportData {
  schema_version: typeof REPORT_SCHEMA_VERSION;
  run_id: string;
  generated_at: string;
  case: ReportCase;
  steps: ReportStep[];
  assertion_results: ReportAssertionResult[];
  verdict: ReportVerdict;
  /** 未通过 / 阻塞原因；PASS 时为 null。 */
  failure_reason: string | null;
  reproduction: ReportReproduction;
  screenshots: ReportScreenshot[];
}

/** writeReportArtifacts 的输入：身份/时间戳/截图由写入层补齐。 */
export type ReportSeed = Omit<
  ReportData,
  'schema_version' | 'run_id' | 'generated_at' | 'screenshots'
>;

export interface ReportScreenshotInput {
  /** 仅文件名（如 final.png）；落于 screenshots/ 下。 */
  name: string;
  caption?: string;
  content: Buffer;
}
