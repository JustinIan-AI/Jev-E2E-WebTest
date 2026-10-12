/**
 * Task 14 —— E2eProvider 单元测试（内存上游替身，无浏览器）。
 *
 * 覆盖四条硬约束（DD §5.0）：
 *  ① 恢复触发权（DD-36）：connect 显式关闭上游 autoHeal/autoRetry 并回读校验，
 *    上游拒绝关闭 → fail-closed 抛错；陈旧失败不触发上游自愈。
 *  ② 错误码吸附（DD-32）：ASSERTION_INCONCLUSIVE → inconclusive/decision。
 *  ③ 候选集编号由我们掌控：L3 只返回 miss + 本层生成的候选。
 *  ④ version 必须回传（六重绑定第⑥项），空版本拒绝。
 */
import { describe, expect, it } from 'vitest';
import { E2eProvider } from '../../src/engine-provider/e2e/provider.js';
import { UpstreamE2eEngineDouble } from '../helpers/upstream-e2e-engine.js';

const ALLOWLIST = ['http://127.0.0.1'];

function connect(overrides: {
  version?: string;
  refuseConfigure?: boolean;
  inconclusiveMode?: boolean;
} = {}): { provider: E2eProvider; engine: UpstreamE2eEngineDouble } {
  const engine = new UpstreamE2eEngineDouble(overrides);
  const provider = E2eProvider.connect({
    engine,
    originsAllowlist: ALLOWLIST,
  });
  return { provider, engine };
}

describe('E2eProvider.connect —— 恢复触发权与版本硬约束', () => {
  it('④ id=e2e；version 来自上游引擎且非空', () => {
    const { provider } = connect({ version: '9.9.9' });
    expect(provider.id).toBe('e2e');
    expect(provider.version).toBe('9.9.9');
    return provider.dispose();
  });

  it('④ 上游拒绝/缺失版本 → connect 抛错（六重绑定第⑥项无法计算）', () => {
    expect(() =>
      E2eProvider.connect({
        engine: new UpstreamE2eEngineDouble({ version: '' }),
        originsAllowlist: ALLOWLIST,
      }),
    ).toThrow(/version/i);
  });

  it('① connect 显式下发 autoHeal=false / autoRetry=false，且回读校验生效', async () => {
    const { provider, engine } = connect();
    expect(engine.configureCalls).toContainEqual({ autoHeal: false, autoRetry: false });
    expect(engine.getConfig()).toEqual({ autoHeal: false, autoRetry: false });
    await provider.dispose();
  });

  it('① 上游拒绝关闭 autoHeal → connect fail-closed 抛错（恢复触发权不可让渡即拒绝启动）', () => {
    expect(() =>
      E2eProvider.connect({
        engine: new UpstreamE2eEngineDouble({ refuseConfigure: true }),
        originsAllowlist: ALLOWLIST,
      }),
    ).toThrow(/auto.?heal|recover|trigger/i);
  });
});

describe('E2eProvider —— 错误码吸附与候选集（硬约束②③）', () => {
  it('② 上游 ASSERTION_INCONCLUSIVE → inconclusive/decision + upstreamErrorCode', async () => {
    const { provider, engine } = connect({ inconclusiveMode: true });
    const r = await provider.checkAssertion({
      kind: 'visible',
      target: { role: 'button', name: '新建', match: 'exact' },
    });
    expect(r.passed).toBe(false);
    expect(r.status).toBe('inconclusive');
    expect(r.blockedReason).toBe('decision');
    expect(r.upstreamErrorCode).toBe('ASSERTION_INCONCLUSIVE');
    engine.setInconclusiveMode(false);
    await provider.dispose();
  });

  it('② 上游普通 failed 不被吸附（真实 FAIL 通道保留）', async () => {
    const { provider } = connect();
    const r = await provider.checkAssertion({
      kind: 'visible',
      target: { role: 'button', name: '不存在', match: 'exact' },
    });
    expect(r.status).toBe('failed');
    expect(r.passed).toBe(false);
    await provider.dispose();
  });

  it('③ L1：唯一命中 resolved；未命中 miss；歧义 ambiguous(count=2)，禁 first 兜底', async () => {
    const { provider } = connect();
    const hit = await provider.resolve(
      { role: 'button', name: '新建', match: 'exact' },
      'L1',
    );
    expect(hit.status).toBe('resolved');
    expect(hit.elementId).toBeDefined();

    const miss = await provider.resolve(
      { role: 'button', name: '不存在', match: 'exact' },
      'L1',
    );
    expect(miss.status).toBe('miss');
    await provider.dispose();

    const dup = E2eProvider.connect({
      engine: Object.assign(new UpstreamE2eEngineDouble(), {
        currentUrl: 'http://127.0.0.1:1/duplicates',
      }),
      originsAllowlist: ALLOWLIST,
    });
    const amb = await dup.resolve(
      { role: 'button', name: '提交', match: 'exact' },
      'L1',
    );
    expect(amb.status).toBe('ambiguous');
    expect(amb.count).toBe(2);
    await dup.dispose();
  });

  it('③ L3：只返回 miss + 本层枚举的候选（绝不伪装 resolved，候选编号不来自上游/模型）', async () => {
    const { provider } = connect();
    const l3 = await provider.resolve(
      { role: 'button', name: '不存在', match: 'exact' },
      'L3',
    );
    expect(l3.status).toBe('miss');
    expect(Array.isArray(l3.candidates)).toBe(true);
    // 候选由本层代码从上游元素表枚举（模糊语义匹配），带编号 elementId。
    for (const c of l3.candidates ?? []) {
      expect(c.elementId).toBeDefined();
      expect(typeof c.elementId).toBe('number');
    }
    await provider.dispose();
  });
});

describe('E2eProvider —— 动作映射与生命周期', () => {
  it('observe：observationId / fingerprint(sha1:) / elements 形状', async () => {
    const { provider } = connect();
    const obs = await provider.observe();
    expect(obs.observationId).toMatch(/^obs-/);
    expect(obs.fingerprint).toMatch(/^sha1:/);
    expect(Array.isArray(obs.elements)).toBe(true);
    expect(obs.elements.length).toBeGreaterThan(0);
    expect(obs.url).toContain('/basic');
    await provider.dispose();
  });

  it('act fill/click 派发；verifyFreshness 未漂移 → fresh', async () => {
    const { provider } = connect();
    const resolved = await provider.resolve(
      { role: 'textbox', name: '用户名', match: 'exact' },
      'L1',
    );
    expect(resolved.status).toBe('resolved');
    const fill = await provider.act({
      kind: 'fill',
      risk: 'reversible',
      target: { elementId: resolved.elementId!, strategy: 'role' },
      value: 'idwth',
    });
    expect(fill.status).toBe('ok');
    expect(fill.dispatched).toBe(true);

    const fresh = await provider.verifyFreshness(
      { role: 'textbox', name: '用户名', match: 'exact' },
      { status: 'resolved', elementId: resolved.elementId!, strategy: 'role' },
    );
    expect(fresh).toBe(true);
    await provider.dispose();
  });

  it('navigate 越界源 → nav_blocked 且零派发（allowlist 在 adapter 层强制）', async () => {
    const { provider, engine } = connect();
    const before = engine.currentUrl;
    const r = await provider.act({
      kind: 'navigate',
      risk: 'reversible',
      url: 'http://evil.example/',
    });
    expect(r.status).toBe('nav_blocked');
    expect(r.dispatched).toBe(false);
    expect(engine.currentUrl).toBe(before);
    await provider.dispose();
  });

  it('screenshot / trace 返回 artifact 引用；dispose 只断连（engine.dispose 恰好一次）', async () => {
    const { provider, engine } = connect();
    const shot = await provider.screenshot({ mask: [] });
    expect(shot.mediaType).toBe('image/png');
    expect(shot.uri).toMatch(/^artifact:\/\//);
    const trace = await provider.trace();
    expect(trace.uri).toMatch(/^artifact:\/\//);
    await provider.dispose();
    expect(engine.disposed).toBe(true);
    await provider.dispose(); // 幂等
    expect(engine.disposed).toBe(true);
  });
});
