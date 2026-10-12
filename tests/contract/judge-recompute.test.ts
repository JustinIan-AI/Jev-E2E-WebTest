/**
 * Task 9 RED — 归档证据离线重算（AC-10 / TR-9.2，详设 §3.6 / §10）。
 *
 * 在线写入（judge-result.json + evidence-manifest + bindings）后：
 *  - `judge recompute <run_id>` 重算 verdict / judge_result / verdict_hash 必须逐字段一致；
 *  - 证据损坏、判定器绑定漂移必须被明确识别，不得伪造一致。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvidenceStore } from '../../src/runtime/evidence-store.js';
import {
  currentJudgeImplHash,
  recomputeJudge,
  writeOnlineJudgeArtifacts,
} from '../../src/runtime/judge/recompute.js';
import type { JudgeInput } from '../../src/runtime/judge/types.js';

const RUN_ID = 'a8f00dba';
const AT = '2026-10-12T00:00:00.000Z';

let rootDir: string;
let baseInput: JudgeInput;

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'idwth-recompute-'));
  baseInput = {
    assertions: {
      dom: [{ kind: 'visible', target: '成功提示', text_contains: '创建成功' }],
      http: [{ kind: 'http', method: 'POST', path_prefix: '/apis/app/v1/workloads', status_equals: 201 }],
    },
    evidence: {
      elements: [
        {
          id: 1,
          role: 'status',
          name: '成功提示',
          text: '工作负载创建成功',
          visible: true,
          enabled: true,
        },
      ],
      url: 'https://sut.local/workloads',
      runStartedAt: '2026-10-12T00:00:00.000Z',
      http: [
        {
          id: 'h1',
          method: 'POST',
          url: 'https://api.local/apis/app/v1/workloads',
          status: 201,
          timestamp: '2026-10-12T00:00:05.000Z',
          body: { name: 'w1' },
        },
      ],
      backend: [],
    },
    evaluatedAt: AT,
  };
});

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('judge recompute（AC-10 / A8）', () => {
  it('在线产物齐全时，重算 verdict/judge_result/verdict_hash 与在线逐字段一致（MATCH）', async () => {
    const judgeImplHash = currentJudgeImplHash();
    const online = await writeOnlineJudgeArtifacts({
      rootDir,
      runId: RUN_ID,
      input: baseInput,
      judgeImplHash,
    });

    const recomputed = await recomputeJudge(path.join(rootDir, '.idwth', 'runs', RUN_ID), {
      expectedJudgeImplHash: judgeImplHash,
    });

    expect(recomputed.status).toBe('match');
    if (recomputed.status !== 'match') throw new Error('expected match');
    expect(recomputed.verdict).toBe('PASS');
    expect(recomputed.verdictHash).toBe(online.verdictHash);
    // judge_result 逐字段一致（canonical 后字节一致）
    expect(JSON.stringify(recomputed.judgeResult)).toBe(JSON.stringify(online.judgeResult));
  });

  it('在线 FAIL 结论同样可逐字段重算（A1 自述 vs 事实）', async () => {
    const runId = 'a8f00dbf';
    const input: JudgeInput = {
      assertions: {
        dom: [],
        http: [{ kind: 'http', method: 'POST', path_prefix: '/w', status_equals: 201 }],
      },
      evidence: {
        elements: [],
        url: 'https://sut.local/x',
        http: [
          {
            id: 'h1',
            method: 'POST',
            url: 'https://api.local/w',
            status: 500,
            timestamp: AT,
            body: { error: 'boom' },
          },
        ],
        backend: [],
      },
      candidates: [{ role: 'assistant', content: '已完成', confidence: 0.9 }],
      evaluatedAt: AT,
    };
    const judgeImplHash = currentJudgeImplHash();
    const online = await writeOnlineJudgeArtifacts({ rootDir, runId, input, judgeImplHash });
    expect(online.judgeResult.verdict).toBe('FAIL');

    const r = await recomputeJudge(path.join(rootDir, '.idwth', 'runs', runId), {
      expectedJudgeImplHash: judgeImplHash,
    });
    expect(r.status).toBe('match');
    if (r.status !== 'match') throw new Error('expected match');
    expect(r.verdict).toBe('FAIL');
    expect(r.verdictHash).toBe(online.verdictHash);
  });

  it('归档证据被篡改（blob 内容损坏）→ 明确报完整性错误 EVIDENCE_CORRUPT，不伪造一致', async () => {
    const runId = 'a8f00dbc';
    const judgeImplHash = currentJudgeImplHash();
    await writeOnlineJudgeArtifacts({ rootDir, runId, input: baseInput, judgeImplHash });

    const runDir = path.join(rootDir, '.idwth', 'runs', runId);
    // 直接改坏 observation 证据 blob：先从 manifest 找到 observation.json 的 blob
    const manifest = JSON.parse(
      await readFile(path.join(runDir, 'evidence-manifest.json'), 'utf8'),
    ) as { judgement_set: Array<{ name: string; sha256: string }> };
    const obs = manifest.judgement_set.find((e) => e.name === 'observation.json');
    expect(obs).toBeDefined();
    const blobPath = path.join(runDir, 'blobs', 'judgement_set', obs!.sha256);
    const tampered = JSON.parse(await readFile(blobPath, 'utf8'));
    tampered.elements[0]!.text = '被篡改的完全不同文本';
    await writeFile(blobPath, JSON.stringify(tampered));

    const r = await recomputeJudge(runDir, { expectedJudgeImplHash: judgeImplHash });
    expect(r.status).toBe('integrity_error');
    if (r.status !== 'integrity_error') throw new Error('expected integrity_error');
    expect(['EVIDENCE_CORRUPT', 'HASH_MISMATCH']).toContain(r.code);
  });

  it('judge-result.json 被手工改写（verdict 与证据不符）→ HASH_MISMATCH', async () => {
    const runId = 'a8f00dbd';
    const judgeImplHash = currentJudgeImplHash();
    await writeOnlineJudgeArtifacts({ rootDir, runId, input: baseInput, judgeImplHash });

    const runDir = path.join(rootDir, '.idwth', 'runs', runId);
    const judgePath = path.join(runDir, 'judge-result.json');
    const stolen = JSON.parse(await readFile(judgePath, 'utf8'));
    stolen.judge_result.verdict = 'FAIL';
    stolen.judge_result.assertion_results[0]!.passed = false;
    await writeFile(judgePath, JSON.stringify(stolen, null, 2));

    const r = await recomputeJudge(runDir, { expectedJudgeImplHash: judgeImplHash });
    expect(r.status).toBe('integrity_error');
    if (r.status !== 'integrity_error') throw new Error('expected integrity_error');
    expect(r.code).toBe('HASH_MISMATCH');
  });

  it('判定器绑定不一致（judge_impl_hash 漂移）→ BINDING_DRIFT，可与证据损坏区分', async () => {
    const runId = 'a8f00dbe';
    await writeOnlineJudgeArtifacts({
      rootDir,
      runId,
      input: baseInput,
      judgeImplHash: 'sha256:impl-version-1',
    });

    const r = await recomputeJudge(path.join(rootDir, '.idwth', 'runs', runId), {
      expectedJudgeImplHash: 'sha256:impl-version-2',
    });
    expect(r.status).toBe('integrity_error');
    if (r.status !== 'integrity_error') throw new Error('expected integrity_error');
    expect(r.code).toBe('BINDING_DRIFT');
  });

  it('必需产物缺失（manifest 丢失）→ EVIDENCE_CORRUPT，而不是抛未分类异常', async () => {
    const runId = 'a8f00dbf0';
    const judgeImplHash = currentJudgeImplHash();
    await writeOnlineJudgeArtifacts({ rootDir, runId, input: baseInput, judgeImplHash });

    const runDir = path.join(rootDir, '.idwth', 'runs', runId);
    await rm(path.join(runDir, 'evidence-manifest.json'), { force: true });

    const r = await recomputeJudge(runDir, { expectedJudgeImplHash: judgeImplHash });
    expect(r.status).toBe('integrity_error');
    if (r.status !== 'integrity_error') throw new Error('expected integrity_error');
    expect(r.code).toBe('EVIDENCE_CORRUPT');
  });

  it('writeOnlineJudgeArtifacts 与 EvidenceStore 共址：judgement_set 三证据 + manifest 实时可见', async () => {
    const runId = 'a8f00dbf1';
    const judgeImplHash = currentJudgeImplHash();
    await writeOnlineJudgeArtifacts({ rootDir, runId, input: baseInput, judgeImplHash });

    const runDir = path.join(rootDir, '.idwth', 'runs', runId);
    const manifest = JSON.parse(
      await readFile(path.join(runDir, 'evidence-manifest.json'), 'utf8'),
    ) as { judgement_set: Array<{ name: string; sha256: string }> };
    const names = manifest.judgement_set.map((e) => e.name).sort();
    expect(names).toEqual(['backend.json', 'http.json', 'observation.json']);
    // 内容寻址：sha256 均为 64hex
    for (const e of manifest.judgement_set) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
