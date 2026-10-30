#!/usr/bin/env node
/**
 * IDWTH CLI 启动预算度量（F4 · 见 .trae/specs/f4-cli-startup-lazy-load/spec.md）。
 *
 * 用法：
 *   node scripts/bench-cli-startup.mjs [--runs N] [--json]
 *
 * 为什么这个脚本必须先剥离环境再测：
 * 本机 agent shell 会注入 `NODE_OPTIONS=--require .../node-language-shim.cjs`（宿主 fs
 * broker）。同一条命令、同一份构建产物，带注入 0.68s、剥离后 0.17s，CPU 采样里 67% 的
 * 时间落在那个 shim 上。**不剥离就等于在测宿主，不是在测 idwth。**
 *
 * 因此本脚本：
 *  - 强制以剥离后的 env 起子进程（NODE_OPTIONS + 全部 *_PROXY，大小写各一份）；
 *  - 若检测到宿主注入了 NODE_OPTIONS，额外做一次"未剥离"对照，并打印
 *    READING NOT COMPARABLE —— 让污染显式可见，而不是悄悄混进结论。
 *
 * 退出码：0 正常；1 无法隔离环境（宁可失败，也不产出不可比的读数）。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = path.join(REPO_ROOT, 'bin/idwth.js');
const PROBE = path.join(REPO_ROOT, 'tests/helpers/module-graph-probe.mjs');
const EXAMPLE_CONTRACT = path.join('.idwth', 'contracts', 'example.contract.yaml');

const ISOLATED_KEYS = [
  'NODE_OPTIONS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
];

const PLAYWRIGHT_RE = /\/(?:playwright|playwright-core)\//;

function parseArgv(argv) {
  const options = { runs: 7, json: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--json') options.json = true;
    else if (token === '--runs') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 3) {
        throw new Error('--runs 需要 >= 3 的整数（少于 3 次取 p95 没有意义）');
      }
      options.runs = value;
    } else throw new Error(`未知参数：${token}`);
  }
  return options;
}

function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of ISOLATED_KEYS) delete env[key];
  return { ...env, ...extra };
}

/** 起一个子进程并测墙钟（含 node 冷启动）。返回耗时与退出码。 */
function measure(entry, args, env, cwd) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, entry === null ? args : [entry, ...args], {
      cwd,
      env,
      stdio: 'ignore',
    });
    child.on('error', () => resolve({ ms: performance.now() - started, code: -1 }));
    child.on('close', (code) => resolve({ ms: performance.now() - started, code: code ?? -1 }));
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function sample(label, entry, args, env, cwd, runs) {
  const durations = [];
  const codes = new Set();
  for (let i = 0; i < runs; i++) {
    const { ms, code } = await measure(entry, args, env, cwd);
    durations.push(ms);
    codes.add(code);
  }
  durations.sort((a, b) => a - b);
  return {
    label,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    exitCodes: [...codes],
    samples: durations.length,
  };
}

/** 用模块图探针采一次：模块总数 + playwright 命中数。 */
async function moduleGraph(entry, args, env, cwd) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-bench-graph-'));
  const logPath = path.join(dir, 'modules.log');
  try {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', PROBE, entry, ...args], {
        cwd,
        env: { ...env, IDWTH_PROBE_LOG: logPath },
        stdio: 'ignore',
      });
      child.on('error', resolve);
      child.on('close', resolve);
    });
    const raw = await readFile(logPath, 'utf8').catch(() => '');
    const urls = raw.split('\n').filter((line) => line.length > 0);
    return { modules: urls.length, playwright: urls.filter((u) => PLAYWRIGHT_RE.test(u)).length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fmt(ms) {
  return `${(ms / 1000).toFixed(3)}s`;
}

async function main() {
  const options = parseArgv(process.argv.slice(2));
  const hostInjected = (process.env.NODE_OPTIONS ?? '').trim();

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'idwth-bench-'));
  const env = isolatedEnv();
  const report = { hostInjected: hostInjected !== '' || undefined, runs: options.runs, rows: [] };

  try {
    // 准备一份可用的示例 contract。
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SHIM, 'init'], { cwd: workDir, env, stdio: 'ignore' });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`init 失败：exit ${code}`))));
    });

    const floors = await sample('node 地板（空进程）', null, ['-e', 'process.exit(0)'], env, workDir, options.runs);
    const version = await sample('idwth --version', SHIM, ['--version'], env, workDir, options.runs);
    const validate = await sample(
      'idwth validate <contract>',
      SHIM,
      ['validate', EXAMPLE_CONTRACT],
      env,
      workDir,
      options.runs,
    );
    const runEnv = { ...env, IDWTH_CDP_ENDPOINT: 'http://127.0.0.1:1' };
    const run = await sample(
      'idwth run <contract>（CDP 不可达）',
      SHIM,
      ['run', EXAMPLE_CONTRACT],
      runEnv,
      workDir,
      options.runs,
    );

    const graphs = {
      version: await moduleGraph(SHIM, ['--version'], env, workDir),
      validate: await moduleGraph(SHIM, ['validate', EXAMPLE_CONTRACT], env, workDir),
      run: await moduleGraph(SHIM, ['run', EXAMPLE_CONTRACT], runEnv, workDir),
    };

    report.rows = [
      { ...floors, ...{ modules: null, playwright: null } },
      { ...version, ...graphs.version },
      { ...validate, ...graphs.validate },
      { ...run, ...graphs.run },
    ];

    if (hostInjected !== '') {
      // 对照：不剥离宿主注入时的读数，用来解释"为什么历史数字不可用"。
      const contaminated = await sample(
        'idwth --version（带宿主注入）',
        SHIM,
        ['--version'],
        { ...process.env },
        workDir,
        Math.min(3, options.runs),
      );
      report.contaminated = contaminated;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const lines = [];
  lines.push('IDWTH CLI 启动预算（F4）');
  lines.push(`  剥离的环境变量：${ISOLATED_KEYS.join(', ')}`);
  if (report.hostInjected !== undefined) {
    lines.push(
      '  ⚠ READING NOT COMPARABLE：检测到宿主注入 NODE_OPTIONS（agent shell 的 fs broker shim）。',
    );
    lines.push('    本次测量已剥离；未剥离的读数不能用于跨环境比较。');
    if (report.contaminated !== undefined) {
      lines.push(
        `    对照：--version 带注入 p50 ${fmt(report.contaminated.p50)} / 剥离后 p50 ${fmt(
          report.rows[1].p50,
        )}`,
      );
    }
  }
  lines.push('');
  lines.push('  命令                                    p50      p95      模块数  playwright');
  for (const row of report.rows) {
    const pad = row.label.padEnd(38, ' ');
    const modules = row.modules === null ? '     –' : String(row.modules).padStart(6);
    const pw = row.playwright === null ? '         –' : String(row.playwright).padStart(10);
    lines.push(`  ${pad}${fmt(row.p50).padStart(8)}  ${fmt(row.p95).padStart(8)}  ${modules}${pw}`);
  }
  lines.push('');
  lines.push('  判据：--version / validate 的 playwright 命中必须为 0；run 必须 > 0（执行臂仍在）。');
  lines.push('  墙钟仅作度量参考，不是 CI 门禁（共享 runner 差异 3–5 倍）。');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`bench-cli-startup: ${error?.message ?? error}\n`);
    process.exit(1);
  });
