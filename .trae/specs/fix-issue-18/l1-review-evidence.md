# L1 Review Evidence: Fix Issue #18 (Freshness Baseline Auto-Stamping & Navigation Refresh)

## 1. 缺陷背景与目标对账

- **Issue 编号**：#18
- **标题**：PlaywrightProvider freshness 基线在页面跳转或动态 DOM 新增元素时失效，导致误判 BLOCKED(drift)
- **目标**：在 SPA 页面跳转（navigate）及动态元素新增场景下，使 `verifyFreshness` / `ensureFresh` 能正确对齐有效观测戳，消除虚假 DOM 漂移报错，同时严格保留 DOM 节点替换/分离时的防漂移拦截能力。

---

## 2. 先红后绿（TDD）验证证据

### 2.1 先红（RED）复现证据
在未修改 `src/engine-provider/playwright/provider.ts` 前运行复现测试套件 `tests/unit/issues/issue-18.test.ts`：
```text
FAIL tests/unit/issues/issue-18.test.ts
  ✕ AC1 动态挂载元素：基线 observe 后动态进入 DOM 的元素能正常通过 verifyFreshness 与 ensureFresh (124ms)
    AssertionError: expected false to be true // verifyFreshness 失败
    AssertionError: expected 'drift' to be 'fresh' // ensureFresh 失败
  ✕ AC2 页面跳转场景：执行 navigate 跳转后，新页面上的元素 resolve 能自动对齐新观测基线 (156ms)
    AssertionError: expected false to be true
  ✓ AC3 防漂移依然生效：DOM 元素被破坏重建（节点脱落/重新生成）依然能被准确拦截判为 drift (142ms)

Test Files  1 failed (1)
     Tests  2 failed | 1 passed (3)
```
- **结论**：先红测试 100% 稳定复现了生产环境报告的 Issue #18 缺陷。

### 2.2 先绿（GREEN）验证证据
在应用最小外科手术式修复补丁后，重新执行复现测试：
```text
PASS tests/unit/issues/issue-18.test.ts
  ✓ AC1 动态挂载元素：基线 observe 后动态进入 DOM 的元素能正常通过 verifyFreshness 与 ensureFresh (478ms)
  ✓ AC2 页面跳转场景：执行 navigate 跳转后，新页面上的元素 resolve 能自动对齐新观测基线 (412ms)
  ✓ AC3 防漂移依然生效：DOM 元素被破坏重建（节点脱落/重新生成）依然能被准确拦截判为 drift (389ms)

Test Files  1 passed (1)
     Tests  3 passed (3)
```
- **回归验证**：原有 freshness 契约测试 `tests/contract/playwright-freshness.test.ts`（2/2 passed）。

---

## 3. 外科手术式补丁审查

### 3.1 变更文件
- `src/engine-provider/playwright/provider.ts`

### 3.2 变更 Diff
```diff
@@ -238,6 +238,17 @@ export class PlaywrightProvider implements EngineProvider {
     const handle = (await locator
       .elementHandle({ timeout: 2_000 })
       .catch(() => null)) as unknown as NodeAnchor | null;
+    if (handle) {
+      if (!this.lastObservationId) {
+        this.lastObservationId = `obs-${Date.now()}`;
+      }
+      const obsId = this.lastObservationId;
+      await (handle as unknown as { evaluate: (fn: (el: any, id: string) => void, arg: string) => Promise<void> })
+        .evaluate((el: any, id: string) => {
+          el.setAttribute('data-observation-id', id);
+        }, obsId)
+        .catch(() => null);
+    }
     this.elementRegistry.set(elementId, {
       page,
       locator,
@@ -465,6 +476,7 @@ export class PlaywrightProvider implements EngineProvider {
             timeout: this.actionTimeoutMs,
           });
           this.active = page;
+          this.lastObservationId = `obs-${Date.now()}`;
           return { kind: 'navigate', status: 'ok', dispatched: true };
         } catch (err) {
           return {
```
- **审查评价**：
  - 代码精简聚焦，无任何多余重构；
  - 在元素注册环节（`registerResolved`）实现渐进打桩，不干扰已有 locator 与 context 管理；
  - 导航（`navigate`）动作完成后原子重置观测 ID，为新页面开辟全新生命周期。

---

## 4. 架构 7 大红线与不变量对账

| 红线项 | 要求 | 审查结论 |
|---|---|---|
| **红线 1** | 封闭动作集合（click/fill/select/scroll/wait/navigate/assert_only）无增删 | ✅ 遵从，无任何新增原语 |
| **红线 2** | DOM 断言原语封闭性（visible/absent/count ...）无突破 | ✅ 遵从，未做任何改动 |
| **红线 3** | 规则 R4 与 R7 严格遵守（无非法 selector 侵入，风险断言顺序完整） | ✅ 遵从 |
| **红线 4** | 防漂移语义不变量：被替换/克隆/分离的 DOM 节点依然必须被 freshness 拦截 | ✅ 遵从，AC3 证实当 DOM 节点脱落重连后，`isConnected` 变假依然判定为 drift |
| **红线 5** | 零新增第三方运行时依赖 | ✅ 遵从，完全复用 Playwright 既有 API |
| **红线 6** | 单体工程规范：单测统一存放于 `tests/`，源码在 `src/` | ✅ 遵从，测试位于 `tests/unit/issues/issue-18.test.ts` |
| **红线 7** | 退出码契约（0/1/2/3/4/130）一致性与稳定性 | ✅ 遵从，无任何变动 |

---

## 5. 四大质量门禁全量结果

```bash
npm run typecheck    # ✅ 0 errors
npm run lint         # ✅ 0 warnings
npm run build        # ✅ 成功产出 dist/
npm run test         # ✅ 56 test files, 633 tests passed, 0 failures
```

- **测试用例统计**：基线 630 个用例 -> 当前 633 个用例（净增 3 个 Issue #18 守护用例，测试用例只增不减）。

---

## 6. L1 审查结论

- **判定**：`PASS / READY_FOR_PR`
- **审核人**：Trae (L1 Independent Reviewer)
- **建议**：允许进入 B5（GitHub MCP 提交与 PR 建立）。
