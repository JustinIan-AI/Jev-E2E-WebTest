/**
 * IDWTH runtime layer (deterministic kernel boundary).
 * Modules are introduced per tasks:
 * resolve/judge T5/T9, executor T6, freshness T5, cleanup/scope T7,
 * error-adapter/bindings T3/T14, lifecycle/context/artifact/credential T3/T8.
 */
export const RUNTIME_NAME = 'idwth-runtime';
