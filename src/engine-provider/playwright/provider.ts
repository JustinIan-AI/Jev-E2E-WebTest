import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import {
  type Action,
  type ActionResult,
  type AssertionResult,
  type AssertionSpec,
  type ArtifactRef,
  type EngineProvider,
  type Observation,
  type ResolveMode,
  type ResolveResult,
  type ResolvedTarget,
  type SemanticTarget,
  type ScreenshotOptions,
} from '../types.js';
import { attach, detach, isOriginAllowed } from './attach.js';
import { openBackgroundTab, type BackgroundTab } from './background-tab.js';
import { newIsolatedContext } from './isolation.js';
import {
  type ElementFingerprint,
  fingerprintsEqual,
  hashDomPath,
} from './fingerprint.js';
import { TMP_DIR } from '../../cli/paths.js';

/** 浏览器侧枚举出来的原始指纹（路径尚未哈希，Node 侧统一哈希）。 */
interface RawFingerprint {
  token: string;
  path: string;
  siblingOrdinal: number;
  anchorText: string[];
}

/**
 * 节点身份锚点的最小结构接口（playwright ElementHandle 的子集）。
 * 以结构类型而非 ElementHandle<SVGElement|HTMLElement> 命名，避免源码依赖 DOM lib
 * （tsconfig lib 仅 ES2022；tests 可经 triple-slash 引入 dom，build 时 src 不引入）。
 */
interface NodeAnchor {
  // el 显式 any：回调运行在浏览器上下文，工程源码不引入 DOM lib。
  evaluate<T>(fn: (el: any) => T): Promise<T>;
  dispose(): Promise<void>;
}

const nodeRequire = createRequire(import.meta.url);
const playwrightPkg = nodeRequire('playwright/package.json') as { version: string };

function sha1(payload: string): string {
  return `sha1:${createHash('sha1').update(payload, 'utf8').digest('hex')}`;
}

/**
 * Playwright 降级实现（id: 'playwright'）。
 * §5.5 的 11 个脚本都归属本类内部；Runtime 只看见 EngineProvider 接口。
 */
export class PlaywrightProvider implements EngineProvider {
  readonly id = 'playwright';
  readonly version = `playwright-${playwrightPkg.version}`;

  private readonly browser: Browser;
  private readonly userContext: BrowserContext;
  private readonly originsAllowlist: readonly string[];

  /**
   * 元素注册表：elementId → { page, locator, handle? }；id 由代码生成，不来自模型。
   * handle 是解析时刻的节点身份锚点（§5.5.6 Freshness）——Locator 是重查询，
   * 无法区分 cloneNode 等属性复制式替换；身份判断必须锚定具体 DOM 节点。
   */
  private readonly elementRegistry = new Map<
    string,
    { page: Page; locator: Locator; handle?: NodeAnchor }
  >();
  private elementSeq = 0;

  /** 最近一次 observe 的 observationId（Freshness 比对基准，Runtime 独占）。 */
  private lastObservationId?: string;

  /** Provider 打开的页面/隔离 context，dispose 时清理（用户原有页面不动）。 */
  private readonly ownedPages = new Set<Page>();
  private readonly ownedContexts = new Set<BrowserContext>();
  private readonly backgroundTabs: BackgroundTab[] = [];

  private active: Page | null;
  private disposed = false;

  /** 单个 mutation 的动作截止（ms），默认 30s（§8.1 dispatch deadline）。 */
  private actionTimeoutMs = 30_000;

  private constructor(
    browser: Browser,
    userContext: BrowserContext,
    originsAllowlist: readonly string[],
  ) {
    this.browser = browser;
    this.userContext = userContext;
    this.originsAllowlist = originsAllowlist;
    this.active = userContext.pages()[0] ?? null;
  }

  static async connect(options: {
    cdpEndpoint: string;
    storageSeed?: Record<string, string>;
    originsAllowlist?: string[];
    viewport?: { width: number; height: number };
    locale?: string;
    timezoneId?: string;
    actionTimeoutMs?: number;
  }): Promise<PlaywrightProvider> {
    const { browser, context } = await attach(options.cdpEndpoint);
    const provider = new PlaywrightProvider(
      browser,
      context,
      options.originsAllowlist ?? [],
    );
    if (options.actionTimeoutMs !== undefined) {
      provider.actionTimeoutMs = options.actionTimeoutMs;
    }

    // SPA 上下文引导同样需要作用于「复用的用户 context」中由我们新建的页：
    // 用户已有 context 不能加 init script 干扰其登录态，因此 seed 只在隔离 context 使用，
    // 这里保留默认 seed 供 openIsolatedPage 复用。
    if (options.storageSeed) provider.defaultSeed = options.storageSeed;
    provider.isolationOptions = {
      ...(options.viewport ? { viewport: options.viewport } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.timezoneId ? { timezoneId: options.timezoneId } : {}),
    };
    return provider;
  }

  private defaultSeed?: Record<string, string>;
  private isolationOptions: {
    viewport?: { width: number; height: number };
    locale?: string;
    timezoneId?: string;
  } = {};

  activePage(): Page {
    if (!this.active) throw new Error('no active page');
    return this.active;
  }

  private trackPage(page: Page): Page {
    this.ownedPages.add(page);
    page.on('close', () => {
      this.ownedPages.delete(page);
      if (this.active === page) this.active = null;
    });
    return page;
  }

  /** 在复用的用户 context 中以前台标签页打开（会获得焦点 —— 前台执行臂）。 */
  async openForegroundTab(url: string): Promise<Page> {
    if (!isOriginAllowed(url, this.originsAllowlist)) {
      throw new Error(`origin not in allowlist: ${url}`);
    }
    const page = this.trackPage(await this.userContext.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    this.active = page;
    return page;
  }

  /** 后台标签页打开（不抢焦点）。 */
  async openBackgroundTab(url: string): Promise<BackgroundTab> {
    if (!isOriginAllowed(url, this.originsAllowlist)) {
      throw new Error(`origin not in allowlist: ${url}`);
    }
    const tab = await openBackgroundTab(this.userContext, url);
    this.backgroundTabs.push(tab);
    return tab;
  }

  /** 强隔离 context 中打开页面；storageSeed 键名由 SUT 适配提供。 */
  async openIsolatedPage(
    url: string,
    seed?: Record<string, string>,
  ): Promise<Page> {
    if (!isOriginAllowed(url, this.originsAllowlist)) {
      throw new Error(`origin not in allowlist: ${url}`);
    }
    const context = await newIsolatedContext(this.browser, {
      ...this.isolationOptions,
      ...(seed ?? this.defaultSeed ? { storageSeed: seed ?? this.defaultSeed } : {}),
    });
    this.ownedContexts.add(context);
    const page = this.trackPage(await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    this.active = page;
    return page;
  }

  // ---------------------------------------------------------------- EngineProvider

  async resolve(target: SemanticTarget, mode: ResolveMode): Promise<ResolveResult> {
    const page = this.activePage();
    if (mode === 'L3') {
      // L3 候选枚举（模糊语义匹配 + registry 登记）由 Task 14 e2e 集成交付；
      // 当前明确返回空候选，绝不在引擎侧伪装 resolved（决策只能由编排层发起）。
      return { status: 'miss', candidates: [] };
    }
    if (mode === 'L2') return this.resolveByFingerprint(page, target);

    const exact = target.match !== 'substring';

    // Issue #25：多通道按序尝试（role > label > name > placeholder > text）。
    // 单通道 if/else 会「label 未命中即判死」，而 fill 目标的 label 通道与 text
    // 通道本就互为兜底；命中多个仍走 ambiguous（铁律 6：禁 .first() 兜底，
    // 也不换通道绕过歧义）。
    const attempts: Array<{ locator: () => Locator; strategy: ResolvedTarget['strategy'] }> = [];
    if (target.role) {
      const accessibleName = target.name ?? target.label ?? target.text;
      attempts.push({
        locator: () =>
          page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
            ...(accessibleName ? { name: accessibleName } : {}),
            exact,
          }),
        strategy: 'role',
      });
    }
    if (target.label) {
      attempts.push({
        locator: () => page.getByLabel(target.label!, { exact }),
        strategy: 'label',
      });
    }
    if (target.name && target.name !== target.label) {
      attempts.push({
        locator: () => page.getByLabel(target.name!, { exact }),
        strategy: 'label',
      });
    }
    if (target.placeholder) {
      attempts.push({
        locator: () => page.getByPlaceholder(target.placeholder!, { exact }),
        strategy: 'placeholder',
      });
    }
    if (target.text) {
      attempts.push({
        locator: () => page.getByText(target.text!, { exact }),
        strategy: 'text',
      });
    }
    if (attempts.length === 0) return { status: 'miss' };

    for (const attempt of attempts) {
      const locator = attempt.locator();
      const count = await locator.count();
      if (count === 0) continue;
      if (count > 1) return { status: 'ambiguous', count }; // ★ 禁 .first() 兜底
      const elementId = await this.registerResolved(page, locator);
      return { status: 'resolved', mode: 'L1', elementId, strategy: attempt.strategy };
    }
    return { status: 'miss' };
  }

  /** 解析登记：分配 elementId 并捕获节点身份锚点（Freshness 用，捕获失败仅降级为戳比对）。 */
  private async registerResolved(page: Page, locator: Locator): Promise<string> {
    const elementId = `el-${++this.elementSeq}`;
    const handle = (await locator
      .elementHandle({ timeout: 2_000 })
      .catch(() => null)) as unknown as NodeAnchor | null;
    if (handle) {
      if (!this.lastObservationId) {
        this.lastObservationId = `obs-${Date.now()}`;
      }
      const obsId = this.lastObservationId;
      await (handle as unknown as { evaluate: (fn: (el: any, id: string) => void, arg: string) => Promise<void> })
        .evaluate((el: any, id: string) => {
          el.setAttribute('data-observation-id', id);
        }, obsId)
        .catch(() => null);
    }
    this.elementRegistry.set(elementId, {
      page,
      locator,
      ...(handle !== null ? { handle } : {}),
    });
    return elementId;
  }

  /**
   * 枚举当前页全部可交互元素的原始指纹。
   * 每次调用重新盖章 data-idwth-l2（唯一 token），保证 Locator 可稳定重定位。
   */
  private async enumerateFingerprints(page: Page): Promise<RawFingerprint[]> {
    return page.evaluate((): RawFingerprint[] => {
      const doc = (globalThis as unknown as { document: any }).document;
      const interactive =
        'button,a,input,select,textarea,[role],[onclick],summary';
      const all = Array.from(doc.querySelectorAll(interactive)) as any[];

      return all.map((el, i) => {
        // DOM 路径：从元素向上收集「标签 + 同级序号」，反转后从根排列（最多 10 层）。
        const reversed: string[] = [];
        let node: any = el;
        let depth = 0;
        while (node && node.nodeType === 1 && depth < 10) {
          const parent = node.parentElement;
          let ordinal = 0;
          if (parent) {
            const sameTag = Array.from(parent.children).filter(
              (c: any) => c.tagName === node.tagName,
            );
            ordinal = sameTag.indexOf(node);
          }
          reversed.push(
            `${node.tagName.toLowerCase()}${sameTagCount(node)}${ordinal}`,
          );
          node = parent;
          depth += 1;
        }
        const path = reversed.reverse().join('>');

        // 锚文本：沿祖先链收集稳定的 label 类容器文本（legend/h1-5/label/th/aria-label）。
        const anchors: string[] = [];
        let anc: any = el.parentElement;
        let up = 0;
        while (anc && up < 6 && anchors.length < 4) {
          const aria = anc.getAttribute?.('aria-label');
          if (aria && aria.trim()) anchors.push(aria.trim().slice(0, 40));
          const tag = anc.tagName;
          if (tag === 'LABEL' || tag === 'TH' || /^H[1-5]$/.test(tag)) {
            const t = (anc.innerText ?? anc.textContent ?? '').trim().slice(0, 40);
            if (t && !anchors.includes(t)) anchors.push(t);
          }
          // 分组锚（如 legend）常是容器祖先的子元素、而非目标自身的祖先：
          // 典型结构 fieldset > legend + nav > a。向分组容器内查询一次。
          if (
            tag === 'FIELDSET' || tag === 'SECTION' ||
            tag === 'FORM' || tag === 'BODY'
          ) {
            const group = anc.querySelector('legend,h1,h2,h3,h4,h5,th');
            if (group) {
              const t = (group.innerText ?? group.textContent ?? '').trim().slice(0, 40);
              if (t && !anchors.includes(t)) anchors.push(t);
            }
          }
          anc = anc.parentElement;
          up += 1;
        }

        const token = `l2-${i}-${Date.now()}`;
        el.setAttribute('data-idwth-l2', token);
        return {
          token,
          path,
          siblingOrdinal: siblingOrdinalOf(el),
          anchorText: dedupe(anchors),
        };
      });

      // 同级序号：元素在父节点 element children 中的位置。
      function siblingOrdinalOf(el: any): number {
        const parent = el.parentElement;
        if (!parent) return 0;
        return Array.from(parent.children).indexOf(el);
      }
      // 路径段中的同名兄弟总数，增强路径唯一性。
      function sameTagCount(node: any): string {
        const parent = node.parentElement;
        if (!parent) return '';
        const n = Array.from(parent.children).filter(
          (c: any) => c.tagName === node.tagName,
        ).length;
        return n > 1 ? `:nth-of-type` : '';
      }
      function dedupe(list: string[]): string[] {
        return list.filter((v, i) => list.indexOf(v) === i);
      }
    });
  }

  /** L2：指纹三件套全等才命中；命中多个 → ambiguous；未命中 → miss。 */
  private async resolveByFingerprint(
    page: Page,
    target: SemanticTarget,
  ): Promise<ResolveResult> {
    const wanted = target.fingerprint;
    if (!wanted) return { status: 'miss' };

    const raws = await this.enumerateFingerprints(page);
    const matches = raws.filter((r) =>
      fingerprintsEqual(
        {
          dom_path_hash: hashDomPath(r.path),
          sibling_ordinal: r.siblingOrdinal,
          anchor_text: r.anchorText,
        },
        wanted,
      ),
    );

    if (matches.length === 0) return { status: 'miss' };
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };

    const raw = matches[0]!;
    const locator = page.locator(`[data-idwth-l2="${raw.token}"]`);
    const elementId = await this.registerResolved(page, locator);
    return {
      status: 'resolved',
      mode: 'L2',
      elementId,
      strategy: 'fingerprint',
    };
  }

  /**
   * 创作期辅助：按真实页面捕获一个元素的冻结指纹（三件套）。
   * 仅用于工具链生成/校验 Frozen Strategy；选择器是创作输入，不进入 Runtime Contract。
   */
  async captureFingerprint(cssSelector: string): Promise<ElementFingerprint> {
    const page = this.activePage();
    const raws = await this.enumerateFingerprints(page);
    const targetToken = await page
      .locator(cssSelector)
      .first()
      .getAttribute('data-idwth-l2')
      .catch(() => null);
    const raw = raws.find((r) => r.token === targetToken);
    if (!raw) throw new Error(`no fingerprint for selector: ${cssSelector}`);
    return {
      dom_path_hash: hashDomPath(raw.path),
      sibling_ordinal: raw.siblingOrdinal,
      anchor_text: raw.anchorText,
    };
  }

  /**
   * Freshness 原语（§5.5.6）：校验 resolved 元素是否仍是最近一次观测中的节点。
   * 作用域限定目标节点，子树外动态校验行不参与判断。
   *
   * 身份锚点优先：resolve 时刻的 ElementHandle 仍连接（未被替换/分离）且携带
   * 当前观测戳才算新鲜 —— cloneNode 等属性复制式替换只改 DOM 身份、不改属性，
   * 仅靠戳比对会把克隆节点误判为原节点；必须锚定具体 DOM 节点。
   */
  async verifyFreshness(
    _target: SemanticTarget,
    resolved: ResolveResult,
  ): Promise<boolean> {
    const entry = resolved.elementId
      ? this.elementRegistry.get(String(resolved.elementId))
      : undefined;
    if (!entry || !this.lastObservationId) return false;

    if (entry.handle) {
      // 元素被替换（分离）时 locator 查询默认会自动等待 30s；
      // Freshness 是廉价只读校验，统一给短超时，分离/失效立即视为不新鲜。
      const state = await entry.handle
        .evaluate((el) => ({
          connected: el.isConnected,
          stamp: el.getAttribute('data-observation-id'),
        }))
        .catch(() => null);
      if (state === null) return false; // 句柄失效（导航/上下文销毁）→ 不新鲜
      return state.connected && state.stamp === this.lastObservationId;
    }

    // 回退：登记时未捕获到身份锚点（极端竞态）→ 仅比对戳。
    const current = await entry.locator
      .getAttribute('data-observation-id', { timeout: 2_000 })
      .catch(() => null);
    return current === this.lastObservationId;
  }

  /**
   * §3.5 / §8.1 派发与 8 态结果。
   * 关键安全语义：结果必须回答「mutation 是否已经发出去」（dispatched）。
   * 派发前的 actionability 失败（遮挡/禁用/分离）一定 dispatched=false，可恢复；
   * 派发后回执超时（如同步阻塞渲染线程）事件可能已生效，必须 dispatched=true，
   * Runtime 据此禁止任何自动重试（TR-6.2）。
   */
  async act(action: Action): Promise<ActionResult> {
    if (this.disposed) {
      return {
        kind: action.kind,
        status: 'error',
        dispatched: false,
        message: 'provider disposed',
      };
    }

    switch (action.kind) {
      case 'navigate': {
        // 越界源：返回结构化结果（不抛异常），Runtime → BLOCKED(env)，零派发。
        if (!isOriginAllowed(action.url, this.originsAllowlist)) {
          return {
            kind: 'navigate',
            status: 'nav_blocked',
            dispatched: false,
            url: action.url,
          };
        }
        try {
          const page = this.active ?? this.trackPage(await this.userContext.newPage());
          await page.goto(action.url, {
            waitUntil: 'domcontentloaded',
            timeout: this.actionTimeoutMs,
          });
          this.active = page;
          this.lastObservationId = `obs-${Date.now()}`;
          return { kind: 'navigate', status: 'ok', dispatched: true };
        } catch (err) {
          return {
            kind: 'navigate',
            status: 'error',
            dispatched: true,
            message: errorMessage(err),
          };
        }
      }
      case 'click':
      case 'fill':
      case 'select': {
        let entry: { page: Page; locator: Locator };
        try {
          entry = this.resolveElement(action.target);
        } catch (err) {
          return {
            kind: action.kind,
            status: 'not_found',
            dispatched: false,
            reason: errorMessage(err),
          };
        }
        try {
          const timeout = this.actionTimeoutMs;
          if (action.kind === 'click') {
            await entry.locator.click({ timeout });
          } else if (action.kind === 'fill') {
            await entry.locator.fill(action.value, { timeout });
          } else {
            await entry.locator.selectOption(action.value, { timeout });
          }
          return { kind: action.kind, status: 'ok', dispatched: true };
        } catch (err) {
          return classifyActionError(action.kind, err, this.actionTimeoutMs);
        }
      }
      case 'scroll': {
        try {
          await this.activePage().mouse.wheel(0, action.deltaY);
          return { kind: 'scroll', status: 'ok', dispatched: true };
        } catch (err) {
          return {
            kind: 'scroll',
            status: 'error',
            dispatched: false,
            message: errorMessage(err),
          };
        }
      }
      case 'wait': {
        await this.activePage().waitForTimeout(action.ms);
        return { kind: 'wait', status: 'ok', dispatched: false };
      }
      case 'assert_only':
        // 纯断言步：无浏览器动作，统一 ok / 非派发。
        return { kind: 'assert_only', status: 'ok', dispatched: false };
      case 'done':
        return { kind: 'done', status: 'ok', dispatched: false };
    }
  }

  async checkAssertion(spec: AssertionSpec): Promise<AssertionResult> {
    if (spec.kind === 'url') {
      const actual = this.activePage().url();
      const passed = spec.expected === undefined || actual === String(spec.expected);
      return { kind: 'url', passed, status: passed ? 'passed' : 'failed', actual };
    }

    if (!spec.target) {
      return {
        kind: spec.kind,
        passed: false,
        status: 'inconclusive',
        blockedReason: 'decision',
        message: 'assertion requires a target',
      };
    }

    const resolved = await this.resolve(spec.target, 'L1');
    if (resolved.status === 'miss') {
      if (spec.kind === 'absent') {
        return { kind: 'absent', passed: true, status: 'passed' };
      }
      return { kind: spec.kind, passed: false, status: 'failed' };
    }
    if (resolved.status === 'ambiguous') {
      const allowMultiple = spec.allow_multiple === true || spec.target.allow_multiple === true;
      if (spec.kind === 'count' || allowMultiple) {
        // count 断言天然处理多匹配；其余原语仅在显式 allow_multiple 时放行。
      } else {
        return {
          kind: spec.kind,
          passed: false,
          status: 'inconclusive',
          blockedReason: 'ambiguity',
          message: `ambiguous match: ${resolved.count} candidates`,
        };
      }
    }

    const elementId = resolved.elementId;
    const locator = elementId
      ? (this.elementRegistry.get(String(elementId))?.locator ?? null)
      : null;
    if (!locator) {
      return {
        kind: spec.kind,
        passed: false,
        status: 'inconclusive',
        blockedReason: 'decision',
      };
    }

    switch (spec.kind) {
      case 'visible': {
        const passed = await locator.isVisible();
        return { kind: 'visible', passed, status: passed ? 'passed' : 'failed' };
      }
      case 'absent': {
        const visible = await locator.isVisible().catch(() => false);
        return { kind: 'absent', passed: !visible, status: visible ? 'failed' : 'passed' };
      }
      case 'count': {
        const actual = await locator.count();
        const passed = spec.expected === undefined || actual === Number(spec.expected);
        return { kind: 'count', passed, status: passed ? 'passed' : 'failed', actual };
      }
      case 'value': {
        const actual = await locator.inputValue().catch(() => null);
        const passed = actual === spec.expected;
        return { kind: 'value', passed, status: passed ? 'passed' : 'failed', actual };
      }
      case 'checked': {
        const actual = await locator.isChecked().catch(() => false);
        const passed = spec.expected === undefined ? actual : actual === Boolean(spec.expected);
        return { kind: 'checked', passed, status: passed ? 'passed' : 'failed', actual };
      }
      case 'number': {
        const raw = await locator.textContent().catch(() => null);
        const actual = raw === null ? Number.NaN : Number(raw.trim());
        const passed = Number.isFinite(actual) && actual === Number(spec.expected);
        return { kind: 'number', passed, status: passed ? 'passed' : 'failed', actual };
      }
      default:
        return {
          kind: spec.kind,
          passed: false,
          status: 'inconclusive',
          blockedReason: 'decision',
          message: `unsupported assertion kind: ${spec.kind}`,
        };
    }
  }

  async observe(): Promise<Observation> {
    const page = this.activePage();

    // 注意：回调运行在浏览器上下文；工程 tsconfig 不引入 dom lib，这里以 any 规避静态类型。
    interface RawObserved {
      id: number;
      role: string;
      name: string;
      text: string;
      visible: boolean;
      enabled: boolean;
      guardInput: number;
    }
    const raw = await page.evaluate((): { obsId: string; records: RawObserved[] } => {
      const doc = (globalThis as unknown as { document: any }).document;
      const interactiveSelector =
        'button,a,input,select,textarea,[role],[onclick],summary';
      const obsId = `obs-${Date.now()}`;
      // 交互元素 ∪ 直接文本元素：dom 断言目标常是非交互文本节点
      // （toast/状态栏/表格单元格，如「部署完成」），只枚举交互元素会让
      // judge 的 visible/absent 断言无证据可评（诚实归档要求证据完整）。
      const TEXT_SKIP = new Set([
        'script', 'style', 'noscript', 'template', 'br', 'head', 'title', 'meta', 'link',
      ]);
      const seen = new Set(Array.from(doc.querySelectorAll(interactiveSelector)) as any[]);
      const textOnly: any[] = [];
      for (const el of (doc.body ? doc.body.querySelectorAll('*') : []) as any[]) {
        if (textOnly.length >= 400) break; // 大页面证据上限，防观测爆炸
        if (seen.has(el) || TEXT_SKIP.has(el.tagName.toLowerCase())) continue;
        const hasDirectText = Array.from(el.childNodes).some(
          (n: any) => n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0,
        );
        if (hasDirectText) textOnly.push(el);
      }
      const all = [...seen, ...textOnly];
      const records = all.map((el: any, i: number) => {
        const type = el.getAttribute('type') ?? el.tagName.toLowerCase();
        const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
        const skipValue = isInput && ['password', 'file', 'hidden'].includes(type);
        return {
          id: i,
          role:
            el.getAttribute('role') ??
            (el.tagName === 'A'
              ? 'link'
              : type === 'submit'
                ? 'button'
                : el.tagName.toLowerCase()),
          name:
            el.getAttribute('aria-label') ??
            el.placeholder ??
            el.innerText?.trim().slice(0, 80) ??
            '',
          text: skipValue ? '' : (el.innerText ?? '').trim().slice(0, 120),
          visible:
            el.offsetParent !== null || el.getClientRects().length > 0,
          enabled: !el.disabled,
          guardInput: el.outerHTML.length,
        };
      });
      // §5.5.6 Freshness 基准：观测时给全部观测元素盖 data-observation-id 戳，
      // verifyFreshness 据此判断 resolved 元素是否仍在最近一次观测中。
      for (const el of all) {
        el.setAttribute('data-observation-id', obsId);
      }
      return { obsId, records };
    });

    const bodyText = await page.evaluate(
      () => (globalThis as unknown as { document: any }).document.body.innerText.slice(0, 4000),
    );
    const observationId = raw.obsId;
    this.lastObservationId = observationId;
    return {
      observationId,
      fingerprint: sha1(bodyText),
      url: page.url(),
      title: await page.title(),
      elements: raw.records.map((r) => ({
        id: r.id,
        role: r.role,
        name: r.name,
        text: r.text,
        visible: r.visible,
        enabled: r.enabled,
        guard: sha1(`guard:${r.id}:${r.guardInput}`),
      })),
      textExcerpt: bodyText,
    };
  }

  async screenshot(options: ScreenshotOptions): Promise<ArtifactRef> {
    const page = this.activePage();
    // 第一层遮罩：密码/文件/隐藏输入控件（Task 8 增加文本级密钥遮罩）。
    const masked = page.locator(
      'input[type="password"],input[type="file"],input[type="hidden"]',
    );
    const buffer = await page.screenshot({
      fullPage: true,
      mask: [...options.mask].length
        ? options.mask.map((sel) => page.locator(sel))
        : await masked.count().then((n) =>
            n > 0
              ? [
                  page.locator(
                    'input[type="password"],input[type="file"],input[type="hidden"]',
                  ),
                ]
              : [],
          ),
    });

    const dir = path.join(TMP_DIR, 'screenshots');
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${buffer.length}.png`;
    const filePath = path.join(dir, fileName);
    await writeFile(filePath, buffer);
    return { uri: `artifact://${filePath}`, mediaType: 'image/png' };
  }

  async trace(): Promise<ArtifactRef> {
    const dir = path.join(TMP_DIR, 'traces');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}.zip`);

    // 在用户 context 上立即开始并停止一段 trace，得到可打开的 trace 包。
    await this.userContext.tracing.start({ screenshots: true, snapshots: true }).catch(
      () => undefined,
    );
    await this.userContext.tracing.stop({ path: filePath }).catch(() => undefined);

    return { uri: `artifact://${filePath}`, mediaType: 'application/zip' };
  }

  /**
   * ★ TR-4.2：只断连，不杀用户浏览器。
   * 清理我们自己创建的页面与隔离 context；用户原有标签页、Chrome 进程、CDP 端点均存活。
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    for (const tab of this.backgroundTabs) {
      await tab.close().catch(() => undefined);
    }
    for (const page of this.ownedPages) {
      await page.close().catch(() => undefined);
    }
    for (const context of this.ownedContexts) {
      await context.close().catch(() => undefined);
    }
    for (const entry of this.elementRegistry.values()) {
      await entry.handle?.dispose().catch(() => undefined); // 释放节点身份锚点
    }
    this.elementRegistry.clear();
    await detach(this.browser);
  }

  private resolveElement(target: ResolvedTarget): { page: Page; locator: Locator } {
    const entry = this.elementRegistry.get(String(target.elementId));
    if (!entry) throw new Error(`unknown elementId: ${String(target.elementId)}`);
    return entry;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 把 Playwright 动作异常映射到 ActionResult 8 态（§3.5 唯一映射表）。
 *
 * 顺序敏感：
 *  1) 「拦截指针事件」是 actionability 阶段命中的遮挡 —— 事件尚未派发 → covered / dispatched=false；
 *  2) 「元素被禁用」→ disabled（派发前）；
 *  3) 「元素分离/已不在 DOM」→ not_found（派发前）；
 *  4) 其余 TimeoutError（含事件已发出、回执因渲染线程阻塞等原因超时）
 *     —— 无法证明未生效，保守 dispatched=true → timeout，禁止自动重试；
 *  5) 其余异常 → error，同样保守 dispatched=true。
 */
function classifyActionError(
  kind: 'click' | 'fill' | 'select',
  err: unknown,
  deadlineMs: number,
): ActionResult {
  const message = errorMessage(err);

  if (/intercepts pointer events/i.test(message)) {
    return { kind, status: 'covered', dispatched: false, by: 'intercepting element' };
  }
  if (/element (is )?(not )?(enabled|disabled)|toBeEnabled/i.test(message)) {
    return { kind, status: 'disabled', dispatched: false };
  }
  if (/element is not attached to the (dom|document)|no longer( matches)?|frame was detached/i.test(message)) {
    return { kind, status: 'not_found', dispatched: false, reason: message };
  }

  const isTimeout =
    (err as { name?: string } | null)?.name === 'TimeoutError' ||
    /timeout of \d+ms? exceeded|timed? ?out/i.test(message);
  if (isTimeout) {
    return { kind, status: 'timeout', dispatched: true, deadlineMs };
  }

  return { kind, status: 'error', dispatched: true, message };
}
