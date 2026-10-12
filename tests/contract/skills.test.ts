import { describe, expect, it } from 'vitest';
import { EXPECTED_SKILLS, listSkillDirs, parseSkillFrontmatter } from '../../src/skills/loader.js';

describe('skill frontmatter', () => {
  it('exposes exactly the seven expected skills', () => {
    expect(listSkillDirs().sort()).toEqual([...EXPECTED_SKILLS].sort());
  });

  it('each skill has valid frontmatter and name matches its directory', () => {
    for (const dir of EXPECTED_SKILLS) {
      const fm = parseSkillFrontmatter(dir);
      expect(fm.name).toBe(dir);
      expect(fm.layer).toBe('declaration');
      expect(Array.isArray(fm.constraints) && fm.constraints.length > 0).toBe(true);
      expect(Array.isArray(fm.verified_by)).toBe(true);
      expect(typeof fm.fallback).toBe('string');
    }
  });

  it('only web-test-contract allows model rewrite and runs at authoring stage', () => {
    const contract = parseSkillFrontmatter('web-test-contract');
    expect(contract.model_may_rewrite).toBe(true);
    expect(contract.stage).toBe('authoring');
    expect(contract.callable_by).toBe('agent');

    for (const dir of EXPECTED_SKILLS.filter((d) => d !== 'web-test-contract')) {
      const fm = parseSkillFrontmatter(dir);
      expect(fm.model_may_rewrite, `${dir} should not be model-rewritable`).toBe(false);
      expect(fm.stage, `${dir} should be runtime`).toBe('runtime');
      expect(fm.callable_by, `${dir} should be runtime-callable`).toBe('runtime');
    }
  });

  it('web-test-judge carries the three mandatory judge constraints', () => {
    const judge = parseSkillFrontmatter('web-test-judge');
    const joined = judge.constraints.join('\n');
    expect(joined).toMatch(/纯函数/);
    expect(joined).toMatch(/写入权归 Runtime/);
    expect(joined).toMatch(/优先级固定/);
  });
});
