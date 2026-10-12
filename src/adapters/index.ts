/**
 * External decision adapters (JevDecisionProvider / MockProvider) — Task 12.
 */
export * from './jev/types.js';
export * from './jev/validate.js';
export * from './jev/budget.js';
export { MockDecisionProvider, type MockDecisionHandler } from './jev/mock.js';
export { TypeSafeJevProvider, JevTransportError, type JevHttpOptions } from './jev/jev-http.js';

export const ADAPTERS_LAYER = 'adapters';
