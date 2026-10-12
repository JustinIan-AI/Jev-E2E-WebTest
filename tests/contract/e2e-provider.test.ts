/**
 * Task 14 —— e2e Provider 契约测试（TR-14.1 / TR-14.2 / AC-16 / AC-17）。
 *
 *  - TR-14.1：e2e（内存上游替身）与 Playwright（真实 Chrome）通过**同一套**
 *    EngineProvider 契约套件；同一 ExecutorCase 切换 Provider 后主结论不变。
 *  - TR-14.2：上游 ASSERTION_INCONCLUSIVE 被吸附为 BLOCKED(decision)（不记 FAIL、
 *    保留 upstream_error_code）；陈旧失败不触发引擎自动 heal（恢复触发权归 Runtime）。
 *  - 绑定接入：provider.version 参与 engine_provider_version，版本漂移触发降级判定，
 *    引擎缓存按版本隔离、不匹配不沿用（DD-35）。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { E2eProvider } from '../../src/engine-provider/e2e/provider.js';
import {
  PlaywrightProvider,
  type EngineProvider,
  type SemanticTarget,
} from '../../src/engine-provider/index.js';
import { executeCase, type ExecutorCase } from '../../src/runtime/executor.js';
import { computeBindings } from '../../src/runtime/bindings/hash.js';
import { checkAtRunStart } from '../../src/runtime/bindings/check.js';
import {
  checkCacheVersion,
  engineCacheDir,
} from '../../src/engine-provider/e2e/engine-cache.js';
import { UpstreamE2eEngineDouble } from '../helpers/upstream-e2e-engine.js';
import {
  runEngineProviderContractSuite,
  type ProviderContractHarness,
} from './engine-provider-suite.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';

const E2E_ALLOWLIST = ['http://127.0.0.1'];

const TARGETS: {
  textbox: SemanticTarget;
  button: SemanticTarget;
  missing: SemanticTarget;
  duplicate: SemanticTarget;
} = {
  textbox: { role: 'textbox', name: '用户名', match: 'exact' },
  button: { role: 'button', name: '新建', match: 'exact' },
  missing: { role: 'button', name: '不存在', match: 'exact' },
  duplicate: { role: 'button', name: '提交', match: 'exact' },
};

/* ── e2e 腿 harness（内存上游替身，无浏览器） ─────────────────────────── */

function makeE2eHarness(): ProviderContractHarness {
  return {
    connect: async () => {
      const engine = new UpstreamE2eEngineDouble();
      engine.navigateTo('http://127.0.0.1:1/basic');
      return E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
    },
    connectAmbiguous: async () => {
      const engine = new UpstreamE2eEngineDouble();
      engine.navigateTo('http://127.0.0.1:1/duplicates');
      return E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
    },
    targets: TARGETS,
    blockedUrl: 'http://evil.example/',
  };
}

/* ── Playwright 腿 harness（真实 Chrome + 本地 fixture 服务） ──────────── */

const PAGES: Record<string, string> = {
  '/basic': `<!doctype html><html><body>
    <label>用户名 <input id="user" type="text" /></label>
    <button id="go">新建</button>
  </body></html>`,
  '/duplicates': `<!doctype html><html><body>
    <button>提交</button><button>提交</button>
  </body></html>`,
};

describe('e2e Provider 契约（TR-14.1 / TR-14.2）', () => {
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
    await rawBrowser.close().catch(() => undefined);
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makePlaywrightHarness(): ProviderContractHarness {
    const open = async (page: '/basic' | '/duplicates'): Promise<PlaywrightProvider> => {
      const p = await PlaywrightProvider.connect({
        cdpEndpoint: chrome.cdpEndpoint,
        originsAllowlist: [baseUrl],
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      });
      await p.openForegroundTab(`${baseUrl}${page}`);
      return p;
    };
    return {
      connect: () => open('/basic'),
      connectAmbiguous: () => open('/duplicates'),
      targets: TARGETS,
      blockedUrl: 'http://evil.example/',
    };
  }

  it('TR-14.1: 同一套契约套件 —— e2e Provider（内存上游替身）通过', async () => {
    await runEngineProviderContractSuite(makeE2eHarness());
  });

  it('TR-14.1: 同一套契约套件 —— Playwright Provider（真实 Chrome）通过', async () => {
    await runEngineProviderContractSuite(makePlaywrightHarness());
  });

  it('TR-14.1: 同一 ExecutorCase 切换 Provider 后主结论不变', async () => {
    const happyCase: ExecutorCase = {
      id: 'invariance.happy',
      steps: [
        {
          intent: '填用户名',
          action: 'fill',
          risk: 'reversible',
          target: TARGETS.textbox,
          value: 'idwth',
        },
        {
          intent: '新建',
          action: 'click',
          risk: 'reversible',
          target: TARGETS.button,
          postcondition: [{ kind: 'visible', target: TARGETS.button }],
        },
      ],
    };
    const missCase: ExecutorCase = {
      id: 'invariance.miss',
      steps: [
        {
          intent: '点不存在的按钮',
          action: 'click',
          risk: 'reversible',
          target: TARGETS.missing,
        },
      ],
    };

    const results: Record<string, { happy: string; miss: string }> = {};

    // e2e 腿（无浏览器）。
    {
      const engine = new UpstreamE2eEngineDouble();
      engine.navigateTo('http://127.0.0.1:1/basic');
      const p = E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });
      const happy = await executeCase(happyCase, p);
      const miss = await executeCase(missCase, p);
      results.e2e = { happy: happy.status, miss: `${miss.status}/${miss.reason}` };
      await p.dispose();
    }

    // Playwright 腿（真实 Chrome；执行前给交互元素盖观测 id 使 Freshness 通过）。
    {
      const p = await PlaywrightProvider.connect({
        cdpEndpoint: chrome.cdpEndpoint,
        originsAllowlist: [baseUrl],
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      });
      const page = await p.openForegroundTab(`${baseUrl}/basic`);
      const obs = await p.observe();
      for (const id of ['user', 'go']) {
        await page.evaluate(
          ({ elId, oid }) => {
            (globalThis as unknown as { document: any }).document
              .getElementById(elId)
              ?.setAttribute('data-observation-id', oid);
          },
          { elId: id, oid: obs.observationId },
        );
      }
      const happy = await executeCase(happyCase, p);
      const miss = await executeCase(missCase, p);
      results.playwright = { happy: happy.status, miss: `${miss.status}/${miss.reason}` };
      await p.dispose();
    }

    // 判定内核看到的结论完全一致（AC-17：切换 Provider 不改主 verdict）。
    expect(results.e2e).toEqual({ happy: 'completed', miss: 'blocked/decision' });
    expect(results.playwright).toEqual(results.e2e);
  });

  it('TR-14.2a: 上游 ASSERTION_INCONCLUSIVE → BLOCKED(decision) 而非 FAIL，upstream_error_code 入档（A10）', async () => {
    const engine = new UpstreamE2eEngineDouble({ inconclusiveMode: true });
    const p = E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });

    // Provider 层：吸附器改判，错误码保留为附加诊断。
    const ar = await p.checkAssertion({ kind: 'visible', target: TARGETS.button });
    expect(ar.status).toBe('inconclusive');
    expect(ar.blockedReason).toBe('decision');
    expect(ar.upstreamErrorCode).toBe('ASSERTION_INCONCLUSIVE');

    // 执行层：postcondition 判不出 → BLOCKED(decision)，绝不 completed/FAIL。
    const result = await executeCase(
      {
        id: 'a10.inconclusive',
        steps: [
          {
            intent: '新建',
            action: 'click',
            risk: 'irreversible',
            target: TARGETS.button,
            postcondition: [{ kind: 'visible', target: TARGETS.button }],
          },
        ],
      },
      p,
    );
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('decision');
    await p.dispose();
  });

  it('TR-14.2b: 陈旧失败不触发引擎自动 heal —— 恢复触发权归 Runtime（DD-36 / §8.3）', async () => {
    const engine = new UpstreamE2eEngineDouble();
    const p = E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });

    // 构造陈旧失败：元素可解析（L1 命中）但派发失败（已禁用）——
    // 上游默认会 auto-heal 这类失败，adapter 必须已将其关闭。
    const staleTarget: SemanticTarget = { role: 'button', name: '禁用按钮', match: 'exact' };
    engine.setPage('/stale', [
      { role: 'button', name: '禁用按钮', text: '禁用按钮', visible: true, enabled: false },
    ]);
    engine.navigateTo('http://127.0.0.1:1/stale');

    // connect 时已显式关闭上游自动恢复（回读校验通过）。
    expect(engine.getConfig()).toEqual({ autoHeal: false, autoRetry: false });

    let recoverCalls = 0;
    const result = await executeCase(
      {
        id: 'stale.failure',
        steps: [
          {
            intent: '点已失效的按钮',
            action: 'click',
            risk: 'reversible',
            target: staleTarget,
            postcondition: [{ kind: 'visible', target: staleTarget }],
          },
        ],
      },
      p,
      {
        recover: async () => {
          recoverCalls += 1;
          return true; // 恢复"成功"但页面未变：重新派发仍失败 → 单步上限拦截
        },
      },
    );

    // 恢复由 Runtime 编排（§8.3 单步 1 次），失败照 §8.2 映射。
    expect(result.status).toBe('blocked');
    expect(result.reason).toBe('recovery');
    expect(recoverCalls).toBe(1);
    // 上游引擎零自愈：陈旧失败从未触发其 auto-heal（DD-36 硬约束①）。
    expect(engine.healCalls).toBe(0);
    await p.dispose();
  });

  it('绑定接入：provider.version 参与 engine_provider_version，漂移触发降级；缓存版本隔离不沿用（DD-35）', async () => {
    const engine = new UpstreamE2eEngineDouble({ version: '7.7.7' });
    const p = E2eProvider.connect({ engine, originsAllowlist: E2E_ALLOWLIST });

    const bindings = computeBindings({
      contract: { id: 'c' },
      strategyContent: { flows: [] },
      judgeImplSource: 'judge',
      runnerVersion: 'test',
      env: {
        browserVersion: 'test',
        targetOrigin: 'http://127.0.0.1',
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
      },
      engineProviderVersion: p.version,
    });
    expect(bindings.engine_provider_version).toBe('7.7.7');

    // 引擎版本漂移 → run 启动判定 downgrade_l1_l3，driftedKeys 含第⑥项。
    const drift = checkAtRunStart({
      current: bindings,
      stored: { ...bindings, engine_provider_version: '0.0.1-other' },
    });
    expect(drift.decision).toBe('downgrade_l1_l3');
    expect(drift.driftedKeys).toContain('engine_provider_version');

    // 引擎缓存按版本分目录；版本不匹配 → 不沿用（Task 15 消费本原语）。
    expect(engineCacheDir('/root/.idwth/engine-cache', p.version)).toBe(
      '/root/.idwth/engine-cache/7.7.7',
    );
    expect(checkCacheVersion({ stored: '0.4.2', current: p.version })).toEqual({
      compatible: false,
      stored: '0.4.2',
      current: '7.7.7',
    });
    await p.dispose();
  });
});
