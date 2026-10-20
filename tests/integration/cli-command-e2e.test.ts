/**
 * F2-1 / F2-2 — 真实 bin shim 子进程命令级确定性闭环（M1 收口）。
 *（真实 shim、mkdtemp cwd、退出码+产物双取证、零外网零模型零新增依赖）
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import {
  access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { cleanupCdpChrome, launchCdpChrome, type CdpChrome } from '../helpers/cdp-chrome.js';

const execFileP = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHIM = path.join(REPO_ROOT, 'bin', 'idwth.js');
const BUILT_ENTRY = path.join(REPO_ROOT, 'dist', 'cli', 'index.js');

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

/**
 * 歧义 SUT：两个不可区分的同名按钮（同 role/name/text，仅 id/位置不同）。
 * 各自点击都会向服务端 /click 上报——用于命令级证明零派发（两侧计数恒 0）。
 */
const AMBIGUOUS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Ambiguous OF</title></head>
<body>
  <button id="del-a">确认删除</button>
  <button id="del-b">确认删除</button>
  <script>
    for (const [id] of [['del-a'], ['del-b']]) {
      document.getElementById(id).addEventListener('click', async () => {
        await fetch('/click?id=' + id, { method: 'POST' });
      });
    }
  </script>
</body></html>`;

/** 跨子任务共享的命令级状态（F2-3 复用）。 */
export interface CommandRunRef {
  cwd: string;
  runId: string;
  contractRel: string;
}
const PASS_RUN: { current?: CommandRunRef } = {};
const BLOCKED_RUN: { current?: CommandRunRef } = {};

/** 临时目录登记：auto=afterEach 即清；retained=跨用例保留到 afterAll。 */
const AUTO_DIRS: string[] = [];
const RETAINED_DIRS: string[] = [];

describe('F2-1 真实 shim 子进程 PASS 确定性闭环', () => {
  let server: http.Server;
  let baseUrl: string;
  let ambiguousUrl: string;
  let chrome: CdpChrome | null = null;
  let cdpEndpoint: string;
  let savedCdpEndpoint: string | undefined;
  /** SUT 侧 click 副作用计数（零派发断言的权威来源）。 */
  let clickCounts: Record<string, number>;

  beforeAll(async () => {
    try { await access(BUILT_ENTRY); }
    catch { await execFileP('npm', ['run', 'build'], { cwd: REPO_ROOT }); }
    clickCounts = { 'del-a': 0, 'del-b': 0 };
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/click?')) {
        const id = new URL(url, 'http://127.0.0.1').searchParams.get('id');
        if (id === 'del-a' || id === 'del-b') clickCounts[id] = (clickCounts[id] ?? 0) + 1;
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(url.startsWith('/ambiguous') ? AMBIGUOUS_HTML : PAGE_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
    ambiguousUrl = `${baseUrl}/ambiguous`;
    chrome = await launchCdpChrome();
    cdpEndpoint = chrome.cdpEndpoint;
    savedCdpEndpoint = process.env.IDWTH_CDP_ENDPOINT;
    process.env.IDWTH_CDP_ENDPOINT = cdpEndpoint;
  }, 60_000);

  afterAll(async () => {
    if (savedCdpEndpoint === undefined) delete process.env.IDWTH_CDP_ENDPOINT;
    else process.env.IDWTH_CDP_ENDPOINT = savedCdpEndpoint;
    await cleanupCdpChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const dirs = RETAINED_DIRS.splice(0);
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  afterEach(async () => {
    const dirs = AUTO_DIRS.splice(0);
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  interface RunResult { code: number; stdout: string; stderr: string; }

  async function runShim(
    args: readonly string[],
    cwd: string,
    env: Record<string, string | undefined> = {},
  ): Promise<RunResult> {
    try {
      const { stdout, stderr } = await execFileP(process.execPath, [SHIM, ...args], {
        cwd,
        env: { ...process.env, IDWTH_CDP_ENDPOINT: cdpEndpoint, ...env },
      });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number | null; stdout?: string; stderr?: string };
      return {
        code: e.code ?? -1,
        stdout: (e.stdout ?? '') as string,
        stderr: (e.stderr ?? '') as string,
      };
    }
  }

  async function freshCwdWithContract(
    contract: unknown,
    retain = false,
  ): Promise<{ cwd: string; rel: string }> {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'idwth-f2-cmd-e2e-'));
    (retain ? RETAINED_DIRS : AUTO_DIRS).push(cwd);
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
      steps: [{
        intent: '点击创建按钮',
        action: 'click',
        target: '创建 Deployment',
        risk: 'irreversible',
        postcondition: [{ kind: 'visible', target: '部署完成' }],
      }],
      assertions: { dom: [{ kind: 'visible', target: '部署完成' }] },
    };
  }

  function ambiguousContract() {
    return {
      version: '1',
      test: { id: 'of.ambiguous.delete', name: '歧义删除' },
      environment: { base_url: ambiguousUrl, action_timeout_ms: 5000 },
      identity: { role: 'operator', credentials_ref: 'cred://of-admin' },
      goal: '在两个不可区分按钮间点击确认删除',
      steps: [{
        intent: '点击确认删除',
        action: 'click',
        target: '确认删除',
        risk: 'irreversible',
        postcondition: [{ kind: 'visible', target: '已删除' }],
      }],
      assertions: { dom: [{ kind: 'visible', target: '已删除' }] },
    };
  }

  it('F2-1 run --json：exit 0、stdout 单行 PASS JSON、run 目录五件套齐备', async () => {
    const { cwd, rel } = await freshCwdWithContract(passContract(), true);
    const result = await runShim(['run', rel, '--json'], cwd);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const out = JSON.parse(lines[0]!) as {
      run_id: string; verdict: string; failure_reason?: string;
    };
    expect(typeof out.run_id).toBe('string');
    expect(out.run_id.length).toBeGreaterThan(0);
    expect(out.verdict).toBe('PASS');
    expect(out.failure_reason).toBeUndefined();
    PASS_RUN.current = { cwd, runId: out.run_id, contractRel: rel };

    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runIds = await readdir(runsDir);
    expect(runIds).toEqual([out.run_id]);
    const runDir = path.join(runsDir, out.run_id);

    const report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8')) as {
      verdict: string;
      failure_reason: string | null;
      screenshots: Array<{ path: string }>;
      reproduction: { rerun_command: string };
    };
    expect(report.verdict).toBe('PASS');
    expect(report.failure_reason).toBeNull();
    expect(report.reproduction.rerun_command).toContain('idwth run');
    expect(report.reproduction.rerun_command).toContain(rel);

    await expect(access(path.join(runDir, 'judge-result.json'))).resolves.toBeUndefined();
    await expect(access(path.join(runDir, 'evidence-manifest.json'))).resolves.toBeUndefined();
    await expect(access(path.join(runDir, 'judgement_set', 'observation.json'))).resolves.toBeUndefined();

    expect(report.screenshots.length).toBeGreaterThan(0);
    await expect(access(path.join(runDir, report.screenshots[0]!.path))).resolves.toBeUndefined();
  }, 60_000);

  it('F2-2.1 歧义（非 --json）：exit 2、BLOCKED(ambiguity)，SUT 两侧 click 计数恒 0（零派发）', async () => {
    const { cwd, rel } = await freshCwdWithContract(ambiguousContract(), true);
    const result = await runShim(['run', rel], cwd);

    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('verdict=BLOCKED');

    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runIds = await readdir(runsDir);
    expect(runIds).toHaveLength(1);
    const runId = runIds[0]!;
    BLOCKED_RUN.current = { cwd, runId, contractRel: rel };
    const runDir = path.join(runsDir, runId);

    const report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8')) as {
      verdict: string;
      failure_reason: string;
    };
    expect(report.verdict).toBe('BLOCKED');
    expect(report.failure_reason).toContain('ambiguity');

    // 零派发（A3）：BLOCKED 之后两侧副作用计数必须恒为 0。
    expect(clickCounts).toEqual({ 'del-a': 0, 'del-b': 0 });
  }, 60_000);

  it('F2-2.2 run 缺路径 / 未知选项：exit 3 且 stderr 含用法', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'idwth-f2-cmd-e2e-'));
    AUTO_DIRS.push(cwd);

    const missing = await runShim(['run'], cwd);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('用法：idwth run');

    const bogus = await runShim(['run', relOfContract(), '--bogus'], cwd);
    expect(bogus.code).toBe(3);
    expect(bogus.stderr).toContain('未知选项');

    function relOfContract() {
      return '.idwth/contracts/demo.contract.yaml';
    }
  }, 30_000);

  it('F2-2.3 CDP 端点不可达：exit 4，临时 cwd 下无 .idwth/runs 目录', async () => {
    const { cwd, rel } = await freshCwdWithContract(passContract());
    const result = await runShim(['run', rel, '--json'], cwd, {
      IDWTH_CDP_ENDPOINT: 'http://127.0.0.1:1',
    });

    expect(result.code).toBe(4);
    expect(result.stderr).toContain('无法连接 Chrome CDP 端点');
    await expect(access(path.join(cwd, '.idwth', 'runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);

  it('F2-3.1 report：exit 0、离线单文件 HTML 五要素齐备（无 script/外链、内联 style、截图内联）', async () => {
    const ref = PASS_RUN.current;
    expect(ref).toBeDefined();
    const { cwd, runId } = ref!;

    const result = await runShim(['report', runId], cwd);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('报告已生成');
    const htmlPath = result.stdout.split('：').pop()!.trim();
    expect(path.isAbsolute(htmlPath)).toBe(true);
    const html = await readFile(htmlPath, 'utf8');

    // 要素 1：用例名 / 目标 / verdict / 可复现命令。
    expect(html).toContain('创建 Deployment');
    expect(html).toContain('点击创建并确认部署完成可见');
    expect(html).toContain('PASS');
    expect(html).toContain('idwth run');
    // 要素 2：PASS 时「未通过原因」区为空态（整块不渲染）。
    expect(html).not.toContain('未通过原因');
    // 要素 3：离线硬契约——无脚本、样式内联。
    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toMatch(/<style>/i);
    // 无资源型外链（base_url 作为文本含 http:// 字面量，故只约束 src/href/url 引用）。
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
    // 要素 4：截图以 data: URI 内联，且物理文件在同 run 目录存在。
    expect(html).toMatch(/<img[^>]+src="data:[^";]+;base64,/);
    const report = JSON.parse(
      await readFile(path.join(cwd, '.idwth', 'runs', runId, 'report.json'), 'utf8'),
    ) as { screenshots: Array<{ path: string }> };
    expect(report.screenshots.length).toBeGreaterThan(0);
    for (const shot of report.screenshots) {
      await expect(
        access(path.join(cwd, '.idwth', 'runs', runId, shot.path)),
      ).resolves.toBeUndefined();
    }
    // 要素 5：html 物理位于该 run 目录内（自包含归档；realpath 消解 /var→/private/var）。
    expect(await realpath(htmlPath)).toBe(
      await realpath(path.join(cwd, '.idwth', 'runs', runId, 'report.html')),
    );
  }, 30_000);

  it('F2-3.2 judge recompute（PASS run）：exit 0、stdout MATCH verdict=PASS、hash 段非空', async () => {
    const ref = PASS_RUN.current;
    expect(ref).toBeDefined();
    const { cwd, runId } = ref!;

    const result = await runShim(['judge', 'recompute', runId], cwd);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('recompute MATCH');
    expect(result.stdout).toContain(`run=${runId}`);
    expect(result.stdout).toContain('verdict=PASS');
    const hash = result.stdout.match(/hash=(\S+)/)?.[1] ?? '';
    // verdict_hash = sha256 裸 hex（64 位）。
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it('F2-3.3 judge recompute（BLOCKED run）：exit 2、stdout MATCH verdict=BLOCKED', async () => {
    const ref = BLOCKED_RUN.current;
    expect(ref).toBeDefined();
    const { cwd, runId } = ref!;

    const result = await runShim(['judge', 'recompute', runId], cwd);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('recompute MATCH');
    expect(result.stdout).toContain('verdict=BLOCKED');
  }, 30_000);

  it('F2-3.4 篡改 manifest 指向的证据 blob 一字节：recompute exit 4 且不输出 MATCH', async () => {
    const ref = BLOCKED_RUN.current;
    expect(ref).toBeDefined();

    // 拷贝到独立临时 run，避免污染原始归档（保持用例独立性）。
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'idwth-f2-tamper-'));
    AUTO_DIRS.push(cwd);
    const runId = ref!.runId;
    const runsRoot = path.join(cwd, '.idwth', 'runs');
    await mkdir(runsRoot, { recursive: true });
    await cp(path.join(ref!.cwd, '.idwth', 'runs', runId), path.join(runsRoot, runId), {
      recursive: true,
    });
    const runDir = path.join(runsRoot, runId);

    // 必须篡改 manifest 中 sha256 指向的内容寻址 blob（命名视图不被校验）。
    const manifest = JSON.parse(
      await readFile(path.join(runDir, 'evidence-manifest.json'), 'utf8'),
    ) as { judgement_set: Array<{ name: string; sha256: string }> };
    expect(manifest.judgement_set.length).toBeGreaterThan(0);
    const target = manifest.judgement_set[0]!;
    const blobPath = path.join(runDir, 'blobs', 'judgement_set', target.sha256);
    const buf = await readFile(blobPath);
    buf[buf.length - 1] = buf[buf.length - 1] === 0x7a ? 0x7b : 0x7a;
    await writeFile(blobPath, buf);

    const result = await runShim(['judge', 'recompute', runId], cwd);
    expect(result.code).toBe(4);
    expect(result.stdout).not.toContain('MATCH');
    expect(result.stderr).toContain('verdict 重算完整性错误');
    expect(result.stderr).toMatch(/EVIDENCE_CORRUPT|HASH_MISMATCH/);
  }, 30_000);

  it('F2-3.5 边界：report 不存在 id / judge recompute 缺 id / judge bogus 均 exit 3', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'idwth-f2-cmd-e2e-'));
    AUTO_DIRS.push(cwd);

    const noReport = await runShim(['report', 'nonexistent-run'], cwd);
    expect(noReport.code).toBe(3);
    expect(noReport.stderr).toContain('找不到 run 报告数据');

    const missingId = await runShim(['judge', 'recompute'], cwd);
    expect(missingId.code).toBe(3);
    expect(missingId.stderr).toContain('用法：idwth judge recompute');

    const bogus = await runShim(['judge', 'bogus'], cwd);
    expect(bogus.code).toBe(3);
    expect(bogus.stderr).toContain('未知子命令：bogus');
  }, 30_000);
});
