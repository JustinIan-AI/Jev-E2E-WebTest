/**
 * Task 10 — IDWTH CLI 入口与命令路由（DD §10，AC-13）。
 *
 * 单次执行：解析 → 分发 → 退出码。任何命令都不残留监听端口 / 守护进程。
 * 退出码六值见 exit-codes.ts：0 PASS / 1 FAIL / 2 BLOCKED / 3 CONFIG_ERROR /
 * 4 RUNTIME_ERROR / 130 CANCELLED。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CancelledError,
  UsageError,
  isCommandName,
  parseDoctorArgs,
  parseReplayArgs,
  parseReportArgs,
  parseRunOptions,
  type CliDeps,
  type DoctorContext,
  type ReplayContext,
  type ReportContext,
  type RunContext,
} from './commands.js';
import { EXIT_CODES } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';
import { RUNS_DIR } from './paths.js';
import { ContractConfigError, loadContractFile } from '../runtime/contract/loader.js';
import { validateContract } from '../runtime/contract/validate.js';
import {
  currentJudgeImplHash,
  recomputeJudge,
} from '../runtime/judge/recompute.js';

const VERSION = '0.1.0';

export interface MainOptions {
  cwd?: string;
  deps?: CliDeps;
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  options: MainOptions = {},
): Promise<ExitCode> {
  const cwd = options.cwd ?? process.cwd();
  const deps = options.deps ?? {};
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return EXIT_CODES.PASS;
  }
  if (command === '--version' || command === '-V') {
    process.stdout.write(`idwth ${VERSION}\n`);
    return EXIT_CODES.PASS;
  }
  if (!isCommandName(command)) {
    process.stderr.write(`idwth: 未知命令 '${command}'\n\n${USAGE}`);
    return EXIT_CODES.CONFIG_ERROR;
  }

  return runCommand(command, rest, cwd, deps);
}

async function runCommand(
  command: string,
  rest: readonly string[],
  cwd: string,
  deps: CliDeps,
): Promise<ExitCode> {
  try {
    switch (command) {
      case 'init':
        return await cmdInit(cwd);
      case 'validate':
        return await cmdValidate(rest, cwd);
      case 'run':
        return await cmdRun(rest, cwd, deps);
      case 'replay':
        return await cmdReplay(rest, cwd, deps);
      case 'report':
        return await cmdReport(rest, cwd, deps);
      case 'doctor':
        return await cmdDoctor(rest, cwd, deps);
      case 'judge':
        return await cmdJudge(rest, cwd);
      default:
        process.stderr.write(`idwth: 未知命令 '${command}'\n`);
        return EXIT_CODES.CONFIG_ERROR;
    }
  } catch (error) {
    return mapError(error);
  }
}

/** 统一错误 → 退出码映射。 */
function mapError(error: unknown): ExitCode {
  if (error instanceof CancelledError) {
    process.stderr.write(`idwth: 已取消：${error.message}\n`);
    return EXIT_CODES.CANCELLED;
  }
  if (error instanceof UsageError || error instanceof ContractConfigError) {
    process.stderr.write(`idwth: ${error.message}\n`);
    return EXIT_CODES.CONFIG_ERROR;
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`idwth: 内部错误：${message}\n`);
  return EXIT_CODES.RUNTIME_ERROR;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const EXAMPLE_CONTRACT_YAML = `version: '1'
test:
  id: example.workload.create
  name: 示例 · 创建 Deployment
environment:
  base_url: https://example.com
identity:
  role: operator
  credentials_ref: cred://staging-operator
goal: 创建一个 Deployment 并确认其进入 Running
steps:
  - intent: 进入工作负载页面
    action: click
    target: 工作负载 导航项
    risk: reversible
  - intent: 提交创建
    action: click
    target: 确认按钮
    risk: irreversible
    postcondition:
      - kind: visible
        target: Deployment 详情页标题
  - intent: 仅做断言
    action: assert_only
    risk: reversible
assertions:
  dom:
    - kind: visible
      target: deployment-name-cell
      text_contains: idwth-run-cid
  http:
    - method: POST
      path_prefix: /api/deployments
      status: 201
      within_run: true
`;

async function cmdInit(cwd: string): Promise<ExitCode> {
  const root = path.join(cwd, '.idwth');
  await mkdir(path.join(root, 'contracts'), { recursive: true });
  await mkdir(path.join(root, 'runs'), { recursive: true });

  const examplePath = path.join(root, 'contracts', 'example.contract.yaml');
  await writeFile(examplePath, EXAMPLE_CONTRACT_YAML, 'utf8');

  // Task 10 阶段先落静态探测框架；动态端口/连通性探测在 doctor（Task 16）交付。
  const probe = {
    generated_at: new Date().toISOString(),
    chrome_debug_port: { status: 'not_checked' },
    remote_allow_origins: { status: 'not_checked' },
    jev_endpoint: { status: 'not_checked' },
    target_permissions: { status: 'not_checked' },
    note: '动态环境探测由 idwth doctor 完成（Task 16）',
  };
  await writeFile(path.join(root, 'env-probe.json'), `${JSON.stringify(probe, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `idwth: 已在 ${root} 生成脚手架\n` +
      `  - contracts/example.contract.yaml（示例 Contract）\n` +
      `  - env-probe.json（环境探测报告）\n` +
      `下一步：idwth validate ${path.relative(cwd, examplePath) || '.idwth/contracts/example.contract.yaml'}\n`,
  );
  return EXIT_CODES.PASS;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function cmdValidate(rest: readonly string[], cwd: string): Promise<ExitCode> {
  const json = rest.includes('--json');
  const positional = rest.find((a) => !a.startsWith('--'));
  if (positional === undefined) {
    throw new UsageError('用法：idwth validate <contract> [--json]');
  }
  for (const a of rest) {
    if (a.startsWith('--') && a !== '--json') {
      throw new UsageError(`未知选项：${a}`);
    }
  }

  const filePath = path.resolve(cwd, positional);
  let payload: { valid: boolean; violations?: unknown[] };
  try {
    const loaded = await loadContractFile(filePath);
    // loader 已做九条校验；再跑一次以拿到结构化结果（供 --json）。
    const result = validateContract(loaded.contract);
    payload = { valid: result.valid, ...(result.valid ? {} : { violations: result.violations }) };
  } catch (error) {
    if (error instanceof ContractConfigError) {
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ valid: false, violations: error.violations }, null, 2)}\n`,
        );
      }
      throw error;
    }
    throw error;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.valid) {
    process.stdout.write(`idwth: Contract 校验通过：${filePath}\n`);
  }
  return payload.valid ? EXIT_CODES.PASS : EXIT_CODES.CONFIG_ERROR;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function cmdRun(rest: readonly string[], cwd: string, deps: CliDeps): Promise<ExitCode> {
  const { contractPath, options } = parseRunOptions(rest);
  if (contractPath === undefined) {
    throw new UsageError('用法：idwth run <contract> [--repeat N] [--provider mock|jev] [--max-cost X] [--freeze] [--json]');
  }
  // 用例写错了先挡在执行之前（exit 3），不进入 runner。
  const loaded = await loadContractFile(path.resolve(cwd, contractPath));

  if (deps.run === undefined) {
    process.stderr.write('idwth: run 执行能力将在 Task 14 交付；当前版本仅提供命令入口与参数校验\n');
    return EXIT_CODES.RUNTIME_ERROR;
  }
  const ctx: RunContext = { cwd, loaded, options };
  return await deps.run(ctx);
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

async function cmdReplay(rest: readonly string[], cwd: string, deps: CliDeps): Promise<ExitCode> {
  const { tracePath, verify, heal } = parseReplayArgs(rest);
  if (tracePath === undefined) {
    throw new UsageError('用法：idwth replay <trace> --verify|--heal');
  }
  if (deps.replay === undefined) {
    process.stderr.write('idwth: replay 执行能力将在 Task 15 交付；当前版本仅提供命令入口与参数校验\n');
    return EXIT_CODES.RUNTIME_ERROR;
  }
  const ctx: ReplayContext = { cwd, tracePath: path.resolve(cwd, tracePath), verify, heal };
  return await deps.replay(ctx);
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

async function cmdReport(rest: readonly string[], cwd: string, deps: CliDeps): Promise<ExitCode> {
  const parsed = parseReportArgs(rest);
  if (parsed.runId === undefined) {
    throw new UsageError('用法：idwth report <run_id> [--open] [--export]');
  }
  if (deps.report === undefined) {
    process.stderr.write('idwth: 报告生成能力将在 Task 11 交付；当前版本仅提供命令入口与参数校验\n');
    return EXIT_CODES.RUNTIME_ERROR;
  }
  const ctx: ReportContext = { cwd, runId: parsed.runId, open: parsed.open, export: parsed.export };
  return await deps.report(ctx);
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

async function cmdDoctor(rest: readonly string[], cwd: string, deps: CliDeps): Promise<ExitCode> {
  parseDoctorArgs(rest);
  if (deps.doctor === undefined) {
    process.stderr.write('idwth: 端口自愈 / 残留进程清理将在 Task 16 交付；当前版本仅提供命令入口\n');
    return EXIT_CODES.RUNTIME_ERROR;
  }
  const ctx: DoctorContext = { cwd };
  return await deps.doctor(ctx);
}

// ---------------------------------------------------------------------------
// judge recompute
// ---------------------------------------------------------------------------

async function cmdJudge(rest: readonly string[], cwd: string): Promise<ExitCode> {
  const [subcommand, ...subRest] = rest;
  if (subcommand !== 'recompute') {
    throw new UsageError(`用法：idwth judge recompute <run_id>（未知子命令：${subcommand ?? '（空）'}）`);
  }
  const runId = subRest[0];
  if (runId === undefined) {
    throw new UsageError('用法：idwth judge recompute <run_id>');
  }
  for (const a of subRest.slice(1)) {
    if (a.startsWith('--')) throw new UsageError(`未知选项：${a}`);
  }

  const runDir = path.join(cwd, RUNS_DIR, runId);
  let manifestExists: boolean;
  try {
    await readFile(path.join(runDir, 'evidence-manifest.json'), 'utf8');
    manifestExists = true;
  } catch {
    manifestExists = false;
  }
  if (!manifestExists) {
    throw new UsageError(`找不到 run 归档：${runDir}`);
  }

  const result = await recomputeJudge(runDir, { expectedJudgeImplHash: currentJudgeImplHash() });
  if (result.status === 'integrity_error') {
    process.stderr.write(`idwth: verdict 重算完整性错误：${result.code}\n`);
    // verdict_hash 不一致 / 证据损坏 / 绑定漂移 = 归档不可信 = RUNTIME_ERROR(4)。
    return EXIT_CODES.RUNTIME_ERROR;
  }

  process.stdout.write(
    `idwth: recompute MATCH run=${runId} verdict=${result.verdict} hash=${result.verdictHash}\n`,
  );
  if (result.verdict === 'PASS') return EXIT_CODES.PASS;
  if (result.verdict === 'FAIL') return EXIT_CODES.FAIL;
  return EXIT_CODES.BLOCKED;
}

const USAGE = `idwth - Intent-Driven Web Test Harness v${VERSION}

Usage: idwth <command> [options]

Commands:
  init        Scaffold .idwth/ + example contract + environment probe
  validate    Validate a contract (schema + 9 executability rules)
  run         Execute a contract (one-shot)
  replay      Replay a trace (--verify default | --heal explicit)
  report      Render/export a static self-contained report
  doctor      Environment diagnostics (port/process self-heal)
  judge       judge recompute <run_id>  — offline verdict recomputation

Exit codes: 0 PASS · 1 FAIL · 2 BLOCKED · 3 CONFIG_ERROR · 4 RUNTIME_ERROR · 130 CANCELLED

All commands run once and exit; there is no daemon or server mode.
`;

// Only execute when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = EXIT_CODES.RUNTIME_ERROR;
    });
}
