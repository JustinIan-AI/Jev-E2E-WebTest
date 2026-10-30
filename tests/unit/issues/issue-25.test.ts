/**
 * Issue #25 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/25
 *
 * fill 结构性不可用：semanticTargetOf 只生成 text 通道，而 getByText 对 input
 * 结构性失效（<input> 是 void 元素，没有文本内容；值在 value、提示在 placeholder）。
 * 契约 target「用户名输入框」在 DOM 中不存在（label 是「用户名：」、placeholder
 * 是「系统登录账号」）→ count=0 → miss → 所有 fill 步骤必然 BLOCKED(decision)。
 *
 * 修复语义（多通道按序尝试）：
 * - 「X输入框」剥离元素类型后缀得核心短语「X」，生成 label 通道（= 可访问名，
 *   对 label 关联的 input 有效）+ placeholder 兜底通道，保留原文 text 通道；
 * - 通道优先级 role > label > name > placeholder > text；
 * - 某通道命中多个 → ambiguous（铁律 6：绝不取第一个，也不换通道绕过歧义）；
 * - 全部通道 miss → miss（上层 BLOCKED(decision)）；
 * - click / 断言不改行为（文本通道对 button / 提示文案有效）。
 */
import { describe, expect, it } from 'vitest';
import { semanticTargetOf } from '../../../src/cli/run-handler.js';
import { E2eProvider } from '../../../src/engine-provider/e2e/provider.js';
import {
  UpstreamE2eEngineDouble,
  type VirtualElement,
} from '../../helpers/upstream-e2e-engine.js';

const ALLOWLIST = ['http://127.0.0.1'];

function connect(page: VirtualElement[]): {
  provider: E2eProvider;
  engine: UpstreamE2eEngineDouble;
} {
  const engine = new UpstreamE2eEngineDouble();
  engine.setPage('/basic', page);
  engine.navigateTo('http://127.0.0.1:1/basic');
  const provider = E2eProvider.connect({ engine, originsAllowlist: ALLOWLIST });
  return { provider, engine };
}

describe('issue #25：semanticTargetOf 多通道推导', () => {
  it('AC1 fill 目标「用户名输入框」→ label 通道「用户名」+ text 原文', () => {
    const target = semanticTargetOf('用户名输入框', { multiChannel: true });
    expect(target.label).toBe('用户名');
    expect(target.text).toBe('用户名输入框');
    expect(target.match).toBe('substring');
  });

  it('AC1b select 目标「角色下拉框」→ label 通道「角色」', () => {
    const target = semanticTargetOf('角色下拉框', { multiChannel: true });
    expect(target.label).toBe('角色');
    expect(target.text).toBe('角色下拉框');
  });

  it('AC1c 无元素类型后缀的短语不多造通道（不猜）', () => {
    const target = semanticTargetOf('用户名', { multiChannel: true });
    expect(target.label).toBeUndefined();
    expect(target.text).toBe('用户名');
  });

  it('AC2 非 fill 目标（click / 断言）仍只喂 text 通道', () => {
    expect(semanticTargetOf('确认按钮')).toEqual({ text: '确认按钮', match: 'substring' });
  });
});

describe('issue #25：provider 多通道按序尝试（L1）', () => {
  it('AC3 label 通道命中：input 无文本内容，text 通道结构性失效', async () => {
    const { provider } = connect([
      { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
    ]);
    const r = await provider.resolve(semanticTargetOf('用户名输入框', { multiChannel: true }), 'L1');
    expect(r.status).toBe('resolved');
    expect(r.strategy).toBe('label');
    await provider.dispose();
  });

  it('AC4 placeholder 通道兜底命中', async () => {
    const { provider } = connect([
      {
        role: 'textbox',
        name: '',
        placeholder: '系统登录账号',
        value: '',
        visible: true,
        enabled: true,
      },
    ]);
    const r = await provider.resolve(
      { placeholder: '系统登录账号', text: '系统登录账号', match: 'substring' },
      'L1',
    );
    expect(r.status).toBe('resolved');
    expect(r.strategy).toBe('placeholder');
    await provider.dispose();
  });

  it('AC5 text 通道回归：button 点击不受影响', async () => {
    const { provider } = connect([
      { role: 'button', name: '确认', text: '确认', visible: true, enabled: true },
    ]);
    const r = await provider.resolve({ text: '确认', match: 'substring' }, 'L1');
    expect(r.status).toBe('resolved');
    expect(r.strategy).toBe('text');
    await provider.dispose();
  });

  it('AC6 全部通道 miss → miss（上层 BLOCKED(decision)），绝不猜测', async () => {
    const { provider } = connect([
      { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
    ]);
    const r = await provider.resolve(
      { label: '不存在的标签', placeholder: '不存在的占位符', text: '不存在的文本', match: 'substring' },
      'L1',
    );
    expect(r.status).toBe('miss');
    await provider.dispose();
  });

  it('AC7 某通道命中多个 → ambiguous（不取第一个、不换通道绕过）', async () => {
    const { provider } = connect([
      { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
      { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
    ]);
    const r = await provider.resolve(
      { label: '用户名', text: '用户名输入框', match: 'substring' },
      'L1',
    );
    expect(r.status).toBe('ambiguous');
    expect(r.count).toBe(2);
    await provider.dispose();
  });

  it('AC8 verifyFreshness 同用多通道：label 命中后判新鲜（防 drift 假阳性）', async () => {
    const { provider } = connect([
      { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
    ]);
    const target = semanticTargetOf('用户名输入框', { multiChannel: true });
    const r = await provider.resolve(target, 'L1');
    expect(r.status).toBe('resolved');
    expect(await provider.verifyFreshness(target, r)).toBe(true);
    await provider.dispose();
  });
});
