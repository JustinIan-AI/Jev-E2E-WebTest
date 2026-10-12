import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export interface SkillFrontmatter {
  name: string;
  version: string;
  layer: 'declaration';
  stage: 'authoring' | 'runtime';
  callable_by: 'agent' | 'runtime';
  model_may_rewrite: boolean;
  inputs: string;
  outputs: string;
  constraints: string[];
  fallback: string;
  verified_by: string[];
}

const REQUIRED_KEYS: (keyof SkillFrontmatter)[] = [
  'name', 'version', 'layer', 'stage', 'callable_by', 'model_may_rewrite',
  'inputs', 'outputs', 'constraints', 'fallback', 'verified_by',
];

const SKILLS_ROOT = resolve(process.cwd(), 'src/skills');

export function listSkillDirs(): string[] {
  return readdirSync(SKILLS_ROOT).filter((d) => statSync(resolve(SKILLS_ROOT, d)).isDirectory());
}

export function parseSkillFrontmatter(skillDir: string): SkillFrontmatter {
  const file = resolve(SKILLS_ROOT, skillDir, 'SKILL.md');
  const raw = readFileSync(file, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`${skillDir}: missing YAML frontmatter`);
  const body = match[1] ?? '';
  const data = parse(body) as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in data)) throw new Error(`${skillDir}: missing frontmatter key '${key}'`);
    if (data[key] === undefined) throw new Error(`${skillDir}: frontmatter key '${key}' is undefined`);
  }
  if (data.layer !== 'declaration') throw new Error(`${skillDir}: layer must be 'declaration'`);
  return data as unknown as SkillFrontmatter;
}

export const EXPECTED_SKILLS = [
  'web-test-contract',
  'web-test-executor',
  'web-semantic-action',
  'web-semantic-recovery',
  'web-test-evidence',
  'web-test-judge',
  'web-test-replay',
] as const;
