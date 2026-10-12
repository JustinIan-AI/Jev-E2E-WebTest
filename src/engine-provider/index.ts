/**
 * §5.0 EngineProvider 层 —— 唯一可替换执行引擎点。
 */
export * from './types.js';
export { PlaywrightProvider } from './playwright/provider.js';
export { attach, detach, isOriginAllowed } from './playwright/attach.js';
export { openBackgroundTab } from './playwright/background-tab.js';
export { newIsolatedContext } from './playwright/isolation.js';
