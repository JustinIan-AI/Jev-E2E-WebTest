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
  type ResolveResult,
  type ResolvedTarget,
  type SemanticTarget,
  type ScreenshotOptions,
} from '../types.js';
import { attach, detach, isOriginAllowed } from './attach.js';
import { openBackgroundTab, type BackgroundTab } from './background-tab.js';
import { newIsolatedContext } from './isolation.js';
import { TMP_DIR } from '../../cli/paths.js';

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

  /** 元素注册表：elementId → { page, locator }；id 由代码生成，不来自模型。 */
  private readonly elementRegistry = new Map<string, { page: Page; locator: Locator }>();
  private elementSeq = 0;

  /** Provider 打开的页面/隔离 context，dispose 时清理（用户原有页面不动）。 */
  private readonly ownedPages = new Set<Page>();
  private readonly ownedContexts = new Set<BrowserContext>();
  private readonly backgroundTabs: BackgroundTab[] = [];

  private active: Page | null;
  private disposed = false;

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
  }): Promise<PlaywrightProvider> {
    const { browser, context } = await attach(options.cdpEndpoint);
    const provider = new PlaywrightProvider(
      browser,
      context,
      options.originsAllowlist ?? [],
    );

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

  async resolve(target: SemanticTarget, mode: 'L1' | 'L2'): Promise<ResolveResult> {
    const page = this.activePage();
    // Task 4 只实现 L1（ARIA role / label / text）；L2 指纹在 Task 5。
    if (mode === 'L2') return { status: 'miss' };

    const exact = target.match !== 'substring';
    let locator: Locator;
    let strategy: ResolvedTarget['strategy'];
    if (target.role) {
      const accessibleName = target.name ?? target.text;
      locator = page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
        ...(accessibleName ? { name: accessibleName } : {}),
        exact,
      });
      strategy = 'role';
    } else if (target.label) {
      locator = page.getByLabel(target.label, { exact });
      strategy = 'label';
    } else if (target.text) {
      locator = page.getByText(target.text, { exact });
      strategy = 'text';
    } else {
      return { status: 'miss' };
    }

    const count = await locator.count();
    if (count === 0) return { status: 'miss' };
    if (count > 1) return { status: 'ambiguous', count }; // ★ 禁 .first() 兜底

    const elementId = `el-${++this.elementSeq}`;
    this.elementRegistry.set(elementId, { page, locator });
    return { status: 'resolved', mode: 'L1', elementId, strategy };
  }

  async act(action: Action): Promise<ActionResult> {
    if (this.disposed) {
      return { kind: action.kind, status: 'blocked', dispatched: false };
    }

    switch (action.kind) {
      case 'navigate': {
        if (!isOriginAllowed(action.url, this.originsAllowlist)) {
          throw new Error(`origin not in allowlist: ${action.url}`);
        }
        const page = this.active ?? this.trackPage(await this.userContext.newPage());
        await page.goto(action.url, { waitUntil: 'domcontentloaded' });
        this.active = page;
        return { kind: 'navigate', status: 'success', dispatched: true };
      }
      case 'click':
      case 'fill':
      case 'select': {
        const entry = this.resolveElement(action.target);
        if (action.kind === 'click') {
          await entry.locator.click();
        } else if (action.kind === 'fill') {
          await entry.locator.fill(action.value);
        } else {
          await entry.locator.selectOption(action.value);
        }
        return { kind: action.kind, status: 'success', dispatched: true };
      }
      case 'scroll': {
        await this.activePage().mouse.wheel(0, action.deltaY);
        return { kind: 'scroll', status: 'success', dispatched: true };
      }
      case 'wait': {
        await this.activePage().waitForTimeout(action.ms);
        return { kind: 'wait', status: 'success', dispatched: false };
      }
      case 'assert_only':
        return { kind: 'assert_only', status: 'skipped', dispatched: false };
      case 'done':
        return { kind: 'done', status: 'success', dispatched: false };
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
    const records = await page.evaluate((): RawObserved[] => {
      const doc = (globalThis as unknown as { document: any }).document;
      const selector =
        'button,a,input,select,textarea,[role],[onclick],summary';
      return Array.from(doc.querySelectorAll(selector)).map((el: any, i: number) => {
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
    });

    const bodyText = await page.evaluate(
      () => (globalThis as unknown as { document: any }).document.body.innerText.slice(0, 4000),
    );
    const observationId = `obs-${Date.now()}`;
    return {
      observationId,
      fingerprint: sha1(bodyText),
      url: page.url(),
      title: await page.title(),
      elements: records.map((r) => ({
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
    this.elementRegistry.clear();
    await detach(this.browser);
  }

  private resolveElement(target: ResolvedTarget): { page: Page; locator: Locator } {
    const entry = this.elementRegistry.get(String(target.elementId));
    if (!entry) throw new Error(`unknown elementId: ${String(target.elementId)}`);
    return entry;
  }
}
