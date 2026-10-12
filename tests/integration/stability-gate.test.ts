/**
 * Task 16 / TR-16.1（AC-15）—— flaky 二值门禁。
 *
 * 门禁口径（DD §9.1）：
 *  - `run --repeat N`（N ≥ 10）出现 verdict 不一致 → 该 case 判为 flaky 缺陷并阻断合并（硬门禁）；
 *  - verdict 一致 → stable，不误报（与 PASS 无关，全 FAIL 一致也是稳定）；
 *  - N < 10 → 无法判定（insufficient-runs），绝不阻断；
 *  - suite 绿灯率只输出观测值，不作为通过阈值。
 */
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/runtime/judge/types.js';
import {
  FLAKY_MIN_REPEAT,
  evaluateStability,
  runWithRepeat,
} from '../../src/runtime/stability.js';

function runsOf(verdicts: Verdict[]): Array<{ runIndex: number; verdict: Verdict }> {
  return verdicts.map((verdict, i) => ({ runIndex: i + 1, verdict }));
}

describe('stability gate — repeat 判定口径（TR-16.1 / AC-15）', () => {
  it('硬门禁阈值常量为 10（N≥10 才判定）', () => {
    expect(FLAKY_MIN_REPEAT).toBe(10);
  });

  it('N=10 全 PASS → stable，不阻断，绿灯率观测 1', () => {
    const report = evaluateStability('case-a', 10, runsOf(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']));
    expect(report.outcome).toBe('stable');
    expect(report.flaky).toBe(false);
    expect(report.blocksMerge).toBe(false);
    expect(report.suiteGreenRate).toBe(1);
  });

  it('N=10 出现 9 PASS + 1 FAIL → flaky 缺陷并阻断合并', () => {
    const report = evaluateStability('case-a', 10, runsOf([
      'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'FAIL',
    ]));
    expect(report.outcome).toBe('flaky');
    expect(report.flaky).toBe(true);
    expect(report.blocksMerge).toBe(true);
    // suite 绿灯率仅输出观测值，不改变 flaky 二值判定。
    expect(report.suiteGreenRate).toBeCloseTo(0.9, 10);
  });

  it('PASS 与 BLOCKED 混合也是 verdict 不一致 → flaky', () => {
    const report = evaluateStability('case-b', 10, runsOf([
      'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED',
    ]));
    expect(report.outcome).toBe('flaky');
    expect(report.blocksMerge).toBe(true);
  });

  it('全 BLOCKED 一致 → stable 不误报（flaky 判定与 PASS 无关）', () => {
    const report = evaluateStability('case-c', 10, runsOf([
      'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'BLOCKED',
    ]));
    expect(report.outcome).toBe('stable');
    expect(report.flaky).toBe(false);
    expect(report.blocksMerge).toBe(false);
  });

  it('N < 10 → insufficient-runs，即使不一致也绝不阻断', () => {
    const unstable = evaluateStability('case-d', 9, runsOf([
      'PASS', 'PASS', 'PASS', 'PASS', 'FAIL', 'FAIL', 'PASS', 'PASS', 'PASS',
    ]));
    expect(unstable.outcome).toBe('insufficient-runs');
    expect(unstable.flaky).toBe(false);
    expect(unstable.blocksMerge).toBe(false);

    const stable = evaluateStability('case-d', 9, runsOf(['PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS', 'PASS']));
    expect(stable.outcome).toBe('insufficient-runs');
    expect(stable.blocksMerge).toBe(false);
  });

  it('N > 10 同样判定（15 次混合 → flaky）', () => {
    const verdicts: Verdict[] = Array.from({ length: 14 }, () => 'PASS');
    verdicts.push('FAIL');
    const report = evaluateStability('case-e', 15, runsOf(verdicts));
    expect(report.outcome).toBe('flaky');
    expect(report.blocksMerge).toBe(true);
    expect(report.suiteGreenRate).toBeCloseTo(14 / 15, 10);
  });

  it('verdictsSeen 输出去重后的观测集合', () => {
    const report = evaluateStability('case-f', 10, runsOf([
      'PASS', 'FAIL', 'PASS', 'FAIL', 'PASS', 'FAIL', 'PASS', 'FAIL', 'PASS', 'FAIL',
    ]));
    expect([...report.verdictsSeen].sort()).toEqual(['FAIL', 'PASS']);
  });

  it('repeat 为 0（无运行）→ insufficient-runs，绿灯率观测为 null', () => {
    const report = evaluateStability('case-g', 0, []);
    expect(report.outcome).toBe('insufficient-runs');
    expect(report.suiteGreenRate).toBeNull();
  });
});

describe('runWithRepeat —— 重复执行编排', () => {
  it('顺序执行 N 次并透传 verdict/blockedReason', async () => {
    let calls = 0;
    const report = await runWithRepeat({
      caseId: 'case-h',
      repeat: 10,
      runCase: async (runIndex) => {
        calls += 1;
        expect(runIndex).toBe(calls);
        return calls <= 3 ? { verdict: 'PASS' } : { verdict: 'FAIL' };
      },
    });
    expect(calls).toBe(10);
    expect(report.caseId).toBe('case-h');
    expect(report.repeat).toBe(10);
    expect(report.runs.map((r) => r.runIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(report.runs[0]!.verdict).toBe('PASS');
    expect(report.runs[9]!.verdict).toBe('FAIL');
    expect(report.outcome).toBe('flaky');
  });

  it('runCase 抛错不吞（原始异常向上传播）', async () => {
    await expect(
      runWithRepeat({
        caseId: 'case-i',
        repeat: 10,
        runCase: async () => {
          throw new Error('provider exploded');
        },
      }),
    ).rejects.toThrow(/provider exploded/);
  });
});
