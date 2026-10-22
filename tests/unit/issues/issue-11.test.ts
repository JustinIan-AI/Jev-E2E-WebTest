/**
 * Issue #11 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-Test/issues/11
 *
 * 叙述式 Gherkin 与封闭动作集不匹配，旧映射器「取最后引号当 target」导致：
 * - fill 的目标/值颠倒（AC2）；
 * - click / Then 断言 target 残留引号与叙述框架（AC3、AC5）；
 * - 多引号歧义步骤被静默猜测落定（AC4）。
 *
 * 本文件只测纯函数映射层；端到端终态由 tests/integration/issue-11-repro.test.ts 守护。
 */
import { describe, expect, it } from 'vitest';
import {
  extractQuotedAll,
  mapStep,
  mapThenStep,
  parseTargetValue,
  sanitizeTarget,
} from '../../../src/runtime/contract/feature-to-contract.js';
import type { ParsedStep } from '../../../src/runtime/contract/gherkin-parse.js';

const FILL_VERB = /^(?:i\s+)?(?:enter|type|input|fill(?:\s+in)?)\b|(?:输入|填入|填写)/i;

function step(keyword: ParsedStep['keyword'], text: string): ParsedStep {
  return { keyword, text, table: [], docString: null };
}

describe('issue #11：引号语义结构化映射', () => {
  it('AC2 fill「在"用户名"输入框中填写"zhangsan"」目标在前值在后，不颠倒', () => {
    const text = '在“用户名”输入框中填写“zhangsan”';
    const parsed = parseTargetValue(text, FILL_VERB);
    expect(parsed).toEqual({ target: '用户名', value: 'zhangsan' });

    const result = mapStep(step('When', text));
    expect(result).toMatchObject({
      step: { action: 'fill', target: '用户名', value: 'zhangsan' },
    });
  });

  it('AC3 click「点击"确定"按钮」剥除引号，输出纯语义目标', () => {
    const result = mapStep(step('When', '点击“确定”按钮'));
    expect(result).toMatchObject({
      step: { action: 'click', target: '确定按钮', risk: 'reversible' },
    });
    if ('step' in result) {
      expect(result.step.target).not.toMatch(/[“”"‘’]/);
    }
  });

  it('AC4 ≥3 个引号片段目标不唯一 → ambiguous-target，绝不猜第一个', () => {
    const text = '在“邮箱”输入框中填写“a@b.com”并抄送“ops@b.com”';
    expect(extractQuotedAll(text)).toHaveLength(3);
    const result = mapStep(step('When', text));
    expect(result).toEqual({ reason: 'ambiguous-target' });
  });

  it('AC5 Then「用户列表中显示"zhangsan"」取引号内容、丢弃叙述框架', () => {
    const result = mapThenStep(step('Then', '用户列表中显示“zhangsan”'));
    expect(result).not.toBeNull();
    expect(result!.assertion).toEqual({ kind: 'visible', target: 'zhangsan' });
  });

  it('AC5 Then 显示句无引号 → null（上层记 unrecognized-assertion，不静默落定）', () => {
    expect(mapThenStep(step('Then', '用户列表中显示 zhangsan'))).toBeNull();
  });

  it('AC5 Then「应该看到"创建成功"提示」剥引号 visible', () => {
    const result = mapThenStep(step('Then', '应该看到“创建成功”提示'));
    expect(result!.assertion).toEqual({ kind: 'visible', target: '创建成功提示' });
  });

  it('R7 sanitizeTarget 剥离引号与选择器特征，输出语义短语', () => {
    expect(sanitizeTarget('#submit-btn >> nth=0()')).toBe('submit-btn nth=0');
    expect(sanitizeTarget('“确定”按钮')).toBe('确定按钮');
  });
});
