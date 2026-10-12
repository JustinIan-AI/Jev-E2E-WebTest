/**
 * Task 18 —— 离线发布包构建脚本（npm run pack:offline）。
 *
 * 用法：tsx scripts/build-offline-package.ts --version <engine_provider_version>
 * 默认：projectRoot=cwd，cacheRoot=<cwd>/.idwth/engine-cache，outDir=<cwd>/offline-package
 * 逻辑全部在 src/runtime/offline-package.ts（受 typecheck 与测试覆盖），本文件只是 CLI 包装。
 */
import { join } from 'node:path';
import { buildOfflinePackage } from '../src/runtime/offline-package.js';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const version = argValue('version');
if (!version) {
  process.stderr.write('usage: npm run pack:offline -- --version <engine_provider_version>\n');
  process.exit(3);
}

const projectRoot = process.cwd();
try {
  const result = await buildOfflinePackage({
    projectRoot,
    cacheRoot: join(projectRoot, '.idwth', 'engine-cache'),
    version,
    outDir: join(projectRoot, 'offline-package'),
  });
  process.stdout.write(
    `idwth: offline package built at ${result.outDir}\n` +
      `  version: ${version}\n` +
      `  files: ${result.files.length}\n`,
  );
} catch (error) {
  process.stderr.write(`idwth: offline package build failed: ${
    error instanceof Error ? error.message : String(error)
  }\n`);
  process.exit(4);
}
