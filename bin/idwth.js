#!/usr/bin/env node
// IDWTH CLI shim -> built output. Run `npm run build` first.
// 必须用动态 import()：dist 缺失时静态 import 会在模块链接阶段抛
// ERR_MODULE_NOT_FOUND，绕过下方 catch（Node 直接 exit 1）；动态导入才能
// 将启动失败统一映射为 RUNTIME_ERROR(4)（issue #3）。
import('../dist/cli/index.js')
  .then(({ main }) => main())
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`idwth failed to start: ${err?.message ?? err}\n`);
    process.exit(4);
  });
