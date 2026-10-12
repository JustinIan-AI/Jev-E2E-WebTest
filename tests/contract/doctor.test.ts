/**
 * Task 16 / TR-16.2（AC-13）—— doctor 环境检查契约。
 *
 * doctor 识别六类问题并返回规定退出码：
 *  - Chrome/CDP 可达、origins 允许列表、JEV 端点、权限、端口污染（残留进程）——注入 prober，不触真实环境；
 *  - 引擎缓存新鲜度：复用 loadEngineCache —— hit→ok / miss→warn（可联网录制，不阻断）/ stale→fail；
 *  - 任一 fail → EXIT_CODES.RUNTIME_ERROR(4)；全部 ok/warn → EXIT_CODES.PASS(0)。
 * 诊断必须完整：所有检查全量执行、不短路。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { runDoctor, type DoctorProbes } from '../../src/runtime/doctor.js';
import { writeEngineCache } from '../../src/runtime/replay/engine-cache.js';

const ok = (detail = 'ok') => async () => ({ ok: true, detail });
const fail = (detail: string) => async () => ({ ok: false, detail });

function allOk(): DoctorProbes {
  return { chrome: ok('chrome reachable'), origins: ok(), jev: ok(), permissions: ok(), ports: ok() };
}

let tmpRoot: string;

afterAll(async () => {
  if (tmpRoot !== undefined) await rm(tmpRoot, { recursive: true, force: true });
});

async function freshRoot(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), 'idwth-doctor-'));
  return tmpRoot;
}

describe('doctor — 全绿环境', () => {
  it('六项检查全 ok + 缓存 hit → exit 0', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: allOk(),
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.exitCode).toBe(EXIT_CODES.PASS);
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['chrome', 'ok'],
      ['origins', 'ok'],
      ['jev', 'ok'],
      ['permissions', 'ok'],
      ['ports', 'ok'],
      ['engine-cache', 'ok'],
    ]);
  });
});

describe('doctor — 不可用环境（exit 4 路径）', () => {
  it('Chrome/CDP 不可达 → fail，exitCode = RUNTIME_ERROR(4)', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: { ...allOk(), chrome: fail('CDP endpoint not reachable') },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.checks.find((c) => c.id === 'chrome')).toMatchObject({ status: 'fail' });
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });

  it('端口污染（残留进程/错误端口）→ fail，exitCode 4', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: { ...allOk(), ports: fail('stale listener on 9222') },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.checks.find((c) => c.id === 'ports')).toMatchObject({
      status: 'fail',
      detail: 'stale listener on 9222',
    });
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });

  it('JEV 端点故障 → fail，exitCode 4', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: { ...allOk(), jev: fail('JEV endpoint 503') },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.checks.find((c) => c.id === 'jev')!.status).toBe('fail');
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });

  it('引擎缓存版本不匹配（stale）→ fail，exitCode 4，entries 不外泄', async () => {
    const root = await freshRoot();
    const { manifestPath } = await writeEngineCache(root, 'engine-1.0.0', [
      { key: 'c:0', strategy: 'role', elementId: 'e1' },
    ]);
    const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
    tampered.engineProviderVersion = 'engine-0.9.0';
    await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');
    const report = await runDoctor({
      probes: allOk(),
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    const cache = report.checks.find((c) => c.id === 'engine-cache')!;
    expect(cache.status).toBe('fail');
    expect(cache.detail).toContain('mismatch');
    expect(cache.detail).not.toContain('c:0');
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });

  it('probe 抛异常按 fail 处理，不崩溃', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: {
        ...allOk(),
        permissions: async () => {
          throw new Error('EACCES: config unreadable');
        },
      },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.checks.find((c) => c.id === 'permissions')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('EACCES'),
    });
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });
});

describe('doctor — 观测级告警与完整性', () => {
  it('缓存 miss → warn，不阻断（exit 0），可联网录制', async () => {
    const root = await freshRoot();
    const report = await runDoctor({
      probes: allOk(),
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    const cache = report.checks.find((c) => c.id === 'engine-cache')!;
    expect(cache.status).toBe('warn');
    expect(report.exitCode).toBe(EXIT_CODES.PASS);
  });

  it('probe 显式声明 warn 严重级 → 观测不阻断', async () => {
    const root = await freshRoot();
    await writeEngineCache(root, 'engine-1.0.0', []);
    const report = await runDoctor({
      probes: {
        ...allOk(),
        origins: async () => ({ ok: false, detail: 'extra origin registered', severity: 'warn' }),
      },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    expect(report.checks.find((c) => c.id === 'origins')).toMatchObject({
      status: 'warn',
      detail: 'extra origin registered',
    });
    expect(report.exitCode).toBe(EXIT_CODES.PASS);
  });

  it('多个 fail 全量收集（诊断不短路），仍只返回一个退出码 4', async () => {
    const root = await freshRoot();
    const { manifestPath } = await writeEngineCache(root, 'engine-1.0.0', []);
    const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
    tampered.engineProviderVersion = 'engine-0.9.0';
    await writeFile(manifestPath, JSON.stringify(tampered), 'utf8');
    const report = await runDoctor({
      probes: { ...allOk(), chrome: fail('no chrome'), jev: fail('jev down'), ports: fail('port polluted') },
      engineCache: { root, currentVersion: 'engine-1.0.0' },
    });
    const failed = report.checks.filter((c) => c.status === 'fail');
    expect(failed.map((c) => c.id).sort()).toEqual(['chrome', 'engine-cache', 'jev', 'ports']);
    // engine-cache 版本不匹配也是 fail。
    expect(report.checks.find((c) => c.id === 'engine-cache')!.status).toBe('fail');
    expect(report.exitCode).toBe(EXIT_CODES.RUNTIME_ERROR);
  });
});
