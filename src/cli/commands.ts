/**
 * Task 10 — 命令面、参数解析与命令上下文（DD §10，AC-13）。
 *
 * 仅含纯解析/类型逻辑：不持有浏览器或模型引用；默认 handler 装配在 index.ts。
 * 刻意不存在 daemon/serve/start-server。
 */
import type { ExitCode } from './exit-codes.js';
import type { LoadedContract } from '../runtime/contract/loader.js';

/** 用法 / 参数错误 → CONFIG_ERROR(3)。 */
export class UsageError extends Error {}

/** 用户取消（SIGINT / 超总预算）→ CANCELLED(130)，不进 verdict 聚合。 */
export class CancelledError extends Error {}

export interface CommandContext {
  readonly cwd: string;
}

/**
 * 命令封闭集（DD §10）。无 daemon / serve / start-server。
 */
export const COMMANDS = [
  'init',
  'validate',
  'run',
  'replay',
  'report',
  'doctor',
  'judge',
  'complete',
] as const;

export type CommandName = (typeof COMMANDS)[number];

export function isCommandName(name: string): name is CommandName {
  return (COMMANDS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// 通用选项解析
// ---------------------------------------------------------------------------

export interface OptionSpec {
  /** 选项名（不含 -- 前缀）。 */
  readonly name: string;
  /** 是否接收值；不接收即为布尔开关。 */
  readonly takesValue?: boolean;
}

export interface ParsedCommand {
  readonly positionals: readonly string[];
  /** 已给出的选项：布尔开关为 true，取值选项为原始字符串。 */
  readonly values: Readonly<Record<string, string | boolean>>;
}

/**
 * 解析 `--name` / `--name=value` / `--name value`（takesValue 时消耗下一 token）。
 * 未知 flag 或缺失取值抛 UsageError，由路由层映射为 3。
 */
export function parseCommand(argv: readonly string[], specs: readonly OptionSpec[]): ParsedCommand {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const positionals: string[] = [];
  const values: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    const name = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    const spec = byName.get(name);
    if (spec === undefined) {
      throw new UsageError(`未知选项：--${name}`);
    }
    if (spec.takesValue) {
      let value: string;
      if (inline !== undefined) {
        value = inline;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new UsageError(`选项 --${name} 需要一个值`);
        }
        value = next;
        i += 1;
      }
      values[name] = value;
    } else {
      values[name] = true;
    }
  }

  return { positionals, values };
}

function optionValue(values: Readonly<Record<string, string | boolean>>, name: string): string | undefined {
  const v = values[name];
  return typeof v === 'string' ? v : undefined;
}

function flagValue(values: Readonly<Record<string, string | boolean>>, name: string): boolean {
  return values[name] === true;
}

// ---------------------------------------------------------------------------
// 命令上下文与 handler 契约
// ---------------------------------------------------------------------------

export interface RunOptions {
  repeat: number;
  provider: 'mock' | 'jev';
  maxCost?: number;
  freeze: boolean;
  json: boolean;
}

export interface RunContext extends CommandContext {
  loaded: LoadedContract;
  options: RunOptions;
}

export interface ReplayContext extends CommandContext {
  tracePath: string;
  /** 默认零模型重放；漂移即 BLOCKED(drift)。 */
  verify: boolean;
  /** 显式允许 recovery；产物不入 CI。 */
  heal: boolean;
}

export interface ReportContext extends CommandContext {
  runId: string;
  open: boolean;
  export: boolean;
}

export interface DoctorContext extends CommandContext {}

export type CommandHandler<T extends CommandContext = CommandContext> = (
  ctx: T,
) => Promise<ExitCode> | ExitCode;

/**
 * 可注入命令依赖。validate / judge recompute / report 默认走真实路径无需注入；
 * run / replay / doctor 的完整能力在后续任务交付，默认入口明确返回 4。
 * openPath 供 report --open 打开渲染产物；测试注入以避免触碰真实桌面环境。
 */
export interface CliDeps {
  run?: CommandHandler<RunContext>;
  replay?: CommandHandler<ReplayContext>;
  report?: CommandHandler<ReportContext>;
  doctor?: CommandHandler<DoctorContext>;
  openPath?: (target: string) => void;
}

// ---------------------------------------------------------------------------
// 各命令的类型化解析
// ---------------------------------------------------------------------------

const RUN_SPECS: readonly OptionSpec[] = [
  { name: 'repeat', takesValue: true },
  { name: 'provider', takesValue: true },
  { name: 'max-cost', takesValue: true },
  { name: 'freeze' },
  { name: 'json' },
];

/** 解析 run 选项并完成取值域校验；失败抛 UsageError。 */
export function parseRunOptions(argv: readonly string[]): {
  contractPath: string | undefined;
  options: RunOptions;
} {
  const parsed = parseCommand(argv, RUN_SPECS);
  const contractPath = parsed.positionals[0];

  const repeatRaw = optionValue(parsed.values, 'repeat') ?? '1';
  const repeat = Number(repeatRaw);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new UsageError(`--repeat 必须是正整数，收到 '${repeatRaw}'`);
  }

  const providerRaw = optionValue(parsed.values, 'provider') ?? 'mock';
  if (providerRaw !== 'mock' && providerRaw !== 'jev') {
    throw new UsageError(`--provider 仅支持 mock|jev，收到 '${providerRaw}'`);
  }

  let maxCost: number | undefined;
  const maxCostRaw = optionValue(parsed.values, 'max-cost');
  if (maxCostRaw !== undefined) {
    maxCost = Number(maxCostRaw);
    if (!Number.isFinite(maxCost) || maxCost <= 0) {
      throw new UsageError(`--max-cost 必须是正数，收到 '${maxCostRaw}'`);
    }
  }

  return {
    contractPath,
    options: {
      repeat,
      provider: providerRaw,
      ...(maxCost !== undefined ? { maxCost } : {}),
      freeze: flagValue(parsed.values, 'freeze'),
      json: flagValue(parsed.values, 'json'),
    },
  };
}

const REPLAY_SPECS: readonly OptionSpec[] = [{ name: 'verify' }, { name: 'heal' }];

export function parseReplayArgs(
  argv: readonly string[],
): { tracePath?: string; verify: boolean; heal: boolean } {
  const parsed = parseCommand(argv, REPLAY_SPECS);
  const tracePath = parsed.positionals[0];
  const verify = flagValue(parsed.values, 'verify');
  const heal = flagValue(parsed.values, 'heal');
  if (verify && heal) {
    throw new UsageError('--verify 与 --heal 互斥，只能选择其一');
  }
  // 默认 verify（零模型）；--heal 为显式 recovery。
  return {
    ...(tracePath !== undefined ? { tracePath } : {}),
    verify: !heal,
    heal,
  };
}

const REPORT_SPECS: readonly OptionSpec[] = [{ name: 'open' }, { name: 'export' }];

export function parseReportArgs(
  argv: readonly string[],
): { runId?: string; open: boolean; export: boolean } {
  const parsed = parseCommand(argv, REPORT_SPECS);
  return {
    ...(parsed.positionals[0] !== undefined ? { runId: parsed.positionals[0] } : {}),
    open: flagValue(parsed.values, 'open'),
    export: flagValue(parsed.values, 'export'),
  };
}

/** doctor 不接受任何 flag。 */
export function parseDoctorArgs(argv: readonly string[]): void {
  const parsed = parseCommand(argv, []);
  if (parsed.positionals.length > 0) {
    throw new UsageError(`doctor 不接受位置参数：${parsed.positionals.join(' ')}`);
  }
}

export interface CompleteArgs {
  readonly draftPath: string;
  readonly apply?: boolean;
  readonly json?: boolean;
  readonly out?: string;
}

const COMPLETE_SPECS: readonly OptionSpec[] = [
  { name: "apply" },
  { name: "json" },
  { name: "out", takesValue: true },
];

export function parseCompleteArgs(argv: readonly string[]): CompleteArgs {
  const parsed = parseCommand(argv, COMPLETE_SPECS);
  if (parsed.positionals.length === 0) {
    throw new UsageError("用法：idwth complete <draft.yaml> [--apply] [--json] [--out <dir>]");
  }
  if (parsed.positionals.length > 1) {
    throw new UsageError(`idwth complete 仅接收一个 draft 文件路径，收到 ${parsed.positionals.length} 个`);
  }
  const outVal = parsed.values["out"];
  return {
    draftPath: parsed.positionals[0]!,
    apply: flagValue(parsed.values, "apply"),
    json: flagValue(parsed.values, "json"),
    ...(typeof outVal === "string" ? { out: outVal } : {}),
  };
}
