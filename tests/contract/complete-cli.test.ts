import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { main } from '../../src/cli/index.js';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { loadContractFile } from '../../src/runtime/contract/loader.js';
import { validateContract } from '../../src/runtime/contract/validate.js';

const CLEANUP: string[] = [];
afterEach(async () => {
  const dirs = CLEANUP.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function newCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-complete-cli-'));
  CLEANUP.push(dir);
  return dir;
}

const SAMPLE_FEATURE_ALL_HIGH = `
Feature: Profile Upload
  Scenario: Upload avatar
    Given I navigate to "https://example.com/profile"
    When I upload a profile picture
    Then I should see "Success"
`;

const SAMPLE_FEATURE_WITH_MEDIUM = `
Feature: Profile Upload
  Scenario: Upload bare
    Given I navigate to "https://example.com/profile"
    When I upload
    Then I should see "Success"
`;

function createDraft(featurePath: string, unmapped: any[], testId = 'profile.upload.avatar') {
  return {
    _draft: {
      status: 'needs-human-completion',
      source_feature: featurePath,
      unmapped_steps: unmapped,
    },
    version: '1',
    test: {
      id: testId,
      name: 'Upload avatar',
    },
    environment: { base_url: 'https://example.com' },
    identity: { role: 'operator', credentials_ref: 'cred://test' },
    goal: 'Upload avatar',
    steps: [
      {
        intent: 'I navigate to "https://example.com/profile"',
        action: 'navigate',
        url: 'https://example.com/profile',
        risk: 'reversible',
      },
      {
        intent: 'I should see "Success"',
        action: 'assert_only',
        risk: 'reversible',
      },
    ],
    assertions: {
      dom: [
        { kind: 'visible', target: 'Success' },
      ],
    },
  };
}

describe('idwth complete CLI (F1-3)', () => {
  it('F1-3.1 默认仅输出建议、退出 0、不写文件（文本形式）', async () => {
    const cwd = await newCwd();
    const featPath = path.join(cwd, 'test.feature');
    await writeFile(featPath, SAMPLE_FEATURE_ALL_HIGH, 'utf8');

    const draft = createDraft(featPath, [
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);
    const draftPath = path.join(cwd, 'test.draft.yaml');
    await writeFile(draftPath, stringifyYaml(draft), 'utf8');

    const chunks: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as any;

    try {
      const code = await main(['complete', draftPath], { cwd });
      expect(code).toBe(EXIT_CODES.PASS);
    } finally {
      process.stdout.write = originalStdout;
    }

    const output = chunks.join('');
    expect(output).toContain('upload-action');
    expect(output).toContain('high');

    // 默认不写 ready contract 文件
    const files = await readdir(cwd);
    expect(files).not.toContain('profile.upload.avatar.contract.yaml');
  });

  it('F1-3.1 默认仅输出建议、退出 0、不写文件（--json 形式）', async () => {
    const cwd = await newCwd();
    const featPath = path.join(cwd, 'test.feature');
    await writeFile(featPath, SAMPLE_FEATURE_ALL_HIGH, 'utf8');

    const draft = createDraft(featPath, [
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);
    const draftPath = path.join(cwd, 'test.draft.yaml');
    await writeFile(draftPath, stringifyYaml(draft), 'utf8');

    const chunks: string[] = [];
    const originalStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as any;

    try {
      const code = await main(['complete', draftPath, '--json'], { cwd });
      expect(code).toBe(EXIT_CODES.PASS);
    } finally {
      process.stdout.write = originalStdout;
    }

    const json = JSON.parse(chunks.join(''));
    expect(json.testId).toBe('profile.upload.avatar');
    expect(json.resolvedHigh).toBe(1);
    expect(json.needsHuman).toBe(0);
    expect(json.candidates[0].matched_rule).toBe('upload-action');
  });

  it('F1-3.2 --apply 全 high：写 <id>.contract.yaml，validate 通过，原 draft 保留；--out 生效', async () => {
    const cwd = await newCwd();
    const featPath = path.join(cwd, 'test.feature');
    await writeFile(featPath, SAMPLE_FEATURE_ALL_HIGH, 'utf8');

    const draft = createDraft(featPath, [
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);
    const draftPath = path.join(cwd, 'test.draft.yaml');
    await writeFile(draftPath, stringifyYaml(draft), 'utf8');

    const outDir = path.join(cwd, 'contracts-out');

    const code = await main(['complete', draftPath, '--apply', `--out=${outDir}`], { cwd });
    expect(code).toBe(EXIT_CODES.PASS);

    // 原 draft 保留
    const draftContent = await readFile(draftPath, 'utf8');
    expect(draftContent).toContain('_draft');

    // 产出 contract 文件在 --out 目录下
    const contractPath = path.join(outDir, 'profile.upload.avatar.contract.yaml');
    const loaded = await loadContractFile(contractPath);
    expect(loaded.contract).toBeDefined();

    const valResult = validateContract(loaded.contract);
    expect(valResult.valid).toBe(true);
  });

  it('F1-3.3 存在 medium/无法补全时 --apply 返回 3、不产出 contract、draft 不被破坏', async () => {
    const cwd = await newCwd();
    const featPath = path.join(cwd, 'test.feature');
    await writeFile(featPath, SAMPLE_FEATURE_WITH_MEDIUM, 'utf8');

    const draft = createDraft(featPath, [
      { keyword: 'When', text: 'I upload', reason: 'unmapped-action' },
    ]);
    const draftPath = path.join(cwd, 'test.draft.yaml');
    await writeFile(draftPath, stringifyYaml(draft), 'utf8');

    const code = await main(['complete', draftPath, '--apply'], { cwd });
    expect(code).toBe(EXIT_CODES.CONFIG_ERROR);

    // 产物不写 contract
    const files = await readdir(cwd);
    expect(files).not.toContain('profile.upload.avatar.contract.yaml');

    // draft 未被破坏
    const draftRaw = await readFile(draftPath, 'utf8');
    const parsed = parseYaml(draftRaw) as any;
    expect(parsed._draft.unmapped_steps).toHaveLength(1);
  });

  it('F1-3.4 draft 缺 _draft / source_feature 缺失返回 3', async () => {
    const cwd = await newCwd();
    const noDraftPath = path.join(cwd, 'no-draft.yaml');
    await writeFile(noDraftPath, stringifyYaml({ version: '1', test: { id: 'a' } }), 'utf8');

    const code1 = await main(['complete', noDraftPath], { cwd });
    expect(code1).toBe(EXIT_CODES.CONFIG_ERROR);

    const noSourceFeaturePath = path.join(cwd, 'no-source.yaml');
    await writeFile(noSourceFeaturePath, stringifyYaml({ _draft: { status: 'draft' } }), 'utf8');
    const code2 = await main(['complete', noSourceFeaturePath], { cwd });
    expect(code2).toBe(EXIT_CODES.CONFIG_ERROR);
  });

  it('F1-3.4 source_feature 文件不存在返回 4', async () => {
    const cwd = await newCwd();
    const draftPath = path.join(cwd, 'missing-source.draft.yaml');
    const draft = createDraft(path.join(cwd, 'non-existent.feature'), [
      { keyword: 'When', text: 'I upload a profile picture', reason: 'unmapped-action' },
    ]);
    await writeFile(draftPath, stringifyYaml(draft), 'utf8');

    const code = await main(['complete', draftPath], { cwd });
    expect(code).toBe(EXIT_CODES.RUNTIME_ERROR);
  });
});

describe('idwth complete 端到端衔接 sample.feature', () => {
  const FIXTURE = path.resolve(fileURLToPath(new URL('../fixtures/sample.feature', import.meta.url)));

  it('init --from 产出的两份草稿经 complete --apply 成功补全为合法 Contract', async () => {
    const cwd = await newCwd();
    // 1. 先用 init --from 生成草稿
    const initCode = await main(
      [
        'init',
        '--from',
        FIXTURE,
        '--base-url',
        'https://staging.example.com',
        '--credentials',
        'cred://staging-operator',
      ],
      { cwd },
    );
    expect(initCode).toBe(EXIT_CODES.PASS);

    const contractsDir = path.join(cwd, '.idwth/contracts');
    const avatarDraft = path.join(contractsDir, 'account.and.catalog.operator.uploads.avatar.draft.yaml');
    const sessionsDraft = path.join(contractsDir, 'account.and.catalog.operator.closes.all.sessions.draft.yaml');

    // 2. complete --apply 头像上传草稿
    const code1 = await main(['complete', avatarDraft, '--apply'], { cwd });
    expect(code1).toBe(EXIT_CODES.PASS);

    const avatarContract = path.join(contractsDir, 'account.and.catalog.operator.uploads.avatar.contract.yaml');
    const loaded1 = await loadContractFile(avatarContract);
    expect(loaded1.contract).toBeDefined();
    expect(validateContract(loaded1.contract).valid).toBe(true);

    // 3. complete --apply 关闭会话草稿
    const code2 = await main(['complete', sessionsDraft, '--apply'], { cwd });
    expect(code2).toBe(EXIT_CODES.PASS);

    const sessionsContract = path.join(contractsDir, 'account.and.catalog.operator.closes.all.sessions.draft.yaml'.replace('.draft.yaml', '.contract.yaml'));
    const loaded2 = await loadContractFile(sessionsContract);
    expect(loaded2.contract).toBeDefined();
    expect(validateContract(loaded2.contract).valid).toBe(true);
  });
});
