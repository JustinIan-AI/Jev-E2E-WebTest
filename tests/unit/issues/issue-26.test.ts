/**
 * Issue #26 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-Test/issues/26
 *
 * R4 收尾规则错误分配 postcondition：
 * - feature-to-contract.ts 的 R4 取 domAssertions[0]（全场景第一条 Then 断言），
 *   与步骤位置无关 → 多个 irreversible 步骤共享同一条断言；
 * - 该断言只对最后一个 irreversible（真正落库的动作）成立，挂在更早的步骤上
 *   必然失败 → 执行时 BLOCKED(postcondition)，case 卡死。
 *
 * 修复语义（专属断言规则）：
 * - irreversible 步骤的 postcondition 必须是【专属】断言——严格位于其后、且先于
 *   下一个 irreversible 步骤的最近一条断言；取不到则保守降级 reversible；
 * - 标准 CRUD happy-path（新建 → 填写 → 创建 → Then 断言）中，只有最后一个
 *   irreversible 步骤挂 postcondition，更早的降级 reversible。
 */
import { describe, expect, it } from 'vitest';
import { parseFeature } from '../../../src/runtime/contract/gherkin-parse.js';
import {
  mapFeatureToContracts,
  type MapFeatureOptions,
} from '../../../src/runtime/contract/feature-to-contract.js';
import { completeDraft } from '../../../src/runtime/contract/complete.js';

const OPTIONS: MapFeatureOptions = {
  baseUrl: 'https://staging.example.com',
  credentialsRef: 'cred://staging-operator',
};

describe('issue #26：R4 postcondition 专属断言分配（feature-to-contract 路径）', () => {
  it('AC1 两 irreversible + 末尾 Then：只有最后一个挂 postcondition，前一个降级 reversible', () => {
    const gherkin = `
Feature: 创建用户
  Scenario: Happy path
    When click "新建"
    When fill in "用户名输入框" with "zhangsan"
    When click "创建按钮"
    Then I should see "用户列表页面"
    Then assert only "创建成功提示" is visible
`;
    const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
    expect(results).toHaveLength(1);
    const steps = results[0]!.contract.steps;

    // 步骤 0：click 新建 —— 修复前错误挂 postcondition（必然 BLOCKED）
    expect(steps[0]!.action).toBe('click');
    expect(steps[0]!.risk).toBe('reversible');
    expect(steps[0]!.postcondition).toBeUndefined();

    // 步骤 1：fill —— 本来就是 reversible
    expect(steps[1]!.action).toBe('fill');

    // 步骤 2：click 创建按钮 —— 最后一个 irreversible，挂第一条末尾断言
    expect(steps[2]!.risk).toBe('irreversible');
    expect(steps[2]!.postcondition).toEqual([
      { kind: 'visible', target: '用户列表页面' },
    ]);
  });

  it('AC2 单 irreversible + 末尾断言：行为不变，仍挂 postcondition（回归）', () => {
    const gherkin = `
Feature: 删除
  Scenario: Delete only
    When click "删除"
    Then I should see "删除成功"
`;
    const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
    const steps = results[0]!.contract.steps;
    expect(steps[0]!.risk).toBe('irreversible');
    expect(steps[0]!.postcondition).toEqual([{ kind: 'visible', target: '删除成功' }]);
  });

  it('AC3 全部 irreversible 且无断言：全部降级 reversible（现有行为保持）', () => {
    const gherkin = `
Feature: 清理
  Scenario: No assertions
    When click "删除"
    When click "移除"
`;
    const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
    const steps = results[0]!.contract.steps;
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.risk).toBe('reversible');
      expect(step.postcondition).toBeUndefined();
    }
  });

  it('AC4 场景中段 Then 断言：两个 irreversible 各得专属断言，不共享', () => {
    const gherkin = `
Feature: 清理与重建
  Scenario: Mid assertions
    When click "删除"
    Then I should see "已删除提示"
    When click "创建"
    Then I should see "创建成功提示"
`;
    const results = mapFeatureToContracts(parseFeature(gherkin), OPTIONS);
    const steps = results[0]!.contract.steps;
    // steps: [click删除, assert_only(已删除), click创建, assert_only(创建成功)]
    expect(steps[0]!.risk).toBe('irreversible');
    expect(steps[0]!.postcondition).toEqual([{ kind: 'visible', target: '已删除提示' }]);
    expect(steps[2]!.risk).toBe('irreversible');
    expect(steps[2]!.postcondition).toEqual([{ kind: 'visible', target: '创建成功提示' }]);
  });
});

describe('issue #26：R4 postcondition 专属断言分配（complete 草稿补全路径）', () => {
  it('AC5 两 irreversible（一 baseline 一候选）+ 末尾 Then：只有最后一个挂 postcondition', () => {
    const featureRaw = `
Feature: Cleanup
  Scenario: Double terminate
    When click "删除"
    When I terminate all active sessions
    Then I should see "Done"
`;
    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/cleanup.feature',
        unmapped_steps: [
          { keyword: 'When' as const, text: 'I terminate all active sessions', reason: 'unmapped-action' },
        ],
      },
      version: '1',
      test: { id: 'cleanup.double_terminate', name: 'Double terminate' },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Double terminate',
      steps: [{ intent: 'click "删除"', action: 'click', target: '删除', risk: 'irreversible' }],
      assertions: { dom: [] },
    };

    const res = completeDraft({ draft: draft as never, featureRaw });
    const steps = res.completedContract?.steps;
    expect(steps).toBeDefined();

    // 步骤 0：click 删除 —— 修复前与 terminate 共享同一条 Done 断言（必然 BLOCKED）
    expect(steps![0]!.risk).toBe('reversible');
    expect(steps![0]!.postcondition).toBeUndefined();

    // 步骤 1：terminate（最后一个 irreversible）挂 Done 断言
    expect(steps![1]!.risk).toBe('irreversible');
    expect(steps![1]!.postcondition).toEqual([{ kind: 'visible', target: 'Done' }]);
  });
});
