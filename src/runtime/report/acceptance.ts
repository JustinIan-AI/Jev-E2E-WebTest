/**
 * Task 17 / TR-17.1 —— 对抗性验收报告（A1~A11 矩阵的机器可读证据产物）。
 *
 * 每条验收必须携带：构造场景、期望 verdict/exit code、实际 verdict/exit code、
 * 归因 AC（所有失败均可归因到具体 AC）。expected/actual 双双一致才记 pass。
 */
import type { Verdict } from '../judge/types.js';

export const ACCEPTANCE_REPORT_SCHEMA = 'idwth.acceptance-report/1';

export interface AcceptanceEntryInput {
  /** 编号全局唯一（A1~A11，A7 拆 a/b；只追加不重排）。 */
  id: string;
  scenario: string;
  expectedVerdict: Verdict;
  expectedExitCode: number;
  actualVerdict: Verdict;
  actualExitCode: number;
  /** 失败可归因到具体 AC（非空）。 */
  acRef: string;
}

export interface AcceptanceEntry extends AcceptanceEntryInput {
  pass: boolean;
}

export interface AcceptanceReport {
  schema: typeof ACCEPTANCE_REPORT_SCHEMA;
  generatedAt: string;
  entries: AcceptanceEntry[];
  allPassed: boolean;
}

export function buildAcceptanceReport(entries: readonly AcceptanceEntryInput[]): AcceptanceReport {
  const withPass = entries.map((e) => ({
    ...e,
    pass: e.expectedVerdict === e.actualVerdict && e.expectedExitCode === e.actualExitCode && e.acRef !== '',
  }));
  return {
    schema: ACCEPTANCE_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    entries: withPass,
    allPassed: withPass.every((e) => e.pass),
  };
}
