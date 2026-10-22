import { describe, it, expect } from 'vitest';
import {
  completeDraft,
  type CompletionResult,
  type StepCandidate,
} from '../../src/runtime/contract/complete.js';

describe('completeDraft - F1-1 扩展动作与断言识别表', () => {
  const baseFeature = `
Feature: Profile and Session Management
  Scenario: Upload profile picture
    Given I navigate to "https://example.com/profile"
    When I upload a profile picture
    Then the upload progress is visible
`;

  const makeDraft = (unmapped: Array<{ keyword: 'Given' | 'When' | 'Then'; text: string; reason: string }>, goal = 'Upload profile picture') => ({
    _draft: {
      status: 'needs-human-completion',
      source_feature: 'features/profile.feature',
      unmapped_steps: unmapped,
    },
    version: '1',
    test: {
      id: 'profile.upload_profile_picture',
      name: goal,
    },
    environment: { base_url: 'https://example.com' },
    identity: { role: 'operator', credentials_ref: 'cred://test' },
    goal,
    steps: [
      {
        intent: 'I navigate to "https://example.com/profile"',
        action: 'navigate',
        url: 'https://example.com/profile',
        risk: 'reversible',
      },
    ],
    assertions: {
      dom: [
        {
          target: 'upload progress',
          kind: 'visible',
        },
      ],
    },
  });

  it('识别英文文件上传：产出 click 动作与语义目标，无选择器/路径字面量', () => {
    const draft = makeDraft([
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);
    const res = completeDraft({ draft, featureRaw: baseFeature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('upload-action');
    expect(candidate.step).toBeDefined();
    expect(candidate.step?.action).toBe('click');
    expect(candidate.step?.risk).toBe('reversible');
    expect(candidate.step?.target).toContain('profile picture');
    expect(candidate.step?.target).not.toMatch(/[#./\\]/);
  });

  it('识别中文文件上传：产出 click 动作与语义目标', () => {
    const zhFeature = `
Feature: 用户资料
  Scenario: 上传头像
    Given 访问 https://example.com/profile
    When 我上传头像文件
    Then 看到 "上传成功"
`;
    const draft = makeDraft(
      [{ keyword: 'When', text: '我上传头像文件', reason: 'unmapped-action' }],
      '上传头像',
    );
    const res = completeDraft({ draft, featureRaw: zhFeature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('upload-action');
    expect(candidate.step?.action).toBe('click');
    expect(candidate.step?.target).toContain('头像');
  });

  it('文件上传动词命中但目标残缺：返回 medium 候选', () => {
    const feature = `
Feature: Profile
  Scenario: Upload
    When I upload
`;
    const draft = makeDraft(
      [{ keyword: 'When', text: 'I upload', reason: 'unmapped-action' }],
      'Upload',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('medium');
    expect(candidate.matched_rule).toBe('upload-action-missing-target');
  });

  it('识别英文终止会话：产出 click 动作，标记 irreversible', () => {
    const feature = `
Feature: Security
  Scenario: Terminate sessions
    When I terminate all active sessions
    Then the sessions table is empty
`;
    const draft = makeDraft(
      [{ keyword: 'When', text: 'I terminate all active sessions', reason: 'unmapped-action' }],
      'Terminate sessions',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('terminate-sessions-action');
    expect(candidate.step?.action).toBe('click');
    expect(candidate.step?.risk).toBe('irreversible');
    expect(candidate.step?.target).toBeDefined();
  });

  it('识别中文关闭会话：产出 click 动作，标记 irreversible', () => {
    const feature = `
Feature: 安全
  Scenario: 关闭会话
    When 我关闭所有活动会话
    Then 看到 "已退出"
`;
    const draft = makeDraft(
      [{ keyword: 'When', text: '我关闭所有活动会话', reason: 'unmapped-action' }],
      '关闭会话',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('terminate-sessions-action');
    expect(candidate.step?.action).toBe('click');
    expect(candidate.step?.risk).toBe('irreversible');
  });

  it('终止动作动词命中但目标残缺：返回 medium 候选', () => {
    const feature = `
Feature: Security
  Scenario: Terminate
    When I close
`;
    const draft = makeDraft(
      [{ keyword: 'When', text: 'I close', reason: 'unmapped-action' }],
      'Terminate',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('medium');
    expect(candidate.matched_rule).toBe('terminate-sessions-missing-target');
  });

  it('识别 Then 清除/消失断言（英文）：产出 dom absent 断言', () => {
    const feature = `
Feature: Session
  Scenario: Risk Clear
    When I click "Dismiss"
    Then the session risk badge is cleared
`;
    const draft = makeDraft(
      [{ keyword: 'Then', text: 'the session risk badge is cleared', reason: 'unrecognized-assertion' }],
      'Risk Clear',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('cleared-assertion');
    expect(candidate.step?.action).toBe('assert_only');
    expect(candidate.assertion?.kind).toBe('absent');
    expect(candidate.assertion?.target).toContain('session risk badge');
  });

  it('识别 Then 消失断言（中文）：产出 dom absent 断言', () => {
    const feature = `
Feature: 提醒
  Scenario: 消除警告
    When 点击 "确定"
    Then 警告提示已消失
`;
    const draft = makeDraft(
      [{ keyword: 'Then', text: '警告提示已消失', reason: 'unrecognized-assertion' }],
      '消除警告',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('high');
    expect(candidate.matched_rule).toBe('cleared-assertion');
    expect(candidate.assertion?.kind).toBe('absent');
    expect(candidate.assertion?.target).toContain('警告提示');
  });

  it('清除断言目标残缺：返回 medium 候选', () => {
    const feature = `
Feature: Alert
  Scenario: Clear
    Then is cleared
`;
    const draft = makeDraft(
      [{ keyword: 'Then', text: 'is cleared', reason: 'unrecognized-assertion' }],
      'Clear',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.confidence).toBe('medium');
    expect(candidate.matched_rule).toBe('cleared-assertion-missing-target');
  });

  it('完全无法识别的步骤：返回 matched_rule = none，无 step/assertion', () => {
    const feature = `
Feature: Unknown
  Scenario: Alien
    Given an alien appears in galaxy
`;
    const draft = makeDraft(
      [{ keyword: 'Given', text: 'an alien appears in galaxy', reason: 'unmapped-precondition' }],
      'Alien',
    );
    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(1);
    const candidate = res.candidates[0]!;
    expect(candidate.matched_rule).toBe('none');
    expect(candidate.step).toBeUndefined();
    expect(candidate.assertion).toBeUndefined();
    expect(res.needsHuman).toBe(1);
    expect(res.resolvedHigh).toBe(0);
    expect(res.completedContract).toBeUndefined();
  });
});

import { validateContract } from '../../src/runtime/contract/validate.js';

describe('completeDraft - F1-2 顺序重映射与数量守恒', () => {
  const multiStepFeature = `
Feature: User Sessions
  Background:
    Given I navigate to https://example.com/settings
    When fill in "username" with "admin"
  Scenario: Cleanup sessions
    When click "Session Manager"
    And I terminate all active sessions
    Then the session risk badge is cleared
    And I should see "Done"
`;

  it('F1-2.1: 按 Background + Scenario 原序合并步骤，基线步骤映射保持不变', () => {
    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/sessions.feature',
        unmapped_steps: [
          { keyword: 'When', text: 'I terminate all active sessions', reason: 'unmapped-action' },
          { keyword: 'Then', text: 'the session risk badge is cleared', reason: 'unrecognized-assertion' },
        ],
      },
      version: '1',
      test: {
        id: 'user.sessions.cleanup.sessions',
        name: 'Cleanup sessions',
      },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Cleanup sessions',
      steps: [
        { intent: 'I navigate to "https://example.com/settings"', action: 'navigate', url: 'https://example.com/settings', risk: 'reversible' },
        { intent: 'I enter "admin" into "username"', action: 'fill', target: 'username', value: 'admin', risk: 'reversible' },
        { intent: 'I click "Session Manager"', action: 'click', target: 'Session Manager', risk: 'reversible' },
        { intent: 'I should see "Done"', action: 'assert_only', risk: 'reversible' },
      ],
      assertions: {
        dom: [
          { kind: 'visible', target: 'Done' },
        ],
      },
    };

    const res = completeDraft({ draft, featureRaw: multiStepFeature });
    expect(res.resolvedHigh).toBe(2);
    expect(res.needsHuman).toBe(0);
    expect(res.completedContract).toBeDefined();

    const completed = res.completedContract!;
    // 验证 steps 顺序严格为：navigate -> fill -> click -> terminate -> cleared -> should see Done
    expect(completed.steps).toHaveLength(6);
    expect(completed.steps[0]?.action).toBe('navigate');
    expect(completed.steps[1]?.action).toBe('fill');
    expect(completed.steps[2]?.action).toBe('click');
    expect(completed.steps[2]?.target).toBe('Session Manager');
    expect(completed.steps[3]?.action).toBe('click');
    expect(completed.steps[3]?.intent).toBe('I terminate all active sessions');
    expect(completed.steps[3]?.risk).toBe('irreversible');
    // R4: 必须带 postcondition
    expect(completed.steps[3]?.postcondition).toBeDefined();
    expect(completed.steps[3]?.postcondition?.length).toBeGreaterThan(0);
    expect(completed.steps[4]?.action).toBe('assert_only');
    expect(completed.steps[5]?.action).toBe('assert_only');

    // 验证 domAssertions 包含清除与 should see
    expect(completed.assertions.dom.length).toBe(2);
    expect(completed.assertions.dom[0]?.kind).toBe('absent');
    expect(completed.assertions.dom[1]?.kind).toBe('visible');

    // 验证通过 Contract 九条校验
    const valResult = validateContract(completed);
        expect(valResult.valid).toBe(true);
  });

  it('F1-2.2: 场景定位与 matchBasis 可解释输出', () => {
    const featureWithMultiScenarios = `
Feature: Multi Scenarios
  Scenario: Scenario Alpha
    When I click "Alpha"
    Then I should see "Alpha"

  Scenario: Scenario Beta
    When I upload a profile picture
    Then I should see "Beta"
`;

    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/multi.feature',
        unmapped_steps: [
          { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
        ],
      },
      version: '1',
      test: {
        id: 'multi_scenarios.scenario_beta',
        name: 'Scenario Beta',
      },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Scenario Beta',
      steps: [
        { intent: 'I should see "Beta"', action: 'assert_only', risk: 'reversible' },
      ],
      assertions: {
        dom: [{ kind: 'visible', target: 'Beta' }],
      },
    };

    const res = completeDraft({ draft, featureRaw: featureWithMultiScenarios });
    expect(res.matchBasis).toContain('Scenario Beta');
    expect(res.resolvedHigh).toBe(1);
    expect(res.completedContract?.goal).toBe('Scenario Beta');
  });

  it('F1-2.3: 候选数量与 unmapped_steps 数量守恒，原文逐条保留', () => {
    const feature = `
Feature: Mixed
  Scenario: Mixed Unmapped
    When I upload
    And I close
    And an unknown alien arrives
`;

    const unmappedList = [
      { keyword: 'When' as const, text: 'I upload', reason: 'unmapped-action' },
      { keyword: 'When' as const, text: 'I close', reason: 'unmapped-action' },
      { keyword: 'When' as const, text: 'an unknown alien arrives', reason: 'unmapped-action' },
    ];

    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/mixed.feature',
        unmapped_steps: unmappedList,
      },
      version: '1',
      test: { id: 'mixed.mixed_unmapped', name: 'Mixed Unmapped' },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Mixed Unmapped',
      steps: [],
      assertions: { dom: [] },
    };

    const res = completeDraft({ draft, featureRaw: feature });
    expect(res.candidates).toHaveLength(3);
    expect(res.candidates[0]?.text).toBe('I upload');
    expect(res.candidates[1]?.text).toBe('I close');
    expect(res.candidates[2]?.text).toBe('an unknown alien arrives');
    expect(res.resolvedHigh).toBe(0);
    expect(res.needsHuman).toBe(3);
    expect(res.completedContract).toBeUndefined();
  });

  it('F1-2.4a: 不可逆步骤之后无断言、之前有断言时不得借用早先断言，降级 reversible', () => {
    const featureEarlierAssertion = `
Feature: Order
  Scenario: Late terminate
    When I click "First"
    Then I should see "Earlier"
    When I terminate all active sessions
`;

    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/order.feature',
        unmapped_steps: [
          { keyword: 'When' as const, text: 'I terminate all active sessions', reason: 'unmapped-action' },
        ],
      },
      version: '1',
      test: { id: 'order.late_terminate', name: 'Late terminate' },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Late terminate',
      steps: [
        { intent: 'I click "First"', action: 'click', target: '"First"', risk: 'reversible' },
        { intent: 'I should see "Earlier"', action: 'assert_only', risk: 'reversible' },
      ],
      assertions: { dom: [{ kind: 'visible', target: 'Earlier' }] },
    };

    const res = completeDraft({ draft, featureRaw: featureEarlierAssertion });
    const terminateStep = res.completedContract?.steps.at(-1);
    expect(terminateStep?.risk).toBe('reversible');
    expect(terminateStep?.postcondition).toBeUndefined();
  });

  it('F1-2.4: 不可逆步骤在无断言时保守降级为 reversible', () => {
    const featureNoAssertion = `
Feature: No Assertion
  Scenario: Terminate only
    When I terminate all active sessions
`;

    const draft = {
      _draft: {
        status: 'needs-human-completion',
        source_feature: 'features/terminate.feature',
        unmapped_steps: [
          { keyword: 'When' as const, text: 'I terminate all active sessions', reason: 'unmapped-action' },
        ],
      },
      version: '1',
      test: { id: 'no_assert.terminate_only', name: 'Terminate only' },
      environment: { base_url: 'https://example.com' },
      identity: { role: 'operator', credentials_ref: 'cred://test' },
      goal: 'Terminate only',
      steps: [],
      assertions: { dom: [] },
    };

    const res = completeDraft({ draft, featureRaw: featureNoAssertion });
    expect(res.resolvedHigh).toBe(1);
    // completedContract 的 steps 降级为 reversible（因为无断言）
    expect(res.completedContract).toBeDefined();
    expect(res.completedContract?.steps[0]?.risk).toBe('reversible');
  });
});
