import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import addFormatsMod from 'ajv-formats';
import { SCHEMA_FILES, type SchemaName } from './index.js';

// ajv-formats CommonJS default under NodeNext: call the default export.
const addFormats = (addFormatsMod as unknown as { default: (ajv: Ajv) => void }).default;

let ajv: Ajv | undefined;

function getAjv(): Ajv {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const name of Object.keys(SCHEMA_FILES) as SchemaName[]) {
    const schema = loadSchemaJson(name);
    ajv.addSchema(schema, name);
  }
  return ajv;
}

/**
 * 解析包内 schema JSON。构建后本模块位于 <pkg>/dist/schema/loader.js，而
 * schema 实体位于 <pkg>/src/schema/*.json（不随 build 复制）；因此优先按
 * 模块自身位置上溯定位（与 cwd 无关），再回退 cwd（tsx 从源码运行的场景）。
 */
export function loadSchemaJson(name: SchemaName): object {
  const rel = SCHEMA_FILES[name];
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // dist/schema → 包根 → src/schema/<file>
    resolve(here, '..', '..', rel),
    resolve(process.cwd(), rel),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as object;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  // 保留原始错误形态（调用方统一按内部错误映射 exit 4）。
  return JSON.parse(readFileSync(candidates[0]!, 'utf8')) as object;
}

export function validate(name: SchemaName, value: unknown): { valid: boolean; errors?: string[] } {
  const validateFn = getAjv().getSchema(name);
  if (!validateFn) return { valid: false, errors: [`schema '${name}' not registered`] };
  const valid = validateFn(value) as boolean;
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: validateFn.errors?.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()) ?? [],
  };
}
