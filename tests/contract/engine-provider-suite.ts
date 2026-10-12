/**
 * Task 14 / TR-14.1 —— EngineProvider 共享契约套件。
 *
 * e2e（内存上游替身）与 Playwright（真实 Chrome）**必须通过同一套**断言；
 * 切换 Provider 时判定内核（executor / Judge）看到的行为形状完全一致。
 * 套件只断言契约（形状 + 语义），不关心引擎实现细节。
 */
import { expect } from 'vitest';
import type { EngineProvider, SemanticTarget } from '../../src/engine-provider/index.js';

export interface ContractTargets {
  /** basic 页唯一文本框。 */
  textbox: SemanticTarget;
  /** basic 页唯一按钮。 */
  button: SemanticTarget;
  /** 不存在的目标。 */
  missing: SemanticTarget;
  /** duplicates 页的重复按钮（歧义）。 */
  duplicate: SemanticTarget;
}

export interface ProviderContractHarness {
  /** 已定位到 basic 页（唯一元素）的 provider。 */
  connect(): Promise<EngineProvider>;
  /** 已定位到 duplicates 页（两个同名按钮）的 provider。 */
  connectAmbiguous(): Promise<EngineProvider>;
  targets: ContractTargets;
  /** 越界导航目标（allowlist 之外）。 */
  blockedUrl: string;
}

/**
 * 契约套件主体：在任一 EngineProvider 实现上顺序执行全部契约断言。
 * 任一断言失败即该实现违反契约。
 */
export async function runEngineProviderContractSuite(
  h: ProviderContractHarness,
): Promise<void> {
  // ── ① id / version 契约（六重绑定第⑥项来源）。 ──
  {
    const p = await h.connect();
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
    expect(typeof p.version).toBe('string');
    expect(p.version.length).toBeGreaterThan(0);
    await p.dispose();
  }

  // ── ② observe 形状：observationId / fingerprint / elements。 ──
  {
    const p = await h.connect();
    const obs = await p.observe();
    expect(obs.observationId).toMatch(/^obs-/);
    expect(obs.fingerprint).toMatch(/^sha1:/);
    expect(Array.isArray(obs.elements)).toBe(true);
    expect(obs.elements.length).toBeGreaterThan(0);
    for (const el of obs.elements) {
      expect(typeof el.id).toBe('number');
      expect(typeof el.role).toBe('string');
      expect(typeof el.name).toBe('string');
      expect(typeof el.visible).toBe('boolean');
      expect(typeof el.enabled).toBe('boolean');
      expect(typeof el.guard).toBe('string');
    }
    await p.dispose();
  }

  // ── ③ L1 唯一命中 → resolved（带 elementId / mode / strategy）。 ──
  {
    const p = await h.connect();
    const r = await p.resolve(h.targets.button, 'L1');
    expect(r.status).toBe('resolved');
    expect(r.mode).toBe('L1');
    expect(r.elementId).toBeDefined();
    expect(r.strategy).toBeDefined();
    await p.dispose();
  }

  // ── ④ L1 未命中 → miss（不抛异常、不兜底）。 ──
  {
    const p = await h.connect();
    const r = await p.resolve(h.targets.missing, 'L1');
    expect(r.status).toBe('miss');
    expect(r.elementId).toBeUndefined();
    await p.dispose();
  }

  // ── ⑤ L1 歧义 → ambiguous + count=2（禁 .first 兜底）。 ──
  {
    const p = await h.connectAmbiguous();
    const r = await p.resolve(h.targets.duplicate, 'L1');
    expect(r.status).toBe('ambiguous');
    expect(r.count).toBe(2);
    expect(r.elementId).toBeUndefined();
    await p.dispose();
  }

  // ── ⑥ L3 契约：只返回 miss + 本层枚举的候选（绝不伪装 resolved）。 ──
  {
    const p = await h.connect();
    const r = await p.resolve(h.targets.missing, 'L3');
    expect(r.status).toBe('miss');
    expect(Array.isArray(r.candidates)).toBe(true);
    for (const c of r.candidates ?? []) {
      expect(c.elementId).toBeDefined();
      expect(c.strategy).toBeDefined();
    }
    await p.dispose();
  }

  // ── ⑦ act fill / click 可派发。 ──
  {
    const p = await h.connect();
    const resolved = await p.resolve(h.targets.textbox, 'L1');
    expect(resolved.status).toBe('resolved');
    const fill = await p.act({
      kind: 'fill',
      risk: 'reversible',
      target: { elementId: resolved.elementId!, strategy: 'role' },
      value: 'idwth',
    });
    expect(fill.status).toBe('ok');
    expect(fill.dispatched).toBe(true);

    const btn = await p.resolve(h.targets.button, 'L1');
    const click = await p.act({
      kind: 'click',
      risk: 'reversible',
      target: { elementId: btn.elementId!, strategy: 'role' },
    });
    expect(click.status).toBe('ok');
    expect(click.dispatched).toBe(true);
    await p.dispose();
  }

  // ── ⑧ checkAssertion visible / count / value 三原语可求值。 ──
  {
    const p = await h.connect();
    const visible = await p.checkAssertion({ kind: 'visible', target: h.targets.button });
    expect(visible.passed).toBe(true);
    expect(visible.status).toBe('passed');

    const count = await p.checkAssertion({
      kind: 'count',
      target: h.targets.button,
      expected: 1,
    });
    expect(count.passed).toBe(true);

    const box = await p.resolve(h.targets.textbox, 'L1');
    await p.act({
      kind: 'fill',
      risk: 'reversible',
      target: { elementId: box.elementId!, strategy: 'role' },
      value: 'idwth',
    });
    const value = await p.checkAssertion({
      kind: 'value',
      target: h.targets.textbox,
      expected: 'idwth',
    });
    expect(value.passed).toBe(true);
    await p.dispose();
  }

  // ── ⑨ navigate 越界 → nav_blocked 且零派发（allowlist 在 provider 层强制）。 ──
  {
    const p = await h.connect();
    const r = await p.act({
      kind: 'navigate',
      risk: 'reversible',
      url: h.blockedUrl,
    });
    expect(r.status).toBe('nav_blocked');
    expect(r.dispatched).toBe(false);
    await p.dispose();
  }

  // ── ⑩ screenshot / trace 产物引用形状。 ──
  {
    const p = await h.connect();
    const shot = await p.screenshot({ mask: [] });
    expect(shot.mediaType).toBe('image/png');
    expect(shot.uri).toMatch(/^artifact:\/\//);
    const trace = await p.trace();
    expect(trace.uri).toMatch(/^artifact:\/\//);
    await p.dispose();
  }

  // ── ⑪ dispose 幂等且不抛（只断连语义）。 ──
  {
    const p = await h.connect();
    await p.dispose();
    await expect(p.dispose()).resolves.toBeUndefined();
  }
}
