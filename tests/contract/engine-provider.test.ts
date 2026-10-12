import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import {
  PlaywrightProvider,
  type EngineProvider,
} from '../../src/engine-provider/index.js';
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
