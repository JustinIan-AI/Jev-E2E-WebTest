/**
 * Task 9 — 在线产物写盘 + 离线重算（详设 §3.6 / §10，AC-10 / TR-9.2）。
 *
 * 在线（Runtime 单点）：judgement_set 三证据 + evidence-manifest + judge-result.json，
 * verdict_hash = sha256(canonical(judge_result) ‖ evidence_digest ‖ judge_impl_hash)。
 *
 * 离线重算 `idwth judge recompute <run_id>`：
 *   MATCH  → verdict / judge_result / verdict_hash 逐字段一致；
 *   完整性错误明确分类：EVIDENCE_CORRUPT / HASH_MISMATCH / BINDING_DRIFT，绝不伪造一致。
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvidenceStore, judgementDigest } from '../evidence-store.js';
import { computeVerdictHash, judge, JUDGE_VERSION } from './index.js';
import type {
  AssertionEvaluation,
  JudgeAssertions,
  JudgeEvidence,
  JudgeInput,
  JudgeResult,
} from './types.js';

export type IntegrityCode = 'EVIDENCE_CORRUPT' | 'HASH_MISMATCH' | 'BINDING_DRIFT';

export type RecomputeResult =
  | {
      status: 'match';
      verdict: JudgeResult['verdict'];
      verdictHash: string;
      judgeResult: JudgeResult;
    }
  | { status: 'integrity_error'; code: IntegrityCode };

/** 当前判定实现绑定哈希（实现语义变更即漂移）。 */
export function currentJudgeImplHash(): string {
  return `sha256:${createHash('sha256').update(`idwth-judge:${JUDGE_VERSION}`).digest('hex')}`;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface StoredAssertionResult {
  kind: string;
  passed: boolean;
  result: AssertionEvaluation['result'];
  evidence_ref: string;
  evidence_id?: string;
  blocked_reason?: 'evidence' | 'ambiguity';
}

interface StoredJudgeResult {
  verdict: JudgeResult['verdict'];
  blocked_reason: JudgeResult['blockedReason'];
  assertion_results: StoredAssertionResult[];
  evaluated_at: string;
  judge_version: string;
}

interface JudgeResultFile {
  judge_result: StoredJudgeResult;
  assertions: JudgeAssertions;
  evidence_digest: string;
  judge_impl_hash: string;
  verdict_hash: string;
}

function toStored(result: JudgeResult): StoredJudgeResult {
  return {
    verdict: result.verdict,
    blocked_reason: result.blockedReason,
    assertion_results: result.assertionResults.map((r) => ({
      kind: r.kind,
      passed: r.passed,
      result: r.result,
      evidence_ref: r.evidenceRef,
      ...(r.evidenceId !== undefined ? { evidence_id: r.evidenceId } : {}),
      ...(r.blockedReason !== undefined ? { blocked_reason: r.blockedReason } : {}),
    })),
    evaluated_at: result.evaluatedAt,
    judge_version: result.judgeVersion,
  };
}

/** 递归按 key 排序的 canonical JSON（与 judge/index 同口径）。 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export interface WriteOnlineOptions {
  rootDir: string;
  runId: string;
  input: JudgeInput;
  judgeImplHash: string;
}

/**
 * 在线写入（仅 Runtime 可调用）：三证据经 EvidenceStore 内容寻址落盘，
 * judge-result.json 记录权威 judge_result / 绑定 / digest / verdict_hash（mode 0600）。
 */
export async function writeOnlineJudgeArtifacts(
  options: WriteOnlineOptions,
): Promise<{ verdictHash: string; judgeResult: JudgeResult }> {
  const { rootDir, runId, input, judgeImplHash } = options;
  const store = createEvidenceStore({ runId, rootDir });

  const observation = {
    elements: input.evidence.elements,
    url: input.evidence.url,
    ...(input.evidence.runStartedAt !== undefined
      ? { run_started_at: input.evidence.runStartedAt }
      : {}),
  };
  await store.judgement({ name: 'observation.json', content: observation, mediaType: 'application/json' });
  await store.judgement({ name: 'http.json', content: input.evidence.http, mediaType: 'application/json' });
  await store.judgement({ name: 'backend.json', content: input.evidence.backend, mediaType: 'application/json' });

  const evidenceDigest = await judgementDigest(store);
  const judgeResult = judge(input);
  const verdictHash = computeVerdictHash({ judgeResult, evidenceDigest, judgeImplHash });

  const file: JudgeResultFile = {
    judge_result: toStored(judgeResult),
    assertions: input.assertions,
    evidence_digest: evidenceDigest,
    judge_impl_hash: judgeImplHash,
    verdict_hash: verdictHash,
  };
  await writeFile(path.join(rootDir, '.idwth', 'runs', runId, 'judge-result.json'), JSON.stringify(file, null, 2), {
    mode: 0o600,
  });

  return { verdictHash, judgeResult };
}

interface ManifestEntry {
  name: string;
  sha256: string;
}
interface Manifest {
  judgement_set: ManifestEntry[];
}

async function readJsonSafe(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * 离线重算。校验顺序：证据完整性 → 绑定漂移 → 判定/哈希一致。
 */
export async function recomputeJudge(
  runDir: string,
  options: { expectedJudgeImplHash: string },
): Promise<RecomputeResult> {
  // 1) manifest 必需，否则 EVIDENCE_CORRUPT（不抛未分类异常）。
  const manifest = (await readJsonSafe(path.join(runDir, 'evidence-manifest.json'))) as Manifest | undefined;
  if (manifest === undefined || !Array.isArray(manifest.judgement_set)) {
    return { status: 'integrity_error', code: 'EVIDENCE_CORRUPT' };
  }

  // 2) 每个 judgement_set blob 必须存在且 sha256 与 manifest 一致。
  const byName = new Map<string, ManifestEntry>();
  for (const entry of manifest.judgement_set) {
    byName.set(entry.name, entry);
    const blobPath = path.join(runDir, 'blobs', 'judgement_set', entry.sha256);
    const buf = await readFile(blobPath).catch(() => undefined);
    if (buf === undefined || sha256Hex(buf) !== entry.sha256) {
      return { status: 'integrity_error', code: 'EVIDENCE_CORRUPT' };
    }
  }

  // 3) judge-result.json 必需。
  const file = (await readJsonSafe(path.join(runDir, 'judge-result.json'))) as JudgeResultFile | undefined;
  if (file === undefined || file.judge_result === undefined) {
    return { status: 'integrity_error', code: 'EVIDENCE_CORRUPT' };
  }

  // 4) 判定器绑定漂移（可与证据损坏区分）。
  if (file.judge_impl_hash !== options.expectedJudgeImplHash) {
    return { status: 'integrity_error', code: 'BINDING_DRIFT' };
  }

  // 5) 从 blob 重建结构化证据并重算。
  const load = async (name: string): Promise<unknown> => {
    const entry = byName.get(name);
    if (!entry) return undefined;
    return readJsonSafe(path.join(runDir, 'blobs', 'judgement_set', entry.sha256));
  };
  const observation = (await load('observation.json')) as
    | { elements: JudgeEvidence['elements']; url: string; run_started_at?: string }
    | undefined;
  const http = ((await load('http.json')) ?? []) as JudgeEvidence['http'];
  const backend = ((await load('backend.json')) ?? []) as JudgeEvidence['backend'];
  if (observation === undefined) {
    return { status: 'integrity_error', code: 'EVIDENCE_CORRUPT' };
  }

  const evidence: JudgeEvidence = {
    elements: observation.elements,
    url: observation.url,
    ...(observation.run_started_at !== undefined ? { runStartedAt: observation.run_started_at } : {}),
    http,
    backend,
  };
  const recomputed = judge({
    assertions: file.assertions,
    evidence,
    evaluatedAt: file.judge_result.evaluated_at,
  });

  // 6) judge_result 逐字段一致 + verdict_hash 一致；手工改写 → HASH_MISMATCH。
  if (canonical(file.judge_result) !== canonical(toStored(recomputed))) {
    return { status: 'integrity_error', code: 'HASH_MISMATCH' };
  }
  const verdictHash = computeVerdictHash({
    judgeResult: recomputed,
    evidenceDigest: file.evidence_digest,
    judgeImplHash: options.expectedJudgeImplHash,
  });
  if (verdictHash !== file.verdict_hash) {
    return { status: 'integrity_error', code: 'HASH_MISMATCH' };
  }

  return {
    status: 'match',
    verdict: recomputed.verdict,
    verdictHash,
    judgeResult: recomputed,
  };
}
