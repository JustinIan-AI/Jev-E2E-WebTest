/**
 * Task 16 / TR-16.2（AC-13 / DD §10）—— doctor 环境检查。
 *
 * 六项检查：Chrome/CDP 可达、origins 允许列表、JEV 端点、权限、端口污染（残留进程）、
 * 引擎缓存新鲜度。前五项由编排层注入 prober（本模块不触真实环境）；引擎缓存复用
 * Task 15 的 loadEngineCache —— hit→ok / miss→warn（可联网录制，不阻断）/ stale→fail。
 *
 * 退出码（AC-13 六值契约）：任一 fail → RUNTIME_ERROR(4)；全 ok/warn → PASS(0)。
 * 诊断必须完整：全部检查执行、不短路。
 */
import { EXIT_CODES } from '../cli/exit-codes.js';
import { loadEngineCache, type EngineCacheLoad } from './replay/engine-cache.js';

export const DOCTOR_CHECK_IDS = [
  'chrome',
  'origins',
  'jev',
  'permissions',
  'ports',
  'engine-cache',
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

/** 单项探针结果。ok=false 时缺省按 fail 处理；severity:'warn' 表示观测不阻断。 */
export interface DoctorProbeResult {
  ok: boolean;
  detail?: string;
  severity?: 'fail' | 'warn';
}

export type DoctorProbe = () => Promise<DoctorProbeResult>;

export interface DoctorProbes {
  chrome: DoctorProbe;
  origins: DoctorProbe;
  jev: DoctorProbe;
  permissions: DoctorProbe;
  ports: DoctorProbe;
}

export interface DoctorCheck {
  id: DoctorCheckId;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  exitCode: typeof EXIT_CODES.PASS | typeof EXIT_CODES.RUNTIME_ERROR;
}

export interface DoctorEngineCacheInput {
  root: string;
  currentVersion: string;
}

async function runProbe(id: DoctorCheckId, probe: DoctorProbe): Promise<DoctorCheck> {
  let result: DoctorProbeResult;
  try {
    result = await probe();
  } catch (error) {
    // 探针自身异常视为该项检查失败（识别不可用环境，绝不让 doctor 崩溃）。
    result = {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (result.ok) {
    return { id, status: 'ok', ...(result.detail !== undefined ? { detail: result.detail } : {}) };
  }
  const status = result.severity === 'warn' ? 'warn' : 'fail';
  return { id, status, ...(result.detail !== undefined ? { detail: result.detail } : {}) };
}

function checkFromCacheLoad(load: EngineCacheLoad): DoctorCheck {
  switch (load.status) {
    case 'hit':
      return { id: 'engine-cache', status: 'ok', detail: `cache hit: ${load.manifestPath}` };
    case 'miss':
      return {
        id: 'engine-cache',
        status: 'warn',
        detail: `engine cache not found (${load.reason}); record one online round to seed it`,
      };
    case 'stale':
      // 陈旧缓存不得沿用（A11 / DD-35）：环境不可用，阻断。
      return { id: 'engine-cache', status: 'fail', detail: load.warning };
  }
}

export async function runDoctor(params: {
  probes: DoctorProbes;
  engineCache: DoctorEngineCacheInput;
}): Promise<DoctorReport> {
  const { probes, engineCache } = params;

  const checks = await Promise.all([
    runProbe('chrome', probes.chrome),
    runProbe('origins', probes.origins),
    runProbe('jev', probes.jev),
    runProbe('permissions', probes.permissions),
    runProbe('ports', probes.ports),
    loadEngineCache(engineCache.root, engineCache.currentVersion).then(checkFromCacheLoad),
  ]);

  const anyFail = checks.some((c) => c.status === 'fail');
  return {
    checks,
    exitCode: anyFail ? EXIT_CODES.RUNTIME_ERROR : EXIT_CODES.PASS,
  };
}
