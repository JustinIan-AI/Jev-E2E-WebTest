/**
 * ai-testgen → IDWTH 衔接：Feature → Contract 映射器单测。
 *
 * 覆盖：动作映射（navigate/fill/select/scroll/wait/click）、
 * Then 断言（visible/count/absent）、R4 不可逆步骤收尾、
 * Background 合并、Scenario Outline 展开、draft 降级与原因分类、
 * id 推导/前缀、中文步骤文本。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseFeature } from '../../src/runtime/contract/gherkin-parse.js';
import {
  extractLastQuoted,
  extractQuotedAll,
  mapFeatureToContracts,
  parseTargetValue,
  sanitizeTarget,
  type MapFeatureOptions,
} from '../../src/runtime/contract/feature-to-contract.js';
import { validateContract } from '../../src/runtime/contract/validate.js';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sample.feature',
);

const OPTIONS: MapFeatureOptions = {
  baseUrl: 'https://staging.example.com',
  credentialsRef: 'cred://staging-operator',
};

function map(text: string, options: MapFeatureOptions = OPTIONS) {
  return mapFeatureToContracts(parseFeature(text), options);
}

describe('mapFeatureToContracts — 夹具整体', () => {
  it('产出 5 条结果：1 ready + 2 draft + 2 Outline 展开行', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.status)).toEqual([
      'ready',
      'draft',
      'draft',
      'ready',
      'ready',
    ]);
  });

  it('test.id 由 Feature 名 + Scenario 名推导，Outline 行追加 rowN', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    expect(results.map((r) => r.testId)).toEqual([
      'account.and.catalog.operator.logs.in',
      'account.and.catalog.operator.uploads.avatar',
      'account.and.catalog.operator.closes.all.sessions',
      'account.and.catalog.search.products.row1',
      'account.and.catalog.search.products.row2',
    ]);
  });

  it('ready 场景合并 Background 且动作/断言类型正确', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    const login = results[0]!;
    const actions = login.contract.steps.map((s) => s.action);
    expect(actions).toEqual(['navigate', 'fill', 'fill', 'click', 'assert_only', 'assert_only', 'assert_only']);
    expect(login.contract.assertions.dom.map((a) => a.kind)).toEqual([
      'visible',
      'count',
      'absent',
    ]);
  });

  it('ready 产物全部通过九条 Contract 校验', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    for (const ready of results.filter((r) => r.status === 'ready')) {
      expect(validateContract(ready.contract).valid).toBe(true);
    }
  });

  it('Outline 占位符被替换为 Examples 行数据', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    const row1 = results[3]!;
    expect(row1.contract.steps.find((s) => s.action === 'fill')?.value).toBe('laptop');
    expect(row1.contract.assertions.dom[0]).toMatchObject({ kind: 'count', equals: 2 });
    const row2 = results[4]!;
    expect(row2.contract.steps.find((s) => s.action === 'fill')?.value).toBe('keyboard');
    expect(row2.contract.assertions.dom[0]).toMatchObject({ kind: 'count', equals: 5 });
  });

  it('draft 记录未映射步骤原文与原因分类', async () => {
    const results = map(await readFile(FIXTURE, 'utf8'));
    const upload = results[1]!;
    expect(upload.status).toBe('draft');
    expect(upload.unmappedSteps).toEqual([
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);

    const close = results[2]!;
    expect(close.unmappedSteps).toEqual([
      { keyword: 'When', text: 'I terminate all active sessions', reason: 'unmapped-action' },
      { keyword: 'Then', text: 'the session risk badge is cleared', reason: 'unrecognized-assertion' },
    ]);
  });
});

describe('mapFeatureToContracts — 动作映射', () => {
  it('navigate 带 URL 产出 navigate.url', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        Given I navigate to https://x.example.com/path
        Then I should see the title
    `);
    expect(r!.contract.steps[0]).toMatchObject({
      action: 'navigate',
      url: 'https://x.example.com/path',
      risk: 'reversible',
    });
  });

  it('navigate 无 URL 时不静默降级为 click，安全降级为 draft (unmapped-navigation)', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        Given I open the dashboard menu
        Then I should see the title
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps).toEqual([
      { keyword: 'Given', text: 'I open the dashboard menu', reason: 'unmapped-navigation' },
    ]);
  });

  it('fill 取「目标引号 + 值引号」结构，目标满足 R7（无引号/选择器特征）', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When fill in "username field" with "alice"
        Then I should see the title
    `);
    const fill = r!.contract.steps[0]!;
    expect(fill).toMatchObject({ action: 'fill', target: 'username field', value: 'alice' });
    expect(fill.target).not.toMatch(/["“”‘’#]|\/\/|>>|\(\)/);
  });

  it('fill 只有一个引号（缺目标或缺值）时降级 draft：unmapped-action', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When fill in "alice"
        Then I should see the title
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps[0]!.reason).toBe('unmapped-action');
  });

  it('fill 无引号时降级 draft：unmapped-action', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I enter something without quotes
        Then I should see the title
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps[0]!.reason).toBe('unmapped-action');
  });

  it('select 取「目标引号 + 值引号」结构', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When select "role dropdown" with "admin"
        Then I should see the title
    `);
    expect(r!.contract.steps[0]).toMatchObject({
      action: 'select',
      target: 'role dropdown',
      value: 'admin',
    });
  });

  it('scroll 向下默认 600、向上为负、显式像素优先', () => {
    const results = map(`
      Feature: T
      Scenario: Down
        When I scroll down 300 pixels
        Then I should see the title
      Scenario: Up
        When I scroll up
        Then I should see the title
    `);
    expect(results[0]!.contract.steps[0]).toMatchObject({ action: 'scroll', deltaY: 300 });
    expect(results[1]!.contract.steps[0]).toMatchObject({ action: 'scroll', deltaY: -600 });
  });

  it('wait 支持秒、毫秒与默认 1000ms', () => {
    const results = map(`
      Feature: T
      Scenario: Seconds
        When I wait 3 seconds
        Then I should see the title
      Scenario: Millis
        When I wait 250 ms
        Then I should see the title
      Scenario: Default
        When I wait
        Then I should see the title
    `);
    expect(results[0]!.contract.steps[0]!.ms).toBe(3000);
    expect(results[1]!.contract.steps[0]!.ms).toBe(250);
    expect(results[2]!.contract.steps[0]!.ms).toBe(1000);
  });

  it('click 命中不可逆词且后置断言存在时补 postcondition（R4）', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the submit button
        Then I should see the success message
    `);
    const click = r!.contract.steps[0]!;
    expect(click.risk).toBe('irreversible');
    expect(click.postcondition).toEqual([{ kind: 'visible', target: 'the success message' }]);
  });

  it('click 不可逆但无任何断言时保守降级为 reversible', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the delete button
    `);
    expect(r!.status).toBe('draft');
    expect(r!.contract.steps[0]!.risk).toBe('reversible');
    expect(r!.contract.steps[0]!.postcondition).toBeUndefined();
  });
});

describe('mapFeatureToContracts — Then 断言', () => {
  it('should see → visible', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the button
        Then I should see the dashboard
    `);
    expect(r!.contract.assertions.dom[0]).toEqual({ kind: 'visible', target: 'the dashboard' });
  });

  it('should see N → count(equals=N, allow_multiple=true)', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the button
        Then I should see 4 error items
    `);
    expect(r!.contract.assertions.dom[0]).toEqual({
      kind: 'count',
      target: 'error items',
      equals: 4,
      allow_multiple: true,
    });
  });

  it('should not see → absent', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the button
        Then I should not see the spinner
    `);
    expect(r!.contract.assertions.dom[0]).toEqual({ kind: 'absent', target: 'the spinner' });
  });

  it('无法识别的 Then → unrecognized-assertion', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the button
        Then the page title turns green
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps[0]).toMatchObject({
      keyword: 'Then',
      reason: 'unrecognized-assertion',
    });
  });
});

describe('mapFeatureToContracts — 选项与中文', () => {
  it('Given 无法映射时原因是 unmapped-precondition', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        Given the database is migrated to v2
        Then I should see the title
    `);
    expect(r!.unmappedSteps[0]!.reason).toBe('unmapped-precondition');
  });

  it('支持中文步骤文本与中文引号（Gherkin 关键字仍为英文）', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario: 登录
        When 在“用户名输入框”中填写“张三”
        And 点击“提交按钮”
        Then 应该看到欢迎横幅
    `);
    const [cn] = mapFeatureToContracts(feature, OPTIONS);
    expect(cn!.status).toBe('ready');
    expect(cn!.contract.steps[0]).toMatchObject({
      action: 'fill',
      target: '用户名输入框',
      value: '张三',
    });
    expect(cn!.contract.steps[1]).toMatchObject({ action: 'click', target: '提交按钮' });
    expect(cn!.contract.assertions.dom[0]).toEqual({ kind: 'visible', target: '欢迎横幅' });
  });

  it('idPrefix / role 显式生效', () => {
    const [r] = map(
      `
      Feature: Ignored Name
      Scenario: Do Something
        When I click the button
        Then I should see the result
    `,
      { ...OPTIONS, idPrefix: 'custom.prefix', role: 'auditor' },
    );
    expect(r!.testId).toBe('custom.prefix.do.something');
    expect(r!.contract.identity.role).toBe('auditor');
  });

  it('纯非 ASCII Scenario 名回退为 scenarioN 段', () => {
    const [r] = map(`
      Feature: T
      Scenario: 登录场景
        When I click the button
        Then I should see the result
    `);
    expect(r!.testId).toBe('t.scenario1');
  });

  it('tags 透传到 contract.test.tags', () => {
    const [r] = map(`
      Feature: T
      @smoke @p0
      Scenario: S
        When I click the button
        Then I should see the result
    `);
    expect(r!.contract.test.tags).toEqual(['smoke', 'p0']);
  });

  it('environment/base_url 与 identity/credentials_ref 原样落位', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When I click the button
        Then I should see the result
    `);
    expect(r!.contract.environment.base_url).toBe(OPTIONS.baseUrl);
    expect(r!.contract.identity.credentials_ref).toBe(OPTIONS.credentialsRef);
  });
});

describe('#11-P1 引号结构工具函数', () => {
  it('extractQuotedAll 提取全部引号片段（中英文引号统一、不含引号字符）', () => {
    expect(extractQuotedAll('在“用户名”输入框中填写"zhangsan"')).toEqual(['用户名', 'zhangsan']);
    expect(extractQuotedAll('no quotes here')).toEqual([]);
  });

  it('extractLastQuoted 恒等于 extractQuotedAll(...).at(-1)', () => {
    const text = 'fill in "a" with "b" and "c"';
    expect(extractLastQuoted(text)).toBe(extractQuotedAll(text).at(-1)!);
    expect(extractLastQuoted('plain')).toBeNull();
  });

  it('sanitizeTarget 剥离所有引号字符与选择器特征并折叠空白', () => {
    expect(sanitizeTarget('点击“确 定”按钮')).toBe('点击确 定按钮'.replace(/\s+/g, ' ').trim());
    expect(sanitizeTarget('“确定”按钮')).toBe('确定按钮');
    expect(sanitizeTarget('a#b >> c()')).toBe('a b c');
  });

  it('parseTargetValue 恰好 2 片段 → 第一片段为目标、末片段为值', () => {
    expect(parseTargetValue('在“用户名”输入框中填写“zhangsan”', /填写/)).toEqual({
      target: '用户名',
      value: 'zhangsan',
    });
  });

  it('parseTargetValue 仅 0/1 片段 → null（缺目标或缺值）', () => {
    expect(parseTargetValue('填写一个没有引号的东西', /填写/)).toBeNull();
    expect(parseTargetValue('填写“zhangsan”', /填写/)).toBeNull();
  });

  it('parseTargetValue ≥3 片段（目标不唯一）→ null（歧义，禁止猜第一个）', () => {
    expect(parseTargetValue('在“甲”和“乙”中填写“zhangsan”', /填写/)).toBeNull();
  });
});

describe('#11-P1 中文双引号结构化映射', () => {
  it('在"用户名"输入框中填写"zhangsan" → target=用户名 / value=zhangsan（不颠倒）', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When 在“用户名”输入框中填写“zhangsan”
        Then 应该看到首页
    `);
    expect(r!.contract.steps[0]).toMatchObject({
      action: 'fill',
      target: '用户名',
      value: 'zhangsan',
    });
  });

  it('点击"确定"按钮 → target=确定按钮（不含引号）', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When 点击“确定”按钮
        Then 应该看到结果
    `);
    expect(r!.contract.steps[0]).toMatchObject({ action: 'click', target: '确定按钮' });
    expect(r!.contract.steps[0]!.target).not.toMatch(/[“”"‘’]/);
  });

  it('歧义多引号（≥2 且目标不唯一）→ draft + ambiguous-target', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When 在“甲”和“乙”中填写“zhangsan”
        Then 应该看到结果
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps[0]!.reason).toBe('ambiguous-target');
  });

  it('Then 用户列表中显示"zhangsan" → visible target=zhangsan（丢弃叙述框架）', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When 点击“查询按钮”
        Then 用户列表中显示“zhangsan”
    `);
    expect(r!.contract.assertions.dom[0]).toEqual({ kind: 'visible', target: 'zhangsan' });
  });

  it('Then 显示句无引号 → unrecognized-assertion', () => {
    const [r] = map(`
      Feature: T
      Scenario: S
        When 点击“查询按钮”
        Then 用户列表中显示张三
    `);
    expect(r!.status).toBe('draft');
    expect(r!.unmappedSteps[0]!).toMatchObject({
      keyword: 'Then',
      reason: 'unrecognized-assertion',
    });
  });
});
