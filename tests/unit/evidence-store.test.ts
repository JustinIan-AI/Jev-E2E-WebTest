/**
 * Task 8 RED — Evidence 分级存储（详设 §3.6 / §6.2 / §4.8.6）。
 * - judgement_set：实时落盘、永不截断、与 archived 分目录、目录权限 0700
 * - 内容寻址去重 sha256(content)
 * - archived 超过字节上限只外移到 archive/ 并写指针，不丢失式截断
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createEvidenceStore,
  judgementDigest,
  DEFAULT_ARCHIVED_LIMIT_BYTES,
  type EvidenceStore,
} from '../../src/runtime/evidence-store.js';

const RUN_ID = 'a1b2c3d4';

let tmp: string;
let store: EvidenceStore;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'idwth-ev-'));
  store = createEvidenceStore({ runId: RUN_ID, rootDir: tmp, secrets: [] });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function runDir(): string {
  return path.join(tmp, '.idwth', 'runs', RUN_ID);
}

describe('分级目录与权限（§6.2）', () => {
  it('judgement_set 与 archived 分目录，run 目录权限 0700', async () => {
    await store.judgement({ name: 'text-1', content: 'visible text', mediaType: 'text/plain' });
    await store.archive({ name: 'shot.png', content: Buffer.from([1, 2, 3]), mediaType: 'image/png' });

    const jEntries = await readdir(path.join(runDir(), 'judgement_set'));
    const aEntries = await readdir(path.join(runDir(), 'archived'));
    expect(jEntries).toHaveLength(1);
    expect(aEntries).toHaveLength(1);

    const mode = (await stat(runDir())).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('artifact URI 形如 artifact://<runId>/<tier>/<name>', async () => {
    const ref = await store.judgement({
      name: 'http-1.json',
      content: '{"status":201}',
      mediaType: 'application/json',
    });
    expect(ref.uri).toBe(`artifact://${RUN_ID}/judgement_set/http-1.json`);
    expect(ref.mediaType).toBe('application/json');
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('实时落盘（§4.8.6 constraints）', () => {
  it('写入调用返回后文件与 manifest 已持久化到磁盘', async () => {
    await store.judgement({ name: 'j1', content: 'hello', mediaType: 'text/plain' });
    const body = await readFile(path.join(runDir(), 'judgement_set', 'j1'), 'utf8');
    expect(body).toBe('hello');
    const manifest = JSON.parse(
      await readFile(path.join(runDir(), 'evidence-manifest.json'), 'utf8'),
    ) as { judgement_set: { name: string; sha256: string }[] };
    expect(manifest.judgement_set.some((e) => e.name === 'j1')).toBe(true);
  });
});

describe('内容寻址去重（sha256(content)）', () => {
  it('同内容不同名只存一份 blob，两个 ref 指向同一 sha256', async () => {
    const a = await store.judgement({ name: 'a.json', content: 'same-payload', mediaType: 'text/plain' });
    const b = await store.judgement({ name: 'b.json', content: 'same-payload', mediaType: 'text/plain' });
    expect(a.sha256).toBe(b.sha256);
    // 去重存储下物理 blob 仅一份；ref 名保留（按名引用），blob 按 hash 寻址
    const blobs = await readdir(path.join(runDir(), 'blobs', 'judgement_set'));
    expect(blobs).toEqual([`${a.sha256}`]);
  });

  it('不同内容 sha256 不同', async () => {
    const a = await store.archive({ name: 'x', content: Buffer.from('x'), mediaType: 'application/octet-stream' });
    const b = await store.archive({ name: 'y', content: Buffer.from('yy'), mediaType: 'application/octet-stream' });
    expect(a.sha256).not.toBe(b.sha256);
  });
});

describe('judgement_set 永不截断', () => {
  it('即使注入极小 archived 上限，judgement_set 也不外移不截断', async () => {
    const tight = createEvidenceStore({
      runId: RUN_ID,
      rootDir: tmp,
      secrets: [],
      archivedLimitBytes: 1,
    });
    const big = 'Z'.repeat(10_000);
    const ref = await tight.judgement({ name: 'big', content: big, mediaType: 'text/plain' });
    const body = await readFile(
      path.join(runDir(), 'judgement_set', ref.sha256),
      'utf8',
    ).catch(async () =>
      readFile(path.join(runDir(), 'blobs', 'judgement_set', ref.sha256), 'utf8'),
    );
    expect(body).toBe(big);
  });

  it('issues / recovery / JEV 原文均归入 judgement_set', async () => {
    await store.judgement({ name: 'issues.json', content: '[{"id":"i1"}]', mediaType: 'application/json' });
    await store.judgement({ name: 'recovery.json', content: '{"attempt":1}', mediaType: 'application/json' });
    await store.judgement({ name: 'jev-raw.json', content: '{"req":1,"rsp":2}', mediaType: 'application/json' });
    const manifest = JSON.parse(
      await readFile(path.join(runDir(), 'evidence-manifest.json'), 'utf8'),
    ) as { judgement_set: unknown[]; archived: unknown[] };
    expect(manifest.judgement_set).toHaveLength(3);
    expect(manifest.archived).toHaveLength(0);
  });
});

describe('archived 超限：只外移 + 写指针（TR-8.2）', () => {
  function tightStore(): EvidenceStore {
    return createEvidenceStore({
      runId: RUN_ID,
      rootDir: tmp,
      secrets: [],
      archivedLimitBytes: 5,
    });
  }

  it('未超限的 archived 留在原地', async () => {
    const s = tightStore();
    const ref = await s.archive({ name: 'small.png', content: Buffer.from([1]), mediaType: 'image/png' });
    expect(ref.offloaded).toBeUndefined();
    expect(await readdir(path.join(runDir(), 'archived'))).toHaveLength(1);
  });

  it('超限后数据外移到 archive/，原位置只留指针文件，数据不丢', async () => {
    const s = tightStore();
    const payload = Buffer.from('X'.repeat(50));
    const ref = await s.archive({ name: 'big.png', content: payload, mediaType: 'image/png' });

    expect(ref.offloaded).toBe(true);
    // 原 archived/ 位置为指针，不是被裁过的数据
    const entries = await readdir(path.join(runDir(), 'archived'));
    const pointerName = entries.find((n) => n.includes('big.png'));
    expect(pointerName).toBeDefined();
    const pointer = JSON.parse(
      await readFile(path.join(runDir(), 'archived', pointerName!), 'utf8'),
    ) as { offloaded: boolean; archive_uri: string; sha256: string };
    expect(pointer.offloaded).toBe(true);
    expect(pointer.sha256).toBe(ref.sha256);
    expect(pointer.archive_uri).toContain('archive/');

    // archive/ 下完整数据可读，字节不丢
    const archiveEntries = await readdir(path.join(runDir(), 'archive'));
    expect(archiveEntries).toContain(ref.sha256);
    const restored = await readFile(path.join(runDir(), 'archive', ref.sha256));
    expect(restored.equals(payload)).toBe(true);
  });

  it('默认上限为 50MB/run', () => {
    expect(DEFAULT_ARCHIVED_LIMIT_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('judgementDigest（§3.6 evidence_digest）', () => {
  it('按 judgement_set 的 sha256 有序聚合，顺序无关但内容敏感', async () => {
    await store.judgement({ name: 'a', content: 'AAA', mediaType: 'text/plain' });
    const d1 = await judgementDigest(store);
    expect(d1).toMatch(/^[0-9a-f]{64}$/);

    const tmp2 = await mkdtemp(path.join(os.tmpdir(), 'idwth-ev2-'));
    try {
      const store2 = createEvidenceStore({ runId: RUN_ID, rootDir: tmp2, secrets: [] });
      await store2.judgement({ name: 'a', content: 'AAA', mediaType: 'text/plain' });
      expect(await judgementDigest(store2)).toBe(d1);

      await store2.judgement({ name: 'b', content: 'BBB', mediaType: 'text/plain' });
      expect(await judgementDigest(store2)).not.toBe(d1);
    } finally {
      await rm(tmp2, { recursive: true, force: true });
    }
  });
});

describe('安全采集（credential 不入 evidence）', () => {
  it('写入 judgement_set 前对 credential 键与已知明文脱敏', async () => {
    const secret = 'sup3r-s3cret-pw';
    const s = createEvidenceStore({ runId: RUN_ID, rootDir: tmp, secrets: [secret] });
    await s.judgement({
      name: 'login.json',
      content: JSON.stringify({ form: { username: 'admin', password: secret } }),
      mediaType: 'application/json',
    });
    const files = await readdir(path.join(runDir(), 'blobs', 'judgement_set'));
    for (const f of files) {
      const body = await readFile(path.join(runDir(), 'blobs', 'judgement_set', f), 'utf8');
      expect(body).not.toContain(secret);
      expect(body).toContain('[REDACTED]');
    }
  });
});
