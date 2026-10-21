import { describe, it, expect } from 'vitest';
import { slugify, safeSlug } from '../../src/utils/slug';

describe('slugify', () => {
  it('keeps pure Chinese titles readable instead of eating them', () => {
    expect(slugify('登录功能')).toBe('登录功能');
  });

  it('produces no leading or trailing hyphen for mixed input', () => {
    const slug = slugify('TDS-C 需求文档');
    expect(slug).toBe('tds-c-需求文档');
    expect(slug.startsWith('-')).toBe(false);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('collapses consecutive non-alphanumeric runs into a single hyphen', () => {
    expect(slugify('Hello,  World!!!')).toBe('hello-world');
  });

  it('limits the slug to 40 characters', () => {
    const slug = slugify('a'.repeat(50) + '中文'.repeat(20));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('is deterministic for the same input', () => {
    expect(slugify('用户 管理 模块')).toBe(slugify('用户 管理 模块'));
  });

  it('returns an empty string for symbol-only input', () => {
    expect(slugify('--- !!! ???')).toBe('');
  });
});

describe('safeSlug', () => {
  it('uses the slugified title when it is non-empty', () => {
    expect(safeSlug('登录功能', '/tmp/需求.txt')).toBe('登录功能');
  });

  it('falls back to the source file name when the title slug is empty', () => {
    expect(safeSlug('---', '/tmp/我的需求文档.txt')).toBe('我的需求文档');
  });

  it('falls back to a timestamped untitled slug when both are empty', () => {
    const now = new Date(2026, 9, 21, 9, 5, 7);
    expect(safeSlug('', '', now)).toBe('untitled-20261021090507');
  });

  it('passes the fallback result through conflict-safe slugification', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5);
    expect(safeSlug('???', '---', now)).toBe('untitled-20260102030405');
  });
});
