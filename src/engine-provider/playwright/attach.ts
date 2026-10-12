import { chromium, type Browser, type BrowserContext } from 'playwright';

/**
 * §5.5.2 attach.ts —— CDP 接管既有 Chrome（主干执行臂）。
 * 复用用户浏览器的既有 context（从而复用登录态），绝不 launch 新浏览器。
 */

export interface AttachOptions {
  timeoutMs?: number;
}

export async function attach(
  endpoint: string,
  options: AttachOptions = {},
): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.connectOverCDP(endpoint, {
    timeout: options.timeoutMs ?? 15_000,
  });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => undefined);
    throw new Error(
      'no existing browser context: 需要带 --remote-debugging-port 启动且至少有一个标签页的 Chrome',
    );
  }
  return { browser, context };
}

/**
 * ★ 只断连：connectOverCDP 下 browser.close() 等价于 disconnect，
 * 不会关闭用户浏览器，CDP 端点继续存活（P0 实测 3/3 复核，TR-4.2）。
 */
export async function detach(browser: Browser): Promise<void> {
  await browser.close();
}

/** 源（scheme + host[:port]）相等性校验；navigate 必须过 allowlist。 */
export function isOriginAllowed(url: string, allowlist: readonly string[]): boolean {
  let candidate: URL;
  try {
    candidate = new URL(url);
  } catch {
    return false;
  }
  return allowlist.some((entry) => {
    try {
      const allowed = new URL(entry);
      return candidate.origin === allowed.origin;
    } catch {
      return false;
    }
  });
}
