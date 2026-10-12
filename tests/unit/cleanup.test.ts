/**
 * TR-7.2：幂等 cleanup 终态轮询（详设 §8.1 五规则，E02 实测补）。
 * ① 完成判据是 GET→404，不是 DELETE 响应码；
 * ② 轮询间隔 2s、超时上限 60s；
 * ③ 超时 → BLOCKED(cleanup)，不静默；
 * ④ DELETE 只发一次，之后只读 GET（只读轮询不是重试 mutation）；
 * ⑤ 重复删除 404 属正常，cleanup 可安全重入。
 */
import { describe, expect, it } from 'vitest';
import {
  cleanupResource,
  DEFAULT_CLEANUP_POLL_INTERVAL_MS,
  DEFAULT_CLEANUP_TIMEOUT_MS,
} from '../../src/runtime/cleanup.js';
import type { BackendAdapter } from '../../src/tools/backend/types.js';

/** 脚本化 adapter：精确记录 delete/get 调用次数，get 按预设序列返回 found。 */
class ScriptedBackend implements BackendAdapter {
  readonly id = 'scripted';
  deleteCalls = 0;
  getCalls: string[] = [];

  constructor(
    private readonly getFoundSequence: boolean[],
    private readonly deleteStatus: 'deleted' | 'not_found' = 'deleted',
  ) {}

  async query(): Promise<null> {
    return null;
  }

  async delete(key: string): Promise<{ status: 'deleted' | 'not_found' }> {
    this.deleteCalls += 1;
    return { status: this.deleteStatus };
  }

  async get(key: string): Promise<{ found: boolean }> {
    this.getCalls.push(key);
    const seq = this.getFoundSequence;
    const found = seq[Math.min(this.getCalls.length - 1, seq.length - 1)] ?? false;
    return { found };
  }
}

const params = {
  scope: 'run' as const,
  runId: 'a1b2c3d4',
  fixtures: { namespace: 'ns-a1b2c3d4', name: 'idwth-a1b2c3d4-workload-create-demo' },
};
const noopSleep = async (): Promise<void> => {};

describe('cleanupResource（§8.1 五规则）', () => {
  it('规则 1：DELETE 200（已受理）后资源仍 Terminating，以 GET→404 为完成判据', async () => {
    const adapter = new ScriptedBackend([true, true, false]);
    const result = await cleanupResource(adapter, 'deployment/demo', params, {
      pollIntervalMs: 0,
      sleep: noopSleep,
    });
    expect(result).toEqual({ status: 'deleted' });
  });

  it('规则 4：DELETE 只发一次；Terminating 期间只进行只读 GET 轮询（不重试 mutation）', async () => {
    const adapter = new ScriptedBackend([true, true, false]);
    await cleanupResource(adapter, 'deployment/demo', params, {
      pollIntervalMs: 0,
      sleep: noopSleep,
    });
    expect(adapter.deleteCalls).toBe(1);
    expect(adapter.getCalls).toHaveLength(3);
  });

  it('DELETE 后立即 GET→404 也算完成（只轮询一次）', async () => {
    const adapter = new ScriptedBackend([false]);
    const result = await cleanupResource(adapter, 'deployment/demo', params, {
      pollIntervalMs: 0,
      sleep: noopSleep,
    });
    expect(result).toEqual({ status: 'deleted' });
    expect(adapter.deleteCalls).toBe(1);
    expect(adapter.getCalls).toHaveLength(1);
  });

  it('规则 5：重复 cleanup 时 DELETE 返回 404 属正常，安全重入且不报错', async () => {
    const adapter = new ScriptedBackend([], 'not_found');
    const result = await cleanupResource(adapter, 'deployment/demo', params, {
      pollIntervalMs: 0,
      sleep: noopSleep,
    });
    expect(result).toEqual({ status: 'deleted' });
    // 已确认不存在时无需再轮询 GET。
    expect(adapter.deleteCalls).toBe(1);
    expect(adapter.getCalls).toHaveLength(0);
  });

  it('规则 3：轮询至终态超时 → BLOCKED(cleanup)，不静默放过；DELETE 仍只发一次', async () => {
    const adapter = new ScriptedBackend([true]);
    let elapsed = 0;
    const result = await cleanupResource(adapter, 'deployment/demo', params, {
      pollIntervalMs: 10,
      timeoutMs: 5,
      sleep: async () => {
        elapsed += 10;
      },
      now: () => elapsed,
    });
    expect(result).toEqual({ status: 'blocked', reason: 'cleanup' });
    expect(adapter.deleteCalls).toBe(1);
  });

  it('规则 2：默认轮询间隔 2s、超时上限 60s（E02 实测口径）', () => {
    expect(DEFAULT_CLEANUP_POLL_INTERVAL_MS).toBe(2000);
    expect(DEFAULT_CLEANUP_TIMEOUT_MS).toBe(60_000);
  });
});
