/**
 * TR-7.1 作用域集成测试：runId + contractId 双标识论域收窄。
 *
 * 场景：非 K8s 形态的共享空间（前缀+标签隔离），同一 store 连续执行两个 run。
 *  - DD-04 通道（假 PASS）：上一 run 的残留 deployment 不得让本 run 的 exists 恒真；
 *  - 系统注入通道（假 FAIL）：自动注入的 kube-root-ca.crt 不得让 count == 0 恒假；
 *  - 批次内串扰：同 run 其他 contract 的对象不计入本 contract 的 run_created_set。
 *
 * 驱动件：core 交付的 MockBackendAdapter（src/tools/backend/mock.ts）。
 */
import { describe, expect, it } from 'vitest';
import {
  cleanupResource,
  expandTemplate,
  narrowRunCreatedSet,
  type RunScope,
} from '../../src/runtime/index.js';
import { MockBackendAdapter, type MockRecord } from '../../src/tools/backend/mock.js';

const SYSTEM_OBJECTS = ['kube-root-ca.crt'];
const noopSleep = async (): Promise<void> => {};

/** 以 run 作用域查询某类对象并做论域收窄（runtime evidence 判定路径）。 */
async function runCreatedList(
  store: MockBackendAdapter,
  kind: string,
  scope: RunScope,
  fixtures: Record<string, string>,
) {
  // §5.3 BackendAdapter.query 返回裸 JSON（列表即数组）；EvidenceProvider
  // 的 {value, observed_at, source_ref} 信封是上层证据采集的职责（Task 8）。
  const value = await store.query(`${kind}.list`, {
    scope: 'run',
    runId: scope.runId,
    fixtures,
  });
  return narrowRunCreatedSet(value as MockRecord[], scope, SYSTEM_OBJECTS);
}

describe('TR-7.1：双标识 run 作用域（连续两个 run，共享存储）', () => {
  it('上次残留不产生假 PASS：本 run 未创建对象时 run_created_set 为空', async () => {
    const store = new MockBackendAdapter();

    // —— Run A：创建 deployment，随后异常退出、未清理（残留）——
    const runA: RunScope = { runId: 'aaaaaaaa', contractId: 'workload-create' };
    const nameA = expandTemplate('idwth-${runId}-${contractId}-demo', runA);
    const fixturesA: Record<string, string> = { deployment_name: nameA };
    store.seed({
      kind: 'deployment',
      name: nameA,
      labels: { owner: `idwth-${runA.runId}-${runA.contractId}` },
    });

    // —— Run B：同 contract、新 runId；SUT 本次创建失败（没有任何 B 的对象落库）——
    const runB: RunScope = { runId: 'bbbbbbbb', contractId: 'workload-create' };
    const fixturesB: Record<string, string> = {
      deployment_name: expandTemplate('idwth-${runId}-${contractId}-demo', runB),
    };

    // 朴素 exists（只看空间内有没有同名前缀对象）会被 A 的残留骗绿；
    // 收窄后的 run_created_set 必须为空 —— 残留不产生假 PASS。
    const narrowedB = await runCreatedList(store, 'deployment', runB, fixturesB);
    expect(narrowedB.run_created).toEqual([]);
  });

  it('系统注入对象不产生假 FAIL：全新空间 configmap.count == 0 成立，注入物进 excluded', async () => {
    const store = new MockBackendAdapter();
    const scope: RunScope = { runId: 'cccccccc', contractId: 'workload-create' };
    const namespace = expandTemplate('ns-${runId}', scope);
    const fixtures: Record<string, string> = { namespace };

    // 刚创建的空命名空间里 K8s 控制面已自动注入 kube-root-ca.crt。
    store.seed({ kind: 'configmap', name: 'kube-root-ca.crt', namespace });

    const narrowed = await runCreatedList(store, 'configmap', scope, fixtures);
    expect(narrowed.run_created).toEqual([]);
    expect(narrowed.excluded_system_objects.map((o) => o.name)).toEqual(['kube-root-ca.crt']);
  });

  it('同 run 其他 contract 的对象不计入本 contract 论域（防批次内串扰）', async () => {
    const store = new MockBackendAdapter();
    const scope: RunScope = { runId: 'dddddddd', contractId: 'workload-create' };
    const name = expandTemplate('idwth-${runId}-${contractId}-demo', scope);
    const fixtures: Record<string, string> = { deployment_name: name };

    store.seed({ kind: 'deployment', name });
    store.seed({ kind: 'deployment', name: `idwth-${scope.runId}-other-contract-demo` });
    // 上一 run 残留同时存在。
    store.seed({ kind: 'deployment', name: 'idwth-00000001-workload-create-demo' });

    const narrowed = await runCreatedList(store, 'deployment', scope, fixtures);
    expect(narrowed.run_created.map((o) => o.name)).toEqual([name]);
  });

  it('cleanup 后本 run 对象消失；历史残留物理仍在但永不进入论域，run 可安全重跑', async () => {
    const store = new MockBackendAdapter();

    const runA: RunScope = { runId: 'eeeeeeee', contractId: 'workload-create' };
    const nameA = expandTemplate('idwth-${runId}-${contractId}-demo', runA);
    const fixturesA: Record<string, string> = { deployment_name: nameA };
    store.seed({ kind: 'deployment', name: nameA });

    const runB: RunScope = { runId: 'ffffffff', contractId: 'workload-create' };
    const nameB = expandTemplate('idwth-${runId}-${contractId}-demo', runB);
    const fixturesB: Record<string, string> = { deployment_name: nameB };
    store.seed({ kind: 'deployment', name: nameB });

    // Run B 完成后 finally cleanup：DELETE 一次 + 只读轮询至 404。
    const result = await cleanupResource(store, `deployment/${nameB}`, {
      scope: 'run',
      runId: runB.runId,
      fixtures: fixturesB,
    }, { pollIntervalMs: 0, sleep: noopSleep });
    expect(result).toEqual({ status: 'deleted' });

    // 幂等重入：再次 cleanup 返回 404 属正常。
    const reenter = await cleanupResource(store, `deployment/${nameB}`, {
      scope: 'run',
      runId: runB.runId,
      fixtures: fixturesB,
    }, { pollIntervalMs: 0, sleep: noopSleep });
    expect(reenter).toEqual({ status: 'deleted' });

    // B 的论域已空；A 的残留仍物理存在但不计入任何 run 的论域。
    const narrowedB = await runCreatedList(store, 'deployment', runB, fixturesB);
    expect(narrowedB.run_created).toEqual([]);
    const narrowedA = await runCreatedList(store, 'deployment', runA, fixturesA);
    expect(narrowedA.run_created.map((o) => o.name)).toEqual([nameA]);
  });
});
