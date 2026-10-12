/**
 * Task 16 / TR-16.1（AC-15 / DD §9.1）—— flaky 二值门禁。
 *
 * 口径：
 *  - `run --repeat N`（N ≥ FLAKY_MIN_REPEAT=10）出现 verdict 不一致 →
 *    该 case 判为 flaky 缺陷并阻断合并（硬门禁，二值：flaky / 非 flaky）；
 *  - verdict 一致 → stable，不误报（与 PASS 无关：全 BLOCKED 一致也是稳定）；
 *  - N < 10 → insufficient-runs，绝不阻断（样本不足不下结论）；
 *  - suite 绿灯率（PASS 比例）只作为趋势观测值输出，不作通过阈值。
 */
import type { Verdict } from './judge/types.js';

/** flaky 判定的最小重复次数（AC-15：`--repeat N` 且 N≥10）。 */
export const FLAKY_MIN_REPEAT = 10;

/** 单次重复运行的结论记录。 */
export interface RepeatRunRecord {
  /** 1 起的运行序号。 */
  runIndex: number;
  verdict: Verdict;
  blockedReason?: string;
}

export type StabilityOutcome = 'stable' | 'flaky' | 'insufficient-runs';

export interface StabilityReport {
  caseId: string;
  repeat: number;
  runs: RepeatRunRecord[];
  /** 观测到的 verdict 去重集合。 */
  verdictsSeen: Verdict[];
  outcome: StabilityOutcome;
  flaky: boolean;
  /** flaky 缺陷阻断合并；stable / insufficient-runs 一律 false。 */
  blocksMerge: boolean;
  /** suite 绿灯率观测值（PASS 比例）；repeat 为 0 时 null。仅观测，不作阈值。 */
  suiteGreenRate: number | null;
}

/** 纯函数判定：单 case 在 N 次重复下的 flaky 二值结论。 */
export function evaluateStability(
  caseId: string,
  repeat: number,
  runs: ReadonlyArray<{ runIndex: number; verdict: Verdict; blockedReason?: string }>,
): StabilityReport {
  const verdictsSeen = [...new Set(runs.map((r) => r.verdict))];
  const greenCount = runs.filter((r) => r.verdict === 'PASS').length;
  const suiteGreenRate = repeat > 0 ? greenCount / repeat : null;

  // 样本不足：不判定、不阻断（宁可漏报也不在无证据时宣布 flaky）。
  if (repeat < FLAKY_MIN_REPEAT) {
    return {
      caseId,
      repeat,
      runs: [...runs],
      verdictsSeen,
      outcome: 'insufficient-runs',
      flaky: false,
      blocksMerge: false,
      suiteGreenRate,
    };
  }

  const consistent = verdictsSeen.length <= 1;
  return {
    caseId,
    repeat,
    runs: [...runs],
    verdictsSeen,
    outcome: consistent ? 'stable' : 'flaky',
    flaky: !consistent,
    blocksMerge: !consistent,
    suiteGreenRate,
  };
}

/**
 * 编排重复执行：顺序运行同一 case N 次（同 case 重复需隔离，顺序执行更安全），
 * 收集每次结论后交给 evaluateStability。runCase 抛错向上传播（失败不是结论）。
 */
export async function runWithRepeat(params: {
  caseId: string;
  repeat: number;
  runCase: (runIndex: number) => Promise<{ verdict: Verdict; blockedReason?: string }>;
}): Promise<StabilityReport> {
  const { caseId, repeat, runCase } = params;
  const runs: RepeatRunRecord[] = [];
  for (let i = 1; i <= repeat; i += 1) {
    const outcome = await runCase(i);
    runs.push({
      runIndex: i,
      verdict: outcome.verdict,
      ...(outcome.blockedReason !== undefined ? { blockedReason: outcome.blockedReason } : {}),
    });
  }
  return evaluateStability(caseId, repeat, runs);
}
