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

// Task 7: run 级作用域（双标识论域收窄）与 finally cleanup 终态轮询。
export * from './scope.js';
export * from './cleanup.js';

// Task 8: Evidence 分级存储（内容寻址/外移指针/digest）与安全采集脱敏。
export * from './evidence-store.js';
export * from './redaction.js';

// Task 9: Judge 七原语纯函数判定、verdict_hash 与离线重算。
export * from './judge/index.js';
export * from './judge/recompute.js';

// Task 12: L3 语义决策编排（JEV 唯一模型介入点；仅 L1/L2 未命中时触发）。
export * from './resolve-l3.js';

// Task 15: replay verify/heal（四项逐步比对 / 漂移终止 / 候选隔离）与引擎缓存交付。
export * from './replay/index.js';
