/**
 * Task 8 — 截图两层遮罩（详设 §5.5.8）。
 *
 * 第一层：Playwright 原生 mask，覆盖一切输入/可编辑/显式私有控件，
 *         连同控件渲染值一并打码（input[type=password] 等）。
 * 第二层：文本级遮罩。kubeconfig / Bearer 等若被页面渲染成普通文本（非 input），
 *         原生 mask 选择器无法命中；先 page.evaluate 注入 TreeWalker(SHOW_TEXT)
 *         脚本，把命中已知明文的 Text 节点替换为黑底黑字 data-redacted span，再截图。
 *
 * 顺序必须是「先文本遮罩、后 screenshot」。
 */
import type { Page } from 'playwright';
import { buildTextMaskScript } from '../../runtime/redaction.js';

/** 第一层遮罩选择器（§5.5.8 骨架 + §9.4 的 password/file/hidden）。 */
export const MASK_INPUT_SELECTOR = [
  // §9.4：敏感类型输入控件显式列出，避免仅靠裸 input 的隐式覆盖。
  'input[type="password"]',
  'input[type="file"]',
  'input[type="hidden"]',
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable]',
  '[data-private]',
].join(', ');

export interface MaskedScreenshotOptions {
  fullPage?: boolean;
}

export interface MaskedScreenshotResult {
  mediaType: 'image/png';
  buffer: Buffer;
  /** 第二层遮罩命中的文本节点数。 */
  redactedTextNodes: number;
}

export async function captureMaskedScreenshot(
  page: Page,
  secrets: readonly string[],
  options: MaskedScreenshotOptions = {},
): Promise<MaskedScreenshotResult> {
  // 第二层：渲染文本中的已知明文（非控件）先遮。
  const redactedTextNodes = (await page.evaluate(buildTextMaskScript(secrets))) as number;

  // 第一层：输入控件原生 mask。
  const buffer = await page.screenshot({
    fullPage: options.fullPage ?? true,
    mask: [page.locator(MASK_INPUT_SELECTOR)],
  });

  return { mediaType: 'image/png', buffer, redactedTextNodes };
}
