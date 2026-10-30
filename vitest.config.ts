import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // ── 超时预算：这是「防挂死」闸门，不是延迟断言 ───────────────────────────
    // 本套件含真实 Chromium（CDP）、真子进程 CLI、以及 beforeAll 里跑 `npm run build`
    // 的用例，全量时约 10 个 worker 并发（10 核机器）。实测同一条子进程命令
    // 单跑 ~1.2s，全量并发下 6.8–8.9s —— 差额是 CPU 争抢，与被断言的行为无关。
    //
    // vitest 默认 5s 于是变成一条我们从没打算设的「启动延迟闸门」：全量跑随机红
    // 1~2 条，且每次红的不是同一条（cli.test.ts / cli-entry.test.ts /
    // compliance-audit.test.ts 都中过）。这类红不指向任何真实缺陷，却持续污染
    // 「门禁是否全绿」的判断。
    //
    // 20s ≈ 2.3× 实测最坏值（8.9s）；真实挂死仍会显式失败，只是慢一点报。
    testTimeout: 20_000,
    // beforeAll 里的 `npm run build`（tsc 全量）在并发下远超默认 10s。
    hookTimeout: 120_000,
  },
});
