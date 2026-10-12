/**
 * §5.5.6 / §6.1③ Freshness 校验（Runtime 独占）。
 *
 * 作用域内比对：只看目标节点子树的 data-observation-id，避免动态校验行
 * 导致每次 mutation 都误判 stale。失效时只允许重解析一次；重解析仍非
 * resolved 或依旧不新鲜 → BLOCKED(drift) 终止，不自动 heal。
 */
import type {
  EngineProvider,
  ResolveResult,
  SemanticTarget,
} from '../engine-provider/index.js';

/**
 * 引擎侧 Freshness 能力（§5.0 接口之外、由具体引擎实现的运行时方法）。
 * 作用域：resolved 元素子树的 data-observation-id 是否与观测一致。
 */
export interface FreshnessCapable {
  verifyFreshness(
    target: SemanticTarget,
    resolved: ResolveResult,
  ): Promise<boolean>;
}

export type FreshOutcome =
  | { outcome: 'fresh'; resolved: ResolveResult }
  | { outcome: 'drift' };

/**
 * 校验已解析目标的新鲜度；失效时最多重解析一次。
 * @param initial 本轮定位得到的 resolved 结果
 */
export async function ensureFresh(
  provider: Pick<EngineProvider, 'resolve'> & FreshnessCapable,
  target: SemanticTarget,
  initial: ResolveResult,
): Promise<FreshOutcome> {
  if (await provider.verifyFreshness(target, initial)) {
    return { outcome: 'fresh', resolved: initial };
  }

  // 失效：只重解析一次，沿用原定位级（歧义/未命中不得自愈或跨级试探）。
  const mode = initial.mode ?? 'L1';
  const reResolved = await provider.resolve(target, mode);
  if (reResolved.status !== 'resolved') {
    return { outcome: 'drift' };
  }

  if (await provider.verifyFreshness(target, reResolved)) {
    return { outcome: 'fresh', resolved: reResolved };
  }

  return { outcome: 'drift' };
}
