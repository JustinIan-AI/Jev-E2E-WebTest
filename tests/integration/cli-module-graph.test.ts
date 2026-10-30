/**
 * F4 门禁 —— CLI 入口依赖边界（模块图判据）。
 *
 * 规格：.trae/specs/f4-cli-startup-lazy-load/spec.md
 *
 * 为什么用模块图而不是秒表：启动耗时在 CI 共享 runner 上差异可达 3–5 倍，设秒表门限
 * 会制造 PR #33 刚整治掉的那类 fake red；而"这条命令有没有把浏览器执行臂拉进来"是
 * 与机器速度无关的确定性问题。
 *
 * 三条断言缺一不可：
 *  1. 瘦（A1/A2）：非 run 命令的模块图不含 playwright / run-handler。
 *  2. 胖（A3，反向）：run 必须含 —— 否则"把执行臂删掉"也能让 A1/A2 变绿。
 *  3. 自证（每次采集）：必须录到 dist/cli/index.js —— 否则探针失灵同样会"看起来绿"。
 *     「没抓到 playwright」与「探针根本没工作」在输出上无法区分，这是本项目反复踩过的坑。
 *
 * 环境隔离：必须剥离宿主注入的 NODE_OPTIONS 与代理变量。带 shim 时同一条命令
 * 0.68s、剥离后 0.17s（spec §1）—— 不剥离，测的就是宿主而不是产品。
 */
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROBE = path.join(REPO_ROOT, 'tests/helpers/module-graph-probe.mjs');
const INJECT_RUN = path.join(REPO_ROOT, 'tests/helpers/inject-run-deps.mjs');
const SHIM = path.join(REPO_ROOT, 'bin/idwth.js');
const BUILT_ENTRY = path.join(REPO_ROOT, 'dist/cli/index.js');
const EXAMPLE_CONTRACT = path.join('.idwth', 'contracts', 'example.contract.yaml');

/** 宿主注入项：剥不干净，读数与判定都不可信。 */
const HOST_INJECTED_KEYS = [
  'NODE_OPTIONS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of HOST_INJECTED_KEYS) delete env[key];
  return { ...env, ...extra };
}

/** playwright 包本体或其执行臂目录；不命中任何无关路径（词边界，防裸子串假阳性）。 */
const PLAYWRIGHT_RE = /\/(?:playwright|playwright-core)\//;
const RUN_HANDLER_RE = /\/cli\/run-handler\.js$/;

interface GraphRun {
  urls: string[];
  code: number;
  stdout: string;
  stderr: string;
}

interface CollectOptions {
  entry: string;
  args: readonly string[];
  /** 被测命令的工作目录；缺省为一次性临时目录。 */
  cwd?: string;
  env?: Record<string, string>;
}

async function collectGraph(options: CollectOptions): Promise<GraphRun> {
  const logDir = await mkdtemp(path.join(os.tmpdir(), 'idwth-graph-'));
  const ownsWorkDir = options.cwd === undefined;
  const workDir = options.cwd ?? (await mkdtemp(path.join(os.tmpdir(), 'idwth-graph-work-')));
  const logPath = path.join(logDir, 'modules.log');
  try {
    const env = isolatedEnv({ ...options.env, IDWTH_PROBE_LOG: logPath });
    let code = 0;
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileP(process.execPath, ['--import', PROBE, options.entry, ...options.args], {
        cwd: workDir,
        env,
        timeout: 60_000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const e = error as { code?: number | null; stdout?: string; stderr?: string };
      code = typeof e.code === 'number' ? e.code : -1;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }
    const raw = await readFile(logPath, 'utf8').catch(() => '');
    return { urls: raw.split('\n').filter((line) => line.length > 0), code, stdout, stderr };
  } finally {
    await rm(logDir, { recursive: true, force: true });
    if (ownsWorkDir) await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * 自证：探针必须真的录到了入口模块。
 * 没有这一条，探针配置错误（如 hooks 挂错线程）会得到一个永远为绿的门禁。
 */
function expectProbeAlive(urls: readonly string[]): void {
  expect(urls.some((url) => url.endsWith('/dist/cli/index.js'))).toBe(true);
  // 入口模块至少有几十个依赖；只有 1–2 条说明 hooks 只录到了冰山一角。
  expect(urls.length).toBeGreaterThan(10);
}

function heavyModules(urls: readonly string[]): string[] {
  return urls.filter((url) => PLAYWRIGHT_RE.test(url) || RUN_HANDLER_RE.test(url));
}

describe('F4 · CLI 入口依赖边界（模块图门禁）', () => {
  let workDir: string;

  beforeAll(async () => {
    // dist 缺失时先就地构建（与 tests/integration/cli-entry.test.ts 一致：CI 在 build 前跑 test）。
    try {
      await access(BUILT_ENTRY);
    } catch {
      await execFileP('npm', ['run', 'build'], { cwd: REPO_ROOT });
    }
    workDir = await mkdtemp(path.join(os.tmpdir(), 'idwth-f4-'));
    await execFileP(process.execPath, [SHIM, 'init'], { cwd: workDir, env: isolatedEnv() });
  });

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  it('A1 瘦：idwth --version 不加载 playwright / run-handler', async () => {
    const run = await collectGraph({ entry: SHIM, args: ['--version'], cwd: workDir });

    expectProbeAlive(run.urls);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^idwth \d+\.\d+\.\d+\n$/);
    // 用 toEqual([]) 而非 not.toContain：失败时直接列出是哪几个重模块漏进来。
    expect(heavyModules(run.urls)).toEqual([]);
  });

  it('A2 瘦：idwth validate 不加载 playwright / run-handler', async () => {
    const run = await collectGraph({
      entry: SHIM,
      args: ['validate', EXAMPLE_CONTRACT],
      cwd: workDir,
    });

    expectProbeAlive(run.urls);
    expect(run.code).toBe(0);
    expect(heavyModules(run.urls)).toEqual([]);
  });

  it('A3 胖（反向）：idwth run 必须加载 run-handler 与 playwright', async () => {
    // CDP 端点不可达 → 命令以 RUNTIME_ERROR(4) 收场，但执行臂必须已经装进来。
    // 这条与 A1/A2 互为约束：删掉执行臂能让 A1/A2 变绿，但这条会红。
    const run = await collectGraph({
      entry: SHIM,
      args: ['run', EXAMPLE_CONTRACT],
      cwd: workDir,
      env: { IDWTH_CDP_ENDPOINT: 'http://127.0.0.1:1' },
    });

    expectProbeAlive(run.urls);
    expect(run.code).toBe(4);
    expect(run.urls.some((url) => RUN_HANDLER_RE.test(url))).toBe(true);
    expect(run.urls.some((url) => PLAYWRIGHT_RE.test(url))).toBe(true);
  });

  it('A4 显式注入 deps.run 时不加载真实执行臂', async () => {
    const run = await collectGraph({
      entry: INJECT_RUN,
      args: [EXAMPLE_CONTRACT],
      cwd: workDir,
    });

    expectProbeAlive(run.urls);
    // 先证明替身真的被调用：否则"没加载 playwright"可能只是命令根本没走到 run。
    expect(run.stdout).toContain('INJECTED_RUN_HANDLER_CALLED');
    expect(run.code).toBe(0);
    expect(heavyModules(run.urls)).toEqual([]);
  });
});
