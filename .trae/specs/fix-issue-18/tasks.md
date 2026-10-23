# Tasks: 修复 Issue #18 - Freshness 基线单次打桩缺陷

## 接口契约（实现前对齐）

```typescript
// 冻结契约：PlaywrightProvider 内部实现约定与不变量
export class PlaywrightProvider {
  /**
   * 最近一次页面观测戳。
   * 不变量 1：在用例生命周期内，任何成功 resolve 并捕获 handle 的有效 DOM 节点，
   * 其 data-observation-id 必须与当前有效的 lastObservationId 保持同步。
   */
  private lastObservationId: string | null = null;

  /**
   * 解析登记：分配 elementId 并捕获节点身份锚点。
   * 不变量 2：若 handle 存在且 connected，在 registerResolved 阶段同步打桩当前 lastObservationId；
   * 不变量 3：若节点被替换或 DOM 分离，handle.isConnected 必为 false，verifyFreshness 依然返回 false。
   */
  private async registerResolved(page: Page, locator: Locator): Promise<string>;
}
```

## 任务拆解与执行顺序

- [x] **B2-1**: 编写先红复现测试用例 `tests/unit/issues/issue-18.test.ts`
  - 预期结果：【✅】在未修改 `src/engine-provider/playwright/provider.ts` 的情况下，用例 100% 失败（RED），明确复现 SPA 导航/动态元素因缺少观测戳而导致 `verifyFreshness === false` 及 `ensureFresh === 'drift'`（2 failed, 1 passed）。
- [x] **B3-1**: 实施最小外科手术式修复 `src/engine-provider/playwright/provider.ts`
  - 在 `registerResolved` 中，对成功获取到的 `handle` 打上有效 `lastObservationId` 戳（若无则初始化）；
  - 在 `act({ kind: 'navigate', ... })` 成功导航后刷新 `this.lastObservationId`；
  - 预期结果：【✅】`tests/unit/issues/issue-18.test.ts` 转绿（GREEN，3/3 passed），既有 `tests/contract/playwright-freshness.test.ts` 全绿（2/2 passed）。
- [x] **B3-2**: 执行四大质量门禁全量验证
  - 运行 `npm run typecheck && npm run lint && npm run build && npm run test`；
  - 预期结果：【✅】四大门禁全绿：typecheck 0 错误、lint 0 警告、build 成功产出 dist、test 56 文件全部通过（633/633 passed，净增 3 个测试用例，0 回归）。
- [x] **B4-1**: 执行 L1 独立代码审查并产出审查证据
  - 对账 AC-1 至 AC-4 与 7 大架构红线，落盘至 `.trae/specs/fix-issue-18/l1-review-evidence.md`。
  - 预期结果：【✅】审查通过（PASS / READY_FOR_PR），先红后绿证据齐全，7 大红线无违规，四大门禁全绿（56 files, 633 tests passed）。
- [ ] **B5-1**: GitHub MCP 提交并创建 PR，注入 `loopx-meta`
  - 通过 GitHub MCP 创建分支与提交，建立 PR，运行 `loopx pr-review` 输出 L2 审查报告。
- [ ] **B6-1**: 执行 8 项审批清单核验，合入 PR 并完成收尾
  - Squash & Merge 合入 main，确认 Issue #18 自动关闭，执行 `loopx goal-lifecycle --operation stop`。
