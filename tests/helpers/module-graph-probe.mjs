/**
 * 模块图探针 —— 主线程入口（F4 · 见 .trae/specs/f4-cli-startup-lazy-load/spec.md）。
 *
 * 用法：node --import <本文件> <entry> [...args]
 * 环境：IDWTH_PROBE_LOG（必填，绝对路径）—— 每个被解析的模块 URL 追加一行。
 *
 * 为什么需要它：启动耗时不能当门禁（CI 共享 runner 差异 3–5 倍，会制造 fake red），
 * 而"某条命令有没有把浏览器执行臂拉进来"是**与机器速度无关**的确定性问题。
 *
 * 两个必须遵守的点：
 *  1. hooks 在独立的 loader 线程执行，与本文件不共享 globalThis —— 所以只能落盘，
 *     不能挂内存变量（挂 globalThis 会永远读到 0 条，静默假绿）。
 *  2. 先建空文件再 register：把"目录不存在 / 无权限"暴露在这一步，而不是让
 *     loader 线程里的 append 抛出一个看不懂的 ENOENT。
 */
import { writeFileSync } from 'node:fs';
import { register } from 'node:module';

const logPath = (process.env.IDWTH_PROBE_LOG ?? '').trim();
if (logPath === '') {
  throw new Error(
    'module-graph-probe: 必须设置 IDWTH_PROBE_LOG（绝对路径）。' +
      '未设置时不允许"静默不记录"——那会让门禁永远为真。',
  );
}

// fail fast：目录不可写直接在这里炸，而不是在 loader 线程里炸。
writeFileSync(logPath, '');

register(new URL('./module-graph-hooks.mjs', import.meta.url).href, import.meta.url);
