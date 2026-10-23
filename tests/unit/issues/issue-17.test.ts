/**
 * Issue #17 单元与行为复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/17
 *
 * 缺陷现象：
 * When navigate "页面名"（无 URL）时，feature-to-contract.ts 的 mapStep
 * 将其静默降级为 action: 'click'，导致原本语义不明的导航步骤被误判为 ready 契约，
 * 运行时产生找不到元素（BLOCKED）或误点同名文本（假 PASS）。
 *
 * 修复要求：
 * 无 URL 的 navigate 步骤严禁静默产出 click，必须返回 reason: 'unmapped-navigation'，
 * 促使契约安全降级为 draft。
 */
import { describe, expect, it } from 'vitest';
import {
  parseFeature,
  type ParsedStep,
} from '../../../src/runtime/contract/gherkin-parse.js';
import {
  mapFeatureToContracts,
  mapStep,
  type MapFeatureOptions,
  type MapStepResult,
} from '../../../src/runtime/contract/feature-to-contract.js';

const OPTIONS: MapFeatureOptions = {
  baseUrl: 'https://staging.example.com',
  credentialsRef: 'cred://staging-operator',
};

function step(text: string, keyword: 'Given' | 'When' | 'Then' = 'When'): ParsedStep {
  return { keyword, text, table: [], docString: null };
}

describe('Issue #17: navigate 缺 URL 严禁静默降级为 click', () => {
  describe('1. mapStep 单步识别行为', () => {
    it('无 URL 的英文 navigate 语句应返回 unmapped-navigation 而非 click', () => {
      const res = mapStep(step('navigate "创建用户页面"')) as MapStepResult;
      // 修复前: res = { step: { action: 'click', target: '创建用户页面' } }
      // 修复后: res = { reason: 'unmapped-navigation' }
      expect('reason' in res).toBe(true);
      if ('reason' in res) {
        expect(res.reason).toBe('unmapped-navigation');
      }
    });

    it('无 URL 的中文打开/访问语句应返回 unmapped-navigation 而非 click', () => {
      const res = mapStep(step('打开 "用户管理中心"')) as MapStepResult;
      expect('reason' in res).toBe(true);
      if ('reason' in res) {
        expect(res.reason).toBe('unmapped-navigation');
      }
    });

    it('含完整 URL 的 navigate 语句保持正常映射为 navigate 动作', () => {
      const res = mapStep(step('navigate to "https://staging.example.com/users"'));
      expect('step' in res).toBe(true);
      if ('step' in res) {
        expect(res.step.action).toBe('navigate');
        expect(res.step.url).toBe('https://staging.example.com/users');
      }
    });
  });

  describe('2. 端到端 Feature → Contract 状态判定', () => {
    it('Issue #17 原文复现：包含无 URL navigate 的场景必须判定为 draft，严禁标为 ready', () => {
      const gherkin = `
Feature: User Navigation
  Scenario: Open user page without explicit url
    When navigate "创建用户页面"
    Then assert only "页面标题" is visible
`;
      const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
      expect(results).toHaveLength(1);
      const scenario = results[0]!;

      // 修复前：status === 'ready', unmappedSteps === []（虚假 ready）
      // 修复后：status === 'draft', unmappedSteps 包含 unmapped-navigation
      expect(scenario.status).toBe('draft');
      expect(scenario.unmappedSteps).toEqual([
        {
          keyword: 'When',
          text: 'navigate "创建用户页面"',
          reason: 'unmapped-navigation',
        },
      ]);
      // 步骤列表中不应存在任何由于 navigate 降级出来的 click 动作
      const clickSteps = scenario.contract.steps.filter((s) => s.action === 'click');
      expect(clickSteps).toHaveLength(0);
    });

    it('含完整 URL 的场景正常判定为 ready 契约', () => {
      const gherkin = `
Feature: Valid Navigation
  Scenario: Open user page with full url
    When navigate to "https://staging.example.com/users"
    Then assert only "页面标题" is visible
`;
      const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
      expect(results).toHaveLength(1);
      const scenario = results[0]!;

      expect(scenario.status).toBe('ready');
      expect(scenario.unmappedSteps).toEqual([]);
      expect(scenario.contract.steps[0]?.action).toBe('navigate');
      expect(scenario.contract.steps[0]?.url).toBe('https://staging.example.com/users');
    });
  });
});
