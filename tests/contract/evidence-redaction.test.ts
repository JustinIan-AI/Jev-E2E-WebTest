/**
 * Task 8 RED — AC-08 / TR-8.1 / TR-8.2 真实 Chromium 契约测试。
 * 对应详设 §4.8.6 行为性验收与 spec AC-08 指定证据
 * （tests/integration/evidence-redaction.test.*；本项目集成测试统一落 tests/contract）。
 *
 * 覆盖：
 *  - 第一层遮罩：截图 Playwright 原生 mask 覆盖输入控件（含渲染文本，验证选择器集）。
 *  - 第二层遮罩：页面渲染的 kubeconfig/Bearer 已知明文被 TreeWalker 脚本替换为
 *    data-redacted span（非 input，原生 mask 遮不住）。
 *  - 登录产物扫描：observation/network/trace/evidence 落盘产物 grep 不含明文密码。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';
import { captureMaskedScreenshot, MASK_INPUT_SELECTOR } from '../../src/engine-provider/playwright/screenshot.js';
import { buildTextMaskScript, redactObservation, scanFilesForSecrets, serializeTraceEvents } from '../../src/runtime/redaction.js';
import { createEvidenceStore } from '../../src/runtime/evidence-store.js';

const PASSWORD = 'sup3r-s3cret-pw-9001';
const BEARER = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.traceSecretPayload42';
const KUBE_KEY = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCmt1YmVjb25maWctc2VjcmV0LWtleQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0t';
const SECRETS = [PASSWORD, BEARER, KUBE_KEY];

const PAGES: Record<string, string> = {
  '/login': `<!doctype html><html><body>
    <h1>登录</h1>
    <form id="login-form" action="/login" method="post">
      <label>用户名 <input id="user" name="username" type="text" value="admin" /></label>
      <label>密码 <input id="pass" name="password" type="password" value="${PASSWORD}" /></label>
      <input type="hidden" name="csrf" value="csrf-token-xyz" />
      <input type="file" name="cert" />
      <button id="submit" type="submit">登录</button>
    </form>
  </body></html>`,
  // 渲染出的凭据明文（非 input）：kubeconfig 与 Bearer，原生 mask 遮不住，必须第二层处理。
  '/secret': `<!doctype html><html><body>
    <h1>集群凭证</h1>
    <pre id="kube">${KUBE_KEY}</pre>
    <p id="tok">Authorization: ${BEARER}</p>
    <div>普通文字不应被误遮</div>
  </body></html>`,
};

describe('Evidence 脱敏契约 (AC-08 / TR-8.1 / TR-8.2)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome;
  let rawBrowser: Browser;
  let tmp: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const body = PAGES[req.url?.split('?')[0] ?? '/'] ?? '<!doctype html><body>ok</body>';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    chrome = await launchCdpChrome();
    rawBrowser = await chromium.connectOverCDP(chrome.cdpEndpoint, { timeout: 15_000 });
    tmp = await mkdtemp(path.join(os.tmpdir(), 'idwth-evcontract-'));
  });

  afterAll(async () => {
    await rawBrowser.close().catch(() => undefined);
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(tmp, { recursive: true, force: true });
  });

  async function newPage(): Promise<Page> {
    return rawBrowser.contexts()[0]!.newPage();
  }

  it('TR-8.2 第一层：mask 选择器覆盖 password/file/hidden 及 contenteditable/data-private', () => {
    expect(MASK_INPUT_SELECTOR).toContain('input');
    for (const sel of ['[type="password"]', '[type="file"]', '[type="hidden"]', '[contenteditable]', '[data-private]']) {
      expect(MASK_INPUT_SELECTOR).toContain(sel);
    }
  });

  it('TR-8.2 第二层：渲染的 kubeconfig/Bearer 文本节点被 data-redacted span 替换', async () => {
    const page = await newPage();
    try {
      await page.goto(`${baseUrl}/secret`);
      // 遮罩前：明文可见
      expect(await page.locator('#kube').textContent()).toContain(KUBE_KEY);

      await page.evaluate(buildTextMaskScript(SECRETS));

      // 命中文本节点被替换为遮罩 span，原明文从 DOM 消失
      expect(await page.locator('[data-redacted="1"]').count()).toBeGreaterThanOrEqual(2);
      const html = await page.content();
      expect(html).not.toContain(KUBE_KEY);
      expect(html).not.toContain('traceSecretPayload42');
      // 未命中的普通文字保留
      expect(html).toContain('普通文字不应被误遮');
    } finally {
      await page.close();
    }
  });

  it('TR-8.2：两层遮罩联合截图成功，产物为非空 PNG', async () => {
    const page = await newPage();
    try {
      await page.goto(`${baseUrl}/secret`);
      const ref = await captureMaskedScreenshot(page, SECRETS, { fullPage: true });
      expect(ref.mediaType).toBe('image/png');
      expect(ref.buffer.length).toBeGreaterThan(100);
      // 截图在 evaluate 遮罩之后生成（实现必须先文本遮罩再 screenshot）
      expect(await page.locator('[data-redacted="1"]').count()).toBeGreaterThanOrEqual(2);
    } finally {
      await page.close();
    }
  });

  it('TR-8.1：登录页 password/file/hidden 控件不进入脱敏后 observation', async () => {
    const page = await newPage();
    try {
      await page.goto(`${baseUrl}/login`);
      const rawObservation = {
        url: page.url(),
        textExcerpt: `登录 密码 ${PASSWORD}`,
        elements: [
          { id: 'user', tag: 'input', inputType: 'text', name: 'username', visible: true },
          { id: 'pass', tag: 'input', inputType: 'password', name: 'password', value: PASSWORD, visible: true },
          { id: 'csrf', tag: 'input', inputType: 'hidden', name: 'csrf', value: 'csrf-token-xyz' },
          { id: 'cert', tag: 'input', inputType: 'file', name: 'cert' },
          { id: 'submit', tag: 'button', inputType: undefined, name: '登录', visible: true },
        ],
      };
      const safe = redactObservation(rawObservation, SECRETS);
      const dumped = JSON.stringify(safe);
      expect(dumped).not.toContain(PASSWORD);
      expect((safe.elements ?? []).map((e) => e.id)).toEqual(['user', 'submit']);
    } finally {
      await page.close();
    }
  });

  it('TR-8.1：登录全链路产物（observation/network/trace/evidence）grep 明文密码为空', async () => {
    const page = await newPage();
    const capturedRequests: unknown[] = [];
    page.on('request', (req) => {
      capturedRequests.push({
        type: 'request',
        url: req.url(),
        method: req.method(),
        headers: req.headers(),
        postData: req.postData() ?? null,
      });
    });

    try {
      await page.goto(`${baseUrl}/login`);
      await page.fill('#pass', PASSWORD);
      // 提交走夹具页（404 也没关系），只要请求事件带 postData 即可
      await page.click('#submit').catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
    } finally {
      await page.close();
    }

    const runId = 'f00dbaad';
    const store = createEvidenceStore({ runId, rootDir: tmp, secrets: SECRETS });

    // 模拟 runtime 落盘：observation 文本 + trace 事件 + 网络证据，全部先脱敏
    const safeObservation = redactObservation(
      { textExcerpt: `登录 ${PASSWORD}`, elements: [] },
      SECRETS,
    );
    await store.judgement({
      name: 'observation.json',
      content: JSON.stringify(safeObservation),
      mediaType: 'application/json',
    });
    await store.judgement({
      name: 'network.json',
      content: serializeTraceEvents(capturedRequests, SECRETS),
      mediaType: 'application/json',
    });

    // trace 产物文件（runtime 序列化结果，非 Playwright 原始 zip）
    const traceText = serializeTraceEvents(
      [...capturedRequests, { type: 'note', body: `submitted password=${PASSWORD}` }],
      SECRETS,
    );
    const runDir = path.join(tmp, '.idwth', 'runs', runId);
    const traceDir = path.join(runDir, 'trace');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(traceDir, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(traceDir, 'events.jsonl'), traceText);

    // 运行中泄漏一份未脱敏文件用于验证扫描器有效（哨兵），随后删除再断言空
    const sentinel = path.join(runDir, 'raw-leak.log');
    await writeFile(sentinel, `DEBUG password=${PASSWORD}`);
    expect(await scanFilesForSecrets(runDir, SECRETS)).toEqual([sentinel]);
    await rm(sentinel);

    // 正式断言：整棵 run 产物树 grep 不到任何已知明文
    const hits = await scanFilesForSecrets(runDir, SECRETS);
    expect(hits).toEqual([]);

    // judgement_set 物理文件再次逐文件核验
    const blobDir = path.join(runDir, 'blobs', 'judgement_set');
    for (const f of await readdir(blobDir)) {
      expect(await readFile(path.join(blobDir, f), 'utf8')).not.toContain(PASSWORD);
    }
  });
});
