/**
 * Issue #27 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-Test/issues/27
 *
 * gherkin 模板示例与映射器规则矛盾，按模板生成的 feature 成批 unmapped：
 * 1. Good 示例教 `navigate "login page"`（页面名），映射器要求 https?:// 绝对 URL
 *    → `unmapped-navigation`，照模板写 100% 被拒收；
 * 2. 前置约束只有叙述性文字、无显式反例，模型实测产出 `Given assert only ...`
 *    → `unmapped-precondition`；设计概念断言（"页面呈现形式" is "独立页面"）
 *    同样不是可定位的页面元素。
 */
import { describe, it, expect } from 'vitest';
import { GherkinTemplate } from '../../src/templates/gherkin.template';
import { ParsedInput, DEFAULT_CONFIG } from '../../src/core/types';

function makeParsedInput(): ParsedInput {
  return {
    type: 'prd',
    title: 'Login Feature',
    scenarios: [
      {
        title: 'Valid Login',
        description: 'User logs in with correct credentials',
        steps: ['Enter email', 'Enter password', 'Click submit'],
      },
    ],
    rawContent: 'Login feature content',
  };
}

describe('Issue #27: gherkin 模板与映射器规则对齐', () => {
  it('AC1 Good 示例的 navigate 必须携带完整 URL，不得教页面名写法', () => {
    const { systemPrompt } = new GherkinTemplate().buildPrompt(
      makeParsedInput(),
      DEFAULT_CONFIG,
    );
    // 修复前：Good 示例是 navigate "login page"（页面名）→ 映射器必然 unmapped-navigation
    expect(systemPrompt).not.toContain('navigate "login page"');
    // 修复后：示例携带 https:// 绝对 URL
    expect(systemPrompt).toMatch(/navigate\s+"https:\/\//);
    // 规则句：navigate 必须携带完整 URL，打开页面入口请用 click
    expect(systemPrompt).toMatch(/navigate must carry a full (absolute )?URL/i);
    expect(systemPrompt).toMatch(/use click/i);
    expect(systemPrompt).toMatch(/never pass a page name to navigate/i);
  });

  it('AC2 前置不得写成断言：必须给出 Given assert only 显式反例', () => {
    const { systemPrompt } = new GherkinTemplate().buildPrompt(
      makeParsedInput(),
      DEFAULT_CONFIG,
    );
    // 反例必须显式出现（叙述性约束实测不遵守）
    expect(systemPrompt).toMatch(/Given assert only[^\n]*❌/);
    // 登录身份由 identity 声明
    expect(systemPrompt).toMatch(/identity/i);
  });

  it('AC3 设计概念不是页面元素：必须给出概念断言显式反例', () => {
    const { systemPrompt } = new GherkinTemplate().buildPrompt(
      makeParsedInput(),
      DEFAULT_CONFIG,
    );
    expect(systemPrompt).toMatch(/页面呈现形式|presentation concept|design concept/i);
    expect(systemPrompt).toMatch(/❌/);
  });

  it('AC4 数据前置指引：不要写 Given，改由用例内 When 自建或预置账号', () => {
    const { systemPrompt } = new GherkinTemplate().buildPrompt(
      makeParsedInput(),
      DEFAULT_CONFIG,
    );
    expect(systemPrompt).toMatch(/data precondition|数据前置/i);
    expect(systemPrompt).toMatch(/pre-provisioned|预置/i);
  });
});
