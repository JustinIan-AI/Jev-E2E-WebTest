/**
 * Issue #23 单元复现（Failing Repro → 回归守护）：
 * https://github.com/JustinIan-AI/Jev-E2E-Test/issues/23
 *
 * QUOTED_PATTERN 捕获组 `[^”"‘']+` 要求引号内至少 1 个字符 → 空引号 `""`
 * 不匹配 → `fill in "X" with ""`（必填校验负向用例标配句式）只提取到 1 个
 * 片段 → parseTargetValue 要求恰好 2 片段 → unmapped-action，guidance 误导。
 *
 * 修复后语义：
 * - 空引号匹配为空串，`fill "X" with ""` 映射为 value: ""（运行时 fill('') = 清空）；
 * - target 为空串仍拒收（防 `click ""` / `fill "" with "x"` 空目标混入）。
 */
import { describe, expect, it } from 'vitest';
import {
  extractQuotedAll,
  mapStep,
  parseTargetValue,
} from '../../../src/runtime/contract/feature-to-contract.js';
import type { ParsedStep } from '../../../src/runtime/contract/gherkin-parse.js';

const FILL_VERB = /^(?:i\s+)?(?:enter|type|input|fill(?:\s+in)?)\b|(?:输入|填入|填写)/i;

function step(keyword: ParsedStep['keyword'], text: string): ParsedStep {
  return { keyword, text, table: [], docString: null };
}

describe('issue #23：空引号（fill with ""）必须可映射', () => {
  it('AC1 `fill in "用户名输入框" with ""` 映射为 value: ""（必填校验负向用例）', () => {
    const text = 'fill in “用户名输入框” with “”';
    expect(extractQuotedAll(text)).toEqual(['用户名输入框', '']);
    expect(parseTargetValue(text, FILL_VERB)).toEqual({
      target: '用户名输入框',
      value: '',
    });
    expect(mapStep(step('When', text))).toMatchObject({
      step: { action: 'fill', target: '用户名输入框', value: '', risk: 'reversible' },
    });
  });

  it('AC1b 中文句式 `在"用户名输入框"中填写""` 同样映射为 value: ""', () => {
    const text = '在“用户名输入框”中填写“”';
    expect(mapStep(step('When', text))).toMatchObject({
      step: { action: 'fill', target: '用户名输入框', value: '' },
    });
  });

  it('AC2 `click ""` 空目标仍拒收（unmapped-action）', () => {
    expect(mapStep(step('When', 'click “”'))).toEqual({ reason: 'unmapped-action' });
  });

  it('AC2b `fill "" with "x"` 空 target 守卫：parseTargetValue 返回 null', () => {
    expect(parseTargetValue('fill “” with “x”', FILL_VERB)).toBeNull();
    expect(mapStep(step('When', 'fill “” with “x”'))).toEqual({ reason: 'unmapped-action' });
  });

  it('AC3 回归守护：非空引号提取行为不变', () => {
    expect(extractQuotedAll('在“用户名”输入框中填写“zhangsan”')).toEqual([
      '用户名',
      'zhangsan',
    ]);
    expect(extractQuotedAll('no quotes here')).toEqual([]);
  });
});
