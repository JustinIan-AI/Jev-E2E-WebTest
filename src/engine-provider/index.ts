/**
 * §5.0 EngineProvider 层 —— 唯一可替换执行引擎点。
 */
export * from './types.js';
export { PlaywrightProvider } from './playwright/provider.js';
export { attach, detach, isOriginAllowed } from './playwright/attach.js';
export { openBackgroundTab } from './playwright/background-tab.js';
export { newIsolatedContext } from './playwright/isolation.js';
export { E2eProvider, type E2eProviderConnectOptions } from './e2e/provider.js';
export { absorbUpstreamAssertion, UPSTREAM_ASSERTION_INCONCLUSIVE } from './e2e/error-adapter.js';
export type * from './e2e/upstream.js';
export {
  checkCacheVersion,
  engineCacheDir,
  sanitizeVersionSegment,
} from './e2e/engine-cache.js';
