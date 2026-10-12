/**
 * IDWTH runtime layer (deterministic kernel boundary).
 * Modules are introduced per tasks:
 * resolve/judge T5/T9, executor T6, freshness T5, cleanup/scope T7,
 * error-adapter/bindings T3/T14, lifecycle/context/artifact/credential T3/T8.
 */
export const RUNTIME_NAME = 'idwth-runtime';

// Task 3: Contract 九条校验/加载 与 六重绑定三作用点。
export * from './contract/validate.js';
export * from './contract/loader.js';
export * from './bindings/hash.js';
export * from './bindings/check.js';

// Task 6: 执行状态机（8 态分流 / 单次重解析 / 恢复上限 / postcondition 闸门）。
export * from './executor.js';
