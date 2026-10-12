/**
 * Core schemas: Contract / Action / Strategy / Trace (Task 2).
 * JSON Schema documents live next to this module.
 */
export const SCHEMA_BASE_VERSION = '1.0.0';

/** 四类核心 Schema 的包内相对路径（运行时由 schema loader 读取）。 */
export const SCHEMA_FILES = {
  contract: 'src/schema/contract.schema.json',
  action: 'src/schema/action.schema.json',
  strategy: 'src/schema/strategy.schema.json',
  trace: 'src/schema/trace.schema.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

