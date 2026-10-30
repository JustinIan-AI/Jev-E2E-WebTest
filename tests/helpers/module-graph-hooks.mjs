/**
 * 模块图探针 —— loader 线程的 ESM hooks（F4）。
 *
 * 只观测，不改写：resolve 结果原样透传给 Node。
 * 每个解析成功的模块 URL 追加一行到 $IDWTH_PROBE_LOG。
 *
 * 注意：这里**不吞异常**。写失败必须让进程显式失败，否则手上一份残缺的模块图会被
 * 当成"没加载 playwright"的证据 —— 这正是本项目反复踩过的"报 0 条 = 我没喂东西"陷阱。
 */
import { appendFileSync } from 'node:fs';

export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  const logPath = process.env.IDWTH_PROBE_LOG;
  if (!logPath) {
    throw new Error('module-graph-hooks: IDWTH_PROBE_LOG 丢失（探针必须经 module-graph-probe.mjs 加载）');
  }
  appendFileSync(logPath, `${resolved.url ?? specifier}\n`);
  return resolved;
}
