/**
 * A4 载体：验证「显式注入 deps.run 时不加载真实执行臂」（F4）。
 *
 * 用法：node --import <module-graph-probe> <本文件> <contract 相对路径>
 * 前置：cwd 指向含该 contract 的临时目录。
 *
 * 为什么要单独一个入口文件：deps 注入是 `main()` 的进程内 API，没法从 CLI argv 表达；
 * 而模块图必须观测"整条命令走完"的全过程。用子进程 + 注入替身是唯一能同时满足两者的形态。
 *
 * 断言侧依赖两条输出：
 *  - stdout 出现 INJECTED_RUN_HANDLER_CALLED —— 证明替身**真的被调用**（否则"没加载
 *    playwright"可能只是因为命令根本没走到 run）；
 *  - 模块图不含 run-handler / playwright —— 证明注入路径不付真实执行臂成本。
 */
import { main } from '../../dist/cli/index.js';

const contractPath = process.argv[2];
if (contractPath === undefined) {
  process.stderr.write('inject-run-deps: 需要 contract 相对路径参数\n');
  process.exit(2);
}

const code = await main(['run', contractPath], {
  deps: {
    run: async () => {
      process.stdout.write('INJECTED_RUN_HANDLER_CALLED\n');
      return 0;
    },
  },
});

process.exitCode = code;
