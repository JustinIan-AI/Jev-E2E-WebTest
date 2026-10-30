/**
 * Task 16 前置装配 —— CLI `run` 命令的默认 handler（生产装配位）。
 *
 * 闭环：LoadedContract → PlaywrightProvider CDP attach（复用用户 Chrome 登录态，
 * TR-4.2 只断连）→ executeCase（L1/L2 确定性，零模型，TR-12.2）→ judge 归档
 * （writeOnlineJudgeArtifacts，verdict_hash 绑定）→ report.json → 六值退出码。
 *
 * 语义决策（§7.4 JEV mock/jev）与批量 repeat 的装配随各自任务交付；当前
 * --provider 两种取值均按纯确定性路径执行（L1/L2 未命中 → BLOCKED(decision)）。
 *
 * verdict 聚合（详设 §5.5.9 骨架）：
 *   - case 执行受阻 → BLOCKED（执行受阻原因写入 report.failure_reason）；
 *     judge 以「空断言集」保守求值 → BLOCKED(evidence)，judge-result.json 仍可
 *     离线 recompute（绝不以部分证据伪造 FAIL）。
 *   - case 完成 → verdict = judge(contract.assertions, 终态观测)（纯函数、权威）。
 *
 * 环境配置：IDWTH_CDP_ENDPOINT（默认 http://127.0.0.1:9222，Chrome 需以
 * --remote-debugging-port 启动）。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunContext } from './commands.js';
import { EXIT_CODES, type ExitCode } from './exit-codes.js';
import { PlaywrightProvider } from '../engine-provider/playwright/provider.js';
import type {
  ArtifactRef,
  AssertionSpec,
  EngineProvider,
  SemanticTarget,
} from '../engine-provider/index.js';
import type { FreshnessCapable } from '../runtime/freshness.js';
import { executeCase, type ExecutorStep } from '../runtime/executor.js';
import { createRunId } from '../runtime/scope.js';
import {
  currentJudgeImplHash,
  writeOnlineJudgeArtifacts,
} from '../runtime/judge/recompute.js';
import type {
  DomAssertionSpec,
  HttpAssertionSpec,
  JudgeAssertions,
  JudgeResult,
} from '../runtime/judge/types.js';
import { writeReportArtifacts } from '../runtime/report/index.js';
import type {
  ReportAssertionResult,
  ReportSeed,
  ReportScreenshotInput,
} from '../runtime/report/types.js';

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';

/** provider 连接工厂输入（origins 允许列表由 contract 环境推导）。 */
export interface ConnectProviderInput {
  cdpEndpoint: string;
  originsAllowlist: string[];
  actionTimeoutMs?: number;
  /** Issue #24：SUT 适配提供的应用就绪标志。 */
  appReadySelector?: string;
  appReadyTimeoutMs?: number;
  resolvePollMaxMs?: number;
  resolvePollIntervalMs?: number;
}

export type ConnectProvider = (input: ConnectProviderInput) => Promise<
  EngineProvider & FreshnessCapable
>;

export interface RunHandlerOptions {
  /** 缺省 = PlaywrightProvider（CDP attach 主干臂）；测试注入替身。 */
  connectProvider?: ConnectProvider;
  /** 环境变量来源；缺省 process.env（测试注入）。 */
  env?: Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Contract 视图（schema 已在 validate 阶段保证形状，此处只做轻量视图与映射）
// ---------------------------------------------------------------------------

interface ContractStepView {
  intent: string;
  action: ExecutorStep['action'];
  target?: string;
  value?: string;
  url?: string;
  ms?: number;
  deltaY?: number;
  risk: 'reversible' | 'irreversible';
  postcondition?: Array<Record<string, unknown>>;
}

interface ContractView {
  test: { id: string; name: string };
  environment: {
    base_url: string;
    origins_allowlist?: string[];
    action_timeout_ms?: number;
    /** Issue #24：SUT 适配项 —— 应用就绪标志（如 `#root .ant-layout`）。 */
    app_ready_selector?: string;
    /** Issue #24：就绪门超时（ms），默认 10000。 */
    app_ready_timeout_ms?: number;
    /** Issue #24：L1 miss 轮询窗口（ms），默认 5000；0 = 关闭。 */
    resolve_poll_max_ms?: number;
    /** Issue #24：轮询间隔（ms），默认 250。 */
    resolve_poll_interval_ms?: number;
  };
  goal: string;
  steps: ContractStepView[];
  assertions?: {
    dom?: Array<Record<string, unknown>>;
    http?: Array<Record<string, unknown>>;
    backend?: Array<Record<string, unknown>>;
    state?: Array<Record<string, unknown>>;
  };
}

/**
 * Contract target 字符串 → 语义目标。约定：人可读语义短语按「元素文本子串」
 * 匹配（与 judge 的 name/text 子串匹配同哲学）；禁止 selector（§3.4）。
 */
function semanticTargetOf(target: string): SemanticTarget {
  return { text: target, match: 'substring' };
}

/** postcondition 条目 → 引擎断言规格（equals 为 judge 侧命名，映射到 expected）。 */
function engineAssertionSpec(raw: Record<string, unknown>): AssertionSpec {
  const target = typeof raw.target === 'string' ? semanticTargetOf(raw.target) : undefined;
  const expected = raw.expected ?? raw.equals;
  const spec: AssertionSpec = { kind: raw.kind as AssertionSpec['kind'] };
  if (target !== undefined) spec.target = target;
  if (expected !== undefined) spec.expected = expected as NonNullable<AssertionSpec['expected']>;
  if (raw.allow_multiple !== undefined) spec.allow_multiple = Boolean(raw.allow_multiple);
  return spec;
}

function stepsOf(contract: ContractView): ExecutorStep[] {
  return contract.steps.map((step) => ({
    intent: step.intent,
    action: step.action,
    risk: step.risk,
    ...(step.target !== undefined ? { target: semanticTargetOf(step.target) } : {}),
    ...(step.value !== undefined ? { value: step.value } : {}),
    ...(step.url !== undefined ? { url: step.url } : {}),
    ...(step.ms !== undefined ? { ms: step.ms } : {}),
    ...(step.deltaY !== undefined ? { deltaY: step.deltaY } : {}),
    ...(step.postcondition !== undefined
      ? { postcondition: step.postcondition.map(engineAssertionSpec) }
      : {}),
  }));
}

/** contract.assertions → Judge 断言集（dom 字段与 DomAssertionSpec 同构，直接透传）。 */
function judgeAssertionsOf(contract: ContractView): JudgeAssertions {
  const a = contract.assertions ?? {};
  return {
    dom: (a.dom ?? []) as unknown as DomAssertionSpec[],
    http: (a.http ?? []).map((raw) => ({
      kind: 'http',
      method: String(raw.method ?? ''),
      ...(raw.path_prefix !== undefined ? { path_prefix: String(raw.path_prefix) } : {}),
      ...(raw.path_equals !== undefined ? { path_equals: String(raw.path_equals) } : {}),
      status_equals: Number(raw.status ?? raw.status_equals ?? 0),
      ...(raw.within_run !== undefined ? { within_run: Boolean(raw.within_run) } : {}),
    })),
    backend: (a.backend ?? []).map((raw) => ({
      kind: 'backend',
      key: String(raw.key ?? ''),
      equals: raw.equals,
    })),
    state: (a.state ?? []).map((raw) => ({
      kind: 'state',
      key: String(raw.key ?? ''),
      equals: raw.equals,
    })),
  };
}

// ---------------------------------------------------------------------------
// 报告辅助
// ---------------------------------------------------------------------------

function domDescription(s: Record<string, unknown>): string {
  const parts = [String(s.kind)];
  if (typeof s.target === 'string') parts.push(s.target);
  if (s.equals !== undefined) parts.push(`equals ${String(s.equals)}`);
  if (s.text_contains !== undefined) parts.push(`contains "${String(s.text_contains)}"`);
  return parts.join(' ');
}

/** 与 judge 求值顺序（dom→http→backend→state）对齐的可读描述。 */
function describeAssertion(
  kind: string,
  spec: Record<string, unknown>,
): string {
  if (kind === 'http') {
    const target = String(spec.path_prefix ?? spec.path_equals ?? '');
    return `http ${String(spec.method)} ${target} → ${String(spec.status_equals)}`;
  }
  if (kind === 'backend' || kind === 'state') {
    return `${kind} ${String(spec.key)} equals ${JSON.stringify(spec.equals) ?? ''}`;
  }
  return domDescription(spec);
}

function assertionResultsOf(
  assertions: JudgeAssertions,
  judgeResult: JudgeResult,
): ReportAssertionResult[] {
  const ordered = [
    ...assertions.dom,
    ...(assertions.http ?? []),
    ...(assertions.backend ?? []),
    ...(assertions.state ?? []),
  ];
  return judgeResult.assertionResults.map((r, i) => ({
    kind: r.kind,
    description: describeAssertion(r.kind, (ordered[i] ?? {}) as Record<string, unknown>),
    passed: r.passed,
    state: r.result,
    evidence_ref: r.evidenceRef,
  }));
}

function failureReasonOf(
  verdict: 'PASS' | 'FAIL' | 'BLOCKED',
  results: ReportAssertionResult[],
  judgeBlockedReason: string | null,
): string | null {
  if (verdict === 'PASS') return null;
  if (verdict === 'FAIL') {
    const first = results.find((r) => !r.passed);
    return first ? `断言未通过：${first.description}` : '断言未通过';
  }
  return judgeBlockedReason !== null ? `判定受阻：${judgeBlockedReason}` : '判定受阻';
}

/** ArtifactRef → 内容 Buffer（contentBase64 内联优先，否则 artifact:// 文件路径）。 */
async function artifactBuffer(ref: ArtifactRef): Promise<Buffer> {
  if (ref.contentBase64) return Buffer.from(ref.contentBase64, 'base64');
  const filePath = ref.uri.startsWith('artifact://')
    ? ref.uri.slice('artifact://'.length)
    : ref.uri;
  return readFile(filePath);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

/**
 * 构造默认 run handler。CLI index.ts 以 `deps.run ?? createRunHandler()` 装配；
 * 测试经 connectProvider 注入替身 provider。
 */
export function createRunHandler(options: RunHandlerOptions = {}): (ctx: RunContext) => Promise<ExitCode> {
  const env = options.env ?? process.env;
  const connectProvider: ConnectProvider =
    options.connectProvider ??
    ((input) =>
      PlaywrightProvider.connect({
        cdpEndpoint: input.cdpEndpoint,
        originsAllowlist: input.originsAllowlist,
        ...(input.actionTimeoutMs !== undefined
          ? { actionTimeoutMs: input.actionTimeoutMs }
          : {}),
        // Issue #24：就绪门 / 轮询配置（SUT 适配提供，缺省走 provider 默认值）。
        ...(input.appReadySelector !== undefined
          ? { appReadySelector: input.appReadySelector }
          : {}),
        ...(input.appReadyTimeoutMs !== undefined
          ? { appReadyTimeoutMs: input.appReadyTimeoutMs }
          : {}),
        ...(input.resolvePollMaxMs !== undefined
          ? { resolvePollMaxMs: input.resolvePollMaxMs }
          : {}),
        ...(input.resolvePollIntervalMs !== undefined
          ? { resolvePollIntervalMs: input.resolvePollIntervalMs }
          : {}),
      }));

  return async function runHandler(ctx: RunContext): Promise<ExitCode> {
    if (ctx.options.repeat > 1) {
      process.stderr.write('idwth: --repeat > 1 将随批量执行任务交付；当前版本仅支持单次执行\n');
      return EXIT_CODES.RUNTIME_ERROR;
    }

    const contract = ctx.loaded.contract as unknown as ContractView;
    const baseUrl = contract.environment.base_url;
    const originsAllowlist = [baseUrl, ...(contract.environment.origins_allowlist ?? [])];
    const cdpEndpoint = (env.IDWTH_CDP_ENDPOINT ?? '').trim() || DEFAULT_CDP_ENDPOINT;

    let provider: EngineProvider & FreshnessCapable;
    try {
      provider = await connectProvider({
        cdpEndpoint,
        originsAllowlist,
        ...(contract.environment.action_timeout_ms !== undefined
          ? { actionTimeoutMs: contract.environment.action_timeout_ms }
          : {}),
        // Issue #24：SUT 适配的就绪门 / 轮询配置（缺省由 provider 决定）。
        ...(contract.environment.app_ready_selector !== undefined
          ? { appReadySelector: contract.environment.app_ready_selector }
          : {}),
        ...(contract.environment.app_ready_timeout_ms !== undefined
          ? { appReadyTimeoutMs: contract.environment.app_ready_timeout_ms }
          : {}),
        ...(contract.environment.resolve_poll_max_ms !== undefined
          ? { resolvePollMaxMs: contract.environment.resolve_poll_max_ms }
          : {}),
        ...(contract.environment.resolve_poll_interval_ms !== undefined
          ? { resolvePollIntervalMs: contract.environment.resolve_poll_interval_ms }
          : {}),
      });
    } catch (error) {
      process.stderr.write(
        `idwth: 无法连接 Chrome CDP 端点 ${cdpEndpoint}` +
          `（Chrome 需以 --remote-debugging-port=<port> 启动且至少有一个标签页）：${errorMessage(error)}\n`,
      );
      return EXIT_CODES.RUNTIME_ERROR;
    }

    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const contractRel = path.relative(ctx.cwd, ctx.loaded.filePath) || ctx.loaded.filePath;

    try {
      // ① 打开 SUT：优先「前台新标签页臂」（复用用户 context 登录态、不污染
      //    用户既有标签页）；provider 不支持该能力时以 navigate 动作兜底。
      const tabCapable = provider as EngineProvider &
        Partial<{ openForegroundTab(url: string): Promise<unknown> }>;
      if (typeof tabCapable.openForegroundTab === 'function') {
        await tabCapable.openForegroundTab(baseUrl);
      } else {
        const nav = await provider.act({ kind: 'navigate', risk: 'reversible', url: baseUrl });
        if (nav.status === 'nav_blocked') {
          process.stderr.write(`idwth: base_url 不在 origins 允许列表内：${baseUrl}\n`);
          return EXIT_CODES.CONFIG_ERROR;
        }
        if (nav.status !== 'ok') {
          process.stderr.write(`idwth: 打开 base_url 失败：${nav.status}\n`);
          return EXIT_CODES.RUNTIME_ERROR;
        }
      }

      // ② 基线观测：建立 Freshness 比对基准（§5.5.6，Runtime 独占③的前置）。
      await provider.observe();

      // ③ 确定性执行（L1/L2；零模型介入，TR-12.2）。
      const caseResult = await executeCase(
        { id: contract.test.id, steps: stepsOf(contract) },
        provider,
        { secrets: [] },
      );

      // ④ 终态观测 → judge 归档。case 受阻时以空断言集保守求值（BLOCKED(evidence)），
      //    绝不以部分证据伪造 FAIL；judge-result 仍满足离线 recompute 一致性。
      const finalObservation = await provider.observe();
      const assertions: JudgeAssertions =
        caseResult.status === 'completed'
          ? judgeAssertionsOf(contract)
          : { dom: [], http: [], backend: [], state: [] };
      const { judgeResult } = await writeOnlineJudgeArtifacts({
        rootDir: ctx.cwd,
        runId,
        input: {
          assertions,
          evidence: {
            elements: finalObservation.elements.map((el) => ({
              id: el.id,
              role: el.role,
              name: el.name,
              text: el.text,
              visible: el.visible,
              enabled: el.enabled,
            })),
            url: finalObservation.url,
            runStartedAt: startedAt,
            http: [],
            backend: [],
          },
          evaluatedAt: new Date().toISOString(),
        },
        judgeImplHash: currentJudgeImplHash(),
      });

      // ⑤ verdict 聚合：case 受阻 → BLOCKED 优先（§5.5.9 默认 BLOCKED 语义）。
      const verdict: 'PASS' | 'FAIL' | 'BLOCKED' =
        caseResult.status === 'blocked' ? 'BLOCKED' : judgeResult.verdict;
      const failureReason =
        caseResult.status === 'blocked'
          ? `执行受阻：${caseResult.reason}${
              caseResult.reasonDetail ? `（${caseResult.reasonDetail}）` : ''
            }`
          : failureReasonOf(verdict, assertionResultsOf(assertions, judgeResult), judgeResult.blockedReason);

      // ⑥ 截图归档（非致命：截图失败不改变 verdict 与证据三件套）。
      const screenshots: ReportScreenshotInput[] = [];
      try {
        const ref = await provider.screenshot({ mask: [] });
        screenshots.push({
          name: 'final.png',
          caption: '执行结束页面状态',
          content: await artifactBuffer(ref),
        });
      } catch {
        // 截图能力缺失/失败 → 报告无截图，不阻断判定。
      }

      // ⑦ report.json（五要素权威数据；report.html 由 `idwth report` 渲染）。
      const seed: ReportSeed = {
        case: {
          id: contract.test.id,
          name: contract.test.name,
          goal: contract.goal,
          base_url: baseUrl,
        },
        steps: contract.steps.map((step, index) => ({
          index: index + 1,
          intent: step.intent,
          action: step.action,
          ...(step.target !== undefined ? { target: step.target } : {}),
          risk: step.risk,
        })),
        assertion_results: assertionResultsOf(assertions, judgeResult),
        verdict,
        failure_reason: failureReason,
        reproduction: {
          contract_path: contractRel,
          provider: provider.id,
          rerun_command: `idwth run ${contractRel}`,
        },
      };
      await writeReportArtifacts({
        rootDir: ctx.cwd,
        runId,
        data: seed,
        generatedAt: new Date().toISOString(),
        screenshots,
      });

      // ⑧ 输出与退出码（六值：PASS 0 / FAIL 1 / BLOCKED 2）。
      if (ctx.options.json) {
        process.stdout.write(
          `${JSON.stringify({
            run_id: runId,
            verdict,
            ...(failureReason !== null ? { failure_reason: failureReason } : {}),
          })}\n`,
        );
      } else {
        process.stdout.write(
          `idwth: run ${runId} verdict=${verdict}` +
            `${failureReason !== null ? `（${failureReason}）` : ''}\n`,
        );
        process.stdout.write(
          `idwth: 报告数据：${path.join(ctx.cwd, '.idwth', 'runs', runId, 'report.json')}` +
            `（idwth report ${runId} 渲染）\n`,
        );
      }
      if (verdict === 'PASS') return EXIT_CODES.PASS;
      if (verdict === 'FAIL') return EXIT_CODES.FAIL;
      return EXIT_CODES.BLOCKED;
    } finally {
      // ★ TR-4.2：只断连，不杀用户浏览器；我们自己打开的标签页/隔离 context 一并清理。
      await provider.dispose();
    }
  };
}

/** CLI 缺省 run handler（生产装配位）。 */
export const defaultRunHandler = createRunHandler();
