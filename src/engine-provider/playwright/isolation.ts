import type { Browser, BrowserContext, Cookie } from 'playwright';

/**
 * §5.5.4 isolation.ts —— 强隔离 + SPA 上下文引导。
 *
 * 每 case newContext() 强隔离（不共享用户 cookie/缓存）。
 * openFuyao 实测：集群身份只存在 sessionStorage，登录时才选集群 ——
 * 因此在 context 创建后、任何页面脚本执行前用 addInitScript 注入 storageSeed。
 *
 * ★ storageSeed 的具体键由 SUT 适配提供（openFuyao 是 { cluster: 'host' }），
 *   core 不假定任何键名。
 */

export interface IsolationOptions {
  storageSeed?: Record<string, string>;
  cookies?: Cookie[];
  locale?: string;
  timezoneId?: string;
  viewport?: { width: number; height: number };
}

export async function newIsolatedContext(
  browser: Browser,
  opts: IsolationOptions = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
  });

  if (opts.storageSeed && Object.keys(opts.storageSeed).length > 0) {
    // 在每个文档的任何脚本执行前写入键值。
    // 回调运行在浏览器上下文（工程不引入 dom lib），以 any 规避静态类型。
    await context.addInitScript((seed: Record<string, string>) => {
      const w = globalThis as unknown as {
        sessionStorage: { setItem: (k: string, v: string) => void };
      };
      for (const [k, v] of Object.entries(seed)) {
        w.sessionStorage.setItem(k, String(v));
      }
    }, opts.storageSeed);
  }

  if (opts.cookies && opts.cookies.length > 0) {
    await context.addCookies(opts.cookies);
  }

  return context;
}
