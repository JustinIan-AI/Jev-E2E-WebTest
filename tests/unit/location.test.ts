import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type {
  EngineProvider,
  ResolveResult,
  SemanticTarget,
} from '../../src/engine-provider/index.js';
import { resolveDeterministic } from '../../src/runtime/resolve.js';
import {
  ensureFresh,
  type FreshnessCapable,
} from '../../src/runtime/freshness.js';
import {
  composeDomPath,
  fingerprintsEqual,
} from '../../src/engine-provider/playwright/fingerprint.js';

type Provider = EngineProvider & FreshnessCapable;

function fakeProvider(script: Array<ResolveResult | 'stale' | 'fresh'>): {
  provider: Provider;
  resolveCalls: Array<{ target: SemanticTarget; mode: 'L1' | 'L2' }>;
} {
  const resolveCalls: Array<{ target: SemanticTarget; mode: 'L1' | 'L2' }> = [];
  const provider = {
    id: 'fake',
    version: 'fake-1',
    resolve: vi.fn(async (target: SemanticTarget, mode: 'L1' | 'L2') => {
      resolveCalls.push({ target, mode });
      const next = script.shift();
      if (next === 'stale' || next === 'fresh') {
        throw new Error('test script misconfigured');
      }
      return next as ResolveResult;
    }),
    verifyFreshness: vi.fn(async () => {
      const next = script.shift();
      return next === 'fresh';
    }),
  } as unknown as Provider;
  return { provider, resolveCalls };
}

const fpTarget: SemanticTarget = {
  role: 'link',
  name: '工作负载',
  fingerprint: {
    dom_path_hash: 'sha1:deadbeef',
    sibling_ordinal: 2,
    anchor_text: ['集群管理'],
  },
};

describe('resolveDeterministic —— L1 → L2 严格串行（§3.3，TR-5.1）', () => {
  it('L1 命中 1 个 → resolved，不调用 L2', async () => {
    const { provider, resolveCalls } = fakeProvider([
      { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'role' },
    ]);
    const r = await resolveDeterministic(provider, fpTarget);
    expect(r.status).toBe('resolved');
    expect(resolveCalls.map((c) => c.mode)).toEqual(['L1']);
  });

  it('L1 匹配 0 且带指纹 → 进入 L2（禁止并行试探）', async () => {
    const { provider, resolveCalls } = fakeProvider([
      { status: 'miss' },
      { status: 'resolved', mode: 'L2', elementId: 'el-2', strategy: 'fingerprint' },
    ]);
    const r = await resolveDeterministic(provider, fpTarget);
    expect(r.status).toBe('resolved');
    expect(r.strategy).toBe('fingerprint');
    expect(resolveCalls.map((c) => c.mode)).toEqual(['L1', 'L2']);
  });

  it('★ L1 匹配 >1（ambiguous）立即终止，绝不降级到 L2（硬规则 1：歧义 ≠ 未命中）', async () => {
    const { provider, resolveCalls } = fakeProvider([{ status: 'ambiguous', count: 2 }]);
    const r = await resolveDeterministic(provider, fpTarget);
    expect(r.status).toBe('ambiguous');
    expect(r.count).toBe(2);
    expect(resolveCalls.map((c) => c.mode)).toEqual(['L1']);
  });

  it('L1 miss 且无指纹 → 直接 miss（L3 是 Task 12 的唯一模型介入点）', async () => {
    const { provider, resolveCalls } = fakeProvider([{ status: 'miss' }]);
    const r = await resolveDeterministic(provider, { role: 'button', name: '保存' });
    expect(r.status).toBe('miss');
    expect(resolveCalls.map((c) => c.mode)).toEqual(['L1']);
  });

  it('L2 仍 miss → miss（交由上层决定 BLOCKED(decision) / L3）', async () => {
    const { provider } = fakeProvider([{ status: 'miss' }, { status: 'miss' }]);
    const r = await resolveDeterministic(provider, fpTarget);
    expect(r.status).toBe('miss');
  });
});

describe('ensureFresh —— 只重解析一次，仍失效即 BLOCKED(drift)（§6.1③，TR-5.2）', () => {
  const initial: ResolveResult = {
    status: 'resolved',
    mode: 'L1',
    elementId: 'el-1',
    strategy: 'role',
  };

  it('首次 Freshness 通过 → fresh，不触发重解析', async () => {
    const { provider } = fakeProvider(['fresh']);
    const out = await ensureFresh(provider, fpTarget, initial);
    expect(out.outcome).toBe('fresh');
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it('失效 → 重解析一次且新快照新鲜 → fresh（第二次解析的 elementId 生效）', async () => {
    const { provider } = fakeProvider([
      'stale',
      { status: 'resolved', mode: 'L1', elementId: 'el-2', strategy: 'role' },
      'fresh',
    ]);
    const out = await ensureFresh(provider, fpTarget, initial);
    expect(out.outcome).toBe('fresh');
    expect(provider.resolve).toHaveBeenCalledTimes(1);
    if (out.outcome === 'fresh') expect(out.resolved.elementId).toBe('el-2');
  });

  it('失效 → 重解析后仍陈旧 → drift（不再有第三次解析）', async () => {
    const { provider } = fakeProvider([
      'stale',
      { status: 'resolved', mode: 'L2', elementId: 'el-9', strategy: 'fingerprint' },
      'stale',
    ]);
    const out = await ensureFresh(provider, fpTarget, initial);
    expect(out.outcome).toBe('drift');
    expect(provider.resolve).toHaveBeenCalledTimes(1);
    expect(provider.verifyFreshness).toHaveBeenCalledTimes(2);
  });

  it('失效 → 重解析为 ambiguous/miss → drift（歧义/未命中不得自愈）', async () => {
    const { provider } = fakeProvider(['stale', { status: 'ambiguous', count: 3 }]);
    const out = await ensureFresh(provider, fpTarget, initial);
    expect(out.outcome).toBe('drift');
    // 重解析未 resolved，不得再做第二次 Freshness 探测
    expect(provider.verifyFreshness).toHaveBeenCalledTimes(1);
  });
});

describe('指纹工具（§3.3 / §5.5.5）', () => {
  it('composeDomPath：路径段以 > 拼接（dom_path_hash 的输入约定）', () => {
    expect(composeDomPath(['section0', 'nav0', 'a2'])).toBe('section0>nav0>a2');
    const expected = `sha1:${createHash('sha1').update('section0>nav0>a2', 'utf8').digest('hex')}`;
    expect(
      `sha1:${createHash('sha1').update(composeDomPath(['section0', 'nav0', 'a2']), 'utf8').digest('hex')}`,
    ).toBe(expected);
  });

  it('fingerprintsEqual：dom_path_hash + sibling_ordinal + anchor_text 全等才命中（误命中比不命中更危险）', () => {
    const base = {
      dom_path_hash: 'sha1:aa',
      sibling_ordinal: 2,
      anchor_text: ['集群管理'],
    };
    expect(fingerprintsEqual(base, { ...base })).toBe(true);
    expect(fingerprintsEqual(base, { ...base, sibling_ordinal: 3 })).toBe(false);
    expect(fingerprintsEqual(base, { ...base, dom_path_hash: 'sha1:bb' })).toBe(false);
    expect(
      fingerprintsEqual(base, { ...base, anchor_text: ['系统管理'] }),
    ).toBe(false);
    // role/name 不参与指纹相等性 —— L2 正是用于名称已漂移的场景
    expect(
      fingerprintsEqual(base, { ...base, role: 'link', name: '工作负载（新）' }),
    ).toBe(true);
  });
});
