import type { BrowserContext, Page } from 'playwright';

/**
 * §5.5.3 background-tab.ts —— 后台标签页执行，不抢焦点。
 *
 * 关键手法：
 *  1) 先通过 CDP Target.createTarget({ background: true }) 得到一个后台 target；
 *  2) 用 context.pages() / waitForEvent('page') 找到对应 Playwright Page；
 *  3) Emulation.setFocusEmulationEnabled 让后台页保持正常渲染与计时。
 *
 * 上游 e2e 引擎不提供这件，两种实现（playwright / e2e）都必须复用本模块。
 */

export interface BackgroundTab {
  page: Page;
  targetId?: string;
  close: () => Promise<void>;
}

export async function openBackgroundTab(
  context: BrowserContext,
  url: string,
): Promise<BackgroundTab> {
  // ① 后台创建 target（不激活用户正在看的标签页）。
  const existing = new Set<Page>(context.pages());

  // 以任意一个已有 page 作为 CDP session 载体。
  const carrier = context.pages()[0];
  if (!carrier) throw new Error('background tab requires an existing page in context');
  const cdp = await context.newCDPSession(carrier);

  const { targetId } = await cdp.send('Target.createTarget', {
    url,
    background: true,
    newWindow: false,
  });

  // ② 等待新 page 出现在 context 中。
  let page = context.pages().find((p) => !existing.has(p));
  if (!page) {
    page = await context.waitForEvent('page', { timeout: 15_000 });
  }

  // ③ 关闭焦点模拟：后台页仍正常渲染与计时。
  const pageCdp = await context.newCDPSession(page);
  await pageCdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(
    () => undefined,
  );

  await page.waitForLoadState('domcontentloaded').catch(() => undefined);

  return {
    page,
    targetId,
    close: async () => {
      await page.close().catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      await pageCdp.detach().catch(() => undefined);
    },
  };
}
