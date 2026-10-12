/**
 * Task 15 / DD §4.7 —— 回放 Trace 格式与录制。
 *
 * Trace 是 verify/heal 回放的数据来源（"Trace 里记录的 resolved_target + actions"）：
 * 由 executor 的 onStep 观测钩子逐步产出 StepExecutionRecord，buildTraceFile 组装为
 * 可序列化的 TraceFile。四项逐步比对的原始素材即记录中的
 * resolve（strategy/matched）、action_result.status、assertion results。
 */
import type { StepExecutionRecord } from '../executor.js';

export const TRACE_SCHEMA = 'idwth.trace/1' as const;

export type TraceVerdict = 'PASS' | 'FAIL' | 'BLOCKED';

/** 回放输入的历史 Trace（录制态 judge_result 摘要可选，供对比输出）。 */
export interface TraceFile {
  schema: typeof TRACE_SCHEMA;
  caseId: string;
  /** 录制时的 engine_provider_version（六重绑定第⑥项同源）。 */
  engineProviderVersion: string;
  recordedAt: string;
  verdict?: TraceVerdict;
  /** 逐步执行记录（仅完成路径；BLOCKED 步骤不产出记录）。 */
  steps: StepExecutionRecord[];
}

export function buildTraceFile(
  records: readonly StepExecutionRecord[],
  meta: {
    caseId: string;
    engineProviderVersion: string;
    verdict?: TraceVerdict;
  },
): TraceFile {
  return {
    schema: TRACE_SCHEMA,
    caseId: meta.caseId,
    engineProviderVersion: meta.engineProviderVersion,
    recordedAt: new Date().toISOString(),
    ...(meta.verdict !== undefined ? { verdict: meta.verdict } : {}),
    steps: [...records],
  };
}
