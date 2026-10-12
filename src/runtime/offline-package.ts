/**
 * Task 18 / TR-18.2 / AC-16 —— 离线/内网发布包构建。
 *
 * 离线包 = 按版本隔离的引擎缓存（Task 15 交付物）+ 可运行入口（bin/dist/package.json）
 * + 打包清单。约束：
 *  - 版本不符拒绝打包（透传 packEngineCache 校验）：先校验后建目录，失败无半成品；
 *  - 产物 files 为相对路径排序清单，与磁盘一致；
 *  - 清单 schema：idwth.offline-package/1。
 */
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { packEngineCache } from './replay/engine-cache.js';

export const OFFLINE_PACKAGE_SCHEMA = 'idwth.offline-package/1' as const;

export interface OfflinePackageOptions {
  /** 仓库/工程根：提供 bin/ dist/ package.json。 */
  projectRoot: string;
  /** 引擎缓存根目录（内含 `<version>/manifest.json`）。 */
  cacheRoot: string;
  /** engine_provider_version：只打包该版本缓存。 */
  version: string;
  /** 包输出目录。 */
  outDir: string;
}

export interface OfflinePackageManifest {
  schema: typeof OFFLINE_PACKAGE_SCHEMA;
  engineProviderVersion: string;
  createdAt: string;
  /** 相对 outDir 的文件排序清单。 */
  files: string[];
}

export interface OfflinePackageResult {
  outDir: string;
  manifestPath: string;
  manifest: OfflinePackageManifest;
  files: string[];
}

/** 收集 outDir 下全部普通文件，返回 POSIX 风格相对路径排序清单。 */
async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath ?? root, entry.name);
    files.push(relative(root, abs).split(sep).join('/'));
  }
  return files.sort();
}

async function copyIfExists(from: string, to: string): Promise<boolean> {
  if (!existsSync(from)) return false;
  const s = await stat(from);
  if (s.isDirectory()) {
    await cp(from, to, { recursive: true });
  } else {
    await cp(from, to);
  }
  return true;
}

/** 构建离线发布包；缓存缺失/版本不符 → 抛错且不产出任何文件。 */
export async function buildOfflinePackage(
  options: OfflinePackageOptions,
): Promise<OfflinePackageResult> {
  const { projectRoot, cacheRoot, version, outDir } = options;

  // 1. 先校验（packEngineCache 对缺失/错配抛错）——失败即止，无半成品。
  await packEngineCache(cacheRoot, version);

  // 2. 组包。
  await mkdir(outDir, { recursive: true });
  await cp(join(cacheRoot, version), join(outDir, 'engine-cache', version), { recursive: true });
  await copyIfExists(join(projectRoot, 'bin'), join(outDir, 'bin'));
  await copyIfExists(join(projectRoot, 'dist'), join(outDir, 'dist'));
  await copyIfExists(join(projectRoot, 'package.json'), join(outDir, 'package.json'));

  const files = await listFiles(outDir);
  // 清单自身也入列，保证 files 与磁盘一致。
  const filesWithManifest = [...files, 'OFFLINE-PACKAGE-MANIFEST.json'].sort();
  const manifest: OfflinePackageManifest = {
    schema: OFFLINE_PACKAGE_SCHEMA,
    engineProviderVersion: version,
    createdAt: new Date().toISOString(),
    files: filesWithManifest,
  };
  const manifestPath = join(outDir, 'OFFLINE-PACKAGE-MANIFEST.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    outDir,
    manifestPath,
    manifest,
    files: filesWithManifest,
  };
}
