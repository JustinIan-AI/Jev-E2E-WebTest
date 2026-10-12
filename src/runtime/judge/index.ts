/**
 * Task 9 — Judge 纯函数判定（详设 §3.2 / §3.6 / §4.8.7，AC-09）。
 *
 * 固定判定优先级（顺序不可换）：
 *   1) 任一 required 断言无法求值 → BLOCKED(evidence)
 *   2) 任一歧义                 → BLOCKED(ambiguity)
 *   3) 任一 passed == false      → FAIL
 *   4) 全部通过                 → PASS
 *
 * 模型候选信号不参与求值（恒为 candidate）；空断言集保守 BLOCKED(evidence)。
 */
import { createHash } from 'node:crypto';
import type {
  AssertionEvaluation,
  BackendAssertionSpec,
  BlockedReason,
  DomAssertionSpec,
  HttpAssertionSpec,
  JudgeAssertions,
  JudgeBackendRecord,
  JudgeElement,
  JudgeEvidence,
  JudgeHttpRecord,
  JudgeInput,
  JudgeResult,
  StateAssertionSpec,
  Verdict,
} from './types.js';

export const JUDGE_VERSION = 'judge-1.0.0';

function lower(s: string): string {
  return s.toLowerCase();
}

/** 目标匹配：substring（默认，name+text 拼接上子串 case-insensitive）或 exact（name 精确）。 */
function targetMatches(el: JudgeElement, spec: DomAssertionSpec): boolean {
  if (spec.target === undefined) return true;
  const want = lower(spec.target);
  const name = lower(el.name);
  if (spec.match === 'exact') {
    return name === want;
  }
  const haystack = `${el.name}\n${el.text}`.toLowerCase();
  return name.includes(want) || haystack.includes(want);
}

function domResult(
  kind: DomAssertionSpec['kind'],
  passed: boolean,
  evidenceRef: string,
  result: AssertionEvaluation['result'],
  blockedReason?: BlockedReason,
): AssertionEvaluation {
  return { kind, passed, result, evidenceRef, ...(blockedReason ? { blockedReason } : {}) };
}

/**
 * 模型自述完成（存在 candidate）但无可观测证据支撑时，Judge 无法区分
 * 「模型谎报（FAIL）」与「证据根本没采到（工具缺口）」→ 不可判 BLOCKED(evidence)（A2）。
 * 无候选自述时，观测到「不存在」是可观测事实 → FAIL（§3.2 精确表）。
 */
function evalDom(spec: DomAssertionSpec, evidence: JudgeEvidence, hasCandidates: boolean): AssertionEvaluation {
  const matches = evidence.elements.filter((el) => targetMatches(el, spec));
  const visibleMatches = matches.filter((el) => el.visible && el.enabled);
  const ref = `observation:${spec.kind}:${spec.target ?? ''}`;

  switch (spec.kind) {
    case 'visible': {
      if (visibleMatches.length === 0) {
        return hasCandidates
          ? domResult('visible', false, ref, 'unevaluable', 'evidence')
          : domResult('visible', false, ref, 'failed');
      }
      if (spec.text_contains !== undefined) {
        const needle = spec.text_contains;
        const ok = visibleMatches.some(
          (el) => el.name.includes(needle) || el.text.includes(needle),
        );
        return domResult('visible', ok, ref, ok ? 'passed' : 'failed');
      }
      return domResult('visible', true, ref, 'passed');
    }

    case 'absent': {
      // 匹配数 == 0（含不可见）才 PASS；任一匹配（哪怕不可见）即 FAIL。
      return domResult('absent', matches.length === 0, ref, matches.length === 0 ? 'passed' : 'failed');
    }

    case 'count': {
      if (matches.length > 1 && spec.allow_multiple !== true) {
        return domResult('count', false, ref, 'ambiguous', 'ambiguity');
      }
      const expected = Number(spec.equals);
      const ok = matches.length === expected;
      return domResult('count', ok, ref, ok ? 'passed' : 'failed');
    }

    case 'value': {
      if (matches.length === 0) return domResult('value', false, ref, 'unevaluable', 'evidence');
      if (matches.length > 1 && spec.allow_multiple !== true) {
        return domResult('value', false, ref, 'ambiguous', 'ambiguity');
      }
      const el = matches[0]!;
      if (el.value === undefined) return domResult('value', false, ref, 'unevaluable', 'evidence');
      const expected = String(spec.equals);
      // 严格相等；两侧均可解析为 number 时按数值比。
      let ok = el.value === expected;
      if (!ok) {
        const a = Number(el.value);
        const b = Number(expected);
        if (el.value.trim() !== '' && expected.trim() !== '' && Number.isFinite(a) && Number.isFinite(b)) {
          ok = a === b;
        }
      }
      return domResult('value', ok, ref, ok ? 'passed' : 'failed');
    }

    case 'checked': {
      if (matches.length === 0) return domResult('checked', false, ref, 'unevaluable', 'evidence');
      const el = matches[0]!;
      if (el.checked === undefined) return domResult('checked', false, ref, 'unevaluable', 'evidence');
      const ok = el.checked === spec.equals;
      return domResult('checked', ok, ref, ok ? 'passed' : 'failed');
    }

    case 'url': {
      let pathname: string;
      try {
        pathname = new URL(evidence.url).pathname;
      } catch {
        return domResult('url', false, ref, 'unevaluable', 'evidence');
      }
      const ok = pathname === String(spec.equals);
      return domResult('url', ok, ref, ok ? 'passed' : 'failed');
    }

    case 'number': {
      if (matches.length === 0) return domResult('number', false, ref, 'unevaluable', 'evidence');
      const el = matches[0]!;
      const actual = Number(String(el.text).trim());
      const expected = Number(spec.equals);
      if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
        return domResult('number', false, ref, 'unevaluable', 'evidence');
      }
      const ok = Math.abs(actual - expected) < 1e-9;
      return domResult('number', ok, ref, ok ? 'passed' : 'failed');
    }
  }
}

function pathnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl;
  }
}

function evalHttp(spec: HttpAssertionSpec, evidence: JudgeEvidence): AssertionEvaluation {
  const wantPath = spec.path_prefix ?? spec.path_equals ?? '';
  const ref = `http:${spec.method}:${wantPath}`;

  let candidates = evidence.http.filter((r) => r.method === spec.method);
  const pathMatched = candidates.filter((r) => {
    const p = pathnameOf(r.url);
    return spec.path_equals !== undefined ? p === spec.path_equals : p.startsWith(spec.path_prefix ?? '');
  });
  candidates = pathMatched;

  if (spec.within_run === true && evidence.runStartedAt !== undefined) {
    const since = Date.parse(evidence.runStartedAt);
    candidates = candidates.filter((r) => Date.parse(r.timestamp) >= since);
  }

  // evidenceId 归一化：不以 'h' 开头的记录 id 补 'h-' 前缀（测试记录 'new' → 'h-new'）。
  const normId = (id: string): string => (id.startsWith('h') ? id : `h-${id}`);

  const mk = (
    record: JudgeHttpRecord | undefined,
    passed: boolean,
    result: AssertionEvaluation['result'],
    blockedReason?: BlockedReason,
  ): AssertionEvaluation => ({
    kind: 'http',
    passed,
    result,
    evidenceRef: record ? `http:${record.id}` : ref,
    ...(record ? { evidenceId: normId(record.id) } : {}),
    ...(blockedReason ? { blockedReason } : {}),
  });

  if (candidates.length === 0) return mk(undefined, false, 'unevaluable', 'evidence');

  // 取状态码最匹配的完整响应。
  const exact = candidates.find((r) => r.status === spec.status_equals);
  if (exact) return mk(exact, true, 'passed');
  // 单条响应状态不符：可观测事实 → FAIL（A1：自述完成 vs HTTP 500）。
  if (candidates.length === 1) return mk(candidates[0], false, 'failed');
  // 多条响应全不匹配（ambiguous_response）：取最后一条 → BLOCKED(evidence)。
  return mk(candidates[candidates.length - 1], false, 'unevaluable', 'evidence');
}

function evalBackend(spec: BackendAssertionSpec, evidence: JudgeEvidence): AssertionEvaluation {
  const ref = `backend:${spec.key}`;
  const record = evidence.backend.find((r) => r.key === spec.key && r.scope === 'run');
  if (record === undefined) {
    return { kind: 'backend', passed: false, result: 'unevaluable', evidenceRef: ref, blockedReason: 'evidence' };
  }
  const ok = record.value === spec.equals;
  return {
    kind: 'backend',
    passed: ok,
    result: ok ? 'passed' : 'failed',
    evidenceRef: `backend:${record.key}`,
    evidenceId: record.key,
  };
}

function evalState(spec: StateAssertionSpec, evidence: JudgeEvidence): AssertionEvaluation {
  const ref = `state:${spec.key}`;
  const record = evidence.backend.find((r) => r.key === spec.key);
  if (record === undefined) {
    return { kind: 'state', passed: false, result: 'unevaluable', evidenceRef: ref, blockedReason: 'evidence' };
  }
  const ok = record.value === spec.equals;
  return {
    kind: 'state',
    passed: ok,
    result: ok ? 'passed' : 'failed',
    evidenceRef: `state:${record.key}`,
    evidenceId: record.key,
  };
}

export function judge(input: JudgeInput): JudgeResult {
  const { assertions, evidence, evaluatedAt } = input;
  const a: JudgeAssertions = {
    dom: assertions.dom,
    http: assertions.http ?? [],
    backend: assertions.backend ?? [],
    state: assertions.state ?? [],
  };

  const httpSpecs = a.http ?? [];
  const backendSpecs = a.backend ?? [];
  const stateSpecs = a.state ?? [];
  const hasCandidates = (input.candidates?.length ?? 0) > 0;
  const results: AssertionEvaluation[] = [
    ...a.dom.map((s) => evalDom(s, evidence, hasCandidates)),
    ...httpSpecs.map((s) => evalHttp(s, evidence)),
    ...backendSpecs.map((s) => evalBackend(s, evidence)),
    ...stateSpecs.map((s) => evalState(s, evidence)),
  ];

  let verdict: Verdict;
  let blockedReason: BlockedReason | null;

  // 空断言集：无断言可判，保守 BLOCKED(evidence)。
  if (results.length === 0) {
    verdict = 'BLOCKED';
    blockedReason = 'evidence';
  } else if (results.some((r) => r.result === 'unevaluable')) {
    verdict = 'BLOCKED';
    blockedReason = 'evidence';
  } else if (results.some((r) => r.result === 'ambiguous')) {
    verdict = 'BLOCKED';
    blockedReason = 'ambiguity';
  } else if (results.some((r) => !r.passed)) {
    verdict = 'FAIL';
    blockedReason = null;
  } else {
    verdict = 'PASS';
    blockedReason = null;
  }

  return {
    verdict,
    blockedReason,
    assertionResults: results,
    evaluatedAt,
    judgeVersion: JUDGE_VERSION,
  };
}

/** 递归按 key 排序的 canonical JSON（字段顺序无关）。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export interface VerdictHashInput {
  judgeResult: JudgeResult;
  evidenceDigest: string;
  judgeImplHash: string;
}

/** verdict_hash = sha256(canonical(judge_result) ‖ evidence_digest ‖ judge_impl_hash)。 */
export function computeVerdictHash(input: VerdictHashInput): string {
  return createHash('sha256')
    .update(canonical(input.judgeResult))
    .update(input.evidenceDigest)
    .update(input.judgeImplHash)
    .digest('hex');
}
