/**
 * Task 14 / DD-32 —— 上游错误码吸附器（§8.2 错误码吸附）。
 *
 * 上游 @e2e-dev/decision 实录：把「模型判不出来」记为测试失败 ——
 * `{ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' }`（class=test、exit 1）。
 * 动机正确（怕无证据被当 PASS），但直接沿用会造成**假 FAIL 通道**：断言区在
 * 视口外 / 页面加载中 / 纯 Canvas 页上的断言会被报告为「测试未通过」。
 *
 * 处置：独立错误码**保留**（有诊断价值，进入附加字段 upstream_error_code），
 * 但判定 class 改为 `inconclusive` + `blockedReason: 'decision'` —— 由 executor
 * 映射为 BLOCKED(decision)，**不计入 bug 检出**。主状态永远是 IDWTH 三态（A10）。
 */
import type { AssertionKind, AssertionResult } from '../types.js';
import type { UpstreamAssertionResult } from './upstream.js';

/** 上游「判不出来」实录错误码（DD-32）。 */
export const UPSTREAM_ASSERTION_INCONCLUSIVE = 'ASSERTION_INCONCLUSIVE';

/**
 * 吸附上游断言结果 → IDWTH AssertionResult。
 * 规则：
 *  - status 'passed' → passed，零污染（不带 upstreamErrorCode）；
 *  - status 'failed' + ASSERTION_INCONCLUSIVE（或 status 'inconclusive'）
 *      → inconclusive / decision / upstreamErrorCode 保留；
 *  - 其余 failed → failed（真实 FAIL 通道保留），其他错误码仍作附加诊断透传。
 */
export function absorbUpstreamAssertion(
  upstream: UpstreamAssertionResult,
  kind: AssertionKind,
): AssertionResult {
  const base = {
    kind,
    passed: upstream.status === 'passed',
    ...(upstream.actual !== undefined ? { actual: upstream.actual } : {}),
    ...(upstream.message !== undefined ? { message: upstream.message } : {}),
  };

  if (upstream.status === 'passed') {
    return { ...base, status: 'passed' };
  }

  const inconclusive =
    upstream.status === 'inconclusive' ||
    upstream.errorCode === UPSTREAM_ASSERTION_INCONCLUSIVE;

  if (inconclusive) {
    return {
      ...base,
      passed: false,
      status: 'inconclusive',
      blockedReason: 'decision',
      ...(upstream.errorCode !== undefined ? { upstreamErrorCode: upstream.errorCode } : {}),
    };
  }

  // 普通 failed：真实可观测的求值为否 → FAIL 通道（§8.2「断言求值为否」）。
  return {
    ...base,
    passed: false,
    status: 'failed',
    ...(upstream.errorCode !== undefined ? { upstreamErrorCode: upstream.errorCode } : {}),
  };
}
