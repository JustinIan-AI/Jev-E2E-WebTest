import { describe, expect, it } from 'vitest';
import { validate } from '../../src/schema/loader.js';

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
  ],
  assertions: {
    dom: [{ kind: 'visible', target: 'deployment-name-cell', text_contains: 'idwth-run-cid' }],
  },
};

describe('contract schema', () => {
  it('accepts a valid contract', () => {
    const r = validate('contract', validContract);
    expect(r.valid, JSON.stringify(r.errors)).toBe(true);
  });

  it('rejects missing required top-level fields', () => {
    const { assertions: _a, ...missing } = validContract as Record<string, unknown>;
    const r = validate('contract', missing);
    expect(r.valid).toBe(false);
  });

  it('rejects irreversible step without postcondition', () => {
    const bad = {
      ...validContract,
      steps: [{ intent: '提交', action: 'click', target: '确认按钮', risk: 'irreversible' }],
    };
    const r = validate('contract', bad);
    expect(r.valid).toBe(false);
  });

  it('rejects plaintext credentials', () => {
    const bad = {
      ...validContract,
      identity: { role: 'operator', credentials_ref: 'pa$$w0rd' },
    };
    const r = validate('contract', bad);
    expect(r.valid).toBe(false);
  });

  it('rejects unknown action kind', () => {
    const bad = {
      ...validContract,
      steps: [{ intent: 'x', action: 'hover', target: 'y', risk: 'reversible' }],
    };
    const r = validate('contract', bad);
    expect(r.valid).toBe(false);
  });
});
