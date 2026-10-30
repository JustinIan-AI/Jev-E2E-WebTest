/**
 * Task 14 —— 上游 @e2e-dev/web + @e2e-dev/decision 引擎契约形状（DD §5.0）。
 *
 * 本文件只声明 IDWTH 对上游引擎的**预期接口**（结构类型），不 import 上游包：
 * 上游实例经 connect({ engine }) 注入。四条硬约束的落点：
 *  ① 恢复触发权（DD-36）：config.autoHeal/autoRetry 必须可显式关闭且回读校验；
 *  ② 错误码吸附（DD-32）：UpstreamAssertionResult.status='failed' +
 *    errorCode='ASSERTION_INCONCLUSIVE' 是上游实录（packages/decision/src/executor.ts:382）；
 *  ③ 候选集编号由我们掌控：上游只提供元素表（observe），编号在 adapter 侧；
 *  ④ version 必须回传（getVersion），参与六重绑定第⑥项。
 */

/** 上游引擎恢复相关配置（①：adapter connect 时强制关闭并回读校验）。 */
export interface UpstreamE2eEngineConfig {
  autoHeal: boolean;
  autoRetry: boolean;
}

/** 上游元素表条目（③：编号由 adapter 重新分配，不直接采用上游 id 以外字段）。 */
export interface UpstreamElementInfo {
  elementId: string | number;
  role: string;
  name: string;
  text?: string;
  visible: boolean;
  enabled: boolean;
}

export interface UpstreamObservation {
  observationId: string;
  url: string;
  title: string;
  elements: UpstreamElementInfo[];
}

export interface UpstreamLocateRequest {
  role?: string;
  name?: string;
  /**
   * Issue #25 可选通道：占位符文本（相当于 getByPlaceholder）。
   * 上游未实现该字段时返回 missing —— 安全退化到 text 通道，不产生假命中。
   */
  placeholder?: string;
  text?: string;
  match?: 'exact' | 'substring';
}

export type UpstreamLocateStatus = 'found' | 'missing' | 'ambiguous';

export interface UpstreamLocateResult {
  status: UpstreamLocateStatus;
  elementId?: string | number;
  count?: number;
}

export interface UpstreamActionRequest {
  kind: 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'navigate' | 'assert_only' | 'done';
  elementId?: string | number;
  value?: string;
  url?: string;
  deltaY?: number;
  ms?: number;
}

/** 8 态对齐 §3.5（status 语义与 IDWTH ActionResult 一一映射）。 */
export type UpstreamActionStatus =
  | 'ok'
  | 'missing'
  | 'ambiguous'
  | 'disabled'
  | 'covered'
  | 'timeout'
  | 'blocked'
  | 'error';

export interface UpstreamActionResult {
  status: UpstreamActionStatus;
  dispatched: boolean;
  message?: string;
  blockedUrl?: string;
}

export interface UpstreamAssertionRequest {
  kind: 'visible' | 'absent' | 'count' | 'value' | 'checked' | 'url' | 'number';
  role?: string;
  name?: string;
  text?: string;
  match?: 'exact' | 'substring';
  expected?: number | string | boolean;
  allowMultiple?: boolean;
}

export type UpstreamAssertionStatus = 'passed' | 'failed' | 'inconclusive';

export interface UpstreamAssertionResult {
  status: UpstreamAssertionStatus;
  /** DD-32：判不出来时上游以 failed + ASSERTION_INCONCLUSIVE 返回。 */
  errorCode?: string;
  actual?: unknown;
  message?: string;
}

export interface UpstreamArtifact {
  data: string;
  mimeType: string;
}

/** 上游引擎实例契约（@e2e-dev/web 的预期形状；测试以替身实现）。 */
export interface UpstreamE2eEngine {
  /** ④ 版本必须回传（非空），参与六重绑定第⑥项 engine_provider_version。 */
  getVersion(): string;
  /** ① 恢复触发权让渡：显式下发配置；adapter 以 getConfig 回读校验（fail-closed）。 */
  configure(partial: Partial<UpstreamE2eEngineConfig>): void;
  getConfig(): UpstreamE2eEngineConfig;
  observe(): Promise<UpstreamObservation>;
  locate(request: UpstreamLocateRequest): Promise<UpstreamLocateResult>;
  execute(request: UpstreamActionRequest): Promise<UpstreamActionResult>;
  assert(request: UpstreamAssertionRequest): Promise<UpstreamAssertionResult>;
  screenshot(options: { mask: string[] }): Promise<UpstreamArtifact>;
  trace(): Promise<UpstreamArtifact>;
  dispose(): Promise<void>;
}
