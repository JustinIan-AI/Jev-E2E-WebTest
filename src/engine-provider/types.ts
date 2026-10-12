/**
 * §5.0 EngineProvider —— 判定内核与具体浏览器引擎之间的唯一可替换点。
 * 本文件只定义接口与共享领域类型，不含任何 Playwright/e2e 细节。
 */

/** 语义目标（Contract steps[].target 的解析输入；禁止 CSS/XPath/JS 选择器）。 */
export interface SemanticTarget {
  role?: string;
  label?: string;
  name?: string;
  text?: string;
  match?: 'exact' | 'substring';
  /** L2 指纹（Task 5）。 */
  fingerprint?: {
    role?: string;
    name?: string;
    dom_path_hash: string;
    sibling_ordinal: number;
    anchor_text: string[];
  };
  /** 断言用：visible/absent/count/value/checked/url/number 七原语的期望。 */
  expected?: number | string | boolean;
  allow_multiple?: boolean;
}

export type ResolveMode = 'L1' | 'L2';
export type ResolveStatus = 'miss' | 'resolved' | 'ambiguous';

/** 统一形状的 ResolvedTarget（Action.schema target 字段）。 */
export interface ResolvedTarget {
  elementId: string | number;
  strategy: 'role' | 'label' | 'text' | 'fingerprint' | 'model';
  confidence?: number;
}

export interface ResolveResult {
  status: ResolveStatus;
  /** 命中所用定位级（L1 role/label/text；L2 指纹）。 */
  mode?: ResolveMode;
  elementId?: string | number;
  strategy?: ResolvedTarget['strategy'];
  /** ambiguous 时的候选数（>1）。 */
  count?: number;
  /** 候选编号（L3 候选集由本层代码生成，Task 12 使用）。 */
  candidates?: ResolvedTarget[];
}

/** Observation（§5.1）：结构化页面状态；elements[].id 由代码生成，不来自模型。 */
export interface ObservedElement {
  id: number;
  role: string;
  name: string;
  text: string;
  visible: boolean;
  enabled: boolean;
  guard: string;
}

export interface Observation {
  observationId: string;
  fingerprint: string;
  url: string;
  title: string;
  elements: ObservedElement[];
  textExcerpt: string;
}

/** §3.4 合法 Action（discriminated union；与 action.schema.json 对齐）。 */
export interface BaseAction {
  kind: 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'navigate' | 'assert_only' | 'done';
  risk: 'reversible' | 'irreversible';
}
export interface ClickAction extends BaseAction {
  kind: 'click';
  target: ResolvedTarget;
}
export interface FillAction extends BaseAction {
  kind: 'fill' | 'select';
  target: ResolvedTarget;
  value: string;
}
export interface ScrollAction extends BaseAction {
  kind: 'scroll';
  deltaY: number;
}
export interface WaitAction extends BaseAction {
  kind: 'wait';
  ms: number;
}
export interface NavigateAction extends BaseAction {
  kind: 'navigate';
  url: string;
}
export interface AssertOnlyAction extends BaseAction {
  kind: 'assert_only';
}
export interface DoneAction extends BaseAction {
  kind: 'done';
}
export type Action =
  | ClickAction
  | FillAction
  | ScrollAction
  | WaitAction
  | NavigateAction
  | AssertOnlyAction
  | DoneAction;

export type ActionResultStatus = 'success' | 'failed' | 'skipped' | 'blocked';

export interface ActionResult {
  kind: Action['kind'];
  status: ActionResultStatus;
  /** ★ 是否已真正派发到页面：mutation 超时/未知结果后禁止自动重试（TR-6.2）。 */
  dispatched: boolean;
  errorCode?: string;
  message?: string;
}

/** 断言规格（七 DOM 原语 + http/backend/state；本任务实现 DOM 子集）。 */
export type AssertionKind =
  | 'visible'
  | 'absent'
  | 'count'
  | 'value'
  | 'checked'
  | 'url'
  | 'number'
  | 'http'
  | 'backend'
  | 'state';

export interface AssertionSpec {
  kind: AssertionKind;
  target?: SemanticTarget;
  expected?: number | string | boolean;
  allow_multiple?: boolean;
}

export type AssertionResultStatus = 'passed' | 'failed' | 'inconclusive';

export interface AssertionResult {
  kind: AssertionKind;
  passed: boolean;
  status: AssertionResultStatus;
  /** 不可判定（如 count>1 未声明 allow_multiple）→ BLOCKED(ambiguity/decision)。 */
  blockedReason?: 'ambiguity' | 'decision' | 'drift';
  actual?: unknown;
  message?: string;
}

/** 产物引用（内容寻址由 Task 8 完善；此处先定形状）。 */
export interface ArtifactRef {
  uri: string;
  mediaType: string;
  /** 内联载荷（小产物，如 PNG buffer 的 base64）；大产物走路径指针。 */
  contentBase64?: string;
}

export interface ScreenshotOptions {
  mask: string[];
}

export interface EngineProvider {
  readonly id: string;
  /** ★ 参与六重绑定第 ⑥ 项 engine_provider_version。 */
  readonly version: string;

  observe(): Promise<Observation>;
  resolve(target: SemanticTarget, mode: ResolveMode): Promise<ResolveResult>;
  act(action: Action): Promise<ActionResult>;
  checkAssertion(spec: AssertionSpec): Promise<AssertionResult>;
  screenshot(options: ScreenshotOptions): Promise<ArtifactRef>;
  trace(): Promise<ArtifactRef>;
  /** ★ 只断连，不杀用户浏览器。 */
  dispose(): Promise<void>;
}

export interface EngineProviderConnectOptions {
  cdpEndpoint: string;
  /** SPA 上下文引导键，键名由 SUT 适配提供，core 不假定任何键名。 */
  storageSeed?: Record<string, string>;
  originsAllowlist?: string[];
  viewport?: { width: number; height: number };
  locale?: string;
  timezoneId?: string;
}

export type { EngineProviderConnectOptions as PlaywrightProviderOptions };

export const ENGINE_PROVIDER_CAPABILITIES = [
  'id',
  'version',
  'observe',
  'resolve',
  'act',
  'checkAssertion',
  'screenshot',
  'trace',
  'dispose',
] as const;
