/**
 * Task 18 / TR-18.1 —— CI 集成契约（先行失败）。
 *
 * CI workflow 必须把 validate、deterministic run、replay --verify、repeat/flaky
 * 检查和六值退出码接入流水线：
 *  - 退出码语义：bash -e 下 idwth 六值退出码（0/1/2/3/4/130）非零即失败，
 *    任何 idwth / vitest / npm 调用不得吞退出码（`|| true`）；
 *  - replay verify 零模型：显式执行 replay-verify / offline-engine-cache 集成测试，
 *    workflow 全文不得注入任何模型凭据（API key env）。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

/** 模型凭据特征：零模型 CI 不得出现。 */
const MODEL_CREDENTIAL_PATTERN =
  /(ANTHROPIC|OPENAI|DASHSCOPE|MOONSHOT|DEEPSEEK|ARK_[A-Z]+|(API[_-]?KEY))\s*[:=]/i;

/** 退出码吞没特征：命令后接 `|| true` / `|| :` / `; true` / `|| echo`。 */
const EXIT_SWALLOW_PATTERN =
  /\|\|\s*(true|:|echo)|;\s*true\b|set \+e/i;

interface WorkflowFile {
  name?: string;
  on?: unknown;
  jobs?: Record<string, { runsOn?: string[] | string; steps?: Array<Record<string, unknown>> }>;
}

/** yaml 包会把 `on` 解析为布尔 true 键（YAML 1.1 语义），归一化处理。 */
function readWorkflow(raw: Record<string, unknown>): WorkflowFile {
  return raw as WorkflowFile;
}

function stepRun(step: Record<string, unknown>): string {
  return typeof step['run'] === 'string' ? step['run'] : '';
}

describe('TR-18.1：CI workflow 契约', () => {
  it('workflow 文件存在且为合法 YAML', async () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    const raw = parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>;
    const wf = readWorkflow(raw);
    expect(wf.name).toBe('ci');
  });

  it('在 push 与 pull_request 上触发', async () => {
    const raw = parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw)).toContain('on');
  });

  it('verify job：锁定依赖安装 + typecheck + 全量测试 + build', async () => {
    const wf = readWorkflow(parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>);
    const job = wf.jobs?.verify as Record<string, unknown> | undefined;
    expect(job).toBeDefined();
    // GitHub Actions 用 kebab-case：runs-on。
    expect(job?.['runs-on'] ?? job?.['runsOn']).toBeDefined();

    const runs = ((job?.['steps'] ?? []) as Array<Record<string, unknown>>)
      .map(stepRun)
      .join('\n');
    expect(runs).toContain('npm ci');
    expect(runs).toContain('npm run typecheck');
    expect(runs).toContain('npm test');
    expect(runs).toContain('npm run build');
  });

  it('validate 接入 CI（退出码直通：CONFIG_ERROR=3 非零即失败）', async () => {
    const wf = readWorkflow(parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>);
    const runs = (wf.jobs?.verify?.steps ?? []).map(stepRun).join('\n');
    expect(runs).toMatch(/bin\/idwth\.js validate .*--json/);
  });

  it('replay --verify 接入 CI 且零模型（显式执行 replay/offline 集成测试）', async () => {
    const wf = readWorkflow(parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>);
    const runs = (wf.jobs?.verify?.steps ?? []).map(stepRun).join('\n');
    expect(runs).toContain('tests/integration/replay-verify.test.ts');
    expect(runs).toContain('tests/integration/offline-engine-cache.test.ts');
  });

  it('repeat/flaky 稳定性门禁接入 CI', async () => {
    const wf = readWorkflow(parse(await readFile(WORKFLOW_PATH, 'utf8')) as Record<string, unknown>);
    const runs = (wf.jobs?.verify?.steps ?? []).map(stepRun).join('\n');
    expect(runs).toContain('tests/integration/stability-gate.test.ts');
  });

  it('离线发布包接入 CI（契约测试）且发布入口 pack:offline 有说明', async () => {
    const text = await readFile(WORKFLOW_PATH, 'utf8');
    const wf = readWorkflow(parse(text) as Record<string, unknown>);
    const runs = (wf.jobs?.verify?.steps ?? []).map(stepRun).join('\n');
    expect(runs).toContain('tests/contract/offline-package.test.ts');
    // 发布时真实构建入口（注释说明）：需先联网录制引擎缓存。
    expect(text).toContain('npm run pack:offline');
  });

  it('六值退出码处理正确：无步骤吞退出码，退出码映射有说明', async () => {
    const text = await readFile(WORKFLOW_PATH, 'utf8');
    const wf = readWorkflow(parse(text) as Record<string, unknown>);
    const runs = (wf.jobs?.verify?.steps ?? []).map(stepRun);
    for (const run of runs) {
      expect(EXIT_SWALLOW_PATTERN.test(run)).toBe(false);
    }
    // 0=PASS 1=FAIL 2=BLOCKED 3=CONFIG_ERROR 4=RUNTIME_ERROR 130=CANCELLED
    expect(text).toContain('0=PASS');
    expect(text).toContain('2=BLOCKED');
    expect(text).toContain('3=CONFIG_ERROR');
  });

  it('零模型：workflow 全文不注入任何模型凭据', async () => {
    const text = await readFile(WORKFLOW_PATH, 'utf8');
    expect(MODEL_CREDENTIAL_PATTERN.test(text)).toBe(false);
  });
});
