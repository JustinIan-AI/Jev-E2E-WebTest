/**
 * Task 15 / AC-11 —— replay 产物 CI 准入门。
 *
 * verify（默认、零模型）产物可入 CI；heal 产物（候选 strategy 只是建议，
 * 修复属 Authoring 行为）一律不得被 CI 使用 —— 门禁输入永远是 verify 产物。
 */
import type { ReplayVerifyOutcome } from './verify.js';
import type { ReplayHealOutcome } from './heal.js';

export type ReplayOutcome = ReplayVerifyOutcome | ReplayHealOutcome;

export function isCiUsableReplayOutcome(outcome: ReplayOutcome): boolean {
  return outcome.mode === 'verify';
}
