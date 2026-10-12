import { describe, expect, it } from 'vitest';
import {
  computeBindings,
  hashContract,
  hashStrategyContent,
  type BindingCheckInput,
  type BindingEnv,
} from '../../src/runtime/bindings/hash.js';
import {
  checkBeforeFreeze,
  checkAtRunStart,
  checkBeforeReplayVerify,
} from '../../src/runtime/bindings/check.js';

const HASH_A = 'sha256:' + 'a'.repeat(64);
const HASH_B = 'sha256:' + 'b'.repeat(64);

const contract = {
  version: '1',
  test: { id: 'workload.create', name: 'n' },
  goal: 'g',
};

const env: BindingEnv = {
  browserVersion: 'Chrome/130.0.6723.91',
  targetOrigin: 'https://example.com',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
};

const bindingInput: BindingCheckInput = {
  contract,
  strategyContent: { flows: [{ step_index: 0, strategy: 'role' }] },
  judgeImplSource: 'export const judge = () => "PASS";\n',
  runnerVersion: '0.1.0',
  env,
  engineProviderVersion: 'playwright@1.49.0',
};

function storedBindings(overrides: Partial<BindingCheckInput> = {}) {
  return computeBindings({ ...bindingInput, ...overrides });
}

describe('六重绑定哈希 (TR-3.2)', () => {
  it('computeBindings 返回全部六个绑定项', () => {
    const b = computeBindings(bindingInput);
    expect(Object.keys(b).sort()).toEqual(
      [
        'contract_hash',
        'engine_provider_version',
        'env_fingerprint',
        'judge_impl_hash',
        'runner_version',
        'strategy_hash',
      ].sort(),
    );
    for (const key of ['contract_hash', 'strategy_hash', 'judge_impl_hash', 'env_fingerprint']) {
      expect(b[key as keyof typeof b]).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('哈希规范化、确定性：键顺序与无关空白不改变结果', () => {
    const reordered = hashContract({ goal: 'g', test: contract.test, version: '1' });
    const normal = hashContract(contract);
    expect(reordered).toBe(normal);

    expect(hashStrategyContent({ flows: [{ strategy: 'role', step_index: 0 }] })).toBe(
      hashStrategyContent({ flows: [{ step_index: 0, strategy: 'role' }] }),
    );
  });

  it('contract 内容任一字节变化 → contract_hash 改变', () => {
    expect(hashContract(contract)).not.toBe(hashContract({ ...contract, goal: 'changed' }));
  });

  it('judge 源码 / 环境 / runner / engine 任一变化 → 对应绑定项改变', () => {
    const base = computeBindings(bindingInput);
    expect(computeBindings({ ...bindingInput, judgeImplSource: '// v2\n' }).judge_impl_hash)
      .not.toBe(base.judge_impl_hash);
    expect(
      computeBindings({ ...bindingInput, env: { ...env, browserVersion: 'Chrome/131.0.0.0' } })
        .env_fingerprint,
    ).not.toBe(base.env_fingerprint);
    expect(computeBindings({ ...bindingInput, runnerVersion: '0.2.0' }).runner_version).not.toBe(
      base.runner_version,
    );
    expect(
      computeBindings({ ...bindingInput, engineProviderVersion: 'playwright@1.50.0' })
        .engine_provider_version,
    ).not.toBe(base.engine_provider_version);
  });
});

describe('作用点1：run 启动 (TR-3.2)', () => {
  it('完全一致 → compatible，无告警', () => {
    const r = checkAtRunStart({ current: storedBindings(), stored: storedBindings() });
    expect(r.decision).toBe('compatible');
    expect(r.driftedKeys).toEqual([]);
  });

  it('任一绑定项不一致 → downgrade_l1_l3（禁用 L2）并列出漂移键与告警', () => {
    const r = checkAtRunStart({
      current: storedBindings(),
      stored: storedBindings({ engineProviderVersion: 'playwright@1.50.0' }),
    });
    expect(r.decision).toBe('downgrade_l1_l3');
    expect(r.driftedKeys).toContain('engine_provider_version');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('strategy 自身被手工改动 → strategy_hash 漂移同样降级', () => {
    const r = checkAtRunStart({
      current: storedBindings(),
      stored: { ...storedBindings(), strategy_hash: HASH_B },
    });
    expect(r.decision).toBe('downgrade_l1_l3');
    expect(r.driftedKeys).toContain('strategy_hash');
  });
});

describe('作用点2：固化前 --freeze (TR-3.2)', () => {
  it('一致 → allow_freeze', () => {
    const r = checkBeforeFreeze({ current: storedBindings(), stored: storedBindings() });
    expect(r.decision).toBe('allow_freeze');
  });

  it('任一绑定项不一致 → reject_freeze 并给出 diff（防写错 Contract 的经验）', () => {
    const r = checkBeforeFreeze({
      current: storedBindings(),
      stored: { ...storedBindings(), contract_hash: HASH_B },
    });
    expect(r.decision).toBe('reject_freeze');
    expect(r.driftedKeys).toContain('contract_hash');
    expect(r.diff.length).toBeGreaterThan(0);
    const row = r.diff.find((d) => d.key === 'contract_hash');
    expect(row?.stored).toBe(HASH_B);
  });

  it('engine_provider_version 漂移也拒绝固化', () => {
    const r = checkBeforeFreeze({
      current: storedBindings(),
      stored: storedBindings({ engineProviderVersion: 'e2e@0.18.0' }),
    });
    expect(r.decision).toBe('reject_freeze');
    expect(r.driftedKeys).toContain('engine_provider_version');
  });
});

describe('作用点3：replay --verify 前 (TR-3.2)', () => {
  it('一致 → 允许开始回放', () => {
    const r = checkBeforeReplayVerify({ current: storedBindings(), stored: storedBindings() });
    expect(r.decision).toBe('proceed');
  });

  it('任一绑定项漂移 → BLOCKED(drift)，不开始回放', () => {
    const r = checkBeforeReplayVerify({
      current: storedBindings(),
      stored: { ...storedBindings(), judge_impl_hash: HASH_A === storedBindings().judge_impl_hash ? HASH_B : HASH_A },
    });
    expect(r.decision).toBe('blocked_drift');
    expect(r.blockedReason).toBe('drift');
    expect(r.driftedKeys.length).toBeGreaterThan(0);
  });

  it('环境指纹漂移（浏览器升级）→ BLOCKED(drift)', () => {
    const r = checkBeforeReplayVerify({
      current: storedBindings(),
      stored: storedBindings({ env: { ...env, timezone: 'UTC' } }),
    });
    expect(r.decision).toBe('blocked_drift');
    expect(r.driftedKeys).toContain('env_fingerprint');
  });
});
