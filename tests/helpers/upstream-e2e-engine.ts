/**
 * 上游 @e2e-dev/web 引擎测试替身（内存虚拟 DOM）。
 *
 * 模拟上游实录行为（DD §5.0 / DD-32 / DD-36）：
 *  - autoHeal / autoRetry **默认开启**；configure() 可显式关闭；
 *    `refuseConfigure: true` 时上游拒绝关闭配置（模拟上游不让渡恢复触发权，
 *    adapter 必须 fail-closed 拒绝启动）。
 *  - `inconclusiveMode` 开启时，assert 一律返回
 *    `{ status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' }` —— 复刻上游
 *    `packages/decision/src/executor.ts:382` 的实录（判不出来记 failed、exit 1）。
 *  - healCalls / autoRetryCalls 计数：证明 adapter 显式关闭后上游不再自作恢复。
 */
import type {
  UpstreamE2eEngine,
  UpstreamE2eEngineConfig,
  UpstreamAssertionRequest,
  UpstreamAssertionResult,
  UpstreamArtifact,
  UpstreamActionRequest,
  UpstreamActionResult,
  UpstreamLocateRequest,
  UpstreamLocateResult,
  UpstreamObservation,
} from '../../src/engine-provider/e2e/upstream.js';

export interface VirtualElement {
  role: string;
  name: string;
  text?: string;
  value?: string;
  visible: boolean;
  enabled: boolean;
}

export interface UpstreamDoubleOptions {
  /** 上报版本；缺省 '0.4.2'。空串用于验证硬约束④（version 必须回传）。 */
  version?: string;
  /** 拒绝关闭 autoHeal/autoRetry（fail-closed 验证）。 */
  refuseConfigure?: boolean;
  /** 开启后 assert() 一律判不出（A10 复刻）。 */
  inconclusiveMode?: boolean;
}

const BASIC_PAGE: VirtualElement[] = [
  { role: 'textbox', name: '用户名', value: '', visible: true, enabled: true },
  { role: 'button', name: '新建', text: '新建', visible: true, enabled: true },
];

const DUPLICATES_PAGE: VirtualElement[] = [
  { role: 'button', name: '提交', text: '提交', visible: true, enabled: true },
  { role: 'button', name: '提交', text: '提交', visible: true, enabled: true },
];

export class UpstreamE2eEngineDouble implements UpstreamE2eEngine {
  config: UpstreamE2eEngineConfig = { autoHeal: true, autoRetry: true };
  /** 上游自作 heal / 自动重试的调用计数（关闭后必须恒为 0）。 */
  healCalls = 0;
  autoRetryCalls = 0;
  disposed = false;
  configureCalls: Partial<UpstreamE2eEngineConfig>[] = [];

  pages: Record<string, VirtualElement[]> = {
    '/basic': BASIC_PAGE.map((el) => ({ ...el })),
    '/duplicates': DUPLICATES_PAGE.map((el) => ({ ...el })),
  };
  currentUrl = 'http://127.0.0.1:1/basic';

  private readonly version: string;
  private readonly refuseConfigure: boolean;
  private inconclusive = false;
  private observationSeq = 0;

  constructor(options: UpstreamDoubleOptions = {}) {
    this.version = options.version ?? '0.4.2';
    this.refuseConfigure = options.refuseConfigure ?? false;
    this.inconclusive = options.inconclusiveMode ?? false;
  }

  setInconclusiveMode(on: boolean): void {
    this.inconclusive = on;
  }

  /** 直接改写虚拟页面（漂移/失败场景构造）。 */
  setPage(url: string, elements: VirtualElement[]): void {
    this.pages[url] = elements.map((el) => ({ ...el }));
  }

  navigateTo(url: string): void {
    // 按 pathname 匹配页面（currentUrl 允许是完整 URL 或路径）。
    const target = this.pageKeyOf(url);
    if (target !== undefined) this.currentUrl = url;
  }

  private pageKeyOf(url: string): string | undefined {
    if (this.pages[url] !== undefined) return url;
    try {
      const pathname = new URL(url).pathname;
      return this.pages[pathname] !== undefined ? pathname : undefined;
    } catch {
      return undefined;
    }
  }

  private get page(): VirtualElement[] {
    return this.pages[this.pageKeyOf(this.currentUrl) ?? ''] ?? [];
  }

  getVersion(): string {
    return this.version;
  }

  configure(partial: Partial<UpstreamE2eEngineConfig>): void {
    this.configureCalls.push(partial);
    if (this.refuseConfigure) return; // 拒绝让渡：配置不生效，getConfig 仍回 true
    this.config = { ...this.config, ...partial };
  }

  getConfig(): UpstreamE2eEngineConfig {
    return { ...this.config };
  }

  async observe(): Promise<UpstreamObservation> {
    this.observationSeq += 1;
    return {
      observationId: `up-obs-${this.observationSeq}`,
      url: this.currentUrl,
      title: '虚拟页面',
      elements: this.page.map((el, index) => ({
        elementId: index,
        role: el.role,
        name: el.name,
        text: el.text ?? el.name,
        visible: el.visible,
        enabled: el.enabled,
      })),
    };
  }

  private match(el: VirtualElement, req: UpstreamLocateRequest): boolean {
    if (req.role !== undefined && el.role !== req.role) return false;
    const wanted = req.name ?? req.text;
    if (wanted !== undefined) {
      const haystack = `${el.name}\n${el.text ?? ''}`;
      if (req.match === 'substring') {
        if (!haystack.includes(wanted)) return false;
      } else if (el.name !== wanted) {
        return false;
      }
    }
    return true;
  }

  async locate(request: UpstreamLocateRequest): Promise<UpstreamLocateResult> {
    const hits = this.page
      .map((el, index) => ({ el, index }))
      .filter(({ el }) => this.match(el, request));
    if (hits.length === 0) return { status: 'missing' };
    if (hits.length > 1) return { status: 'ambiguous', count: hits.length };
    return { status: 'found', elementId: hits[0]!.index };
  }

  async execute(request: UpstreamActionRequest): Promise<UpstreamActionResult> {
    switch (request.kind) {
      case 'navigate': {
        this.navigateTo(request.url ?? '');
        return { status: 'ok', dispatched: true };
      }
      case 'wait':
      case 'scroll':
      case 'assert_only':
      case 'done':
        return { status: 'ok', dispatched: false };
      case 'click':
      case 'fill':
      case 'select': {
        const index = Number(request.elementId);
        const el = this.page[index];
        if (!el) {
          // 上游默认 auto-heal：失败先自作恢复一次（DD-36 实录）。
          if (this.config.autoHeal) this.healCalls += 1;
          return { status: 'missing', dispatched: false };
        }
        if (!el.enabled) return { status: 'disabled', dispatched: false };
        if (!el.visible) return { status: 'covered', dispatched: false };
        if (request.kind === 'fill' || request.kind === 'select') {
          el.value = request.value ?? '';
        }
        return { status: 'ok', dispatched: true };
      }
    }
  }

  async assert(request: UpstreamAssertionRequest): Promise<UpstreamAssertionResult> {
    if (this.inconclusive) {
      // DD-32 实录：判不出来 → status 'failed' + 独立错误码（class=test、exit 1）。
      return {
        status: 'failed',
        errorCode: 'ASSERTION_INCONCLUSIVE',
        message: 'insufficient evidence',
      };
    }
    if (request.kind === 'url') {
      const pathname = new URL(this.currentUrl).pathname;
      const passed = request.expected === undefined || pathname === String(request.expected);
      return { status: passed ? 'passed' : 'failed', actual: pathname };
    }
    const hits = this.page.filter((el) => this.match(el, request));
    switch (request.kind) {
      case 'absent': {
        const visible = hits.some((el) => el.visible && el.enabled);
        return { status: visible ? 'failed' : 'passed' };
      }
      case 'count': {
        const passed = hits.length === Number(request.expected ?? 0);
        return { status: passed ? 'passed' : 'failed', actual: hits.length };
      }
      case 'visible': {
        const passed = hits.some((el) => el.visible && el.enabled);
        return { status: passed ? 'passed' : 'failed' };
      }
      case 'value': {
        const el = hits[0];
        if (!el) return { status: 'failed', actual: null };
        const passed = (el.value ?? '') === String(request.expected ?? '');
        return { status: passed ? 'passed' : 'failed', actual: el.value ?? '' };
      }
      default:
        return { status: 'failed', message: `unsupported upstream assertion: ${request.kind}` };
    }
  }

  async screenshot(_options: { mask: string[] }): Promise<UpstreamArtifact> {
    return { data: 'c2hvdA==', mimeType: 'image/png' };
  }

  async trace(): Promise<UpstreamArtifact> {
    return { data: 'dHJhY2U=', mimeType: 'application/zip' };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
