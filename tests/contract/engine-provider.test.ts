import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  PlaywrightProvider,
  type EngineProvider,
  type SemanticTarget,
} from '../../src/engine-provider/index.js';
import { resolveDeterministic } from '../../src/runtime/resolve.js';
import { ensureFresh } from '../../src/runtime/freshness.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';

const PAGES: Record<string, string> = {
  '/button': `<!doctype html><html><body>
    <h1>表单</h1>
    <label>用户名 <input id="user" type="text" /></label>
    <button id="go">新建</button>
  </body></html>`,
  '/two': `<!doctype html><html><body>
    <button>提交</button><button>提交</button>
  </body></html>`,
  '/seed': `<!doctype html><html><body>
    <div id="cluster">none</div>
    <script>document.getElementById('cluster').textContent =
      sessionStorage.getItem('cluster') ?? 'none';</script>
  </body></html>`,
  // L2 指纹夹具：两个 fieldset，各自 legend 提供稳定锚文本；链接可改名模拟名称漂移。
  '/fp': `<!doctype html><html><body>
    <fieldset><legend>集群管理</legend><nav>
      <a href="#wl">工作负载</a><a href="#node">节点</a>
    </nav></fieldset>
    <fieldset><legend>系统管理</legend><nav>
      <a href="#user">用户</a><a href="#role">角色</a>
    </nav></fieldset>
  </body></html>`,
  // Freshness 夹具：目标按钮在 form 子树内；#rows 是子树外的动态校验行挂载点。
  '/fresh': `<!doctype html><html><body>
    <main><form id="f">
      <label>名称 <input id="name" type="text" /></label>
      <button id="save" type="button">保存</button>
    </form><div id="rows"></div></main>
  </body></html>`,
};

/**
 * TR-4.1 / TR-4.2 / AC-14 / AC-17。
 * 使用真实 Chromium（以「用户已启动、带 --remote-debugging-port」方式拉起），
 * 通过 CDP 接管，验证：复用上下文 / 后台标签页不抢焦点 / 强隔离 + SPA 上下文引导 /
 * dispose 只断连不杀浏览器。同一套契约后续也套在 e2e Provider 上（Task 14）。
 */
describe('PlaywrightProvider over CDP —— Provider 契约 (TR-4.1 / TR-4.2)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome;
  let rawBrowser: Browser;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = PAGES[req.url ?? '/'] ?? '<!doctype html><html><body>ok</body></html>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    chrome = await launchCdpChrome();
    rawBrowser = await chromium.connectOverCDP(chrome.cdpEndpoint, { timeout: 15_000 });
  });

  afterAll(async () => {
    await rawBrowser.close().catch(() => undefined); // 只断连
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function makeProvider(overrides: {
    storageSeed?: Record<string, string>;
    originsAllowlist?: string[];
  } = {}): Promise<PlaywrightProvider> {
    return PlaywrightProvider.connect({
      cdpEndpoint: chrome.cdpEndpoint,
      ...(overrides.storageSeed ? { storageSeed: overrides.storageSeed } : {}),
      originsAllowlist: overrides.originsAllowlist ?? [baseUrl],
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
  }

  it('id/version：id 为 playwright，version 是非空字面量（参与六重绑定第⑥项）', async () => {
    const provider = await makeProvider();
    expect(provider.id).toBe('playwright');
    expect(typeof provider.version).toBe('string');
    expect(provider.version.length).toBeGreaterThan(0);
    await provider.dispose();
  });

  it('TR-4.1: CDP 接管并复用既有上下文（登录态/标签页均来自用户 Chrome）', async () => {
    const beforePages = rawBrowser.contexts().flatMap((c) => c.pages()).length;

    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/button`);
    expect(page.url()).toContain('/button');

    // 复用既有 context：Provider 没有创建额外的顶层 context，只在用户 context 里加页。
    const afterPages = rawBrowser.contexts().flatMap((c) => c.pages()).length;
    expect(afterPages).toBe(beforePages + 1);
    await provider.dispose();
  });

  it('TR-4.1: 后台标签页不抢焦点 —— 用户当前标签页保持 active', async () => {
    const provider = await makeProvider();
    const front = await provider.openForegroundTab(`${baseUrl}/button`);

    const bg = await provider.openBackgroundTab(`${baseUrl}/seed`);

    const activePage = provider.activePage();
    expect(activePage).toBe(front);
    expect(activePage).not.toBe(bg.page);
    expect(bg.page.url()).toContain('/seed');

    // 后台标签页可独立关闭，不影响前台。
    await bg.close();
    expect(provider.activePage()).toBe(front);
    await front.close().catch(() => undefined);
    await provider.dispose();
  });

  it('TR-4.1: 强隔离 context + addInitScript 注入 SUT 提供的 SPA 键（cluster=host）', async () => {
    // storageSeed 的键由 SUT 适配提供，core 不假定键名。
    const provider = await makeProvider({ storageSeed: { cluster: 'host' } });
    const page = await provider.openIsolatedPage(`${baseUrl}/seed`);

    expect(await page.textContent('#cluster')).toBe('host');
    await provider.dispose();
  });

  it('TR-4.1: 隔离 context 不共享用户 context 的 cookie（强隔离）', async () => {
    const userCtx = rawBrowser.contexts()[0];
    expect(userCtx).toBeDefined();
    await userCtx!.addCookies([
      { name: 'session', value: 'user-secret', domain: '127.0.0.1', path: '/' },
    ]);

    const provider = await makeProvider();
    const page = await provider.openIsolatedPage(`${baseUrl}/seed`);
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { document: any }).document.cookie,
      ),
    ).toBe('');
    await provider.dispose();
  });

  it('navigate 受 originsAllowlist 约束：越界源被拒绝（配置错误路径）', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/button`);
    await expect(
      provider.act({ kind: 'navigate', risk: 'reversible', url: 'http://evil.example/' }),
    ).rejects.toThrow(/allowlist|origin/i);
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('resolve L1：role+name 唯一命中 → resolved；0 命中 → miss；多命中 → ambiguous（禁 .first 兜底）', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/button`);

    const one = await provider.resolve(
      { role: 'button', name: '新建', match: 'exact' },
      'L1',
    );
    expect(one.status).toBe('resolved');
    expect(one.mode).toBe('L1');
    expect(one.elementId).toBeDefined();

    const miss = await provider.resolve(
      { role: 'button', name: '不存在', match: 'exact' },
      'L1',
    );
    expect(miss.status).toBe('miss');
    await page.close().catch(() => undefined);

    const page2 = await provider.openForegroundTab(`${baseUrl}/two`);
    const amb = await provider.resolve(
      { role: 'button', name: '提交', match: 'exact' },
      'L1',
    );
    expect(amb.status).toBe('ambiguous');
    expect(amb.count).toBe(2);
    expect(amb.elementId).toBeUndefined();
    await page2.close().catch(() => undefined);
    await provider.dispose();
  });

  it('act + checkAssertion：fill/click 可派发，visible/count 断言可求值', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/button`);

    const resolved = await provider.resolve(
      { role: 'textbox', name: '用户名', match: 'exact' },
      'L1',
    );
    expect(resolved.status).toBe('resolved');
    const fillResult = await provider.act({
      kind: 'fill',
      risk: 'reversible',
      target: { elementId: resolved.elementId!, strategy: 'role' },
      value: 'idwth',
    });
    expect(fillResult.dispatched).toBe(true);
    expect(await page.inputValue('#user')).toBe('idwth');

    const visible = await provider.checkAssertion({
      kind: 'visible',
      target: { role: 'button', name: '新建', match: 'exact' },
    });
    expect(visible.passed).toBe(true);

    const count = await provider.checkAssertion({
      kind: 'count',
      target: { role: 'button', name: '新建', match: 'exact' },
      expected: 1,
    });
    expect(count.passed).toBe(true);
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('TR-5.1: L2 指纹在名称漂移（L1 miss）后仍唯一命中，role/name 不参与指纹相等性', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/fp`);

    // 用真实页面捕获目标链接在「改名前」的冻结指纹（三件套）。
    const frozen = await provider.captureFingerprint('a[href="#wl"]');
    expect(frozen.anchor_text).toContain('集群管理');
    expect(frozen.sibling_ordinal).toBeGreaterThanOrEqual(0);

    // 名称漂移：链接文案改变 → L1 语义定位 miss。
    await page.evaluate(() => {
      (globalThis as unknown as { document: any }).document
        .querySelector('a[href="#wl"]').textContent = '工作负载（新）';
    });
    const l1Only = await provider.resolve(
      { role: 'link', name: '工作负载', match: 'exact' },
      'L1',
    );
    expect(l1Only.status).toBe('miss');

    // 带冻结指纹 → resolveDeterministic 串行进入 L2 并唯一命中（strategy=fingerprint）。
    const target: SemanticTarget = {
      role: 'link',
      name: '工作负载',
      fingerprint: {
        dom_path_hash: frozen.dom_path_hash,
        sibling_ordinal: frozen.sibling_ordinal,
        anchor_text: frozen.anchor_text,
      },
    };
    const r = await resolveDeterministic(provider, target);
    expect(r.status).toBe('resolved');
    expect(r.mode).toBe('L2');
    expect(r.strategy).toBe('fingerprint');
    expect(r.elementId).toBeDefined();

    // 命中的确实是改名后的同一个元素。
    const href = await page.evaluate(
      () => (globalThis as unknown as { document: any }).document
        .querySelector('a[href="#wl"]').getAttribute('href'),
    );
    expect(href).toBe('#wl');
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('TR-5.1: L2 三件套任一不匹配即 miss（误命中比不命中更危险）', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/fp`);
    const frozen = await provider.captureFingerprint('a[href="#wl"]');

    const wrongOrdinal = await provider.resolve(
      {
        role: 'link',
        fingerprint: {
          dom_path_hash: frozen.dom_path_hash,
          sibling_ordinal: frozen.sibling_ordinal + 99,
          anchor_text: frozen.anchor_text,
        },
      },
      'L2',
    );
    expect(wrongOrdinal.status).toBe('miss');

    const wrongAnchor = await provider.resolve(
      {
        role: 'link',
        fingerprint: {
          dom_path_hash: frozen.dom_path_hash,
          sibling_ordinal: frozen.sibling_ordinal,
          anchor_text: ['不存在的锚'],
        },
      },
      'L2',
    );
    expect(wrongAnchor.status).toBe('miss');
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('TR-5.2: Freshness 作用域内比对 —— 子树外动态校验行不判 stale，目标子树替换即失效', async () => {
    const provider = await makeProvider();
    const page = await provider.openForegroundTab(`${baseUrl}/fresh`);

    const initial = await provider.resolve(
      { role: 'button', name: '保存', match: 'exact' },
      'L1',
    );
    expect(initial.status).toBe('resolved');
    expect(initial.elementId).toBeDefined();

    // observe 给当前目标盖上 data-observation-id（解析所依据的观测）。
    const obs = await provider.observe();
    await page.evaluate(
      (id) => {
        (globalThis as unknown as { document: any }).document
          .getElementById('save')
          .setAttribute('data-observation-id', id);
      },
      obs.observationId,
    );

    // 子树外插入动态校验行 → 仍 fresh（作用域隔离，避免每次 mutation 误判）。
    await page.evaluate(() => {
      const d = (globalThis as unknown as { document: any }).document;
      d.getElementById('rows').appendChild(d.createElement('div')).textContent =
        '名称不能为空';
    });
    const stillFresh = await ensureFresh(
      provider,
      { role: 'button', name: '保存', match: 'exact' },
      initial,
    );
    expect(stillFresh.outcome).toBe('fresh');

    // 目标子树（按钮本身）被替换：新节点无旧 observation id → stale；
    // 重解析拿到新按钮并盖上新 id 后重判仍无法匹配旧观测 → drift（只重解析一次）。
    await page.evaluate(() => {
      const d = (globalThis as unknown as { document: any }).document;
      const old = d.getElementById('save');
      const neu = d.createElement('button');
      neu.id = 'save';
      neu.type = 'button';
      neu.textContent = '保存（已更新）';
      old.replaceWith(neu);
    });
    const drifted = await ensureFresh(
      provider,
      { role: 'button', name: '保存', match: 'exact' },
      initial,
    );
    expect(drifted.outcome).toBe('drift');
    await page.close().catch(() => undefined);
    await provider.dispose();
  });

  it('screenshot：返回可读取的 PNG artifact 引用', async () => {
    const provider = await makeProvider();
    await provider.openForegroundTab(`${baseUrl}/button`);
    const ref = await provider.screenshot({ mask: [] });
    expect(ref.mediaType).toBe('image/png');
    expect(ref.uri).toMatch(/^artifact:\/\//);
    await provider.dispose();
  });

  it('TR-4.2: dispose 只断连 —— 之后用户 Chrome 进程与 CDP 端点仍存活', async () => {
    const provider = await makeProvider();
    await provider.openForegroundTab(`${baseUrl}/button`);

    expect(chrome.process.killed).toBe(false);
    expect(await chrome.endpointAlive()).toBe(true);

    await provider.dispose();

    // 稍作等待，确保 close() 没有异步杀死远端进程。
    await new Promise((r) => setTimeout(r, 300));
    expect(chrome.process.killed).toBe(false);
    expect(await chrome.endpointAlive()).toBe(true);

    // dispose 后可再次 attach（断连是幂等且可逆的）。
    const reattach = await chromium.connectOverCDP(chrome.cdpEndpoint, {
      timeout: 15_000,
    });
    expect(reattach.isConnected()).toBe(true);
    await reattach.close();
  });

  it('EngineProvider 契约：playwright 实现可被当作 EngineProvider 使用（AC-17 同套契约）', async () => {
    const provider: EngineProvider = await makeProvider();
    const obs = await provider.observe();
    expect(obs.observationId).toMatch(/^obs-/);
    expect(obs.fingerprint).toMatch(/^sha1:/);
    expect(Array.isArray(obs.elements)).toBe(true);
    await provider.dispose();
  });
});
