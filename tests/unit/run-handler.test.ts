/**
 * Task 16 前置装配 —— 默认 run handler（CLI deps.run 缺省实现）单元测试。
 *
 * 被测对象：src/cli/run-handler.ts 的 createRunHandler / defaultRunHandler。
 * 装配闭环：contract → CDP provider 连接 → executeCase → judge 归档 → report.json。
 * 本文件以注入的 FakeProvider 覆盖分支语义（不依赖真实浏览器）；
 * 真实 CDP 链路由 tests/integration/run-cdp.test.ts 覆盖。
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import {
  createRunHandler,
  DEFAULT_CDP_ENDPOINT,
} from '../../src/cli/run-handler.js';
import type { RunContext } from '../../src/cli/commands.js';
import { loadContractFile } from '../../src/runtime/contract/loader.js';
import { currentJudgeImplHash, recomputeJudge } from '../../src/runtime/judge/recompute.js';
import type { ExitCode } from '../../src/cli/exit-codes.js';
import type {
  Action,
  ActionResult,
  AssertionResult,
  AssertionSpec,
  EngineProvider,
  Observation,
  ResolveResult,
  SemanticTarget,
} from '../../src/engine-provider/index.js';
import type { FreshnessCapable } from '../../src/runtime/freshness.js';

// ---------------------------------------------------------------------------
// FakeProvider：EngineProvider + FreshnessCapable 最小实现（可编程分支）
// ---------------------------------------------------------------------------

class FakeProvider implements EngineProvider, FreshnessCapable {
  readonly id = 'fake';
  readonly version = 'fake-1.0';

  disposed = false;
  readonly foregroundUrls: string[] = [];
  readonly navigatedUrls: string[] = [];
  /** resolve 可命中子串集（空集 = 全部 miss）。 */
  resolvable: string[] = ['创建'];
  /** observe() 返回的最终页面元素（name/text 片段）。 */
  finalElements: Array<{ name: string; text: string }> = [];
  screenshotThrows = false;

  /** 有此方法 → handler 走前台新标签页臂。 */
  async openForegroundTab(url: string): Promise<void> {
    this.foregroundUrls.push(url);
  }

  async resolve(target: SemanticTarget): Promise<ResolveResult> {
    const needle = target.text ?? target.name ?? '';
    const hit = this.resolvable.some((r) => r.includes(needle) || needle.includes(r));
    if (!hit) return { status: 'miss' };
    return { status: 'resolved', mode: 'L1', elementId: 'el-1', strategy: 'text' };
  }

  async act(action: Action): Promise<ActionResult> {
    if (action.kind === 'navigate') {
      this.navigatedUrls.push(action.url);
      return { kind: 'navigate', status: 'ok', dispatched: true };
    }
    if (action.kind === 'click' || action.kind === 'fill' || action.kind === 'select') {
      return { kind: action.kind, status: 'ok', dispatched: true };
    }
    return { kind: action.kind, status: 'ok', dispatched: false };
  }

  async observe(): Promise<Observation> {
    return {
      observationId: 'obs-fake',
      fingerprint: 'fp-fake',
      url: 'http://127.0.0.1:41111/final',
      title: 'Fake SUT',
      elements: this.finalElements.map((el, id) => ({
        id,
        role: 'button',
        name: el.name,
        text: el.text,
        visible: true,
        enabled: true,
        guard: `guard-${id}`,
      })),
      textExcerpt: this.finalElements.map((el) => el.text).join('\n'),
    };
  }

  async checkAssertion(spec: AssertionSpec): Promise<AssertionResult> {
    const needle = spec.target?.text ?? spec.target?.name ?? '';
    const found = this.finalElements.some(
      (el) => el.text.includes(needle) || el.name.includes(needle),
    );
    return { kind: spec.kind, passed: found, status: found ? 'passed' : 'failed' };
  }

  async screenshot() {
    if (this.screenshotThrows) throw new Error('screenshot boom');
    return {
      uri: 'artifact://fake/final.png',
      mediaType: 'image/png',
      contentBase64: Buffer.from('fake-png-bytes').toString('base64'),
    };
  }

  async trace() {
    return { uri: 'artifact://fake/trace.zip', mediaType: 'application/zip', contentBase64: '' };
  }

  async verifyFreshness(): Promise<boolean> {
    return true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

// ---------------------------------------------------------------------------
// Contract fixture 与执行辅助
// ---------------------------------------------------------------------------

function baseContract() {
  return {
    version: '1',
    test: { id: 'of.demo.flow', name: '示例流程' },
    environment: { base_url: 'http://127.0.0.1:41111' },
    identity: { role: 'operator', credentials_ref: 'cred://of-admin' },
    goal: '完成一次示例操作并确认结果可见',
    steps: [
      { intent: '点击创建', action: 'click', target: '创建', risk: 'reversible' },
      { intent: '确认结果', action: 'assert_only', risk: 'reversible' },
    ],
    assertions: { dom: [{ kind: 'visible', target: '部署完成' }] },
  };
}

interface HandlerFactoryOptions {
  connectProvider?: (input: {
    cdpEndpoint: string;
    originsAllowlist: string[];
    actionTimeoutMs?: number;
  }) => Promise<EngineProvider & FreshnessCapable>;
  env?: Record<string, string | undefined>;
}

function makeHandler(options: HandlerFactoryOptions = {}) {
  return createRunHandler(options);
}

const TMP_DIRS: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const dirs = TMP_DIRS.splice(0);
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function newTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-run-handler-'));
  TMP_DIRS.push(dir);
  return dir;
}

async function writeContractYaml(dir: string, contract: unknown): Promise<string> {
  const file = path.join(dir, 'demo.contract.yaml');
  await writeFile(file, stringifyYaml(contract), 'utf8');
  return file;
}

async function makeCtx(
  contract: unknown = baseContract(),
  overrides: { repeat?: number; json?: boolean } = {},
): Promise<{ ctx: RunContext; cwd: string }> {
  const cwd = await newTmpDir();
  const file = await writeContractYaml(cwd, contract);
  const loaded = await loadContractFile(file);
  return {
    cwd,
    ctx: {
      cwd,
      loaded,
      options: {
        repeat: overrides.repeat ?? 1,
        provider: 'mock',
        freeze: false,
        json: overrides.json ?? false,
      },
    },
  };
}

/** 读取唯一 run 目录下的 JSON 产物。 */
async function readRunArtifact<T>(cwd: string, name: string): Promise<T> {
  const runsDir = path.join(cwd, '.idwth', 'runs');
  const runIds = await readdir(runsDir);
  expect(runIds).toHaveLength(1);
  const runDir = path.join(runsDir, runIds[0]!);
  return JSON.parse(await readFile(path.join(runDir, name), 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('default run handler 装配闭环', () => {
  it('PASS：全链路产出 judge/report 证据，退出 0，provider 只断连', async () => {
    const provider = new FakeProvider();
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const connectInputs: Array<{ cdpEndpoint: string; originsAllowlist: string[] }> = [];
    const handler = makeHandler({
      connectProvider: async (input) => {
        connectInputs.push(input);
        return provider;
      },
    });
    const { ctx, cwd } = await makeCtx();

    const code: ExitCode = await handler(ctx);

    expect(code).toBe(0);
    expect(provider.disposed).toBe(true);

    const report = await readRunArtifact<Record<string, unknown>>(cwd, 'report.json');
    expect(report['verdict']).toBe('PASS');
    expect(report['failure_reason']).toBeNull();
    const judgeFile = await readRunArtifact<{
      judge_result: { verdict: string };
      evidence_digest: string;
      verdict_hash: string;
    }>(cwd, 'judge-result.json');
    expect(judgeFile.judge_result.verdict).toBe('PASS');

    // 证据三件套 + recompute 完整性闭环
    const manifest = await readRunArtifact<{
      judgement_set: Array<{ name: string }>;
    }>(cwd, 'evidence-manifest.json');
    const names = manifest.judgement_set.map((e) => e.name).sort();
    expect(names).toEqual(['backend.json', 'http.json', 'observation.json']);
    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runId = (await readdir(runsDir))[0]!;
    const recompute = await recomputeJudge(path.join(runsDir, runId), {
      expectedJudgeImplHash: currentJudgeImplHash(),
    });
    expect(recompute.status).toBe('match');
    if (recompute.status === 'match') expect(recompute.verdict).toBe('PASS');

    // 截图归档（contentBase64 路径）
    const shots = report['screenshots'] as Array<{ path: string }>;
    expect(shots).toHaveLength(1);
    const shotPath = path.join(runsDir, runId, shots[0]!.path);
    await expect(readFile(shotPath)).resolves.toEqual(Buffer.from('fake-png-bytes'));

    // reproduction 可复现命令
    const reproduction = report['reproduction'] as { rerun_command: string; provider: string };
    expect(reproduction.rerun_command).toContain('idwth run');
    expect(reproduction.provider).toBe('fake');
  });

  it('FAIL：断言不成立 → 退出 1，failure_reason 非空', async () => {
    const provider = new FakeProvider();
    provider.finalElements = []; // 最终页没有结果元素
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx, cwd } = await makeCtx();

    const code = await handler(ctx);

    expect(code).toBe(1);
    const report = await readRunArtifact<Record<string, unknown>>(cwd, 'report.json');
    expect(report['verdict']).toBe('FAIL');
    expect(report['failure_reason']).not.toBeNull();
  });

  it('BLOCKED：L1/L2 未命中且无决策能力 → 退出 2，judge 以空断言集保守 BLOCKED(evidence)', async () => {
    const provider = new FakeProvider();
    provider.resolvable = []; // 全部 miss → BLOCKED(decision)
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx, cwd } = await makeCtx();

    const code = await handler(ctx);

    expect(code).toBe(2);
    const report = await readRunArtifact<Record<string, unknown>>(cwd, 'report.json');
    expect(report['verdict']).toBe('BLOCKED');
    expect(String(report['failure_reason'])).toContain('decision');

    const judgeFile = await readRunArtifact<{
      judge_result: { verdict: string; blocked_reason: string | null };
      assertions: { dom: unknown[] };
    }>(cwd, 'judge-result.json');
    expect(judgeFile.judge_result.verdict).toBe('BLOCKED');
    expect(judgeFile.judge_result.blocked_reason).toBe('evidence');
    expect(judgeFile.assertions.dom).toHaveLength(0); // 未求值 = 空断言集，绝不伪造 FAIL

    // blocked run 的 judge 产物同样可离线重算
    const runsDir = path.join(cwd, '.idwth', 'runs');
    const runId = (await readdir(runsDir))[0]!;
    const recompute = await recomputeJudge(path.join(runsDir, runId), {
      expectedJudgeImplHash: currentJudgeImplHash(),
    });
    expect(recompute.status).toBe('match');
    if (recompute.status === 'match') expect(recompute.verdict).toBe('BLOCKED');
  });

  it('连接失败（CDP 不可达）→ RUNTIME_ERROR(4)，不产生 run 归档', async () => {
    const handler = makeHandler({
      connectProvider: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const { ctx, cwd } = await makeCtx();

    const code = await handler(ctx);

    expect(code).toBe(4);
    // 未产生任何 run 归档
    await expect(readdir(path.join(cwd, '.idwth', 'runs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('repeat > 1 → RUNTIME_ERROR(4)，不连接 provider', async () => {
    let connected = 0;
    const handler = makeHandler({
      connectProvider: async () => {
        connected += 1;
        return new FakeProvider();
      },
    });
    const { ctx } = await makeCtx(baseContract(), { repeat: 2 });

    const code = await handler(ctx);

    expect(code).toBe(4);
    expect(connected).toBe(0);
  });

  it('截图失败不致命：run 仍产出 PASS 结论', async () => {
    const provider = new FakeProvider();
    provider.screenshotThrows = true;
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx, cwd } = await makeCtx();

    const code = await handler(ctx);

    expect(code).toBe(0);
    const report = await readRunArtifact<Record<string, unknown>>(cwd, 'report.json');
    expect(report['verdict']).toBe('PASS');
    expect(report['screenshots']).toHaveLength(0);
  });
});

describe('default run handler 装配参数', () => {
  it('前台新标签页臂：provider 支持 openForegroundTab 时优先使用', async () => {
    const provider = new FakeProvider();
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx } = await makeCtx();

    await handler(ctx);

    expect(provider.foregroundUrls).toEqual(['http://127.0.0.1:41111']);
    expect(provider.navigatedUrls).toHaveLength(0);
  });

  it('navigate 兜底臂：provider 无 openForegroundTab 时以 navigate 动作打开 base_url', async () => {
    const provider = new FakeProvider();
    // 实例属性遮蔽原型方法 → 模拟不支持前台标签页臂的 provider（如 E2eProvider）
    Object.defineProperty(provider, 'openForegroundTab', { value: undefined });
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx } = await makeCtx();

    await handler(ctx);

    expect(provider.navigatedUrls).toEqual(['http://127.0.0.1:41111']);
  });

  it('origins_allowlist = base_url + 显式扩展；action_timeout_ms 透传', async () => {
    const provider = new FakeProvider();
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const connectInputs: Array<{
      originsAllowlist: string[];
      actionTimeoutMs?: number;
    }> = [];
    const handler = makeHandler({ connectProvider: async (input) => {
      connectInputs.push(input);
      return provider;
    } });
    const contract = baseContract();
    (contract.environment as Record<string, unknown>).origins_allowlist = [
      'http://127.0.0.1:41112',
    ];
    (contract.environment as Record<string, unknown>).action_timeout_ms = 5000;
    const { ctx } = await makeCtx(contract);

    await handler(ctx);

    expect(connectInputs).toHaveLength(1);
    expect(connectInputs[0]!.originsAllowlist).toEqual([
      'http://127.0.0.1:41111',
      'http://127.0.0.1:41112',
    ]);
    expect(connectInputs[0]!.actionTimeoutMs).toBe(5000);
  });

  it('CDP 端点：默认 127.0.0.1:9222，IDWTH_CDP_ENDPOINT 可覆盖', async () => {
    const endpoints: string[] = [];
    const provider = new FakeProvider();
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const handler = makeHandler({
      connectProvider: async (input) => {
        endpoints.push(input.cdpEndpoint);
        return provider;
      },
      env: {},
    });
    const { ctx } = await makeCtx();
    await handler(ctx);

    const handlerEnv = makeHandler({
      connectProvider: async (input) => {
        endpoints.push(input.cdpEndpoint);
        return provider;
      },
      env: { IDWTH_CDP_ENDPOINT: 'http://127.0.0.1:9999' },
    });
    const { ctx: ctx2 } = await makeCtx();
    await handlerEnv(ctx2);

    expect(DEFAULT_CDP_ENDPOINT).toBe('http://127.0.0.1:9222');
    expect(endpoints).toEqual(['http://127.0.0.1:9222', 'http://127.0.0.1:9999']);
  });

  it('--json：stdout 输出 run_id + verdict 的单行 JSON', async () => {
    const provider = new FakeProvider();
    provider.finalElements = [{ name: '部署完成', text: '部署完成' }];
    const handler = makeHandler({ connectProvider: async () => provider });
    const { ctx, cwd } = await makeCtx(baseContract(), { json: true });

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const code = await handler(ctx);

    expect(code).toBe(0);
    const jsonLine = writes.join('').trim();
    const parsed = JSON.parse(jsonLine) as { run_id: string; verdict: string };
    expect(parsed.verdict).toBe('PASS');
    const runsDir = path.join(cwd, '.idwth', 'runs');
    expect((await readdir(runsDir))[0]).toBe(parsed.run_id);
  });
});
