import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContractConfigError, loadContractFile } from '../../src/runtime/contract/loader.js';

const YAML_CONTRACT = `
version: "1"
test:
  id: smoke.login
  name: 登录冒烟
environment:
  base_url: https://example.com
identity:
  role: operator
  credentials_ref: "cred://staging-operator"
goal: 用户可以登录
steps:
  - intent: 提交登录
    action: click
    target: 登录按钮
    risk: irreversible
    postcondition:
      - kind: visible
        target: 首页标题
assertions:
  dom:
    - kind: visible
      target: 欢迎横幅
`;

describe('loadContractFile (TR-3.1)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'idwth-contract-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('加载并解析 .yaml Contract，返回 id 与规范化原文', async () => {
    const file = join(dir, 'contract.yaml');
    await writeFile(file, YAML_CONTRACT, 'utf8');
    const loaded = await loadContractFile(file);
    expect(loaded.id).toBe('smoke.login');
    expect(loaded.contract.goal).toBe('用户可以登录');
    expect(loaded.sourceFormat).toBe('yaml');
  });

  it('加载并解析 .json Contract', async () => {
    const file = join(dir, 'contract.json');
    const contract = {
      version: '1',
      test: { id: 'smoke.json', name: 'JSON 用例' },
      environment: { base_url: 'https://example.com' },
      identity: { credentials_ref: 'cred://x' },
      goal: 'g',
      steps: [
        {
          intent: '提交',
          action: 'click',
          target: '确认',
          risk: 'irreversible',
          postcondition: [{ kind: 'visible', target: '结果' }],
        },
      ],
      assertions: { dom: [{ kind: 'visible', target: '结果' }] },
    };
    await writeFile(file, JSON.stringify(contract), 'utf8');
    const loaded = await loadContractFile(file);
    expect(loaded.id).toBe('smoke.json');
    expect(loaded.sourceFormat).toBe('json');
  });

  it('非法 YAML 语法抛 CONFIG_ERROR（映射 exit 3 路径）', async () => {
    const file = join(dir, 'bad.yaml');
    await writeFile(file, 'version: "1"\n  bad: : :\n - [unclosed', 'utf8');
    await expect(loadContractFile(file)).rejects.toBeInstanceOf(ContractConfigError);
  });

  it('文件不存在抛 CONFIG_ERROR 且带文件路径', async () => {
    const file = join(dir, 'missing.yaml');
    await expect(loadContractFile(file)).rejects.toMatchObject({
      name: 'ContractConfigError',
      filePath: file,
    });
  });

  it('九条规则不通过时抛 CONFIG_ERROR 并保留违规明细', async () => {
    const file = join(dir, 'invalid.yaml');
    await writeFile(
      file,
      YAML_CONTRACT.replace('credentials_ref: "cred://staging-operator"', 'credentials_ref: "plaintext-123"'),
      'utf8',
    );
    const err = await loadContractFile(file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractConfigError);
    expect((err as ContractConfigError).violations.length).toBeGreaterThan(0);
  });
});
