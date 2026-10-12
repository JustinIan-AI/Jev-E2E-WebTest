/**
 * §5.3 Backend Adapter 与 §3.2 EvidenceProvider 契约。
 *
 * backend: 断言抽象为可替换的 evidence provider；scope:'run' 时 provider
 * 必须以 runId 过滤（名字 / 标签），使「忘记传 runId」在接口层不成立。
 *
 * setup/teardown 复用同一 BackendAdapter（DD-44：不新增第 4 个可替换接口）：
 * cleanup 所需的 delete/get 原语在 MutableBackendAdapter 上扩展。
 * V1 提供 rest / sqlite / mock；k8s 作为 reference adapter 放 examples/，
 * 不进 core。
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export interface BackendQueryParams {
  scope: 'run' | 'global';
  runId: string;
  fixtures: Record<string, unknown>;
}

/** §5.3：只读证据查询边界。 */
export interface BackendAdapter {
  id: string;
  query(key: string, params: BackendQueryParams): Promise<Json>;
}

/** cleanup 复用 adapter 的 delete/get 原语（DD-44，接口内扩展非新边界）。 */
export interface MutableBackendAdapter extends BackendAdapter {
  /**
   * 发起一次删除。只允许调用一次，不自动重试；
   * 资源已不存在时返回 not_found（幂等，404 属正常）。
   */
  delete(
    key: string,
    params: BackendQueryParams,
  ): Promise<{ status: 'deleted' | 'not_found' }>;
  /** 只读终态探针：found=false 即终态 404。 */
  get(key: string, params: BackendQueryParams): Promise<{ found: boolean }>;
}

/** §3.2：backend 断言证据（值 + 观测时间 + 来源引用）。 */
export interface EvidenceProvider extends BackendAdapter {
  query(
    key: string,
    params: BackendQueryParams,
  ): Promise<{ value: Json; observed_at: string; source_ref: string }>;
}
