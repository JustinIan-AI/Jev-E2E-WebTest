/**
 * Issue #18 单元与行为复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/18
 *
 * 缺陷现象：
 * SPA 中在基线观测（provider.observe()）之后进入 DOM 的元素（或 navigate 到新页面的元素），
 * 从未被盖过 data-observation-id 戳；resolve 定位时亦不打桩，
 * 导致 verifyFreshness 与 ensureFresh 结构性失败，100% BLOCKED(drift)。
 */
/// <reference lib="dom" />
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { PlaywrightProvider } from '../../../src/engine-provider/playwright/provider.js';
import { ensureFresh } from '../../../src/runtime/freshness.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../../helpers/cdp-chrome.js';

describe('issue #18：SPA 动态挂载与导航元素 Freshness 基准同步', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome;
  let rawBrowser: Browser;
  let provider: PlaywrightProvider;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url === '/page2') {
        res.end(`<!doctype html><html><body>
          <h1>用户管理页面</h1>
          <button id="create-user">新建用户</button>
        </body></html>`);
        return;
      }
      res.end(`<!doctype html><html><body>
        <h1>首页</h1>
        <button id="initial-btn">初始按钮</button>
        <div id="container"></div>
      </body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    chrome = await launchCdpChrome();
    rawBrowser = await chromium.connectOverCDP(chrome.cdpEndpoint, { timeout: 15_000 });
    provider = await PlaywrightProvider.connect({
      cdpEndpoint: chrome.cdpEndpoint,
      originsAllowlist: [baseUrl],
    });
    await provider.openForegroundTab(`${baseUrl}/`);
  });

  afterAll(async () => {
    await provider?.dispose().catch(() => undefined);
    await rawBrowser?.close().catch(() => undefined);
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('AC1 动态挂载元素：基线 observe 后动态进入 DOM 的元素能正常通过 verifyFreshness 与 ensureFresh', async () => {
    // 1. case 开始时执行基线观测
    await provider.observe();

    // 2. 模拟 SPA 异步渲染/动态挂载新元素（在此之前未被 observe 遍历过）
    const page = provider.activePage();
    await page.evaluate(() => {
      const container = document.getElementById('container')!;
      const btn = document.createElement('button');
      btn.id = 'dynamic-btn';
      btn.textContent = '动态新建';
      container.appendChild(btn);
    });

    const target = { text: '动态新建', match: 'substring' as const };

    // 3. 定位新元素
    const resolved = await provider.resolve(target, 'L1');
    expect(resolved.status).toBe('resolved');

    // 4. 新鲜度核验与 ensureFresh 判定
    const isFresh = await provider.verifyFreshness(target, resolved);
    expect(isFresh).toBe(true);

    const freshOutcome = await ensureFresh(provider, target, resolved);
    expect(freshOutcome.outcome).toBe('fresh');
  });

  it('AC2 页面导航：navigate 到新页面后，新页面的目标元素能正常通过 freshness 校验', async () => {
    // 1. 当前处于首页且具有旧观测戳
    await provider.observe();

    // 2. 执行导航动作跳转到 page2
    const navResult = await provider.act({
      kind: 'navigate',
      url: `${baseUrl}/page2`,
      risk: 'reversible',
    });
    expect(navResult.status).toBe('ok');

    const target = { text: '新建用户', match: 'substring' as const };

    // 3. 定位新页面元素
    const resolved = await provider.resolve(target, 'L1');
    expect(resolved.status).toBe('resolved');

    // 4. 验证新鲜度与 ensureFresh
    const isFresh = await provider.verifyFreshness(target, resolved);
    expect(isFresh).toBe(true);

    const freshOutcome = await ensureFresh(provider, target, resolved);
    expect(freshOutcome.outcome).toBe('fresh');
  });

  it('AC3 防漂移守护：元素被 DOM 替换后依然被准确识别为不新鲜（drift）', async () => {
    const target = { text: '新建用户', match: 'substring' as const };
    const resolved = await provider.resolve(target, 'L1');
    expect(resolved.status).toBe('resolved');

    // 模拟 DOM 漂移（同名节点被替换重建，原 DOM 节点分离）
    const page = provider.activePage();
    await page.evaluate(() => {
      const btn = document.getElementById('create-user')!;
      const clone = btn.cloneNode(true) as HTMLElement;
      btn.replaceWith(clone);
    });

    // 重新观测触发新戳且旧节点已断开
    await provider.observe();

    const isFresh = await provider.verifyFreshness(target, resolved);
    expect(isFresh).toBe(false);

    // ensureFresh 会尝试重解析并对齐，若无干扰重解析会捕获新节点
    const freshOutcome = await ensureFresh(provider, target, resolved);
    expect(freshOutcome.outcome).toBe('fresh'); // 重解析自愈成功
  });
});
