/**
 * Task 8 — Evidence 安全采集脱敏（详设 §9.4 / §5.5.8 / §4.8.6 constraints）。
 *
 * 两条安全规则：
 *  1. credential 永不进 judgement_set / evidence / snapshot（§9.4）：
 *     - 观测剔除 password/file/hidden 输入控件；
 *     - 任意嵌套层级的 credential 语义键（password、authorization、api_key…）值替换为 [REDACTED]。
 *  2. 已知明文（登录密码、渲染出的 Bearer/kubeconfig）无论键名是否敏感一律替换；
 *     截图第二层文本遮罩见 buildTextMaskScript（TreeWalker SHOW_TEXT，§5.5.8）。
 *
 * 纯函数、无浏览器依赖，可在 Node 侧单测；页面侧脚本通过 page.evaluate 注入。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const REDACTED = '[REDACTED]';

/** §9.4：观测必须剔除的输入控件 type（button/submit 等不在内）。 */
export const EXCLUDED_INPUT_TYPES = new Set(['password', 'file', 'hidden']);

/**
 * credential 语义键名（小写、归一化后）匹配。
 * 采用保守的包含式词段匹配，宁可误遮（安全侧），不可漏 credential。
 */
const CREDENTIAL_KEY_TOKENS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'key',
  'apikey',
  'authorization',
  'auth',
  'credential',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, '');
}

export function isCredentialKey(key: string): boolean {
  const k = normalizeKey(key);
  return CREDENTIAL_KEY_TOKENS.some(
    (t) => k === t || k.includes(t) || k.includes(normalizeKey(t)),
  );
}

/** 长 secret 先替换，避免短串先命中破坏长串；过滤 ≤3 的无意义值（§5.5.8）。 */
function effectiveSecrets(secrets: readonly string[]): string[] {
  return [...new Set(secrets)].filter((s) => s.length > 3).sort((a, b) => b.length - a.length);
}

export function redactSecretsInString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const s of effectiveSecrets(secrets)) {
    out = out.split(s).join(REDACTED);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 深度脱敏：
 *  - credential 语义键 → 整值 [REDACTED]（不再下钻，凭据结构整体不进证据）；
 *  - 其余字符串值做已知明文替换；数组/对象递归。
 */
export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactSecretsInString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, secrets));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isCredentialKey(k) ? REDACTED : redactValue(v, secrets);
    }
    return out;
  }
  return value;
}

/** 观测元素最小结构（与 provider Observation 解耦，按结构识别）。 */
interface ObservationElement {
  id?: unknown;
  tag?: unknown;
  inputType?: unknown;
  type?: unknown;
  [k: string]: unknown;
}

export interface RedactedObservation {
  [k: string]: unknown;
  elements?: Array<Record<string, unknown>>;
}

/**
 * §9.4：从观测中剔除 password/file/hidden 输入控件，其余字段整体走 redactValue。
 * 控件识别取 inputType/type 两种字段名，tag 缺省时只要 type 命中也剔除（保守）。
 */
export function redactObservation<T extends Record<string, unknown>>(
  observation: T,
  secrets: readonly string[],
): RedactedObservation {
  const out = redactValue(observation, secrets) as RedactedObservation;
  const elements = Array.isArray(out.elements) ? (out.elements as ObservationElement[]) : undefined;
  if (elements) {
    out.elements = elements
      .filter((el) => {
        const t = String(el.inputType ?? el.type ?? '').toLowerCase();
        return !EXCLUDED_INPUT_TYPES.has(t);
      })
      .map((el) => redactValue(el, secrets) as Record<string, unknown>);
  }
  return out;
}

/**
 * §5.5.8 第二层文本遮罩：返回可直接传入 page.evaluate 的函数表达式（IIFE）。
 * TreeWalker(SHOW_TEXT) 遍历渲染出的文本节点，命中长度>3 的已知明文时，
 * 将整个 Text 节点替换为黑底黑字 data-redacted span（非 input 的 kubeconfig/Bearer 靠这层）。
 *
 * 注意：secrets 在 Node 侧序列化进脚本，脚本本身不得写入任何证据产物。
 */
export function buildTextMaskScript(secrets: readonly string[]): string {
  const vals = effectiveSecrets(secrets);
  return `(() => {
  const vals = ${JSON.stringify(vals)};
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walk.nextNode()) {
    const t = walk.currentNode;
    if (vals.some((v) => v.length > 3 && t.data.includes(v))) hits.push(t);
  }
  for (const t of hits) {
    const masked = vals.reduce((acc, v) => acc.split(v).join('[REDACTED]'), t.data);
    const s = document.createElement('span');
    s.style.cssText = 'background:#000;color:#000';
    s.textContent = masked;
    s.setAttribute('data-redacted', '1');
    t.replaceWith(s);
  }
  return hits.length;
})()`;
}

/** runtime trace 事件序列化（§4.8.6：trace 不得含明文密码）。 */
export function serializeTraceEvents(
  events: readonly unknown[],
  secrets: readonly string[],
): string {
  return JSON.stringify(
    events.map((e) => redactValue(e, secrets)),
    null,
    2,
  );
}

/** 视为二进制、跳过文本扫描的扩展名。 */
const SKIP_SCAN_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.zip',
  '.gz',
  '.tar',
  '.pdf',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
]);

async function walkFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, acc);
    } else if (entry.isFile() && !SKIP_SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * TR-8.1 产物扫描：递归检查目录下全部文本文件，返回包含任一已知明文的文件绝对路径。
 * 命中空数组即「登录产物 grep 为空」。
 */
export async function scanFilesForSecrets(
  dir: string,
  secrets: readonly string[],
): Promise<string[]> {
  const vals = effectiveSecrets(secrets);
  if (vals.length === 0) return [];
  const hits: string[] = [];
  for (const file of await walkFiles(dir)) {
    let buf: Buffer;
    try {
      const s = await stat(file);
      if (s.size === 0) continue;
      buf = await readFile(file);
    } catch {
      continue;
    }
    // 内容含 NUL 字节视为二进制，跳过
    if (buf.includes(0)) continue;
    const text = buf.toString('utf8');
    if (vals.some((v) => text.includes(v))) hits.push(file);
  }
  return hits;
}
