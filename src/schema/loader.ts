import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

export function loadSchemaJson(name: SchemaName): object {
  // Tests run from repo root; resolve against package root.
  const path = resolve(process.cwd(), SCHEMA_FILES[name]);
  return JSON.parse(readFileSync(path, 'utf8')) as object;
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
