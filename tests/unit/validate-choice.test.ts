/**
 * Task 12 / TR-12.1 —— L3 决策应答合法性校验（DD §7.3 五校验 + §7.2 分级阈值）。
 *
 * 校验次序：合法性优先于阈值（结构/白名单 → 范围 → 概率结构 → 置信度阈值）。
 * 任一不满足 → 零动作派发，BLOCKED(decision)（AC-05）。
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLDS,
  DECISION_OPERATIONS,
  validateChoiceAnswer,
} from '../../src/adapters/jev/validate.js';
import { createDecisionBudget } from '../../src/adapters/jev/budget.js';
import type { ChoiceAnswer } from '../../src/adapters/jev/types.js';

const reversibleCtx = {
  requestedOperation: 'click' as const,
  candidateCount: 3,
  risk: 'reversible' as const,
};

const irreversibleCtx = { ...reversibleCtx, risk: 'irreversible' as const };

function answer(over: Partial<ChoiceAnswer>): ChoiceAnswer {
  return { choice: 1, confidence: 0.72, ...over };
}

/* ─────────────── 合法响应 ─────────────── */

describe('validateChoiceAnswer：合法响应', () => {
  it('choice 在候选范围内 → 通过，operation 由代码给定', () => {
    const v = validateChoiceAnswer({ ...reversibleCtx, answer: answer({}) });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.decision).toEqual({
        operation: 'click',
        targetIndex: 1,
        confidence: 0.72,
      });
    }
  });

  it('choice=0（首个候选）与 choice=末位候选均通过', () => {
    expect(
      validateChoiceAnswer({ ...reversibleCtx, answer: answer({ choice: 0 }) }).ok,
    ).toBe(true);
    expect(
      validateChoiceAnswer({ ...reversibleCtx, answer: answer({ choice: 2 }) }).ok,
    ).toBe(true);
  });

  it('模型回填 operation 且等于请求 operation（白名单内）→ 通过', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ operation: 'click' }),
    });
    expect(v.ok).toBe(true);
  });

  it('合法概率结构（键齐全、Σ=1、p[choice]=max）→ 通过', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 } }),
    });
    expect(v.ok).toBe(true);
  });
});

/* ─────────────── 非法 operation（白名单） ─────────────── */

describe('validateChoiceAnswer：非法 operation → 零派发', () => {
  it('模型回填 eval_js → illegal_operation', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ operation: 'eval_js' }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'illegal_operation' });
  });

  it('模型回填 xpath://… → illegal_operation', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ operation: 'xpath://div[1]' }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'illegal_operation' });
  });

  it('回填 operation 与请求 operation 不一致（fill ≠ click）→ illegal_operation', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ operation: 'fill' }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'illegal_operation' });
  });

  it('白名单仅含 click/fill/select（语义动作三操作）', () => {
    expect([...DECISION_OPERATIONS]).toEqual(['click', 'fill', 'select']);
  });
});

/* ─────────────── 越界 index ─────────────── */

describe('validateChoiceAnswer：越界/非法 choice → out_of_range', () => {
  it.each([99, -1, 3, 1.5, Number.NaN])('choice=%p → out_of_range', (choice) => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ choice: choice as number }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'out_of_range' });
  });
});

/* ─────────────── 结构非法 / 目标注入 ─────────────── */

describe('validateChoiceAnswer：结构与注入拦截', () => {
  it.each([
    ['null', null],
    ['数组', [1, 2]],
    ['字符串', 'choice 1'],
    ['数字', 1],
  ])('answer 为%s → invalid_structure', (_label, raw) => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: raw as unknown as ChoiceAnswer,
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_structure' });
  });

  it.each([1.2, -0.1, Number.NaN, '0.8'])(
    'confidence=%p 非法 → invalid_structure',
    (confidence) => {
      const v = validateChoiceAnswer({
        ...reversibleCtx,
        answer: answer({ confidence: confidence as number }),
      });
      expect(v).toMatchObject({ ok: false, reason: 'invalid_structure' });
    },
  );

  it('answer 携带 selector / xpath / js / coordinates 注入字段 → unknown_field', () => {
    for (const key of ['selector', 'xpath', 'js', 'coordinates']) {
      const v = validateChoiceAnswer({
        ...reversibleCtx,
        answer: { ...answer({}), [key]: '#btn-submit' } as unknown as ChoiceAnswer,
      });
      expect(v).toMatchObject({ ok: false, reason: 'unknown_field' });
    }
  });

  it('answer 缺 choice / 缺 confidence → invalid_structure', () => {
    const v1 = validateChoiceAnswer({
      ...reversibleCtx,
      answer: { confidence: 0.8 } as unknown as ChoiceAnswer,
    });
    expect(v1).toMatchObject({ ok: false, reason: 'invalid_structure' });
    const v2 = validateChoiceAnswer({
      ...reversibleCtx,
      answer: { choice: 1 } as unknown as ChoiceAnswer,
    });
    expect(v2).toMatchObject({ ok: false, reason: 'invalid_structure' });
  });
});

/* ─────────────── 概率结构（DD §7.3 ②③④） ─────────────── */

describe('validateChoiceAnswer：非法概率 → invalid_probability', () => {
  it('② 键少于候选集（缺 2）→ invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 0.5, 1: 0.5 } }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });

  it('② 键多于候选集（多出 3）→ invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 0.4, 1: 0.4, 2: 0.2, 3: 0 } }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });

  it('③ Σp=0.9（|Σp−1| ≥ 1e-6）→ invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 0.3, 1: 0.3, 2: 0.3 } }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });

  it('③ Σ=1 但单值越界（1.2 / 负值）→ invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 1.2, 1: -0.2, 2: 0 } }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });

  it('④ p[choice] ≠ max(p) → invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: { 0: 0.9, 1: 0.05, 2: 0.05 } }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });

  it('probabilities 非对象（数组）→ invalid_probability', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ probabilities: [0.5, 0.5] as unknown as Record<string, number> }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'invalid_probability' });
  });
});

/* ─────────────── 分级置信度阈值（DD §7.2，DD-15） ─────────────── */

describe('validateChoiceAnswer：分级置信度门限（合法性之后才生效）', () => {
  it('reversible：0.60 恰好通过、0.599 拒绝 low_confidence', () => {
    const ok = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ confidence: 0.6 }),
    });
    expect(ok.ok).toBe(true);
    const low = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ confidence: 0.599 }),
    });
    expect(low).toMatchObject({ ok: false, reason: 'low_confidence' });
  });

  it('irreversible：0.90 恰好通过、0.899 拒绝 low_confidence', () => {
    const ok = validateChoiceAnswer({
      ...irreversibleCtx,
      answer: answer({ confidence: 0.9 }),
    });
    expect(ok.ok).toBe(true);
    const low = validateChoiceAnswer({
      ...irreversibleCtx,
      answer: answer({ confidence: 0.899 }),
    });
    expect(low).toMatchObject({ ok: false, reason: 'low_confidence' });
  });

  it('reversible 合法的 0.72 在 irreversible 下不足 0.90 → low_confidence', () => {
    const v = validateChoiceAnswer({ ...irreversibleCtx, answer: answer({}) });
    expect(v).toMatchObject({ ok: false, reason: 'low_confidence' });
  });

  it('阈值表：reversible=0.60 / irreversible=0.90', () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({ reversible: 0.6, irreversible: 0.9 });
  });

  it('合法性优先于阈值：choice 越界且置信度低 → 报 out_of_range 而非 low_confidence', () => {
    const v = validateChoiceAnswer({
      ...reversibleCtx,
      answer: answer({ choice: 99, confidence: 0.1 }),
    });
    expect(v).toMatchObject({ ok: false, reason: 'out_of_range' });
  });
});

/* ─────────────── 预算控制（DD §7.4：发请求前按最坏情况预留） ─────────────── */

describe('createDecisionBudget：发请求前预留', () => {
  it('maxRequests=1：首次预留成功，第二次被拒（请求前拦截）', () => {
    const b = createDecisionBudget({ maxRequests: 1 });
    expect(b.reserve(1, 0)).toBe(true);
    expect(b.reserve(1, 0)).toBe(false);
  });

  it('maxCost=150：第一次预留 100 成功；第二次 100 超额被拒；50 恰好成功', () => {
    const b = createDecisionBudget({ maxCost: 150 });
    expect(b.reserve(1, 100)).toBe(true);
    expect(b.reserve(1, 100)).toBe(false);
    expect(b.reserve(1, 50)).toBe(true);
  });

  it('一次预留多个请求单位同样受限', () => {
    const b = createDecisionBudget({ maxRequests: 2 });
    expect(b.reserve(2, 0)).toBe(true);
    expect(b.reserve(1, 0)).toBe(false);
  });

  it('无上限预算：任意预留均成功', () => {
    const b = createDecisionBudget({});
    for (let i = 0; i < 10; i++) expect(b.reserve(1, 999)).toBe(true);
  });

  it('snapshot 如实记账（含已消耗请求与成本）', () => {
    const b = createDecisionBudget({ maxRequests: 5, maxCost: 300 });
    b.reserve(1, 100);
    b.reserve(2, 50);
    expect(b.snapshot()).toEqual({ usedRequests: 3, usedCost: 150 });
  });
});
