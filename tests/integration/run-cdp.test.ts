/**
 * Task 16 前置装配 —— 默认 run handler 端到端集成测试。
 *
 * 真实链路：CLI main(['run', ...]) → run-handler 默认装配 →
 *   PlaywrightProvider CDP attach（复用既有 Chrome / 登录态语义）→
 *   executeCase → judge 归档 → report.json → judge recompute 完整性闭环。
 * 同时回归 TR-4.2：run 结束只断连，用户 Chrome 进程存活。
 */
import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { main } from '../../src/cli/index.js';
import { currentJudgeImplHash, recomputeJudge } from '../../src/runtime/judge/recompute.js';
import { renderRunReport } from '../../src/runtime/report/index.js';
import {
  cleanupCdpChrome,
  launchCdpChrome,
  type CdpChrome,
} from '../helpers/cdp-chrome.js';

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fake OF</title></head>
<body>
  <nav><a href="/workloads">工作负载</a></nav>
  <button id="create">创建 Deployment</button>
  <div id="result" style="display:none">部署完成</div>
  <script>
    document.getElementById('create').addEventListener('click', () => {
      document.getElementById('result').style.display = 'block';
    });
  </script>
</body></html>`;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        srv.close(() => resolve(addr.port));
      } else {
        reject(new Error('no port'));
      }
    });
  });
}

const TMP_DIRS: string[] = [];
afterEach(async () => {
  const dirs = TMP_DIRS.splice(0);
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('run 端到端（真实 CDP Chrome）', () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  let server: http.Server;
  let baseUrl: string;
  let chrome: CdpChrome | null = null;
  let tmpRoot: string;
  let savedCdpEndpoint: string | undefined;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    chrome = await launchCdpChrome();
    // handler 经进程 env 读取 CDP 端点（IDWTH_CDP_ENDPOINT），测试后恢复原值。
    savedCdpEndpoint = process.env.IDWTH_CDP_ENDPOINT;
    process.env.IDWTH_CDP_ENDPOINT = chrome.cdpEndpoint;
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'idwth-run-e2e-'));
  });

  afterAll(async () => {
    if (savedCdpEndpoint === undefined) delete process.env.IDWTH_CDP_ENDPOINT;
    else process.env.IDWTH_CDP_ENDPOINT = savedCdpEndpoint;
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    TMP_DIRS.push(tmpRoot);
  });

  async function writeContract(contract: unknown): Promise<{ cwd: string; rel: string }> {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'idwth-run-e2e-cwd-'));
    TMP_DIRS.push(cwd);
    const rel = '.idwth/contracts/demo.contract.yaml';
    const file = path.join(cwd, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, stringifyYaml(contract), 'utf8');
    return { cwd, rel };
  }

  function passContract() {
    return {
      version: '1',
      test: { id: 'of.create.deployment', name: '创建 Deployment' },
      environment: { base_url: baseUrl, action_timeout_ms: 5000 },
      identity: { role: 'operator', credentials_ref: 'cred://of-admin' },
      goal: '点击创建并确认部署完成可见',
      steps: [
        {
          intent: '点击创建按钮',
          action: 'click',
          target: '创建 Deployment',
          risk: 'irreversible',
          postcondition: [{ kind: 'visible', target: '部署完成' }],
        },
      ],
      assertions: { dom: [{ kind: 'visible', target: '部署完成' }] },
    };
  }

  it('PASS 全链路：run → exit 0 → report PASS → recompute MATCH → report.html 可渲染 → Chrome 存活', async () => {
    const { cwd, rel } = await writeContract(passContract());

    const code = await main(['run', rel, '--json'], {
      cwd,
      deps: {},
    });

    expect(code).toBe(0);

    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runId = (await readdir(runsDir))[0]!;
    const runDir = path.join(runsDir, runId);

    const report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8')) as {
      verdict: string;
      failure_reason: string | null;
      screenshots: Array<{ path: string }>;
      case: { base_url: string };
    };
    expect(report.verdict).toBe('PASS');
    expect(report.failure_reason).toBeNull();
    expect(report.case.base_url).toBe(baseUrl);
    expect(report.screenshots.length).toBeGreaterThan(0); // 真实截图落盘

    // judge 完整性闭环
    const recompute = await recomputeJudge(runDir, {
      expectedJudgeImplHash: currentJudgeImplHash(),
    });
    expect(recompute.status).toBe('match');
    if (recompute.status === 'match') expect(recompute.verdict).toBe('PASS');

    // 静态报告可渲染（report 命令复用同一路径）
    const htmlPath = await renderRunReport({ rootDir: cwd, runId });
    const html = await readFile(htmlPath, 'utf8');
    expect(html).toContain('PASS');
    expect(html).not.toContain('<script');

    // TR-4.2：只断连，用户 Chrome 进程存活
    await expect(chrome!.endpointAlive()).resolves.toBe(true);
  });

  it('origin 越界导航 → BLOCKED(env) 退出 2', async () => {
    const contract = passContract();
    (contract.steps as Array<Record<string, unknown>>).unshift({
      intent: '越界导航',
      action: 'navigate',
      url: 'http://evil.example.com/',
      risk: 'reversible',
    });
    const { cwd, rel } = await writeContract(contract);

    const code = await main(['run', rel], { cwd, deps: {} });

    expect(code).toBe(2);
    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runId = (await readdir(runsDir))[0]!;
    const report = JSON.parse(
      await readFile(path.join(runsDir, runId, 'report.json'), 'utf8'),
    ) as { verdict: string; failure_reason: string | null };
    expect(report.verdict).toBe('BLOCKED');
    expect(report.failure_reason).toContain('env');
  });
});
