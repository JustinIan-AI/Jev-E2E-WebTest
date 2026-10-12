import { describe, expect, it } from 'vitest';
import {
  validateContract,
  type ContractViolation,
} from '../../src/runtime/contract/validate.js';

/** 合法 Contract 基线（对应详设 §3.1，九条规则全部满足）。 */
const validContract = {
  version: '1',
  test: { id: 'workload.create', name: '创建 Deployment' },
  environment: { base_url: 'https://example.com' },
  identity: { role: 'operator', credentials_ref: 'cred://staging-operator' },
  goal: '创建一个 Deployment 并确认其进入 Running',
  steps: [
    { intent: '进入工作负载', action: 'click', target: '工作负载 导航项', risk: 'reversible' },
    {
      intent: '提交',
      action: 'click',
      target: '确认按钮',
      risk: 'irreversible',
      postcondition: [{ kind: 'visible', target: 'Deployment 详情页标题' }],
    },
    { intent: '只校验', action: 'assert_only', risk: 'reversible' },
  ],
  assertions: {
    dom: [{ kind: 'visible', target: 'deployment-name-cell', text_contains: 'idwth-run-cid' }],
    http: [
      { method: 'POST', path_prefix: '/api/deployments', status: 201, within_run: true },
    ],
  },
};

function violationsOf(contract: unknown, options?: Parameters<typeof validateContract>[1]): ContractViolation[] {
  const r = validateContract(contract, options);
  if (r.valid) throw new Error('expected invalid contract, got valid');
  return r.violations;
}

function hasRule(violations: ContractViolation[], rule: string): boolean {
  return violations.some((v) => v.rule === rule);
}

describe('validateContract —— 九条校验规则 (TR-3.1)', () => {
  it('合法 Contract 通过（含 http.within_run 且运行上下文带 run_started_at）', () => {
    const r = validateContract(validContract, {
      runtimeContext: { runStartedAt: '2026-10-12T08:00:00.000Z' },
    });
    expect(r.valid, JSON.stringify(r.violations)).toBe(true);
  });

  it('静态校验（无运行上下文）也通过：run_started_at 由 runner 启动时注入', () => {
    const r = validateContract(validContract);
    expect(r.valid, JSON.stringify(r.violations)).toBe(true);
  });

  it('规则1：缺 goal / assertions / base_url / credentials_ref 被拒绝', () => {
    const missingGoal = { ...validContract, goal: '' };
    expect(hasRule(violationsOf(missingGoal), 'R1-required')).toBe(true);

    const missingBaseUrl = {
      ...validContract,
      environment: { action_timeout_ms: 30000 },
    };
    expect(hasRule(violationsOf(missingBaseUrl), 'R1-required')).toBe(true);

    const missingCred = { ...validContract, identity: { role: 'operator' } };
    expect(hasRule(violationsOf(missingCred), 'R1-required')).toBe(true);
  });

  it('规则2：无任何断言被拒绝（runner 不自创正确性标准）', () => {
    const noAssertions = { ...validContract, assertions: {} };
    expect(hasRule(violationsOf(noAssertions), 'R2-no-assertions')).toBe(true);

    const emptyArrays = {
      ...validContract,
      assertions: { dom: [], http: [], backend: [], state: [] },
    };
    expect(hasRule(violationsOf(emptyArrays), 'R2-no-assertions')).toBe(true);
  });

  it('规则3：凭据字面量命中敏感键正则被拒绝，cred:// 与 @fixture 引用放行', () => {
    const literalPassword = {
      ...validContract,
      metadata: { owner: 'qa', password: 'hunter2' },
    };
    expect(hasRule(violationsOf(literalPassword), 'R3-credential-literal')).toBe(true);

    const nestedToken = {
      ...validContract,
      metadata: { db: { api_token: 'abc123' } },
    };
    expect(hasRule(violationsOf(nestedToken), 'R3-credential-literal')).toBe(true);

    const fixtureRef = {
      ...validContract,
      metadata: { password_ref: '@fixture.login_password' },
    };
    expect(validateContract(fixtureRef).valid).toBe(true);
  });

  it('规则4：irreversible 步骤缺 postcondition 被拒绝', () => {
    const bad = {
      ...validContract,
      steps: [{ intent: '提交', action: 'click', target: '确认按钮', risk: 'irreversible' }],
    };
    expect(hasRule(violationsOf(bad), 'R4-irreversible-postcondition')).toBe(true);
  });

  it('规则4：postcondition 为空数组也拒绝', () => {
    const bad = {
      ...validContract,
      steps: [
        {
          intent: '提交',
          action: 'click',
          target: '确认按钮',
          risk: 'irreversible',
          postcondition: [],
        },
      ],
    };
    expect(hasRule(violationsOf(bad), 'R4-irreversible-postcondition')).toBe(true);
  });

  it('规则5：封闭动作集之外的 action 被拒绝', () => {
    const bad = {
      ...validContract,
      steps: [{ intent: '悬停', action: 'hover', target: '菜单', risk: 'reversible' }],
    };
    expect(hasRule(violationsOf(bad), 'R5-action-set')).toBe(true);
  });

  it('规则6：DOM 断言非 7 个封闭原语被拒绝', () => {
    const bad = {
      ...validContract,
      assertions: { dom: [{ kind: 'contains_text', target: '单元格' }] },
    };
    expect(hasRule(violationsOf(bad), 'R6-assertion-primitive')).toBe(true);
  });

  it('规则7：target 含 CSS/XPath/JS 特征被拒绝（# . // >> () 与点选择器）', () => {
    const cssId = {
      ...validContract,
      steps: [{ intent: 'x', action: 'click', target: '#submit-btn', risk: 'reversible' }],
    };
    expect(hasRule(violationsOf(cssId), 'R7-no-selector')).toBe(true);

    const cssClass = {
      ...validContract,
      steps: [{ intent: 'x', action: 'click', target: '.btn.primary', risk: 'reversible' }],
    };
    expect(hasRule(violationsOf(cssClass), 'R7-no-selector')).toBe(true);

    const xpath = {
      ...validContract,
      steps: [{ intent: 'x', action: 'click', target: '//button[@id="ok"]', risk: 'reversible' }],
    };
    expect(hasRule(violationsOf(xpath), 'R7-no-selector')).toBe(true);

    const domAssertion = {
      ...validContract,
      assertions: { dom: [{ kind: 'visible', target: 'row >> span.name' }] },
    };
    expect(hasRule(violationsOf(domAssertion), 'R7-no-selector')).toBe(true);

    const postcondition = {
      ...validContract,
      steps: [
        {
          intent: '提交',
          action: 'click',
          target: '确认按钮',
          risk: 'irreversible',
          postcondition: [{ kind: 'visible', target: 'div.confirm()' }],
        },
      ],
    };
    expect(hasRule(violationsOf(postcondition), 'R7-no-selector')).toBe(true);
  });

  it('规则8：id 非 kebab-case 或批次内重复被拒绝', () => {
    const badFormat = {
      ...validContract,
      test: { id: 'Workload Create', name: 'x' },
    };
    expect(hasRule(violationsOf(badFormat), 'R8-id-unique')).toBe(true);

    const duplicate = violationsOf(validContract, { knownIds: ['workload.create'] });
    expect(hasRule(duplicate, 'R8-id-unique')).toBe(true);
  });

  it('规则9：http.within_run=true 但运行上下文无 run_started_at 注入点被拒绝', () => {
    const noWindow = violationsOf(validContract, { runtimeContext: {} });
    expect(hasRule(noWindow, 'R9-within-run-window')).toBe(true);

    const withWindow = validateContract(validContract, {
      runtimeContext: { runStartedAt: '2026-10-12T08:00:00.000Z' },
    });
    expect(withWindow.valid).toBe(true);
  });

  it('规则9：无 within_run 断言时不要求 run_started_at', () => {
    const noHttp = { ...validContract, assertions: { dom: validContract.assertions.dom } };
    const r = validateContract(noHttp, { runtimeContext: {} });
    expect(r.valid, JSON.stringify(r.violations)).toBe(true);
  });

  it('JSON Schema 结构违规同样以配置错误类别返回', () => {
    const r = validateContract({ version: '1', goal: '残缺对象' });
    expect(r.valid).toBe(false);
    expect(r.errorCategory).toBe('config');
  });

  it('每条违规都带可读 message 与定位 path', () => {
    const r = validateContract(
      { ...validContract, assertions: {} },
      { runtimeContext: {} },
    );
    expect(r.valid).toBe(false);
    for (const v of r.violations) {
      expect(typeof v.message).toBe('string');
      expect(v.message.length).toBeGreaterThan(0);
      expect(typeof v.path).toBe('string');
    }
  });
});
