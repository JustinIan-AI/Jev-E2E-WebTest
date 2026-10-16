/**
 * ai-testgen → IDWTH 衔接：极简 Gherkin 解析器单测。
 *
 * 覆盖：块/标签/注释解析、And/But 归一化、数据表与文档串、
 * Background 合并基础、Scenario Outline + Examples、CRLF，
 * 以及各类语法错误的行号定位。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GherkinParseError,
  parseFeature,
} from '../../src/runtime/contract/gherkin-parse.js';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/sample.feature',
);

describe('parseFeature — 夹具 sample.feature', () => {
  it('解析 Feature 名、标签与描述块', async () => {
    const feature = parseFeature(await readFile(FIXTURE, 'utf8'));
    expect(feature.name).toBe('Account and Catalog');
    expect(feature.tags).toEqual(['regression']);
    expect(feature.background).toHaveLength(1);
  });

  it('解析全部 Scenario（含 Outline 关键字）', async () => {
    const feature = parseFeature(await readFile(FIXTURE, 'utf8'));
    expect(feature.scenarios).toHaveLength(4);
    expect(feature.scenarios.map((s) => s.keyword)).toEqual([
      'Scenario',
      'Scenario',
      'Scenario',
      'Scenario Outline',
    ]);
  });

  it('And/But 归一化到最近关键字，标签挂到 Scenario', async () => {
    const feature = parseFeature(await readFile(FIXTURE, 'utf8'));
    const login = feature.scenarios[0]!;
    expect(login.tags).toEqual(['smoke']);
    expect(login.steps.map((s) => s.keyword)).toEqual([
      'Given',
      'Given',
      'When',
      'Then',
      'Then',
      'Then',
    ]);
    expect(login.steps[5]!.text).toBe('I should not see the login form');
  });

  it('Examples 表含表头且单元格 trim', async () => {
    const feature = parseFeature(await readFile(FIXTURE, 'utf8'));
    const outline = feature.scenarios[3]!;
    expect(outline.tags).toEqual(['positive']);
    expect(outline.examples).toHaveLength(1);
    expect(outline.examples[0]!.tags).toEqual([]);
    expect(outline.examples[0]!.table).toEqual([
      ['keyword', 'count'],
      ['laptop', '2'],
      ['keyboard', '5'],
    ]);
  });
});

describe('parseFeature — 语法子集', () => {
  it('整行注释与空行被忽略', () => {
    const feature = parseFeature(`
      # 这是注释
      Feature: T

      Scenario: S
        When I click the button
        Then I should see the result
    `);
    expect(feature.scenarios).toHaveLength(1);
  });

  it('支持 CRLF 换行', () => {
    const feature = parseFeature(
      'Feature: T\r\nScenario: S\r\nWhen I click the button\r\nThen I should see the result\r\n',
    );
    expect(feature.scenarios[0]!.steps).toHaveLength(2);
  });

  it('步骤数据表挂到最近步骤', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario: S
        Given the following users exist
          | name  | role     |
          | alice | operator |
        Then I should see the user list
    `);
    expect(feature.scenarios[0]!.steps[0]!.table).toEqual([
      ['name', 'role'],
      ['alice', 'operator'],
    ]);
  });

  it('三引号文档串原样保留', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario: S
        Given the payload is
          """
          { "a": 1 }
          """
        Then I should see the result
    `);
    expect(feature.scenarios[0]!.steps[0]!.docString).toBe('{ "a": 1 }');
  });

  it('反引号文档串原样保留', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario: S
        Given the note is
          \`\`\`
          hello
          \`\`\`
        Then I should see the result
    `);
    expect(feature.scenarios[0]!.steps[0]!.docString).toBe('hello');
  });

  it('Feature 描述行收集到 description', () => {
    const feature = parseFeature(`
      Feature: T
      这是一段
      自由描述
      Scenario: S
        Then I should see the result
    `);
    expect(feature.description).toEqual(['这是一段', '自由描述']);
  });

  it('* 星号步骤归一化到最近关键字', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario: S
        Given a precondition
        * another precondition
        Then I should see the result
    `);
    expect(feature.scenarios[0]!.steps[1]!.keyword).toBe('Given');
  });

  it('Background 步骤单独解析', () => {
    const feature = parseFeature(`
      Feature: T
      Background:
        Given I navigate to https://example.com
      Scenario: S
        Then I should see the result
    `);
    expect(feature.background).toHaveLength(1);
    expect(feature.background[0]!.keyword).toBe('Given');
  });

  it('Example / Scenario Template / Scenarios 别名均可识别', () => {
    const feature = parseFeature(`
      Feature: T
      Scenario Template: S
        Given I enter "<v>" in the field
        Then I should see the result
        Scenarios:
          | v   |
          | one |
    `);
    expect(feature.scenarios[0]!.keyword).toBe('Scenario Outline');
    expect(feature.scenarios[0]!.examples[0]!.table).toHaveLength(2);
  });

  it('Examples 上方标签挂到 Examples，不污染 Scenario', () => {
    const feature = parseFeature(`
      Feature: T
      @outline
      Scenario Outline: S
        Given I enter "<v>" in the field
        Then I should see the result
        @rows
        Examples:
          | v   |
          | one |
    `);
    expect(feature.scenarios[0]!.tags).toEqual(['outline']);
    expect(feature.scenarios[0]!.examples[0]!.tags).toEqual(['rows']);
  });
});

describe('parseFeature — 错误定位', () => {
  it('缺少 Feature 声明抛错', () => {
    expect(() => parseFeature('Scenario: S\nThen I should see x')).toThrow(GherkinParseError);
  });

  it('Feature 中没有任何 Scenario 抛错', () => {
    expect(() => parseFeature('Feature: Empty')).toThrow(/至少需要一个 Scenario/);
  });

  it('And 作为首个步骤抛错并给出行号', () => {
    try {
      parseFeature('Feature: T\nScenario: S\n  And something');
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(GherkinParseError);
      expect((error as GherkinParseError).line).toBe(3);
    }
  });

  it('Scenario 之前先出现步骤抛错', () => {
    expect(() =>
      parseFeature('Feature: T\nWhen I click the button'),
    ).toThrow(/Background 或 Scenario/);
  });

  it('Examples 出现在普通 Scenario 中抛错', () => {
    expect(() =>
      parseFeature(`
        Feature: T
        Scenario: S
          Then I should see x
          Examples:
            | a |
            | 1 |
      `),
    ).toThrow(/Examples 只能/);
  });

  it('无法识别的行抛错并带行号', () => {
    try {
      parseFeature('Feature: T\n一段没有任何关键字的文本');
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(GherkinParseError);
      expect((error as GherkinParseError).line).toBe(2);
    }
  });

  it('未闭合文档串抛错', () => {
    expect(() =>
      parseFeature(`
        Feature: T
        Scenario: S
          Given the payload is
            """
            never closed
      `),
    ).toThrow(/闭合标记/);
  });

  it('畸形数据表行抛错', () => {
    expect(() =>
      parseFeature(`
        Feature: T
        Scenario: S
          Given x
            | a | b
      `),
    ).toThrow(/数据表行/);
  });
});
