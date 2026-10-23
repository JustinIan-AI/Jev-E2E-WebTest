# Spec: 修复 Issue #18 - Freshness 基线单次打桩导致的 SPA 动态元素 Drift 缺陷

## 1. 概述与背景

- **目标缺陷**：GitHub Issue #18 `[runtime] freshness 基线只在 case 开始时打一次桩：SPA 中 case 开始后进入 DOM 的元素必然 BLOCKED(drift)`
- **影响范围**：
  - SPA 路由跳转（`action: navigate`）后加载的新页面元素；
  - 异步渲染、动态挂载、弹窗、抽屉等在初始基线观测（`provider.observe()`）之后进入 DOM 的元素；
  - 以上元素在执行 mutation 步骤（`click`、`fill`、`select`）前，进行 `ensureFresh` 新鲜度校验时必然失败，结构性抛出 `BLOCKED(drift)`。

## 2. 根因分析（Root Cause）

1. **基线观测时刻与定位时刻脱节**：
   - `src/cli/run-handler.ts:310` 处，`provider.observe()` 仅在用例开始前执行一次，生成 `lastObservationId = 'obs-<t0>'`，并在当时的 DOM 上给元素盖章 `data-observation-id="obs-<t0>"`。
2. **新进入 DOM 的元素无打桩记录**：
   - SPA 路由跳转或动态挂载的元素，其 `data-observation-id` 属性为 `null`。
3. **定位过程（`resolve`）未打桩**：
   - `PlaywrightProvider.resolve()`（`provider.ts:231`）在成功匹配元素并调用 `registerResolved()` 时，仅分配 `elementId` 并缓存 `ElementHandle`，不进行任何观测打桩。
4. **`verifyFreshness` 对比必假**：
   - `verifyFreshness()`（`provider.ts:404-431`）核验目标节点的 `data-observation-id === this.lastObservationId`。由于新元素属性为 `null`，且初始观测戳固定，比对恒为 `false`。
5. **重解析自愈失效**：
   - `ensureFresh()` 发现不新鲜后触发 `reResolved = await provider.resolve(target, mode)`，重解析同样未盖戳，导致再次校验失败，最终必然返回 `outcome: 'drift'`，CLI 退出码为 `2 (BLOCKED)`。

## 3. 修复方案设计（Surgical Fix）

### 3.1 核心修复原则
- **不破坏原有防漂移（Drift Detection）语义**：若节点被替换（如 Vue/React key 变化导致旧节点分离）或已从 DOM 脱落，`verifyFreshness` 仍必须准确识别并返回 `false`。
- **定位即同步（Alignment on Resolve）**：
  - 在 `PlaywrightProvider.registerResolved(page, locator)` 阶段，当成功获取到 DOM 节点锚点（`handle`）时：
    1. 确保当前存在有效观测基准（若 `this.lastObservationId` 尚未初始化，则赋予 `obs-${Date.now()}`）；
    2. 检查该 DOM 节点是否已具有合法的 `data-observation-id`；若无或与当前基准脱节，则在节点上打上当前的有效观测戳 `this.lastObservationId`。
- **导航联动（Alignment on Navigation）**：
  - 在 `provider.act({ kind: 'navigate', ... })` 成功后，重置/更新 `this.lastObservationId = 'obs-' + Date.now()`，确保新页面开启全新的观测基准生命周期。

### 3.2 架构红线合规核对
1. 封闭集合不被突破：动作原语与断言原语完全零新增。
2. 零网络零模型：纯本地 DOM 状态与属性打桩，无任何 LLM/外部调用。
3. 质量门禁全绿：`npm run typecheck && npm run lint && npm run build && npm run test`。

## 4. 验收准则（Acceptance Criteria）

- **AC-1**：先红测试先于实现运行，在基线代码上 100% 复现动态插入元素或导航后新元素触发 `verifyFreshness(...) === false` 及 `ensureFresh` 返回 `drift`。
- **AC-2**：应用补丁后，动态插入元素或页面导航后解析出的新元素，在进入 `verifyFreshness` 时返回 `true`（新鲜），顺利通过 `ensureFresh`。
- **AC-3**：既有防漂移语义不回退：当 DOM 节点被克隆/替换/从 DOM 分离时，`verifyFreshness` 依然准确返回 `false`。
- **AC-4**：全量回归测试保持 0 失败，测试用例数只增不减。
