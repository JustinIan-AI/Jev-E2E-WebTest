/**
 * Task 9 RED — Judge 纯函数判定（AC-09 / TR-9.1，详设 §3.2 / §3.6 / §4.8.7）。
 *
 * 固定优先级：无法求值(BLOCKED evidence) → 歧义(BLOCKED ambiguity) → FAIL → PASS。
 * 模型信号恒为 candidate，不能直接产生 PASS/FAIL；judgement_set 空 → BLOCKED。
 */
import { describe, expect, it } from 'vitest';
import {
  computeVerdictHash,
  judge,
  JUDGE_VERSION,
} from '../../src/runtime/judge/index.js';
import type {
  BackendAssertionSpec,
  DomAssertionSpec,
  HttpAssertionSpec,
  JudgeEvidence,
} from '../../src/runtime/judge/types.js';

const AT = '2026-10-12T00:00:00.000Z';

function el(partial: Partial<JudgeEvidence['elements'][number]> & { id: number }) {
  return {
    role: 'button',
    name: '',
    text: '',
    visible: true,
    enabled: true,
    value: undefined,
    checked: undefined,
    ...partial,
  };
}

function evidence(partial: Partial<JudgeEvidence> = {}): JudgeEvidence {
  return {
    elements: [],
    url: 'https://sut.local/dashboard',
    http: [],
    backend: [],
    ...partial,
  };
}

function dom(assertion: DomAssertionSpec): { dom: DomAssertionSpec[] } {
  return { dom: [assertion] };
}

describe('Judge — DOM 七原语精确求值（§3.2）', () => {
  it('visible: ≥1 个可见 enabled 匹配 → PASS；文本包含要求同时满足', () => {
    const ok = judge({
      assertions: dom({ kind: 'visible', target: '创建', text_contains: '创建工作负载' }),
      evidence: evidence({
        elements: [
          el({ id: 1, name: '创建工作负载', text: '创建工作负载', visible: true }),
        ],
      }),
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const textMiss = judge({
      assertions: dom({ kind: 'visible', target: '创建', text_contains: 'idwth-abc12345-c1' }),
      evidence: evidence({
        elements: [el({ id: 1, name: '创建工作负载', text: '创建工作负载' })],
      }),
      evaluatedAt: AT,
    });
    expect(textMiss.verdict).toBe('FAIL');
  });

  it('visible: 匹配元素存在但不可见/disabled → FAIL；count=0 也是 FAIL（可观测事实）', () => {
    const hidden = judge({
      assertions: dom({ kind: 'visible', target: '保存' }),
      evidence: evidence({
        elements: [el({ id: 1, name: '保存', visible: false })],
      }),
      evaluatedAt: AT,
    });
    expect(hidden.verdict).toBe('FAIL');

    const missing = judge({
      assertions: dom({ kind: 'visible', target: '删除' }),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(missing.verdict).toBe('FAIL');
  });

  it('visible: target 子串匹配 case-insensitive，match:exact 收紧', () => {
    const ci = judge({
      assertions: dom({ kind: 'visible', target: 'SUBMIT' }),
      evidence: evidence({ elements: [el({ id: 1, name: 'submit now' })] }),
      evaluatedAt: AT,
    });
    expect(ci.verdict).toBe('PASS');

    const exact = judge({
      assertions: dom({ kind: 'visible', target: 'submit', match: 'exact' }),
      evidence: evidence({ elements: [el({ id: 1, name: 'submit now' })] }),
      evaluatedAt: AT,
    });
    expect(exact.verdict).toBe('FAIL');
  });

  it('absent: 匹配数为 0（含不可见）→ PASS；有可见匹配 → FAIL', () => {
    const gone = judge({
      assertions: dom({ kind: 'absent', target: '加载中' }),
      evidence: evidence({
        elements: [el({ id: 1, name: '加载中', visible: false })],
      }),
      evaluatedAt: AT,
    });
    // 存在但不可见 → 匹配数不为 0，absent 要求「匹配数 == 0（含不可见）」→ FAIL
    expect(gone.verdict).toBe('FAIL');

    const reallyGone = judge({
      assertions: dom({ kind: 'absent', target: '加载中' }),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(reallyGone.verdict).toBe('PASS');
  });

  it('count: 匹配数等于 equals → PASS；不等 → FAIL', () => {
    const ev = evidence({
      elements: [
        el({ id: 1, role: 'row', name: '行A', text: '行A' }),
        el({ id: 2, role: 'row', name: '行B', text: '行B' }),
      ],
    });
    const ok = judge({
      assertions: dom({ kind: 'count', target: '行', equals: 2, allow_multiple: true }),
      evidence: ev,
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const bad = judge({
      assertions: dom({ kind: 'count', target: '行', equals: 3, allow_multiple: true }),
      evidence: ev,
      evaluatedAt: AT,
    });
    expect(bad.verdict).toBe('FAIL');
  });

  it('count: 多匹配且未声明 allow_multiple → BLOCKED(ambiguity)', () => {
    const r = judge({
      assertions: dom({ kind: 'count', target: '行', equals: 2 }),
      evidence: evidence({
        elements: [
          el({ id: 1, role: 'row', name: '行A', text: '行A' }),
          el({ id: 2, role: 'row', name: '行B', text: '行B' }),
        ],
      }),
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('ambiguity');
  });

  it('value: 控件 inputValue 严格相等；两侧可解析为 number 时按数值比；控件不存在 → BLOCKED(evidence)', () => {
    const ok = judge({
      assertions: dom({ kind: 'value', target: '副本数', equals: '3' }),
      evidence: evidence({
        elements: [el({ id: 1, name: '副本数', value: '3' })],
      }),
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const numeric = judge({
      assertions: dom({ kind: 'value', target: '端口', equals: '8080' }),
      evidence: evidence({
        elements: [el({ id: 1, name: '端口', value: '8080' })],
      }),
      evaluatedAt: AT,
    });
    expect(numeric.verdict).toBe('PASS');

    const missing = judge({
      assertions: dom({ kind: 'value', target: '不存在的控件', equals: 'x' }),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(missing.verdict).toBe('BLOCKED');
    expect(missing.blockedReason).toBe('evidence');
  });

  it('checked: isChecked 等于 equals；控件不存在 → BLOCKED(evidence)', () => {
    const ok = judge({
      assertions: dom({ kind: 'checked', target: '同意', equals: true }),
      evidence: evidence({
        elements: [el({ id: 1, name: '同意', checked: true })],
      }),
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const unchecked = judge({
      assertions: dom({ kind: 'checked', target: '同意', equals: true }),
      evidence: evidence({
        elements: [el({ id: 1, name: '同意', checked: false })],
      }),
      evaluatedAt: AT,
    });
    expect(unchecked.verdict).toBe('FAIL');

    const missing = judge({
      assertions: dom({ kind: 'checked', target: '同意', equals: true }),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(missing.verdict).toBe('BLOCKED');
    expect(missing.blockedReason).toBe('evidence');
  });

  it('url: new URL(...).pathname 严格等于（不含 query/hash）', () => {
    const ok = judge({
      assertions: dom({ kind: 'url', equals: '/workloads' }),
      evidence: evidence({ url: 'https://sut.local/workloads?tab=all#top' }),
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const bad = judge({
      assertions: dom({ kind: 'url', equals: '/workloads?tab=all' }),
      evidence: evidence({ url: 'https://sut.local/workloads?tab=all' }),
      evaluatedAt: AT,
    });
    expect(bad.verdict).toBe('FAIL');
  });

  it('number: 解析数字 abs(actual-equals)<1e-9；解析失败/控件缺失 → BLOCKED(evidence)', () => {
    const ok = judge({
      assertions: dom({ kind: 'number', target: '总量', equals: 42 }),
      evidence: evidence({
        elements: [el({ id: 1, name: '总量', text: ' 42 ' })],
      }),
      evaluatedAt: AT,
    });
    expect(ok.verdict).toBe('PASS');

    const epsilon = judge({
      assertions: dom({ kind: 'number', target: '总量', equals: 1 }),
      evidence: evidence({
        elements: [el({ id: 1, name: '总量', text: '1.0000000001' })],
      }),
      evaluatedAt: AT,
    });
    expect(epsilon.verdict).toBe('PASS');

    const nan = judge({
      assertions: dom({ kind: 'number', target: '总量', equals: 1 }),
      evidence: evidence({
        elements: [el({ id: 1, name: '总量', text: 'N/A' })],
      }),
      evaluatedAt: AT,
    });
    expect(nan.verdict).toBe('BLOCKED');
    expect(nan.blockedReason).toBe('evidence');
  });
});

describe('Judge — HTTP 断言三条补充规则（§3.2）', () => {
  const httpSpec = (a: Partial<HttpAssertionSpec> & Pick<HttpAssertionSpec, 'method' | 'path_prefix' | 'status_equals'>): HttpAssertionSpec => ({
    kind: 'http',
    ...a,
  });

  function http(assertions: HttpAssertionSpec[]) {
    return { dom: [], http: assertions };
  }

  it('path_prefix 以前缀匹配去 query 的 pathname；path_equals 精确匹配', () => {
    const ev = evidence({
      http: [
        {
          id: 'h1',
          method: 'POST',
          url: 'https://api.local/apis/app/v1/workloads?dryRun=false',
          status: 201,
          timestamp: '2026-10-12T00:00:01.000Z',
          body: {},
        },
      ],
    });
    const prefix = judge({
      assertions: http([httpSpec({ method: 'POST', path_prefix: '/apis/app/v1/workloads', status_equals: 201 })]),
      evidence: ev,
      evaluatedAt: AT,
    });
    expect(prefix.verdict).toBe('PASS');

    const exact = judge({
      assertions: http([httpSpec({ method: 'POST', path_equals: '/apis/app/v1/workloads', status_equals: 201 })]),
      evidence: ev,
      evaluatedAt: AT,
    });
    expect(exact.verdict).toBe('PASS');
  });

  it('within_run=true 只取 timestamp >= run_started_at 的响应，旧残留不参与判定', () => {
    const r = judge({
      assertions: http([
        httpSpec({
          method: 'POST',
          path_prefix: '/w',
          status_equals: 201,
          within_run: true,
        }),
      ]),
      evidence: evidence({
        runStartedAt: '2026-10-12T00:00:00.000Z',
        http: [
          { id: 'old', method: 'POST', url: 'https://api.local/w', status: 500, timestamp: '2026-10-11T00:00:00.000Z', body: {} },
          { id: 'new', method: 'POST', url: 'https://api.local/w', status: 201, timestamp: '2026-10-12T00:00:05.000Z', body: {} },
        ],
      }),
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('PASS');
    expect(r.assertionResults[0]!.evidenceId).toBe('h-new');
  });

  it('同 (method,path) 多条响应取状态码最匹配的；全不匹配取最后一条并记 ambiguous_response → BLOCKED(evidence)', () => {
    const ev = evidence({
      http: [
        { id: 'h-a', method: 'GET', url: 'https://api.local/w', status: 500, timestamp: '2026-10-12T00:00:01.000Z', body: {} },
        { id: 'h-b', method: 'GET', url: 'https://api.local/w', status: 200, timestamp: '2026-10-12T00:00:02.000Z', body: {} },
        { id: 'h-c', method: 'GET', url: 'https://api.local/w', status: 502, timestamp: '2026-10-12T00:00:03.000Z', body: {} },
      ],
    });
    const matched = judge({
      assertions: http([httpSpec({ method: 'GET', path_prefix: '/w', status_equals: 200 })]),
      evidence: ev,
      evaluatedAt: AT,
    });
    expect(matched.verdict).toBe('PASS');
    expect(matched.assertionResults[0]!.evidenceId).toBe('h-b');

    const none = judge({
      assertions: http([httpSpec({ method: 'GET', path_prefix: '/w', status_equals: 200 })]),
      evidence: evidence({
        http: [
          { id: 'h-a', method: 'GET', url: 'https://api.local/w', status: 500, timestamp: '2026-10-12T00:00:01.000Z', body: {} },
          { id: 'h-c', method: 'GET', url: 'https://api.local/w', status: 502, timestamp: '2026-10-12T00:00:03.000Z', body: {} },
        ],
      }),
      evaluatedAt: AT,
    });
    expect(none.verdict).toBe('BLOCKED');
    expect(none.blockedReason).toBe('evidence');
    expect(none.assertionResults[0]!.evidenceId).toBe('h-c');
  });

  it('无匹配 HTTP 证据 → BLOCKED(evidence)（A2：无证据不可 PASS）', () => {
    const r = judge({
      assertions: http([httpSpec({ method: 'DELETE', path_prefix: '/w', status_equals: 204 })]),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('evidence');
  });
});

describe('Judge — backend 断言（run_created_set 计数）', () => {
  function backend(a: BackendAssertionSpec) {
    return { dom: [], backend: [a] };
  }

  it('provider 查询结果 equals 匹配 → PASS；不等 → FAIL；缺证据 → BLOCKED(evidence)', () => {
    const base = {
      assertions: backend({ kind: 'backend', key: 'configmap.count', equals: 1 }),
      evaluatedAt: AT,
    };
    const ok = judge({
      ...base,
      evidence: evidence({ backend: [{ key: 'configmap.count', value: 1, scope: 'run' }] }),
    });
    expect(ok.verdict).toBe('PASS');

    const bad = judge({
      ...base,
      evidence: evidence({ backend: [{ key: 'configmap.count', value: 2, scope: 'run' }] }),
    });
    expect(bad.verdict).toBe('FAIL');

    const missing = judge({ ...base, evidence: evidence() });
    expect(missing.verdict).toBe('BLOCKED');
    expect(missing.blockedReason).toBe('evidence');
  });
});

describe('Judge — 固定优先级与三态（AC-09）', () => {
  it('A1：模型自述完成但 HTTP 500 → FAIL（模型信号恒为 candidate）', () => {
    const r = judge({
      assertions: {
        dom: [],
        http: [{ kind: 'http', method: 'POST', path_prefix: '/w', status_equals: 201 }],
      },
      evidence: evidence({
        http: [
          { id: 'h1', method: 'POST', url: 'https://api.local/w', status: 500, timestamp: AT, body: { error: 'boom' } },
        ],
      }),
      candidates: [{ role: 'assistant', content: '任务已完成，工作负载创建成功', confidence: 0.99 }],
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('FAIL');
  });

  it('A2：judgement_set 为空（无任何证据），即便模型自述完成 → BLOCKED，非 PASS', () => {
    const r = judge({
      assertions: dom({ kind: 'visible', target: '成功提示' }),
      evidence: evidence(),
      candidates: [{ role: 'assistant', content: 'done', confidence: 1 }],
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('evidence');
  });

  it('顺序不可换：1 条 FAIL + 1 条无法求值并存 → BLOCKED(evidence)，不是 FAIL', () => {
    const r = judge({
      assertions: {
        dom: [
          { kind: 'visible', target: '不存在的元素X' }, // 无匹配 → FAIL
          { kind: 'value', target: '不存在的控件Y', equals: '1' }, // 控件缺失 → 无法求值
        ],
      },
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('evidence');
  });

  it('歧义优先于 FAIL：1 条 FAIL + 1 条歧义 → BLOCKED(ambiguity)', () => {
    const r = judge({
      assertions: {
        dom: [
          { kind: 'visible', target: '缺失Z' }, // FAIL
          { kind: 'count', target: '行', equals: 1 }, // 多匹配未声明 allow_multiple → 歧义
        ],
      },
      evidence: evidence({
        elements: [
          el({ id: 1, role: 'row', name: '行A', text: '行A' }),
          el({ id: 2, role: 'row', name: '行B', text: '行B' }),
        ],
      }),
      evaluatedAt: AT,
    });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockedReason).toBe('ambiguity');
  });

  it('全部断言求值完成且 passed → PASS；断言集为空 → BLOCKED(evidence)', () => {
    const pass = judge({
      assertions: { dom: [] },
      evidence: evidence({ elements: [el({ id: 1, name: '随便什么' })] }),
      evaluatedAt: AT,
    });
    // 有证据但无断言：无断言可判，按「不可判」保守 BLOCKED(evidence)
    expect(pass.verdict).toBe('BLOCKED');
    expect(pass.blockedReason).toBe('evidence');
  });

  it('纯函数：同输入必同输出，evaluatedAt 之外无隐藏状态/时间/随机依赖', () => {
    const input = {
      assertions: dom({ kind: 'visible', target: '保存' }),
      evidence: evidence({ elements: [el({ id: 1, name: '保存' })] }),
      evaluatedAt: AT,
    };
    const a = judge(input);
    const b = judge({ ...input, evidence: evidence({ elements: [el({ id: 99, name: '保存' })] }), candidates: [] });
    // elementId 不参与判定文本，结论一致（evidence_ref 仍记录实际 id）
    expect(b.verdict).toBe(a.verdict);
    expect(judge(input)).toEqual(a);
  });
});

describe('Judge — judge_result 与 verdict_hash（§3.6）', () => {
  it('judge_result 形状固定：verdict/blocked_reason/assertions/evaluated_at/judge_version', () => {
    const r = judge({
      assertions: dom({ kind: 'visible', target: '保存' }),
      evidence: evidence({ elements: [el({ id: 1, name: '保存' })] }),
      evaluatedAt: AT,
    });
    expect(r.blockedReason).toBeNull();
    expect(r.evaluatedAt).toBe(AT);
    expect(r.judgeVersion).toBe(JUDGE_VERSION);
    expect(r.assertionResults).toHaveLength(1);
    expect(r.assertionResults[0]).toMatchObject({
      kind: 'visible',
      passed: true,
      result: 'passed',
    });
    expect(typeof r.assertionResults[0]!.evidenceRef).toBe('string');
  });

  it('verdict_hash = sha256(canonical(judge_result) ‖ evidence_digest ‖ judge_impl_hash)', () => {
    const input = {
      assertions: dom({ kind: 'visible', target: '保存' }),
      evidence: evidence({ elements: [el({ id: 1, name: '保存' })] }),
      evaluatedAt: AT,
    };
    const r = judge(input);
    const h1 = computeVerdictHash({
      judgeResult: r,
      evidenceDigest: 'digest-alpha',
      judgeImplHash: 'impl-1',
    });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);

    // 同输入同 hash
    expect(
      computeVerdictHash({ judgeResult: judge(input), evidenceDigest: 'digest-alpha', judgeImplHash: 'impl-1' }),
    ).toBe(h1);

    // 任一组成变化 → hash 变化
    expect(
      computeVerdictHash({ judgeResult: r, evidenceDigest: 'digest-beta', judgeImplHash: 'impl-1' }),
    ).not.toBe(h1);
    expect(
      computeVerdictHash({ judgeResult: r, evidenceDigest: 'digest-alpha', judgeImplHash: 'impl-2' }),
    ).not.toBe(h1);

    const failResult = judge({
      assertions: dom({ kind: 'visible', target: '删除' }),
      evidence: evidence(),
      evaluatedAt: AT,
    });
    expect(
      computeVerdictHash({ judgeResult: failResult, evidenceDigest: 'digest-alpha', judgeImplHash: 'impl-1' }),
    ).not.toBe(h1);
  });

  it('hash 与字段顺序无关（canonical JSON），但与值相关', () => {
    const input = {
      assertions: dom({ kind: 'visible', target: '保存' }),
      evidence: evidence({ elements: [el({ id: 1, name: '保存' })] }),
      evaluatedAt: AT,
    };
    const r = judge(input);
    const h = computeVerdictHash({ judgeResult: r, evidenceDigest: 'd', judgeImplHash: 'i' });
    const reordered = { ...r, assertionResults: r.assertionResults, judgeVersion: r.judgeVersion };
    expect(
      computeVerdictHash({ judgeResult: reordered, evidenceDigest: 'd', judgeImplHash: 'i' }),
    ).toBe(h);
  });
});
