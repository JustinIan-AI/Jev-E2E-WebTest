/**
 * Task 8 — Evidence 分级存储（详设 §3.6 / §6.2 / §4.8.6）。
 *
 * 落盘布局（rootDir/.idwth/runs/<runId>/，run 目录 0700）：
 *   judgement_set/<name>   判定必需集（永不截断、实时落盘）的命名视图
 *   archived/<name>        可归档集（截图/完整 DOM/console）；超限后此位置变为指针
 *   blobs/<tier>/<sha256>  内容寻址物理 blob（同内容只存一份）
 *   archive/<sha256>       archived 超字节上限后的外移位置（完整数据，不丢失）
 *   evidence-manifest.json 两级引用清单（每次写入同步刷盘，mode 0600）
 *
 * 引用：artifact://<runId>/<tier>/<name>；分级按「是否参与判定」而非体积。
 */
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { redactValue } from './redaction.js';

export const DEFAULT_ARCHIVED_LIMIT_BYTES = 50 * 1024 * 1024;

export type EvidenceTier = 'judgement_set' | 'archived';

export interface EvidenceWriteInput {
  name: string;
  content: string | Buffer | unknown;
  mediaType: string;
}

export interface EvidenceRef {
  uri: string;
  mediaType: string;
  sha256: string;
  size: number;
  /** archived 超字节上限外移后置 true。 */
  offloaded?: true;
}

export interface EvidenceStoreOptions {
  runId: string;
  /** 工作区根（.idwth 建在其下）；测试注入临时目录。 */
  rootDir: string;
  secrets?: readonly string[];
  archivedLimitBytes?: number;
}

interface ManifestEntry {
  name: string;
  sha256: string;
  size: number;
  mediaType: string;
  offloaded: boolean;
  archive_uri?: string;
}

interface Manifest {
  run_id: string;
  judgement_set: ManifestEntry[];
  archived: ManifestEntry[];
}

export interface EvidenceStore {
  readonly runId: string;
  judgement(input: EvidenceWriteInput): Promise<EvidenceRef>;
  archive(input: EvidenceWriteInput): Promise<EvidenceRef>;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function serialize(content: EvidenceWriteInput['content']): Buffer {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(JSON.stringify(content), 'utf8');
}

async function exists(file: string): Promise<boolean> {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

/** store 实例 → run 目录（内部映射，不污染对外接口）。 */
const runDirs = new WeakMap<EvidenceStore, string>();

export function createEvidenceStore(options: EvidenceStoreOptions): EvidenceStore {
  const {
    runId,
    rootDir,
    secrets = [],
    archivedLimitBytes = DEFAULT_ARCHIVED_LIMIT_BYTES,
  } = options;

  const runDir = path.join(rootDir, '.idwth', 'runs', runId);
  const manifestPath = path.join(runDir, 'evidence-manifest.json');

  const manifest: Manifest = { run_id: runId, judgement_set: [], archived: [] };
  let archivedBytesUsed = 0;
  let ready = false;

  async function ensureLayout(): Promise<void> {
    if (ready) return;
    await mkdir(path.join(runDir, 'blobs', 'judgement_set'), { recursive: true });
    await mkdir(path.join(runDir, 'blobs', 'archived'), { recursive: true });
    await mkdir(path.join(runDir, 'judgement_set'), { recursive: true });
    await mkdir(path.join(runDir, 'archived'), { recursive: true });
    await mkdir(path.join(runDir, 'archive'), { recursive: true });
    await chmod(runDir, 0o700).catch(() => undefined);
    ready = true;
  }

  async function persistManifest(): Promise<void> {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }

  async function write(tier: EvidenceTier, input: EvidenceWriteInput): Promise<EvidenceRef> {
    await ensureLayout();

    // 安全闸门：任意证据写入前先深度脱敏（credential 键 + 已知明文，§4.8.6）。
    // 二进制产物（如截图 PNG）不经文本脱敏，密钥遮罩在截图采集层完成（§5.5.8）。
    const safe: EvidenceWriteInput['content'] = Buffer.isBuffer(input.content)
      ? input.content
      : (redactValue(input.content, secrets) as EvidenceWriteInput['content']);
    const buf = serialize(safe);
    const hash = sha256(buf);

    // 内容寻址去重：blob 已存在即只保留一份物理文件。
    const blobPath = path.join(runDir, 'blobs', tier, hash);
    if (!(await exists(blobPath))) {
      await writeFile(blobPath, buf, { mode: 0o600 });
    }

    const entry: ManifestEntry = {
      name: input.name,
      sha256: hash,
      size: buf.length,
      mediaType: input.mediaType,
      offloaded: false,
    };

    if (tier === 'judgement_set') {
      // 永不截断：命名视图直接落 judgement_set/<name>；同名拒绝（保护实时落盘可追溯性）。
      const viewPath = path.join(runDir, 'judgement_set', input.name);
      if (await exists(viewPath)) {
        throw new Error(`judgement_set name already exists: ${input.name}`);
      }
      await writeFile(viewPath, buf, { mode: 0o600 });
      manifest.judgement_set.push(entry);
    } else {
      archivedBytesUsed += buf.length;
      if (archivedBytesUsed > archivedLimitBytes) {
        // 超限：只外移到 archive/<sha256>，archived/<name> 写指针，不做丢失式截断。
        const archivePath = path.join(runDir, 'archive', hash);
        if (await exists(blobPath)) {
          await rename(blobPath, archivePath).catch(async () => {
            await copyFile(blobPath, archivePath);
          });
        }
        const archiveUri = `artifact://${runId}/archive/${hash}`;
        const pointer = { ...entry, offloaded: true, archive_uri: archiveUri };
        await writeFile(path.join(runDir, 'archived', input.name), JSON.stringify(pointer, null, 2), {
          mode: 0o600,
        });
        entry.offloaded = true;
        entry.archive_uri = archiveUri;
      } else {
        await writeFile(path.join(runDir, 'archived', input.name), buf, { mode: 0o600 });
      }
      manifest.archived.push(entry);
    }

    await persistManifest();

    return {
      uri: `artifact://${runId}/${tier}/${input.name}`,
      mediaType: input.mediaType,
      sha256: hash,
      size: buf.length,
      ...(entry.offloaded ? { offloaded: true as const } : {}),
    };
  }

  const store: EvidenceStore = {
    runId,
    judgement: (input) => write('judgement_set', input),
    archive: (input) => write('archived', input),
  };
  runDirs.set(store, runDir);
  return store;
}

/**
 * §3.6 evidence_digest：读 manifest，将 judgement_set 各条 sha256 排序后聚合。
 * 同一组证据（写入顺序无关）摘要相同；证据增减或内容变化摘要不同。
 */
export async function judgementDigest(store: EvidenceStore): Promise<string> {
  const runDir = runDirs.get(store);
  if (!runDir) throw new Error('unknown evidence store');
  const manifest = JSON.parse(
    await readFile(path.join(runDir, 'evidence-manifest.json'), 'utf8'),
  ) as Manifest;
  const ordered = manifest.judgement_set.map((e) => e.sha256).sort();
  return createHash('sha256')
    .update(ordered.join('\n'))
    .digest('hex');
}
