/**
 * §3.1 / §3.2：run 级作用域与论域收窄（DD-04 / DD-43）。
 *
 * 两级标识：runId 防上次运行残留（假 PASS 通道），contractId 防同一批次
 * 内其他用例串扰。归属判定只允许使用「名字 / 标签内嵌 runId+contractId」，
 * 禁止 created_at > run_start —— K8s 时间戳为秒级精度，该判据已被 E02 实测证伪。
 *
 * run_created_set 只含本 run 本 contract 创建的对象；系统自动注入对象
 * （如 kube-root-ca.crt）进入 excluded_system_objects[]，两条通道分别
 * 防假 PASS（残留）与假 FAIL（注入）。
 */
import { randomUUID } from 'node:crypto';

/** 一次 run 的双标识作用域。 */
export interface RunScope {
  runId: string;
  contractId: string;
}

/** Provider 列表查询返回的对象形状（名字 + 可选标签）。 */
export interface ScopedObject {
  kind: string;
  name: string;
  labels?: Record<string, string>;
}

export interface NarrowedSet {
  run_created: ScopedObject[];
  excluded_system_objects: ScopedObject[];
}

/**
 * 生成 8 字符小写十六进制短 runId（UUID v4 前 8 hex）。
 * 命名空间 ns-<runId> / 资源名内嵌使用，足够区分相邻 run。
 */
export function createRunId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 对单个字符串做两级模板替换：${runId} 与 ${contractId}。
 * fixtures、cleanup 条目与资源标签同源实例化。
 */
export function expandTemplate(value: string, scope: RunScope): string {
  return value
    .replaceAll('${runId}', scope.runId)
    .replaceAll('${contractId}', scope.contractId);
}

/**
 * 对 fixtures 所有值做两级模板替换。
 * Contract schema 规定 fixtures 为 string→string（§3.1），故签名收窄为
 * string→string；模板未命中的占位符原样保留。
 */
export function instantiateFixtures(
  fixtures: Record<string, string>,
  scope: RunScope,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([key, value]) => [key, expandTemplate(value, scope)]),
  );
}

function hasDualMarker(text: string, scope: RunScope): boolean {
  return text.includes(scope.runId) && text.includes(scope.contractId);
}

/**
 * 将 provider 返回的空间内对象集收窄为 run_created_set：
 *  - 名字或任一标签值同时内嵌 runId+contractId → run_created；
 *  - 命中 systemObjectNames 名单 → excluded_system_objects；
 *  - 历史残留 / 同 run 他用例对象一律不计入。
 */
export function narrowRunCreatedSet(
  objects: ScopedObject[],
  scope: RunScope,
  systemObjectNames: readonly string[] = [],
): NarrowedSet {
  const excluded_system_objects: ScopedObject[] = [];
  const run_created: ScopedObject[] = [];

  for (const obj of objects) {
    const nameOwned = hasDualMarker(obj.name, scope);
    const labelOwned = Object.values(obj.labels ?? {}).some((v) =>
      hasDualMarker(v, scope),
    );

    if (nameOwned || labelOwned) {
      run_created.push(obj);
    } else if (systemObjectNames.includes(obj.name)) {
      excluded_system_objects.push(obj);
    }
  }

  return { run_created, excluded_system_objects };
}
