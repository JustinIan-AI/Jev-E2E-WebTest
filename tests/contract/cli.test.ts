/**
 * Task 10 RED — CLI 命令路由 / 参数解析 / 退出码契约（AC-13 / TR-10.1，详设 §10）。
 *
 * 命令矩阵：init / validate / run / replay / report / doctor / judge recompute。
 * 成功、失败、阻塞、配置错误、环境/Runtime 错误、取消路径必须分别返回 0/1/2/3/4/130。
 * 不存在 daemon / serve / start-server；所有命令一次性执行退出。
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { main } from '../../src/cli/index.js';
import {
  CancelledError,
  type CliDeps,
  type DoctorContext,
  type ReplayContext,
  type ReportContext,
  type RunContext,
} from '../../src/cli/commands.js';
import {
  currentJudgeImplHash,
  writeOnlineJudgeArtifacts,
} from '../../src/runtime/judge/recompute.js';
import type { JudgeInput } from '../../src/runtime/judge/types.js';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CLI_ENTRY = path.join(REPO_ROOT, 'src/cli/index.ts');
const execFileP = promisify(execFile);

/** 合法 Contract 基线（九条校验全部满足）。 */
const validContract = {
  version: '1',
  test: { id: 'workload.create', name: '创建 Deployment' },
  environment: { base_url: 'https://example.com' },
  identity: { role: 'operator', credentials_ref: 'cred://staging-operator' },
  goal: '创建一个 Deployment 并确认其进入 Running',
  steps: [
    { intent: '进入工作负载', action: 'click', target: '工作负载 导航项', risk: 'reversible' },
    {
      intent: '提交',
      action: 'click',
      target: '确认按钮',
      risk: 'irreversible',
      postcondition: [{ kind: 'visible', target: 'Deployment 详情页标题' }],
    },
    { intent: '只校验', action: 'assert_only', risk: 'reversible' },
  ],
  assertions: {
    dom: [{ kind: 'visible', target: 'deployment-name-cell', text_contains: 'idwth-run-cid' }],
    http: [
      { method: 'POST', path_prefix: '/api/deployments', status: 201, within_run: true },
    ],
  },
};

async function newTmpDir(prefix = 'idwth-cli-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function writeContract(
  dir: string,
  name: string,
  contract: unknown = validContract,
  format: 'yaml' | 'json' = 'yaml',
): Promise<string> {
  const file = path.join(dir, name);
  const content = format === 'json' ? JSON.stringify(contract, null, 2) : stringifyYaml(contract);
  await writeFile(file, content, 'utf8');
  return file;
}

const CLEANUP: string[] = [];
afterEach(async () => {
  const dirs = CLEANUP.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function runCli(
  args: readonly string[],
  options: { cwd?: string; deps?: CliDeps } = {},
): Promise<number> {
  let cwd = options.cwd;
  if (cwd === undefined) {
    cwd = await newTmpDir();
    CLEANUP.push(cwd);
  }
  if (options.deps !== undefined) {
    return main(args, { cwd, deps: options.deps });
  }
  return main(args, { cwd });
}

function judgePassInput(): JudgeInput {
  return {
    assertions: {
      dom: [{ kind: 'visible', target: '成功提示', text_contains: '创建成功' }],
      http: [{ kind: 'http', method: 'POST', path_prefix: '/apis/app/v1/workloads', status_equals: 201 }],
    },
    evidence: {
      elements: [
        { id: 1, role: 'status', name: '成功提示', text: '工作负载创建成功', visible: true, enabled: true },
      ],
      url: 'https://sut.local/workloads',
      runStartedAt: '2026-10-12T00:00:00.000Z',
      http: [
        {
          id: 'h1',
          method: 'POST',
          url: 'https://api.local/apis/app/v1/workloads',
          status: 201,
          timestamp: '2026-10-12T00:00:05.000Z',
          body: { name: 'w1' },
        },
      ],
      backend: [],
    },
    evaluatedAt: '2026-10-12T00:00:10.000Z',
  };
}

function judgeFailInput(): JudgeInput {
  return {
    assertions: {
      dom: [],
      http: [{ kind: 'http', method: 'POST', path_prefix: '/w', status_equals: 201 }],
    },
    evidence: {
      elements: [],
      url: 'https://sut.local/x',
      http: [
        {
          id: 'h1',
          method: 'POST',
          url: 'https://api.local/w',
          status: 500,
          timestamp: '2026-10-12T00:00:05.000Z',
          body: { error: 'boom' },
        },
      ],
      backend: [],
    },
    evaluatedAt: '2026-10-12T00:00:10.000Z',
  };
}

async function seedRun(
  cwd: string,
  runId: string,
  input: JudgeInput,
  judgeImplHash: string = currentJudgeImplHash(),
): Promise<void> {
  await writeOnlineJudgeArtifacts({ rootDir: cwd, runId, input, judgeImplHash });
}

describe('AC-13 / TR-10.1 — CLI 命令矩阵退出码', () => {
  describe('帮助 / 版本 / 未知命令', () => {
    it('无参数 → 0（打印用法）', async () => {
      expect(await runCli([])).toBe(0);
    });

    it('--help / -h → 0', async () => {
      expect(await runCli(['--help'])).toBe(0);
      expect(await runCli(['-h'])).toBe(0);
    });

    it('--version / -V → 0', async () => {
      expect(await runCli(['--version'])).toBe(0);
      expect(await runCli(['-V'])).toBe(0);
    });

    it('未知命令 → 3（用法/配置域）', async () => {
      expect(await runCli(['frobnicate'])).toBe(3);
    });

    it('daemon / serve / start-server 不是命令 → 3', async () => {
      expect(await runCli(['daemon'])).toBe(3);
      expect(await runCli(['serve'])).toBe(3);
      expect(await runCli(['start-server'])).toBe(3);
    });
  });

  describe('validate（真实 loader + 九条校验）', () => {
    it('合法 YAML Contract → 0', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      expect(await runCli(['validate', file], { cwd })).toBe(0);
    });

    it('合法 JSON Contract → 0', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.json', validContract, 'json');
      expect(await runCli(['validate', file], { cwd })).toBe(0);
    });

    it('缺 goal 的 Contract → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const bad = { ...validContract, goal: '' };
      const file = await writeContract(cwd, 'bad.yaml', bad);
      expect(await runCli(['validate', file], { cwd })).toBe(3);
    });

    it('schema 违规（缺 environment.base_url）→ 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const bad = { ...validContract, environment: { action_timeout_ms: 30000 } };
      const file = await writeContract(cwd, 'bad.yaml', bad);
      expect(await runCli(['validate', file], { cwd })).toBe(3);
    });

    it('缺少 contract 路径参数 → 3', async () => {
      expect(await runCli(['validate'])).toBe(3);
    });

    it('文件不存在 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      expect(await runCli(['validate', path.join(cwd, 'missing.yaml')], { cwd })).toBe(3);
    });

    it('YAML 语法损坏 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = path.join(cwd, 'broken.yaml');
      await writeFile(file, 'steps: [unclosed\n  - bad', 'utf8');
      expect(await runCli(['validate', file], { cwd })).toBe(3);
    });

    it('不支持的文件类型 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = path.join(cwd, 'case.txt');
      await writeFile(file, 'whatever', 'utf8');
      expect(await runCli(['validate', file], { cwd })).toBe(3);
    });

    it('--json：以 JSON 输出校验结论且合法契约仍 → 0', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      const writes: string[] = [];
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          writes.push(String(chunk));
          return true;
        });
      try {
        expect(await runCli(['validate', file, '--json'], { cwd })).toBe(0);
      } finally {
        spy.mockRestore();
      }
      const printed = writes.join('');
      expect(printed).toContain('"valid"');
      expect(() => JSON.parse(printed)).not.toThrow();
    });

    it('--json：非法契约仍 → 3 且输出 JSON', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const bad = { ...validContract, assertions: {} };
      const file = await writeContract(cwd, 'bad.yaml', bad);
      const writes: string[] = [];
      const spy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          writes.push(String(chunk));
          return true;
        });
      try {
        expect(await runCli(['validate', file, '--json'], { cwd })).toBe(3);
      } finally {
        spy.mockRestore();
      }
      const parsed = JSON.parse(writes.join('')) as { valid: boolean };
      expect(parsed.valid).toBe(false);
    });
  });

  describe('init（脚手架 + 环境探测报告）', () => {
    it('在空目录生成 .idwth/、示例 Contract 与探测报告 → 0', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      expect(await runCli(['init'], { cwd })).toBe(0);

      const idwthDir = path.join(cwd, '.idwth');
      await expect(stat(idwthDir)).resolves.toBeDefined();

      // 示例 Contract 与探测报告均存在
      const example = path.join(cwd, '.idwth', 'contracts', 'example.contract.yaml');
      const probe = path.join(cwd, '.idwth', 'env-probe.json');
      const exampleContent = await readFile(example, 'utf8');
      await expect(readFile(probe, 'utf8')).resolves.toBeDefined();
      expect(exampleContent.length).toBeGreaterThan(0);
    });

    it('生成的示例 Contract 自身通过校验', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      expect(await runCli(['init'], { cwd })).toBe(0);
      const example = path.join(cwd, '.idwth', 'contracts', 'example.contract.yaml');
      expect(await runCli(['validate', example], { cwd })).toBe(0);
    });
  });

  describe('run（参数解析 + 路由 + 退出码映射）', () => {
    it('缺少 contract 路径 → 3', async () => {
      expect(await runCli(['run'])).toBe(3);
    });

    it('contract 文件不存在 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      expect(await runCli(['run', path.join(cwd, 'nope.yaml')], { cwd })).toBe(3);
    });

    it('未知 flag → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      expect(await runCli(['run', file, '--bogus'], { cwd })).toBe(3);
    });

    it('--repeat 非正整数（abc / 0 / -1）→ 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      expect(await runCli(['run', file, '--repeat', 'abc'], { cwd })).toBe(3);
      expect(await runCli(['run', file, '--repeat', '0'], { cwd })).toBe(3);
      expect(await runCli(['run', file, '--repeat', '-1'], { cwd })).toBe(3);
    });

    it('--provider 仅接受 mock|jev，其余 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      expect(await runCli(['run', file, '--provider', 'chrome'], { cwd })).toBe(3);
    });

    it('--max-cost 非正数（abc / 0）→ 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      expect(await runCli(['run', file, '--max-cost', 'abc'], { cwd })).toBe(3);
      expect(await runCli(['run', file, '--max-cost', '0'], { cwd })).toBe(3);
    });

    it('成功路径：注入 runner 返回 → 0，且解析后的选项完整传入', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      let seen: RunContext | undefined;
      const deps: CliDeps = {
        run: (ctx) => {
          seen = ctx;
          return 0;
        },
      };
      const code = await runCli(
        ['run', file, '--repeat', '3', '--provider', 'jev', '--max-cost', '1.5', '--freeze', '--json'],
        { cwd, deps },
      );
      expect(code).toBe(0);
      expect(seen).toBeDefined();
      expect(seen?.options).toEqual({
        repeat: 3,
        provider: 'jev',
        maxCost: 1.5,
        freeze: true,
        json: true,
      });
      expect(seen?.loaded.id).toBe('workload.create');
    });

    it('默认选项：repeat=1 / provider=mock / freeze=false / json=false', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      let seen: RunContext | undefined;
      const deps: CliDeps = {
        run: (ctx) => {
          seen = ctx;
          return 0;
        },
      };
      expect(await runCli(['run', file], { cwd, deps })).toBe(0);
      expect(seen?.options.repeat).toBe(1);
      expect(seen?.options.provider).toBe('mock');
      expect(seen?.options.freeze).toBe(false);
      expect(seen?.options.json).toBe(false);
      expect(seen?.options.maxCost).toBeUndefined();
    });

    it('失败路径：确定性断言不通过 → 1', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      const deps: CliDeps = { run: () => 1 };
      expect(await runCli(['run', file], { cwd, deps })).toBe(1);
    });

    it('阻塞路径：runner 返回 BLOCKED → 2', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      const deps: CliDeps = { run: () => 2 };
      expect(await runCli(['run', file], { cwd, deps })).toBe(2);
    });

    it('取消路径：runner 抛 CancelledError → 130', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      const deps: CliDeps = {
        run: () => {
          throw new CancelledError('SIGINT');
        },
      };
      expect(await runCli(['run', file], { cwd, deps })).toBe(130);
    });

    it('内部异常 → 4', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const file = await writeContract(cwd, 'case.yaml');
      const deps: CliDeps = {
        run: () => {
          throw new Error('boom');
        },
      };
      expect(await runCli(['run', file], { cwd, deps })).toBe(4);
    });
  });

  describe('replay（--verify 默认 / --heal 显式）', () => {
    it('缺少 trace 路径 → 3', async () => {
      expect(await runCli(['replay'])).toBe(3);
    });

    it('--verify 与 --heal 同时给出 → 3', async () => {
      expect(await runCli(['replay', 'trace.json', '--verify', '--heal'])).toBe(3);
    });

    it('未知 flag → 3', async () => {
      expect(await runCli(['replay', 'trace.json', '--nope'])).toBe(3);
    });

    it('默认 / --verify：verify=true、heal=false 传入 handler', async () => {
      // 数组捕获两次调用 + 显式参数类型：可选 handler 的参数会被推为 never。
      const calls: ReplayContext[] = [];
      const deps: CliDeps = {
        replay: (ctx: ReplayContext) => {
          calls.push(ctx);
          return 0;
        },
      };
      expect(await runCli(['replay', 'trace.json'], { deps })).toBe(0);
      expect(await runCli(['replay', 'trace.json', '--verify'], { deps })).toBe(0);
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.verify)).toEqual([true, true]);
      expect(calls.map((c) => c.heal)).toEqual([false, false]);
    });

    it('--heal：heal=true、verify=false', async () => {
      let seen: ReplayContext | undefined;
      const deps: CliDeps = {
        replay: (ctx) => {
          seen = ctx;
          return 0;
        },
      };
      expect(await runCli(['replay', 'trace.json', '--heal'], { deps })).toBe(0);
      expect(seen?.heal).toBe(true);
      expect(seen?.verify).toBe(false);
    });

    it('漂移终止 → BLOCKED 2', async () => {
      const deps: CliDeps = { replay: () => 2 };
      expect(await runCli(['replay', 'trace.json', '--verify'], { deps })).toBe(2);
    });

    it('取消 → 130', async () => {
      const deps: CliDeps = {
        replay: () => {
          throw new CancelledError('budget exceeded');
        },
      };
      expect(await runCli(['replay', 'trace.json'], { deps })).toBe(130);
    });
  });

  describe('report（静态渲染 / 导出入口）', () => {
    it('缺少 run_id → 3', async () => {
      expect(await runCli(['report'])).toBe(3);
    });

    it('未知 flag → 3', async () => {
      expect(await runCli(['report', 'run-1', '--serve'])).toBe(3);
    });

    it('--open / --export 解析后传入 handler，成功 → 0', async () => {
      let seen: ReportContext | undefined;
      const deps: CliDeps = {
        report: (ctx) => {
          seen = ctx;
          return 0;
        },
      };
      expect(await runCli(['report', 'run-1', '--open', '--export'], { deps })).toBe(0);
      expect(seen?.runId).toBe('run-1');
      expect(seen?.open).toBe(true);
      expect(seen?.export).toBe(true);
    });

    it('handler 内部异常 → 4', async () => {
      const deps: CliDeps = {
        report: () => {
          throw new Error('render failed');
        },
      };
      expect(await runCli(['report', 'run-1'], { deps })).toBe(4);
    });
  });

  describe('doctor（保留明确、可测试的入口）', () => {
    it('注入 handler 成功 → 0', async () => {
      let seen: DoctorContext | undefined;
      const deps: CliDeps = {
        doctor: (ctx) => {
          seen = ctx;
          return 0;
        },
      };
      expect(await runCli(['doctor'], { deps })).toBe(0);
      expect(seen?.cwd).toBeDefined();
    });

    it('完整能力在 Task 16 交付：未注入时默认入口明确返回 4（不静默成功）', async () => {
      expect(await runCli(['doctor'])).toBe(4);
    });

    it('未知 flag → 3', async () => {
      expect(await runCli(['doctor', '--fix-all'])).toBe(3);
    });
  });

  describe('judge recompute（真实归档重算路径）', () => {
    it('缺少 run_id → 3', async () => {
      expect(await runCli(['judge', 'recompute'])).toBe(3);
    });

    it('judge 未知子命令 → 3', async () => {
      expect(await runCli(['judge', 'something-else'])).toBe(3);
    });

    it('run 目录不存在 → 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      expect(await runCli(['judge', 'recompute', 'deadbeef'], { cwd })).toBe(3);
    });

    it('PASS run 重算一致 → 0', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      await seedRun(cwd, 'a8f00dba', judgePassInput());
      expect(await runCli(['judge', 'recompute', 'a8f00dba'], { cwd })).toBe(0);
    });

    it('FAIL run 重算一致 → 1', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      await seedRun(cwd, 'a8f00dbf', judgeFailInput());
      expect(await runCli(['judge', 'recompute', 'a8f00dbf'], { cwd })).toBe(1);
    });

    it('证据/哈希被篡改（verdict_hash 不一致）→ 4', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      await seedRun(cwd, 'a8f00dbc', judgePassInput());
      const judgeResultPath = path.join(cwd, '.idwth', 'runs', 'a8f00dbc', 'judge-result.json');
      const raw = JSON.parse(await readFile(judgeResultPath, 'utf8')) as {
        judge_result: { verdict: string };
      };
      raw.judge_result.verdict = 'FAIL';
      await writeFile(judgeResultPath, JSON.stringify(raw), 'utf8');
      expect(await runCli(['judge', 'recompute', 'a8f00dbc'], { cwd })).toBe(4);
    });

    it('判定实现绑定漂移（BINDING_DRIFT）→ 4', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      await seedRun(cwd, 'a8f00dbd', judgePassInput(), 'sha256:different-binding');
      expect(await runCli(['judge', 'recompute', 'a8f00dbd'], { cwd })).toBe(4);
    });
  });

  describe('进程级退出码（真实子进程）', () => {
    it('idwth --version 进程退出码为 0', async () => {
      const { code } = await spawnCli(['--version']);
      expect(code).toBe(0);
    });

    it('idwth validate 非法契约进程退出码为 3', async () => {
      const cwd = await newTmpDir();
      CLEANUP.push(cwd);
      const bad = { ...validContract, goal: '' };
      const file = await writeContract(cwd, 'bad.yaml', bad);
      const { code } = await spawnCli(['validate', file]);
      expect(code).toBe(3);
    });
  });
});

async function spawnCli(args: readonly string[]): Promise<{ code: number | null }> {
  try {
    await execFileP(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
    });
    return { code: 0 };
  } catch (error) {
    const e = error as { code?: number | null };
    return { code: e.code ?? null };
  }
}


