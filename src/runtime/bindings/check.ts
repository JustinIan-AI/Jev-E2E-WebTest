/**
 * 六重绑定的三个作用点处置策略（详设 §3.7）：
 *  1. run 启动：不一致 → 禁用 L2，降级 L1→L3 + 告警
 *  2. 固化前 --freeze：不一致 → 拒绝固化，给出 diff
 *  3. replay --verify 前：不一致 → BLOCKED(drift)，不开始回放
 */
import { BINDING_KEYS, type BindingKey, type Bindings } from './hash.js';

export interface BindingComparison {
  /** 当前环境实算的绑定。 */
  current: Bindings;
  /** 固化 strategy 中记录的绑定。 */
  stored: Bindings;
}

export interface BindingDiffRow {
  key: BindingKey;
  stored: string;
  current: string;
}

function diffBindings(current: Bindings, stored: Bindings): BindingDiffRow[] {
  return BINDING_KEYS.filter((key) => current[key] !== stored[key]).map((key) => ({
    key,
    stored: stored[key],
    current: current[key],
  }));
}

// ── 作用点 1：run 启动 ───────────────────────────────────────────────────────

export type RunStartDecision = 'compatible' | 'downgrade_l1_l3';

export interface RunStartResult {
  decision: RunStartDecision;
  driftedKeys: BindingKey[];
  warnings: string[];
  diff: BindingDiffRow[];
}

export function checkAtRunStart({ current, stored }: BindingComparison): RunStartResult {
  const diff = diffBindings(current, stored);
  if (diff.length === 0) {
    return { decision: 'compatible', driftedKeys: [], warnings: [], diff: [] };
  }
  const driftedKeys = diff.map((row) => row.key);
  return {
    decision: 'downgrade_l1_l3',
    driftedKeys,
    warnings: [
      `六重绑定不一致，禁用 L2 指纹解析，本次降级为 L1→L3：${driftedKeys.join(', ')}`,
      '指纹是按旧约定采集的，直接匹配当前页面可能静默错配。',
    ],
    diff,
  };
}

// ── 作用点 2：固化前 --freeze ────────────────────────────────────────────────

export type FreezeDecision = 'allow_freeze' | 'reject_freeze';

export interface FreezeResult {
  decision: FreezeDecision;
  driftedKeys: BindingKey[];
  diff: BindingDiffRow[];
}

export function checkBeforeFreeze({ current, stored }: BindingComparison): FreezeResult {
  const diff = diffBindings(current, stored);
  if (diff.length === 0) {
    return { decision: 'allow_freeze', driftedKeys: [], diff: [] };
  }
  return {
    decision: 'reject_freeze',
    driftedKeys: diff.map((row) => row.key),
    diff,
  };
}

// ── 作用点 3：replay --verify 前 ─────────────────────────────────────────────

export type ReplayDecision = 'proceed' | 'blocked_drift';

export interface ReplayResult {
  decision: ReplayDecision;
  blockedReason: 'drift' | null;
  driftedKeys: BindingKey[];
  diff: BindingDiffRow[];
}

export function checkBeforeReplayVerify({ current, stored }: BindingComparison): ReplayResult {
  const diff = diffBindings(current, stored);
  if (diff.length === 0) {
    return { decision: 'proceed', blockedReason: null, driftedKeys: [], diff: [] };
  }
  return {
    decision: 'blocked_drift',
    blockedReason: 'drift',
    driftedKeys: diff.map((row) => row.key),
    diff,
  };
}
