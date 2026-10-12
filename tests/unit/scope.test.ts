/**
 * TR-7.1 单元侧：runId 生成、fixtures 两级模板注入与 run-created 论域收窄。
 * 依据详设 §3.1（DD-04 / DD-43）与 FR-11。
 */
import { describe, expect, it } from 'vitest';
import {
  createRunId,
  expandTemplate,
  instantiateFixtures,
  narrowRunCreatedSet,
  type RunScope,
  type ScopedObject,
} from '../../src/runtime/scope.js';

describe('createRunId（§3.1：短 UUID，8 字符）', () => {
  it('返回恰好 8 个小写十六进制字符', () => {
    expect(createRunId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('两次生成结果不同（无碰撞的随机源）', () => {
    expect(createRunId()).not.toBe(createRunId());
  });
});

describe('expandTemplate / instantiateFixtures（${runId} + ${contractId} 两级）', () => {
  const scope: RunScope = { runId: 'a1b2c3d4', contractId: 'workload-create' };

  it('同时替换 runId 与 contractId 占位符', () => {
    expect(expandTemplate('idwth-${runId}-${contractId}-demo', scope)).toBe(
      'idwth-a1b2c3d4-workload-create-demo',
    );
    expect(expandTemplate('ns-${runId}', scope)).toBe('ns-a1b2c3d4');
  });

  it('不含占位符的字符串原样返回', () => {
    expect(expandTemplate('plain-name', scope)).toBe('plain-name');
  });

  it('对 fixtures 所有值做两级替换（cleanup/断言与 fixture 同源）', () => {
    const resolved = instantiateFixtures(
      {
        namespace: 'ns-${runId}',
        deployment_name: 'idwth-${runId}-${contractId}-demo',
        untouched: 'fixed',
      },
      scope,
    );
    expect(resolved).toEqual({
      namespace: 'ns-a1b2c3d4',
      deployment_name: 'idwth-a1b2c3d4-workload-create-demo',
      untouched: 'fixed',
    });
  });
});

describe('narrowRunCreatedSet（论域只含本 run 本 contract 创建对象）', () => {
  const scope: RunScope = { runId: 'a1b2c3d4', contractId: 'workload-create' };
  const oldRunId = '00000001';

  const objects: ScopedObject[] = [
    // 本 run 本 contract：名字内嵌双标识。
    { kind: 'deployment', name: `idwth-${scope.runId}-${scope.contractId}-demo` },
    // 本 run 本 contract：标签内嵌双标识（SUT 无原生命名空间时的形式）。
    {
      kind: 'configmap',
      name: 'app-config',
      labels: { owner: `idwth-${scope.runId}-${scope.contractId}` },
    },
    // 上次运行残留：不同 runId。
    { kind: 'deployment', name: `idwth-${oldRunId}-${scope.contractId}-demo` },
    // 同批次其他用例：runId 相同、contractId 不同。
    { kind: 'deployment', name: `idwth-${scope.runId}-other-contract-demo` },
    // 系统自动注入对象。
    { kind: 'configmap', name: 'kube-root-ca.crt' },
  ];

  it('run_created 只包含名字/标签内嵌完整 runId+contractId 的两个对象', () => {
    const narrowed = narrowRunCreatedSet(objects, scope, ['kube-root-ca.crt']);
    expect(narrowed.run_created.map((o) => o.name).sort()).toEqual([
      'app-config',
      'idwth-a1b2c3d4-workload-create-demo',
    ]);
  });

  it('系统注入对象进入 excluded_system_objects，不落入 run_created', () => {
    const narrowed = narrowRunCreatedSet(objects, scope, ['kube-root-ca.crt']);
    expect(narrowed.excluded_system_objects.map((o) => o.name)).toEqual([
      'kube-root-ca.crt',
    ]);
  });

  it('残留与其他用例对象既不在 run_created 也不在 excluded（不产生假 PASS/假 FAIL）', () => {
    const narrowed = narrowRunCreatedSet(objects, scope, ['kube-root-ca.crt']);
    const allNames = [...narrowed.run_created, ...narrowed.excluded_system_objects].map(
      (o) => o.name,
    );
    expect(allNames).not.toContain(`idwth-${oldRunId}-${scope.contractId}-demo`);
    expect(allNames).not.toContain(`idwth-${scope.runId}-other-contract-demo`);
  });

  it('cleanup 条目接受同一模板替换（scope:run 只作用于本 run 资源）', () => {
    expect(expandTemplate('ns-${runId}', scope)).toBe('ns-a1b2c3d4');
  });
});
