/**
 * §8.1 finally cleanup：幂等删除 + 只读终态轮询（E02 实测五规则）。
 *
 *  1. 「完成」判据是终态 GET→404，不是 DELETE 响应码 —— DELETE 200 只代表
 *     已受理（实测 K8s namespace 仍 Terminating 6.2s）。
 *  2. 轮询间隔 2s、超时上限 60s，防止 CI 永久挂住。
 *  3. 超时 → BLOCKED(cleanup)，不静默放过（静默 = 残留累积成假 PASS）。
 *  4. DELETE 只发一次；之后只做只读 GET 轮询。注意：只读轮询不是重试
 *     mutation，与「已派发 mutation 不得自动重试」不冲突。
 *  5. 重复删除返回 404 属正常（幂等），cleanup 必须可安全重入。
 *
 * cleanup 在 finally 中无条件执行（FAIL / BLOCKED / abort 照做，DD-45）。
 */
import type { BackendQueryParams, MutableBackendAdapter } from '../tools/backend/types.js';

/** 默认轮询间隔 2s（规则 2）。 */
export const DEFAULT_CLEANUP_POLL_INTERVAL_MS = 2000;
/** 默认终态超时上限 60s（规则 2）。 */
export const DEFAULT_CLEANUP_TIMEOUT_MS = 60_000;

export type CleanupResult =
  | { status: 'deleted' }
  | { status: 'blocked'; reason: 'cleanup' };

export interface CleanupOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** 可注入时钟/休眠，供测试零耗时轮询。 */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * 删除单个 run 作用域对象并轮询至 404 终态。
 *
 * @param key    形如 `${kind}/${name}`（如 'deployment/idwth-a1b2c3d4-x-demo'）
 * @param params scope:'run' + runId + 已实例化 fixtures
 */
export async function cleanupResource(
  adapter: MutableBackendAdapter,
  key: string,
  params: BackendQueryParams,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_CLEANUP_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  // 规则 4：DELETE 只发一次，不自动重试。规则 5：404（not_found）属正常幂等。
  const deletion = await adapter.delete(key, params);
  if (deletion.status === 'not_found') {
    return { status: 'deleted' };
  }

  // 规则 1/4：随后只做只读 GET 轮询（只读不是重试 mutation），
  // 直至 found=false（404 终态）。规则 3：超时 → BLOCKED(cleanup)。
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const probe = await adapter.get(key, params);
    if (!probe.found) {
      return { status: 'deleted' };
    }
    await sleep(pollIntervalMs);
  }

  return { status: 'blocked', reason: 'cleanup' };
}
