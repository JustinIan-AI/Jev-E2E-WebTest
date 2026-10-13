/**
 * Task 16 前置装配 —— PlaywrightProvider Freshness 协议闭环（§5.5.6）。
 *
 * Runtime 独占的 Freshness 校验依赖「observe 时给观测元素盖 data-observation-id
 * 戳」。缺省未盖戳时 verifyFreshness 恒 false → 所有带 target 步骤必然
 * BLOCKED(drift)，run 装配无法工作。本文件锁定协议：
 *   1) observe() 后，已观测元素携带当前 observationId 戳 → fresh；
 *   2) 元素被替换/分离后 verifyFreshness → 不新鲜（drift 可检测）。
 */
/// <reference lib="dom" />
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { PlaywrightProvider } from '../../src/engine-provider/playwright/provider.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';

describe('PlaywrightProvider Freshness 协议', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome;
  let rawBrowser: Browser;
  let provider: PlaywrightProvider;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body>
        <button id="go">执行</button>
        <span id="out"></span>
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
    await rawBrowser.close().catch(() => undefined); // 只断连
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('observe() 盖戳后：已解析元素 fresh；重observe同元素仍 fresh', async () => {
    const target = { text: '执行', match: 'substring' as const };

    await provider.observe(); // 基线观测（盖戳）
    const first = await provider.resolve(target, 'L1');
    expect(first.status).toBe('resolved');

    await expect(provider.verifyFreshness(target, first)).resolves.toBe(true);

    await provider.observe(); // 再次观测：元素未变 → 仍 fresh
    await expect(provider.verifyFreshness(target, first)).resolves.toBe(true);
  });

  it('元素被替换后：verifyFreshness 检出漂移（不新鲜）', async () => {
    const target = { text: '执行', match: 'substring' as const };

    await provider.observe();
    const resolved = await provider.resolve(target, 'L1');
    expect(resolved.status).toBe('resolved');

    // 页面重建按钮节点（同文本、不同 DOM 节点）
    const page = provider.activePage();
    await page.evaluate(() => {
      const btn = document.getElementById('go')!;
      const clone = btn.cloneNode(true) as HTMLElement;
      btn.replaceWith(clone);
    });

    await provider.observe(); // 新观测：新节点盖新戳，旧 registry locator 已分离
    await expect(provider.verifyFreshness(target, resolved)).resolves.toBe(false);
  });
});
