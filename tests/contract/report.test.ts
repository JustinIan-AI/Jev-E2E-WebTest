/**
 * Task 11 RED — 报告导出与静态自包含 HTML 报告契约（FR-8 / AC-12 / AC-19，DD-48）。
 *
 * TR-11.1：report.json + 导出包包含五要素（用例 / 截图 / verdict / 未通过原因 / 可复现过程）
 * 及 judgement_set；状态配色 PASS 中性蓝、FAIL 红、BLOCKED 琥珀（不以红绿表通过）；
 * 在无任何 IDWTH/HTTP 进程时，单文件 report.html 可离线 file:// 打开且内容完整。
 */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../../src/cli/index.js';
import type { CliDeps } from '../../src/cli/commands.js';
import {
  currentJudgeImplHash,
  writeOnlineJudgeArtifacts,
} from '../../src/runtime/judge/recompute.js';
import type { JudgeInput } from '../../src/runtime/judge/types.js';
import { writeReportArtifacts } from '../../src/runtime/report/index.js';
import type { ReportData } from '../../src/runtime/report/types.js';

/** 1x1 透明 PNG（确定性测试截图）。 */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const png1x1 = (): Buffer => Buffer.from(PNG_1X1_BASE64, 'base64');

const CLEANUP: string[] = [];
afterEach(async () => {
  const dirs = CLEANUP.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function newTmpDir(prefix = 'idwth-report-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  CLEANUP.push(dir);
  return dir;
}

async function runCli(args: readonly string[], cwd: string, deps?: CliDeps): Promise<number> {
  return main(args, deps === undefined ? { cwd } : { cwd, deps });
}

type ReportSeed = Omit<
  ReportData,
  'schema_version' | 'run_id' | 'generated_at' | 'screenshots'
>;

function passSeed(): ReportSeed {
  return {
    case: {
      id: 'case.workload.create',
      name: '创建工作负载',
      goal: '创建一个工作负载并确认创建成功',
      base_url: 'https://sut.local',
    },
    steps: [
      { index: 1, intent: '进入工作负载页面', action: 'click', target: '工作负载 导航项', risk: 'reversible' },
      { index: 2, intent: '提交创建', action: 'click', target: '确认按钮', risk: 'irreversible' },
      { index: 3, intent: '仅做断言', action: 'assert_only', risk: 'reversible' },
    ],
    assertion_results: [
      {
        kind: 'visible',
        description: '成功提示可见且包含「创建成功」',
        passed: true,
        state: 'passed',
        evidence_ref: 'artifact://RUN/judgement_set/observation.json',
      },
      {
        kind: 'http',
        description: 'POST /apis/app/v1/workloads 返回 201',
        passed: true,
        state: 'passed',
        evidence_ref: 'artifact://RUN/judgement_set/http.json',
      },
    ],
    verdict: 'PASS',
    failure_reason: null,
    reproduction: {
      contract_path: '.idwth/contracts/case.yaml',
      provider: 'mock',
      rerun_command: 'idwth run .idwth/contracts/case.yaml --provider mock',
    },
  };
}

function failSeed(): ReportSeed {
  return {
    ...passSeed(),
    assertion_results: [
      {
        kind: 'http',
        description: 'POST /workloads 返回 201',
        passed: false,
        state: 'failed',
        evidence_ref: 'artifact://RUN/judgement_set/http.json',
      },
    ],
    verdict: 'FAIL',
    failure_reason: '未通过原因：期望 POST /workloads 返回 201，实际返回 500',
    reproduction: {
      contract_path: '.idwth/contracts/case-fail.yaml',
      provider: 'mock',
      rerun_command: 'idwth run .idwth/contracts/case-fail.yaml --provider mock',
    },
  };
}

function blockedSeed(): ReportSeed {
  return {
    ...passSeed(),
    verdict: 'BLOCKED',
    failure_reason: '未通过原因：证据不足，无法确认提交按钮是否触发创建请求（BLOCKED/evidence）',
    reproduction: {
      contract_path: '.idwth/contracts/case-blocked.yaml',
      provider: 'mock',
      rerun_command: 'idwth run .idwth/contracts/case-blocked.yaml --provider mock',
    },
  };
}

function judgeInputFor(verdict: 'PASS' | 'FAIL' | 'BLOCKED'): JudgeInput {
  const base = {
    assertions: { dom: [] },
    evidence: {
      elements: [],
      url: 'https://sut.local',
      http: [],
      backend: [],
    },
    evaluatedAt: '2026-10-12T00:00:10.000Z',
  } satisfies JudgeInput;
  if (verdict === 'FAIL') {
    return {
      ...base,
      assertions: { dom: [], http: [{ kind: 'http', method: 'POST', path_prefix: '/w', status_equals: 201 }] },
      evidence: {
        ...base.evidence,
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
      },
    };
  }
  if (verdict === 'BLOCKED') {
    return {
      ...base,
      assertions: { dom: [{ kind: 'visible', target: '提交按钮' }] },
    };
  }
  return {
    ...base,
    assertions: {
      dom: [{ kind: 'visible', target: '成功提示', text_contains: '创建成功' }],
    },
    evidence: {
      ...base.evidence,
      elements: [
        { id: 1, role: 'status', name: '成功提示', text: '创建成功', visible: true, enabled: true },
      ],
    },
  };
}

/** Seed 完整 run 归档：judge 三证据 + judge-result + report.json + 截图。 */
async function seedFullRun(
  cwd: string,
  runId: string,
  seed: ReportSeed,
): Promise<ReportData> {
  await writeOnlineJudgeArtifacts({
    rootDir: cwd,
    runId,
    input: judgeInputFor(seed.verdict),
    judgeImplHash: currentJudgeImplHash(),
  });
  return writeReportArtifacts({
    rootDir: cwd,
    runId,
    data: seed,
    generatedAt: '2026-10-12T00:00:20.000Z',
    screenshots: [
      { name: 'final.png', caption: '用例结束时页面截图', content: png1x1() },
    ],
  });
}

const RUN_DIR_PASS = 'rpt-pass-0001';
const RUN_DIR_FAIL = 'rpt-fail-0002';
const RUN_DIR_BLOCKED = 'rpt-block-0003';

/** 抽取 HTML 中所有会触发资源加载的引用（src/hread/url()/@import）。 */
function resourceRefs(html: string): string[] {
  const refs: string[] = [];
  const reAttr = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = reAttr.exec(html)) !== null) refs.push(m[1]!);
  const reUrl = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = reUrl.exec(html)) !== null) refs.push(m[1]!);
  const reImport = /@import\s+["']([^"']+)["']/gi;
  while ((m = reImport.exec(html)) !== null) refs.push(m[1]!);
  return refs;
}

describe('FR-8 / AC-12 / TR-11.1 — report.json 五要素与静态 HTML 报告', () => {
  it('writeReportArtifacts 产出 report.json 与截图文件，五要素字段齐备', async () => {
    const cwd = await newTmpDir();
    const data = await seedFullRun(cwd, RUN_DIR_PASS, passSeed());

    const runDir = path.join(cwd, '.idwth', 'runs', RUN_DIR_PASS);
    const reportJson = JSON.parse(
      await readFile(path.join(runDir, 'report.json'), 'utf8'),
    ) as ReportData;

    // 要素 1：测试用例（用例身份 + 步骤）
    expect(reportJson.case.id).toBe('case.workload.create');
    expect(reportJson.case.name).toBe('创建工作负载');
    expect(reportJson.case.goal).toContain('创建一个工作负载');
    expect(reportJson.steps).toHaveLength(3);
    expect(reportJson.steps[0]?.target).toBe('工作负载 导航项');
    // 要素 2：截图索引（相对路径 + sha256）
    expect(reportJson.screenshots).toHaveLength(1);
    expect(reportJson.screenshots[0]?.path).toBe('screenshots/final.png');
    expect(reportJson.screenshots[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(stat(path.join(runDir, 'screenshots', 'final.png'))).resolves.toBeDefined();
    // 要素 3：verdict
    expect(reportJson.verdict).toBe('PASS');
    // 要素 4：未通过原因（PASS 时明确为 null）
    expect(reportJson.failure_reason).toBeNull();
    // 要素 5：可复现过程（rerun 命令）
    expect(reportJson.reproduction.rerun_command).toBe(
      'idwth run .idwth/contracts/case.yaml --provider mock',
    );
    expect(data.screenshots[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('idwth report <run_id> 默认走真实渲染 → 0，run 目录内生成 report.html', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    expect(await runCli(['report', RUN_DIR_PASS], cwd)).toBe(0);

    const htmlPath = path.join(cwd, '.idwth', 'runs', RUN_DIR_PASS, 'report.html');
    const html = await readFile(htmlPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('报告 FAIL run 命令仍成功（0），命令结果与 verdict 无关', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_FAIL, failSeed());
    expect(await runCli(['report', RUN_DIR_FAIL], cwd)).toBe(0);
  });

  it('离线打开校验（无任何 IDWTH/HTTP 进程）：单文件自包含、零外部资源、内容完整', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    expect(await runCli(['report', RUN_DIR_PASS], cwd)).toBe(0);

    const runDir = path.join(cwd, '.idwth', 'runs', RUN_DIR_PASS);
    const html = await readFile(path.join(runDir, 'report.html'), 'utf8');

    // (a) 不加载任何外部/远程资源：所有引用只能是 data: 或页内锚点。
    const refs = resourceRefs(html);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('data:') || ref.startsWith('#')).toBe(true);
    }
    // (b) 截图内联为 data URI（数量与截图索引一致）。
    expect((html.match(/data:image\/png;base64,/g) ?? []).length).toBe(1);
    // (c) 无脚本 src、无运行时取数逻辑（纯静态 HTML+CSS）。
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toMatch(/\bfetch\s*\(/);
    expect(html).not.toMatch(/XMLHttpRequest/);
    // (d) 样式内联。
    expect(html).toMatch(/<style[\s\S]*<\/style>/);
    // (e) 五要素文本离线可见。
    expect(html).toContain('创建工作负载');
    expect(html).toContain('创建一个工作负载并确认创建成功');
    expect(html).toContain('PASS');
    expect(html).toContain('idwth run .idwth/contracts/case.yaml --provider mock');
    expect(html).toContain('用例结束时页面截图');
    expect(html).toContain('工作负载 导航项');
  });

  it('FAIL 报告：未通过原因与失败断言可见', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_FAIL, failSeed());
    expect(await runCli(['report', RUN_DIR_FAIL], cwd)).toBe(0);
    const html = await readFile(
      path.join(cwd, '.idwth', 'runs', RUN_DIR_FAIL, 'report.html'),
      'utf8',
    );
    expect(html).toContain('未通过原因：期望 POST /workloads 返回 201，实际返回 500');
    expect(html).toContain('FAIL');
    expect(html).toContain('idwth run .idwth/contracts/case-fail.yaml --provider mock');
  });

  it('BLOCKED 报告：阻塞原因可见', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_BLOCKED, blockedSeed());
    expect(await runCli(['report', RUN_DIR_BLOCKED], cwd)).toBe(0);
    const html = await readFile(
      path.join(cwd, '.idwth', 'runs', RUN_DIR_BLOCKED, 'report.html'),
      'utf8',
    );
    expect(html).toContain('证据不足，无法确认提交按钮是否触发创建请求');
    expect(html).toContain('BLOCKED');
  });

  it('状态视觉规范：PASS 蓝、FAIL 红、BLOCKED 琥珀；任何报告都不以绿色表达通过', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    await seedFullRun(cwd, RUN_DIR_FAIL, failSeed());
    await seedFullRun(cwd, RUN_DIR_BLOCKED, blockedSeed());
    for (const id of [RUN_DIR_PASS, RUN_DIR_FAIL, RUN_DIR_BLOCKED]) {
      expect(await runCli(['report', id], cwd)).toBe(0);
    }

    const read = (id: string): Promise<string> =>
      readFile(path.join(cwd, '.idwth', 'runs', id, 'report.html'), 'utf8');
    const passHtml = await read(RUN_DIR_PASS);
    const failHtml = await read(RUN_DIR_FAIL);
    const blockedHtml = await read(RUN_DIR_BLOCKED);

    // 三态配色硬契约。
    expect(passHtml).toContain('#2563eb'); // PASS 中性蓝
    expect(failHtml).toContain('#dc2626'); // FAIL 红
    expect(blockedHtml).toContain('#d97706'); // BLOCKED 琥珀

    // 绿色在所有报告中均不得出现（不用红绿表达通过与否）。
    for (const html of [passHtml, failHtml, blockedHtml]) {
      expect(html).not.toMatch(/green/i);
      expect(html).not.toMatch(/#(?:16a34a|22c55e|15803d|4ade80|86efac)/i);
    }
  });

  it('--export：导出包含 report.html/report.json/截图/judgement_set/judge-result → 0', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    expect(await runCli(['report', RUN_DIR_PASS, '--export'], cwd)).toBe(0);

    const exportDir = path.join(cwd, '.idwth', 'exports', RUN_DIR_PASS);
    const entries = await readdir(exportDir);
    expect(entries).toContain('report.html');
    expect(entries).toContain('report.json');
    expect(entries).toContain('judge-result.json');
    expect(entries).toContain('evidence-manifest.json');
    expect(entries).toContain('export-manifest.json');

    // judgement_set 完整随包（供跨机器 judge recompute）。
    const js = await readdir(path.join(exportDir, 'judgement_set'));
    expect(js).toEqual(
      expect.arrayContaining(['observation.json', 'http.json', 'backend.json']),
    );
    // 截图随包。
    const shots = await readdir(path.join(exportDir, 'screenshots'));
    expect(shots).toContain('final.png');
    // 导出清单记录包内文件。
    const manifest = JSON.parse(
      await readFile(path.join(exportDir, 'export-manifest.json'), 'utf8'),
    ) as { run_id: string; files: readonly string[] };
    expect(manifest.run_id).toBe(RUN_DIR_PASS);
    expect(manifest.files).toEqual(
      expect.arrayContaining(['report.html', 'judgement_set/observation.json']),
    );
  });

  it('--open：渲染后经注入的 openPath 打开 report.html → 0', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    const opened: string[] = [];
    const deps: CliDeps = {
      openPath: (target) => {
        opened.push(target);
      },
    };
    expect(await runCli(['report', RUN_DIR_PASS, '--open'], cwd, deps)).toBe(0);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBe(
      path.join(cwd, '.idwth', 'runs', RUN_DIR_PASS, 'report.html'),
    );
  });

  it('run 目录不存在 → 3（CONFIG_ERROR）', async () => {
    const cwd = await newTmpDir();
    expect(await runCli(['report', 'no-such-run'], cwd)).toBe(3);
  });

  it('run 存在但缺 report.json → 3', async () => {
    const cwd = await newTmpDir();
    await seedFullRun(cwd, RUN_DIR_PASS, passSeed());
    await rm(path.join(cwd, '.idwth', 'runs', RUN_DIR_PASS, 'report.json'), { force: true });
    expect(await runCli(['report', RUN_DIR_PASS], cwd)).toBe(3);
  });

  it('注入 deps.report 仍优先使用（命令入口契约不变）', async () => {
    const cwd = await newTmpDir();
    const deps: CliDeps = {
      report: () => 0,
    };
    expect(await runCli(['report', 'whatever-run'], cwd, deps)).toBe(0);
  });
});
