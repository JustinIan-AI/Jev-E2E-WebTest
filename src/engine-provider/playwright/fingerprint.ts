/**
 * §3.3 / §5.5.5 L2 指纹工具。
 *
 * 指纹三件套：dom_path_hash（DOM 路径的 sha1）+ sibling_ordinal（同级序号）
 * + anchor_text[]（锚文本）。role/name 不参与相等性 —— L2 正是用于名称已漂移
 * 的场景。"误命中比不命中更危险"，三件套必须全等才判命中。
 */
import { createHash } from 'node:crypto';

/** 指纹形状（与 SemanticTarget.fingerprint、strategy.schema.json 对齐）。 */
export interface ElementFingerprint {
  role?: string;
  name?: string;
  dom_path_hash: string;
  sibling_ordinal: number;
  anchor_text: string[];
}

/**
 * 将 DOM 路径段拼接为稳定的路径字符串（dom_path_hash 的输入约定）。
 * 例：['section0', 'nav0', 'a2'] → 'section0>nav0>a2'
 */
export function composeDomPath(segments: readonly string[]): string {
  return segments.join('>');
}

/** 计算路径的 sha1 指纹，统一 `sha1:<hex>` 前缀。 */
export function hashDomPath(path: string): string {
  return `sha1:${createHash('sha1').update(path, 'utf8').digest('hex')}`;
}

/**
 * 指纹相等性：仅比较 dom_path_hash + sibling_ordinal + anchor_text。
 * anchor_text 为有序数组，顺序与元素均须一致；role/name 一律忽略。
 */
export function fingerprintsEqual(
  a: ElementFingerprint,
  b: ElementFingerprint,
): boolean {
  if (a.dom_path_hash !== b.dom_path_hash) return false;
  if (a.sibling_ordinal !== b.sibling_ordinal) return false;
  if (a.anchor_text.length !== b.anchor_text.length) return false;
  return a.anchor_text.every((text, i) => text === b.anchor_text[i]);
}
