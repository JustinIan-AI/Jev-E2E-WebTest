/**
 * ai-testgen → IDWTH 衔接：`idwth init --from` 端到端契约测试。
 *
 * 验证用户决策 1~3 的落盘行为：
 * - ready 场景写 .contract.yaml，且可被 loader 加载、validate 通过、run 可直接消费；
 * - 未映射场景写 .draft.yaml，含 _draft.unmapped_steps 原因分类；
 * - 参数校验（--base-url/--credentials 必带且合法）与退出码 0/3/4。
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { main } from '../../src/cli/index.js';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { loadContractFile } from '../../src/runtime/contract/loader.js';
import type { Contract } from '../../src/runtime/contract/feature-to-contract.js';

function asContract(record: Record<string, unknown>): Contract {
  return record as unknown as Contract;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/sample.feature');

const READY_FILES = [
  'account.and.catalog.operator.logs.in.contract.yaml',
  'account.and.catalog.search.products.row1.contract.yaml',
  'account.and.catalog.search.products.row2.contract.yaml',
];
const DRAFT_FILES = [
  'account.and.catalog.operator.uploads.avatar.draft.yaml',
  'account.and.catalog.operator.closes.all.sessions.draft.yaml',
];

const CLEANUP: string[] = [];
afterEach(async () => {
  const dirs = CLEANUP.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function newCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-init-from-'));
  CLEANUP.push(dir);
  return dir;
}

const BASE_ARGS = [
  'init',
  '--from',
  FIXTURE,
  '--base-url',
  'https://staging.example.com',
  '--credentials',
  'cred://staging-operator',
];

describe('idwth init --from（决策 1~3）', () => {
  it('默认输出到 .idwth/contracts，返回 0', async () => {
    const cwd = await newCwd();
    const code = await main(BASE_ARGS, { cwd });
    expect(code).toBe(EXIT_CODES.PASS);

    const files = await readdir(path.join(cwd, '.idwth/contracts'));
    for (const name of [...READY_FILES, ...DRAFT_FILES]) {
      expect(files).toContain(name);
    }
  });

  it('不再写脚手架示例文件 example.contract.yaml / env-probe.json', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const files = await readdir(path.join(cwd, '.idwth/contracts'));
    expect(files).not.toContain('example.contract.yaml');
    await expect(readFile(path.join(cwd, '.idwth/env-probe.json'), 'utf8')).rejects.toBeTruthy();
  });

  it('ready 产物可被 loadContractFile 加载', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    for (const name of READY_FILES) {
      const loaded = await loadContractFile(path.join(cwd, '.idwth/contracts', name));
      const contract = asContract(loaded.contract);
      expect(contract.environment.base_url).toBe('https://staging.example.com');
      expect(contract.identity.credentials_ref).toBe('cred://staging-operator');
    }
  });

  it('ready 产物经 idwth validate 校验通过（衔接后可被无缝执行）', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    for (const name of READY_FILES) {
      const code = await main(
        ['validate', path.join(cwd, '.idwth/contracts', name)],
        { cwd },
      );
      expect(code).toBe(EXIT_CODES.PASS);
    }
  });

  it('Outline 展开行的占位符已替换（row1=laptop/2，row2=keyboard/5）', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const dir = path.join(cwd, '.idwth/contracts');
    const row1 = asContract(
      (await loadContractFile(path.join(dir, READY_FILES[1]!))).contract,
    );
    const row2 = asContract(
      (await loadContractFile(path.join(dir, READY_FILES[2]!))).contract,
    );
    expect(row1.steps.find((s) => s.action === 'fill')?.value).toBe('laptop');
    expect(row1.assertions.dom[0]).toMatchObject({ kind: 'count', equals: 2 });
    expect(row2.steps.find((s) => s.action === 'fill')?.value).toBe('keyboard');
    expect(row2.assertions.dom[0]).toMatchObject({ kind: 'count', equals: 5 });
  });

  it('draft 产物含头部注释与 _draft.unmapped_steps 原因分类', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', DRAFT_FILES[0]!),
      'utf8',
    );
    expect(raw.startsWith('# DRAFT')).toBe(true);
    expect(raw).toContain('.contract.yaml');

    const doc = parseYaml(raw) as Record<string, any>;
    expect(doc._draft.status).toBe('needs-human-completion');
    expect(doc._draft.source_feature).toBe(FIXTURE);
    expect(doc._draft.unmapped_steps).toHaveLength(1);
    expect(doc._draft.unmapped_steps[0]).toMatchObject({
      keyword: 'When',
      text: 'I upload a profile picture',
      reason: 'unmapped-action',
    });
    expect(typeof doc._draft.unmapped_steps[0].guidance).toBe('string');
  });

  it('多未映射步骤的 draft 逐条保留原文，不丢弃', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', DRAFT_FILES[1]!),
      'utf8',
    );
    const doc = parseYaml(raw) as Record<string, any>;
    expect(doc._draft.unmapped_steps).toHaveLength(2);
    expect(doc._draft.unmapped_steps.map((s: any) => s.reason)).toEqual([
      'unmapped-action',
      'unrecognized-assertion',
    ]);
  });

  it('#11-P2 每个未映射步骤带可操作指引 guidance（按 reason 分类）', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', DRAFT_FILES[0]!),
      'utf8',
    );
    const doc = parseYaml(raw) as Record<string, any>;
    const step = doc._draft.unmapped_steps[0];
    expect(step.reason).toBe('unmapped-action');
    expect(typeof step.guidance).toBe('string');
    expect(step.guidance.length).toBeGreaterThan(10);
    // 指引必须落到封闭动作集，而非开放叙述
    expect(step.guidance).toMatch(/点击|填写|选择|滚动|等待|打开|访问/);
  });

  it('#11-P2 unmapped-precondition 指引：前置状态用 identity/fixtures 声明表达，不得改写成动作', async () => {
    const cwd = await newCwd();
    const feature = path.join(cwd, 'precondition.feature');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      feature,
      [
        'Feature: Precondition Hint',
        '  Scenario: operator with history',
        '    Given I am already logged in as an operator',
        '    When click "history button"',
        '    Then I should see the history panel',
        '',
      ].join('\n'),
      'utf8',
    );
    const code = await main(
      [
        'init',
        '--from',
        feature,
        '--base-url',
        'https://staging.example.com',
        '--credentials',
        'cred://staging-operator',
      ],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.PASS);
    const files = await readdir(path.join(cwd, '.idwth/contracts'));
    const draftName = files.find((f) => f.endsWith('.draft.yaml'));
    expect(draftName).toBeTruthy();
    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', draftName!),
      'utf8',
    );
    const doc = parseYaml(raw) as Record<string, any>;
    const given = doc._draft.unmapped_steps.find(
      (s: any) => s.keyword === 'Given',
    );
    expect(given).toBeTruthy();
    expect(given.reason).toBe('unmapped-precondition');
    expect(given.guidance).toMatch(/identity|fixtures|身份|凭据|前置/);
    expect(given.guidance).toMatch(/不要|不得|勿|而非|而不是/);
    // 未映射前置不得产生 ready 假落定
    expect(files.filter((f) => f.endsWith('.contract.yaml'))).toHaveLength(0);
  });

  it('#11-P2 顶层 note 含前置状态可操作总则', async () => {
    const cwd = await newCwd();
    await main(BASE_ARGS, { cwd });
    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', DRAFT_FILES[0]!),
      'utf8',
    );
    const doc = parseYaml(raw) as Record<string, any>;
    expect(doc._draft.note).toMatch(/identity|fixtures|前置|封闭动作/);
  });

  it('支持 --out 自定义输出目录与 --flag=value 形式', async () => {
    const cwd = await newCwd();
    const out = path.join(cwd, 'custom-out');
    const code = await main(
      [
        'init',
        `--from=${FIXTURE}`,
        `--base-url=https://staging.example.com`,
        `--credentials=cred://staging-operator`,
        `--role=auditor`,
        `--out=${out}`,
      ],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.PASS);
    const files = await readdir(out);
    expect(files).toContain(READY_FILES[0]);
    const loaded = asContract(
      (await loadContractFile(path.join(out, READY_FILES[0]!))).contract,
    );
    expect(loaded.identity.role).toBe('auditor');
  });

  it('成功时 stdout 分别报告 ready 与 draft（draft 带未映射条数）', async () => {
    const cwd = await newCwd();
    const chunks: string[] = [];
    const spy = (chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    };
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = spy as typeof process.stdout.write;
    try {
      await main(BASE_ARGS, { cwd });
    } finally {
      process.stdout.write = original;
    }
    const output = chunks.join('');
    expect(output).toContain('已生成 Contract');
    expect(output).toMatch(/已生成草稿（1 个未映射步骤/);
  });
});

describe('idwth init --from — 参数与错误退出码', () => {
  it('缺少 --base-url 返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const code = await main(
      ['init', '--from', FIXTURE, '--credentials', 'cred://x'],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('缺少 --credentials 返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const code = await main(
      ['init', '--from', FIXTURE, '--base-url', 'https://x.example.com'],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('非法 --base-url 返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const code = await main(
      ['init', '--from', FIXTURE, '--base-url', 'not-a-url', '--credentials', 'cred://x'],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('--credentials 非 cred:// 前缀返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const code = await main(
      [
        'init',
        '--from',
        FIXTURE,
        '--base-url',
        'https://x.example.com',
        '--credentials',
        'plain-secret',
      ],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('未知选项与位置参数均返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const code1 = await main(['init', '--bogus'], { cwd });
    expect(code1).toBe(EXIT_CODES.CONFIG_ERROR);
    const code2 = await main(['init', 'positional.feature'], { cwd });
    expect(code2).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('feature 文件不存在返回 RUNTIME_ERROR(4)', async () => {
    const cwd = await newCwd();
    const code = await main(
      [
        'init',
        '--from',
        path.join(cwd, 'missing.feature'),
        '--base-url',
        'https://x.example.com',
        '--credentials',
        'cred://x',
      ],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.RUNTIME_ERROR);
  });

  it('feature 语法错误返回 CONFIG_ERROR(3)', async () => {
    const cwd = await newCwd();
    const bad = path.join(cwd, 'bad.feature');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(bad, 'Scenario: 缺少 Feature\nThen I should see x\n', 'utf8');
    const code = await main(
      [
        'init',
        '--from',
        bad,
        '--base-url',
        'https://x.example.com',
        '--credentials',
        'cred://x',
      ],
      { cwd },
    );
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);
  });
});
