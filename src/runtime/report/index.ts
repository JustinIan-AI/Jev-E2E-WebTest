/**
 * Task 11 — 报告产物写入、静态渲染与导出包（FR-8 / AC-12 / DD-48）。
 *
 * run 目录布局（rootDir/.idwth/runs/<runId>/）：
 *   report.json          五要素权威数据（mode 0600）
 *   screenshots/<name>   截图物理文件（mode 0600；HTML 中以 data URI 内联）
 *   report.html          单文件静态报告（渲染生成，可离线 file:// 打开）
 *
 * 导出包布局（rootDir/.idwth/exports/<runId>/）：
 *   report.html / report.json / screenshots/ / judgement_set/ /
 *   judge-result.json / evidence-manifest.json / export-manifest.json
 * judgement_set 随包以支持跨机器 `idwth judge recompute`。
 */
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderReportHtml } from './render.js';
import {
  REPORT_SCHEMA_VERSION,
  type ReportData,
  type ReportScreenshotInput,
  type ReportSeed,
} from './types.js';

export type {
  ReportData,
  ReportSeed,
  ReportScreenshotInput,
} from './types.js';

export interface WriteReportOptions {
  rootDir: string;
  runId: string;
  data: ReportSeed;
  generatedAt: string;
  screenshots: readonly ReportScreenshotInput[];
}

function runDirOf(rootDir: string, runId: string): string {
  return path.join(rootDir, '.idwth', 'runs', runId);
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function mediaTypeFor(name: string): string {
  if (name.toLowerCase().endsWith('.png')) return 'image/png';
  if (name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  return 'application/octet-stream';
}

/**
 * 写入 report.json + screenshots/（内容 sha256 索引）。
 * 由 Runtime 在判定结束后单点调用；与 judge 归档同处一个 run 目录。
 */
export async function writeReportArtifacts(
  options: WriteReportOptions,
): Promise<ReportData> {
  const { rootDir, runId, data, generatedAt, screenshots } = options;
  const runDir = runDirOf(rootDir, runId);
  const shotsDir = path.join(runDir, 'screenshots');
  await mkdir(runDir, { recursive: true });
  await chmod(runDir, 0o700).catch(() => undefined);
  await mkdir(shotsDir, { recursive: true });

  const indexed = await Promise.all(
    screenshots.map(async (shot) => {
      const sha256 = sha256Hex(shot.content);
      await writeFile(path.join(shotsDir, shot.name), shot.content, { mode: 0o600 });
      return {
        path: `screenshots/${shot.name}`,
        sha256,
        ...(shot.caption !== undefined ? { caption: shot.caption } : {}),
      };
    }),
  );

  const report: ReportData = {
    schema_version: REPORT_SCHEMA_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    case: data.case,
    steps: data.steps,
    assertion_results: data.assertion_results,
    verdict: data.verdict,
    failure_reason: data.failure_reason,
    reproduction: data.reproduction,
    screenshots: indexed,
  };

  await writeFile(path.join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  return report;
}

export interface RenderOptions {
  rootDir: string;
  runId: string;
}

/**
 * 读取 run 目录的 report.json + 截图，渲染单文件 report.html。
 * run 目录或 report.json 缺失时抛错（由 CLI 映射为 CONFIG_ERROR(3)）。
 */
export async function renderRunReport(options: RenderOptions): Promise<string> {
  const { rootDir, runId } = options;
  const runDir = runDirOf(rootDir, runId);

  let raw: string;
  try {
    raw = await readFile(path.join(runDir, 'report.json'), 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ReportNotFoundError(`找不到 run 报告数据：${path.join(runDir, 'report.json')}`);
    }
    throw error;
  }

  const data = JSON.parse(raw) as ReportData;
  const inlined = await Promise.all(
    data.screenshots.map(async (entry) => {
      const buf = await readFile(path.join(runDir, entry.path));
      const name = path.basename(entry.path);
      return {
        ...(entry.caption !== undefined ? { caption: entry.caption } : {}),
        mediaType: mediaTypeFor(name),
        base64: buf.toString('base64'),
      };
    }),
  );

  const html = renderReportHtml(data, inlined);
  const htmlPath = path.join(runDir, 'report.html');
  await writeFile(htmlPath, html, 'utf8');
  return htmlPath;
}

/** run 目录 / report.json 缺失。 */
export class ReportNotFoundError extends Error {}

export interface ExportResult {
  exportDir: string;
  files: string[];
}

/**
 * 打包导出目录：报告 + 截图 + judgement_set + judge 绑定文件 + 清单。
 * 调用前应先 renderRunReport，确保 report.html 已生成。
 */
export async function exportRunPackage(options: RenderOptions): Promise<ExportResult> {
  const { rootDir, runId } = options;
  const runDir = runDirOf(rootDir, runId);
  const exportDir = path.join(rootDir, '.idwth', 'exports', runId);
  await rm(exportDir, { recursive: true, force: true });
  await mkdir(exportDir, { recursive: true });

  const entries: readonly string[] = [
    'report.html',
    'report.json',
    'judge-result.json',
    'evidence-manifest.json',
    'screenshots',
    'judgement_set',
  ];

  const files: string[] = [];
  for (const entry of entries) {
    const src = path.join(runDir, entry);
    const dest = path.join(exportDir, entry);
    await cp(src, dest, { recursive: true });
    await collectFiles(dest, entry, files);
  }

  files.sort();
  await writeFile(
    path.join(exportDir, 'export-manifest.json'),
    `${JSON.stringify({ run_id: runId, files }, null, 2)}\n`,
    'utf8',
  );

  return { exportDir, files };
}

async function collectFiles(target: string, relBase: string, out: string[]): Promise<void> {
  const info = await stat(target);
  if (info.isDirectory()) {
    for (const child of await readdir(target)) {
      await collectFiles(path.join(target, child), path.join(relBase, child), out);
    }
    return;
  }
  out.push(relBase.split(path.sep).join('/'));
}
