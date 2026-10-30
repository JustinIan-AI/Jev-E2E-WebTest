/**
 * Issue #24 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/24
 *
 * SPA 未水合竞态：goto(waitUntil:'domcontentloaded') 返回时应用只有挂载壳
 * （<div id="root"></div>），bundle 下载/执行/首渲染均未发生；紧跟的元素步骤
 * 一次性 count() 查询 → 0 → miss → 步骤判死，case 秒级失败且随机器速度波动。
 *
 * 修复语义（两层，均为确定性代码）：
 * ① 应用就绪门：goto 后等待挂载根「有子节点」（SUT 适配可给 appReadySelector）；
 *    超时 → navigate 返回 timeout + errorCode 'app_not_mounted'
 *    → classifyFailure 映射 BLOCKED(app_not_mounted)，快速失败、原因可读；
 * ② L1 miss 有限轮询（默认 5000ms / 250ms）：就绪门只保证应用挂载，不保证
 *    局部组件渲染；轮询命中的元素必须走 registerResolved 登记 anchor；
 * ③ 不做：networkidle 主门 / 契约 sleep 兜底 / 无限重试 / 断言也轮询（absent
 *    断言会被拖慢，断言保持一次性判定）。
 */
/// <reference lib="dom" />
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { PlaywrightProvider } from '../../../src/engine-provider/playwright/provider.js';
import { classifyFailure, executeCase } from '../../../src/runtime/executor.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../../helpers/cdp-chrome.js';

/** 1s 后才挂载内容的 SPA：复现「domcontentloaded 早于应用渲染」。 */
const LATE_MOUNT_PAGE = `<!doctype html><html><body>
  <div id="root"></div>
  <script>
    setTimeout(function () {
      document.getElementById('root').innerHTML = '<button id="late-btn">新建</button>';
    }, 1000);
  </script>
</body></html>`;

/** 永不挂载的 SPA：就绪门必须超时并给出 app_not_mounted。 */
const NEVER_MOUNT_PAGE = `<!doctype html><html><body><div id="root"></div></body></html>`;

/** 首屏已挂载、局部组件 900ms 后才懒加载：复现 L1 miss 轮询场景。 */
const LAZY_PART_PAGE = `<!doctype html><html><body>
  <div id="root"><button id="first">首屏按钮</button></div>
  <script>
    setTimeout(function () {
      var b = document.createElement('button');
      b.id = 'lazy-btn';
      b.textContent = '懒加载按钮';
      document.getElementById('root').appendChild(b);
    }, 900);
  </script>
</body></html>`;

/** 传统多页/SSR 页面：无 SPA 挂载根，就绪门不得误伤（不得白等超时）。 */
const SSR_PAGE = `<!doctype html><html><body>
  <h1>传统页面</h1>
  <button>确定</button>
</body></html>`;

describe('issue #24：SPA 就绪门 + L1 miss 有限轮询', () => {
  vi.setConfig({ testTimeout: 40_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome;
  let rawBrowser: Browser;
  const providers: PlaywrightProvider[] = [];

  async function connect(options: {
    appReadyTimeoutMs?: number;
    resolvePollMaxMs?: number;
  }): Promise<PlaywrightProvider> {
    const provider = await PlaywrightProvider.connect({
      cdpEndpoint: chrome.cdpEndpoint,
      originsAllowlist: [baseUrl],
      ...options,
    });
    providers.push(provider);
    return provider;
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (req.url === '/late') return res.end(LATE_MOUNT_PAGE);
      if (req.url === '/never') return res.end(NEVER_MOUNT_PAGE);
      if (req.url === '/lazy') return res.end(LAZY_PART_PAGE);
      return res.end(SSR_PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    chrome = await launchCdpChrome();
    rawBrowser = await chromium.connectOverCDP(chrome.cdpEndpoint, { timeout: 15_000 });
  });

  afterAll(async () => {
    for (const provider of providers) await provider.dispose().catch(() => undefined);
    await rawBrowser?.close().catch(() => undefined);
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('AC1 就绪门：navigate 返回即应用已挂载，紧跟的元素步骤可直接命中', async () => {
    const provider = await connect({ appReadyTimeoutMs: 5_000 });
    const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: `${baseUrl}/late` });
    expect(nav.status).toBe('ok');

    // 修复前：gate 不存在 → navigate 立刻返回、DOM 仍是空壳 → resolve miss
    const resolved = await provider.resolve({ text: '新建', match: 'substring' }, 'L1');
    expect(resolved.status).toBe('resolved');
  });

  it('AC2 轮询兜底：首屏后懒加载的元素在窗口内出现即命中，且 anchor 可派发', async () => {
    const provider = await connect({ appReadyTimeoutMs: 5_000, resolvePollMaxMs: 3_000 });
    const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: `${baseUrl}/lazy` });
    expect(nav.status).toBe('ok');

    // 修复前：count() 一次性判定 → miss（元素 900ms 后才出现）
    const resolved = await provider.resolve({ text: '懒加载按钮', match: 'substring' }, 'L1');
    expect(resolved.status).toBe('resolved');

    // 轮询命中必须登记 anchor：直接派发 click 应成功
    if (resolved.status === 'resolved') {
      const clicked = await provider.act({
        kind: 'click',
        risk: 'reversible',
        target: {
          elementId: resolved.elementId!,
          strategy: resolved.strategy ?? 'text',
        },
      });
      expect(clicked.status).toBe('ok');
      expect(clicked.dispatched).toBe(true);
    }
  });

  it('AC3 超时错误码：就绪门超时 → timeout + app_not_mounted → BLOCKED(app_not_mounted)', async () => {
    const provider = await connect({ appReadyTimeoutMs: 600 });
    const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: `${baseUrl}/never` });
    // 修复前：无门 → status 'ok'（随后元素步骤在空壳上必然 miss）
    expect(nav.status).toBe('timeout');
    if (nav.status === 'timeout') {
      expect(nav.errorCode).toBe('app_not_mounted');
      expect(classifyFailure(nav).blockReason).toBe('app_not_mounted');
    }

    // 端到端：executeCase 携带该 ActionResult → BLOCKED(app_not_mounted)
    const stub = {
      resolve: async () => ({ status: 'miss' as const }),
      verifyFreshness: async () => false,
      act: async () => nav,
      checkAssertion: async () => ({ kind: 'visible', passed: false, status: 'failed' as const }),
      observe: async () => ({
        observationId: 'obs-x',
        fingerprint: 'fp-x',
        url: `${baseUrl}/never`,
        title: '',
        elements: [],
      }),
      screenshot: async () => ({ path: 'x', sha256: 'x', bytes: 0 }),
      trace: async () => ({ path: 'x', sha256: 'x', bytes: 0 }),
      dispose: async () => undefined,
      id: 'stub',
      version: '0',
    } as unknown as Parameters<typeof executeCase>[1];
    const result = await executeCase(
      {
        id: 'case-24',
        steps: [
          {
            intent: 'navigate to never-mounting page',
            action: 'navigate',
            risk: 'reversible',
            url: `${baseUrl}/never`,
          },
        ],
      },
      stub,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('app_not_mounted');
  });

  it('AC4 非 SPA 页面不误伤：无挂载根时立即就绪，不白等超时', async () => {
    // appReadyTimeoutMs 仅 300ms：若实现盲目等待 #root，这里必然超时失败
    const provider = await connect({ appReadyTimeoutMs: 300 });
    const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: `${baseUrl}/ssr` });
    expect(nav.status).toBe('ok');

    const resolved = await provider.resolve({ text: '确定', match: 'substring' }, 'L1');
    expect(resolved.status).toBe('resolved');
  });

  it('AC5 断言不轮询：absent/visible 断言保持一次性判定，不被轮询窗口拖慢', async () => {
    const provider = await connect({ appReadyTimeoutMs: 5_000, resolvePollMaxMs: 4_000 });
    const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: `${baseUrl}/lazy` });
    expect(nav.status).toBe('ok');

    const startedAt = Date.now();
    const assertion = await provider.checkAssertion({
      kind: 'visible',
      target: { text: '懒加载按钮', match: 'substring' },
    });
    const elapsed = Date.now() - startedAt;

    expect(assertion.passed).toBe(false); // 元素此刻还没出现
    expect(elapsed).toBeLessThan(1_500); // 远小于 4000ms 轮询窗口
  });
});
