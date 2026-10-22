/**
 * Issue #11 集成守护：叙述式 Gherkin 喂入 `idwth init --from` 的映射/校验终态。
 *
 * 端到端断言（in-process 调 CLI，临时 cwd）：
 * - AC#2 「在"用户名"输入框中填写"zhangsan"」→ fill，target=用户名、value=zhangsan（不颠倒）；
 * - AC#3 「点击"确定"按钮」→ click，target=确定按钮（剥引号，可被 substring 匹配）；
 * - Then「应该看到"创建成功"提示」→ visible 创建成功提示（剥引号）；
 * - Then「用户列表中显示"zhangsan"」→ visible zhangsan（丢弃叙述框架）；
 * - Given 状态句 → unmapped-precondition（identity/fixtures 指引）；
 * - 主语前缀叙述 When → unmapped-action（封闭动作集指引）；
 * - 整体落 draft：仅产出 *.draft.yaml，无 ready 假落定。
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { main } from '../../src/cli/index.js';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';

const CLEANUP: string[] = [];
afterEach(async () => {
  const dirs = CLEANUP.splice(0);
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function newCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'idwth-issue11-'));
  CLEANUP.push(dir);
  return dir;
}

const REPRO_FEATURE = [
  'Feature: 用户管理',
  '  Background:',
  '    Given 管理员已登录系统并拥有 "system:user:create" 权限',
  '',
  '  Scenario: 成功创建新用户',
  '    When 管理员在用户管理页面点击"新增"按钮',
  '    And 在"用户名"输入框中填写"zhangsan"',
  '    And 点击"确定"按钮',
  '    Then 应该看到"创建成功"提示',
  '    And 用户列表中显示"zhangsan"',
  '',
].join('\n');

describe('issue #11 复现：init --from 映射/校验终态', () => {
  it('叙述式 feature 整体落 draft，无 ready 假落定，返回 0', async () => {
    const cwd = await newCwd();
    const feature = path.join(cwd, 'repro.feature');
    await writeFile(feature, REPRO_FEATURE, 'utf8');

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
    expect(files).toEqual(['scenario0.scenario1.draft.yaml']);
    expect(files.filter((f) => f.endsWith('.contract.yaml'))).toHaveLength(0);

    const raw = await readFile(
      path.join(cwd, '.idwth/contracts', 'scenario0.scenario1.draft.yaml'),
      'utf8',
    );
    expect(raw.startsWith('# DRAFT')).toBe(true);
    const doc = parseYaml(raw) as Record<string, any>;

    // --- AC#2 fill：目标在前、值在后，不颠倒 ---
    const fill = doc.steps.find((s: any) => s.action === 'fill');
    expect(fill).toBeTruthy();
    expect(fill.target).toBe('用户名');
    expect(fill.value).toBe('zhangsan');

    // --- AC#3 click：target 剥引号 ---
    const clicks = doc.steps.filter((s: any) => s.action === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0].target).toBe('确定按钮');
    expect(clicks[0].target).not.toMatch(/["“”‘’]/);
    // 「确定」非不可逆关键词（确认/提交才是），保守可逆、无 postcondition
    expect(clicks[0].risk).toBe('reversible');
    expect(clicks[0].postcondition).toBeUndefined();

    // --- DOM 断言：两个 visible，均剥引号 ---
    expect(doc.assertions.dom).toEqual([
      { kind: 'visible', target: '创建成功提示' },
      { kind: 'visible', target: 'zhangsan' },
    ]);

    // --- 未映射步骤：Given 前置 + 主语前缀 When，均带可操作指引 ---
    expect(doc._draft.unmapped_steps).toHaveLength(2);
    const [precondition, action] = doc._draft.unmapped_steps;
    expect(precondition).toMatchObject({
      keyword: 'Given',
      reason: 'unmapped-precondition',
    });
    expect(precondition.guidance).toMatch(/identity|fixtures/);
    expect(action).toMatchObject({
      keyword: 'When',
      reason: 'unmapped-action',
    });
    expect(action.guidance).toMatch(/点击|填写|选择|滚动|等待|打开|访问/);
  });
});
