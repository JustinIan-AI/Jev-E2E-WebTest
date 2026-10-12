/**
 * Task 13 —— Recovery 审计（AC-07 / DD §8.3）。
 *
 * 每次语义 Recovery 留下一条 RecoveryRecord：case 级 attempt 编号、恢复模式、
 * 恢复前后各一份 fresh 观测快照（经观测脱敏，§9.4）、时延与结果。
 *
 * A4 硬规则（semantic-recovery ①）：Recovery 钩子由 Runtime 零参调用，拿不到
 * Goal/Assertion 的可写句柄；恢复后校验的 postcondition 以 executor 在派发前
 * 固化的副本为准（见 executor.ts 的 declared 快照），运行期篡改不生效。
 */
import type { Observation } from '../engine-provider/index.js';
import { redactObservation, type RedactedObservation } from './redaction.js';

/** 编排层声明的恢复结果；boolean 返回兼容旧钩子（true = 已修复）。 */
export interface RecoveryOutcome {
  ok: boolean;
  /** 恢复模式（如 re-navigate / dismiss-modal），由编排层声明。 */
  mode?: string;
}

/** 单次 Recovery 审计记录（进入 CaseResult.recoveries）。 */
export interface RecoveryRecord {
  stepIndex: number;
  intent: string;
  /** Case 级序号（1 起）；上限 1 次/step、3 次/case（DD §8.3）。 */
  attempt: number;
  fixed: boolean;
  mode?: string;
  /** 恢复前 fresh 快照（已脱敏）。 */
  before?: RedactedObservation;
  /** 恢复后 fresh 快照（已脱敏；仅 fixed=true 时采集）。 */
  after?: RedactedObservation;
  beforeError?: string;
  afterError?: string;
  latencyMs?: number;
}

export interface RecoverySnapshot {
  snapshot?: RedactedObservation;
  error?: string;
}

/**
 * 采集一份 fresh 观测快照（恢复时点现采，非缓存）。
 * 观测失败只记 error，不中断 Recovery 判定——快照是证据，不是闸门。
 */
export async function captureRecoverySnapshot(
  provider: { observe(): Promise<Observation> },
  secrets: readonly string[],
): Promise<RecoverySnapshot> {
  try {
    const observation = await provider.observe();
    return { snapshot: redactObservation({ ...observation }, secrets) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function normalizeRecoveryOutcome(value: boolean | RecoveryOutcome): RecoveryOutcome {
  return typeof value === 'boolean' ? { ok: value } : value;
}
