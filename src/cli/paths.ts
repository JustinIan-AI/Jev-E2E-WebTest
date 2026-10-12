import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Run-artifact layout under `.idwth/` (DD §3.6 / FR-8).
 * All commands are run-and-exit; artifacts are plain files, never a service store.
 */
export const ARTIFACT_ROOT = '.idwth';
export const RUNS_DIR = `${ARTIFACT_ROOT}/runs`;
export const ENGINE_CACHE_DIR = `${ARTIFACT_ROOT}/engine-cache`;
export const TMP_DIR = `${ARTIFACT_ROOT}/tmp`;

/** Directory holding the packaged static report template (rendered to a file in Task 11). */
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../..');
}

export function reportTemplatePath(): string {
  return resolve(packageRoot(), 'src/cli/assets/report-template.html');
}
