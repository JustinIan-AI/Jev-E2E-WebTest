/**
 * Side-effecting tools outside the deterministic kernel:
 * HTTP assertions and SUT backend EvidenceProviders (rest / sqlite / mock).
 */
export const TOOLS_LAYER = 'tools';

// Task 7: BackendAdapter / EvidenceProvider 契约与 V1 mock 实现。
export * from './backend/types.js';
export * from './backend/mock.js';
