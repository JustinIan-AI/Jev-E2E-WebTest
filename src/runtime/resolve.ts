/**
 * §3.3 定位解析编排：L1 role/label/text → L2 指纹，严格串行，禁止并行试探。
 *
 * 硬规则：
 *  - matched 0 → 降级到下一级；matched 1 → resolved；matched >1 → ambiguous
 *    立即终止，绝不降级（歧义 ≠ 未命中）。
 *  - L1 miss 时只有携带指纹才允许进入 L2；否则直接 miss。
 *  - L3（JEV）是唯一模型介入点，由 Task 12 接入，本模块不涉及。
 *
 * 候选集编号（elementId）一律由 EngineProvider 代码生成，绝不来自模型。
 */
import type {
  EngineProvider,
  ResolveResult,
  SemanticTarget,
} from '../engine-provider/index.js';

/**
 * 执行一次确定性的 L1→L2 定位。
 * @returns provider 的 ResolveResult（resolved / ambiguous / miss）
 */
export async function resolveDeterministic(
  provider: Pick<EngineProvider, 'resolve'>,
  target: SemanticTarget,
): Promise<ResolveResult> {
  const l1 = await provider.resolve(target, 'L1');
  if (l1.status !== 'miss') {
    // resolved 或 ambiguous：均立即返回。ambiguous 禁止降级到 L2。
    return l1;
  }

  // L1 miss：仅当 Frozen Strategy 携带 L2 指纹时才允许进入 L2。
  if (target.fingerprint) {
    return provider.resolve(target, 'L2');
  }

  return l1;
}
