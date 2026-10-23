/**
 * Issue #16 单元与行为复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/16
 *
 * 缺陷现象：
 * 1. mapThenStep 只认 3 类叙述句式，`assert only "X" is visible` 报 unrecognized-assertion；
 * 2. schema 封闭允许的 7 种 DOM 原语中，value / checked / number / url 无任何 Gherkin 出口；
 * 3. 导致包含这些断言的场景被强制降级为 .draft.yaml。
 */
import { describe, expect, it } from 'vitest';
import {
  parseFeature,
  type ParsedStep,
} from '../../../src/runtime/contract/gherkin-parse.js';
import {
  mapFeatureToContracts,
  mapThenStep,
  type MapFeatureOptions,
} from '../../../src/runtime/contract/feature-to-contract.js';
import { validateContract } from '../../../src/runtime/contract/validate.js';

const OPTIONS: MapFeatureOptions = {
  baseUrl: 'https://staging.example.com',
  credentialsRef: 'cred://staging-operator',
};

function step(text: string): ParsedStep {
  return { keyword: 'Then', text, table: [], docString: null };
}

describe('Issue #16: Then 断言动作式句式与缺失原语映射扩展', () => {
  describe('1. 动作式 visible / absent 断言映射', () => {
    it('支持 assert only "X" is visible 与中文句式', () => {
      const en = mapThenStep(step('assert only "用户列表页面" is visible'));
      expect(en).not.toBeNull();
      expect(en?.step.action).toBe('assert_only');
      expect(en?.assertion).toEqual({ kind: 'visible', target: '用户列表页面' });

      const zh = mapThenStep(step('断言仅 "用户列表页面" 可见'));
      expect(zh).not.toBeNull();
      expect(zh?.step.action).toBe('assert_only');
      expect(zh?.assertion).toEqual({ kind: 'visible', target: '用户列表页面' });
    });

    it('支持 assert only "X" is not visible / is absent 与中文句式', () => {
      const notVisible = mapThenStep(step('assert only "删除按钮" is not visible'));
      expect(notVisible).not.toBeNull();
      expect(notVisible?.step.action).toBe('assert_only');
      expect(notVisible?.assertion).toEqual({ kind: 'absent', target: '删除按钮' });

      const absent = mapThenStep(step('assert only "删除按钮" is absent'));
      expect(absent).not.toBeNull();
      expect(absent?.step.action).toBe('assert_only');
      expect(absent?.assertion).toEqual({ kind: 'absent', target: '删除按钮' });

      const zh = mapThenStep(step('断言仅 "删除按钮" 不可见'));
      expect(zh).not.toBeNull();
      expect(zh?.step.action).toBe('assert_only');
      expect(zh?.assertion).toEqual({ kind: 'absent', target: '删除按钮' });
    });
  });

  describe('2. 缺失原语映射 (value / checked / number / url)', () => {
    it('支持 value 断言句式 (中英文)', () => {
      // Issue #16 原文复现
      const en = mapThenStep(step('assert only "用户列表中的zhangsan01状态" is "已启用"'));
      expect(en).not.toBeNull();
      expect(en?.step.action).toBe('assert_only');
      expect(en?.assertion).toEqual({
        kind: 'value',
        target: '用户列表中的zhangsan01状态',
        expected: '已启用',
      });

      const zh1 = mapThenStep(step('"用户名输入框" 的值为 "admin"'));
      expect(zh1).not.toBeNull();
      expect(zh1?.assertion).toEqual({
        kind: 'value',
        target: '用户名输入框',
        expected: 'admin',
      });

      const zh2 = mapThenStep(step('"用户名输入框" 的值是 "admin"'));
      expect(zh2).not.toBeNull();
      expect(zh2?.assertion).toEqual({
        kind: 'value',
        target: '用户名输入框',
        expected: 'admin',
      });
    });

    it('支持 checked 断言句式 (已勾选 / 未勾选)', () => {
      const checkedEn = mapThenStep(step('assert only "记住密码" is checked'));
      expect(checkedEn).not.toBeNull();
      expect(checkedEn?.assertion).toEqual({
        kind: 'checked',
        target: '记住密码',
        expected: true,
      });

      const checkedZh = mapThenStep(step('"记住密码" 已勾选'));
      expect(checkedZh).not.toBeNull();
      expect(checkedZh?.assertion).toEqual({
        kind: 'checked',
        target: '记住密码',
        expected: true,
      });

      const notCheckedEn = mapThenStep(step('assert only "记住密码" is not checked'));
      expect(notCheckedEn).not.toBeNull();
      expect(notCheckedEn?.assertion).toEqual({
        kind: 'checked',
        target: '记住密码',
        expected: false,
      });

      const notCheckedZh = mapThenStep(step('"记住密码" 未勾选'));
      expect(notCheckedZh).not.toBeNull();
      expect(notCheckedZh?.assertion).toEqual({
        kind: 'checked',
        target: '记住密码',
        expected: false,
      });
    });

    it('支持 number 断言句式', () => {
      const en = mapThenStep(step('assert only "购物车数量" number is 3'));
      expect(en).not.toBeNull();
      expect(en?.assertion).toEqual({
        kind: 'number',
        target: '购物车数量',
        expected: 3,
      });

      const zh = mapThenStep(step('"商品库存" 的数值为 99'));
      expect(zh).not.toBeNull();
      expect(zh?.assertion).toEqual({
        kind: 'number',
        target: '商品库存',
        expected: 99,
      });
    });

    it('支持 url 断言句式', () => {
      const en = mapThenStep(step('current url is "https://example.com/dashboard"'));
      expect(en).not.toBeNull();
      expect(en?.assertion).toEqual({
        kind: 'url',
        expected: 'https://example.com/dashboard',
      });

      const zh = mapThenStep(step('当前地址是 "https://example.com/dashboard"'));
      expect(zh).not.toBeNull();
      expect(zh?.assertion).toEqual({
        kind: 'url',
        expected: 'https://example.com/dashboard',
      });
    });
  });

  describe('3. Issue #16 真实端到端场景复现', () => {
    it('Issue #16 示例中的 Gherkin 特征文件直接落定为 ready 契约而非 draft', () => {
      const gherkin = `
Feature: User Management
  Scenario: Check user list and status
    When click "创建按钮"
    Then assert only "用户列表页面" is visible
    And assert only "用户列表中的zhangsan01状态" is "已启用"
`;
      const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
      expect(results).toHaveLength(1);
      const scenarioResult = results[0]!;

      // 修复前：status === 'draft', unmappedSteps 有 2 条 unrecognized-assertion
      // 修复后：status === 'ready', unmappedSteps 为空
      expect(scenarioResult.status).toBe('ready');
      expect(scenarioResult.unmappedSteps).toEqual([]);
      expect(scenarioResult.contract.steps).toHaveLength(3);
      expect(scenarioResult.contract.assertions.dom).toEqual([
        { kind: 'visible', target: '用户列表页面' },
        { kind: 'value', target: '用户列表中的zhangsan01状态', expected: '已启用' },
      ]);

      const validation = validateContract(scenarioResult.contract);
      expect(validation.valid).toBe(true);
    });
  });
});
