# Tasks: Issue #17 - navigate 缺 URL 严禁静默降级为 click

## 接口契约冻结块 (Frozen Interface Contract)

```typescript
// src/runtime/contract/feature-to-contract.ts

export type TargetValueFailure = 'unmapped-action' | 'ambiguous-target' | 'unmapped-navigation';

export interface MapStepFailure {
  reason: TargetValueFailure;
}

export type MapStepResult = StepMapping | MapStepFailure;

/**
 * mapStep: 将 When/Given 步骤安全映射为 Contract 步骤
 * 输入: raw: ParsedStep
 * 输出: MapStepResult (StepMapping | MapStepFailure)
 * 不变量:
 * 1. 命中 NAVIGATE_PATTERN 且存在 URL 时，产出 action: 'navigate'；
 * 2. 命中 NAVIGATE_PATTERN 但不存在 URL 时，严禁降级为 action: 'click'，必须返回 { reason: 'unmapped-navigation' }；
 * 3. 产生 unmapped-navigation 的步骤在上层 mapOneScenario 中归入 unmappedSteps，使整个 Scenario 安全降级为 draft；
 * 4. 零模型零网络，确定性映射。
 */
export function mapStep(raw: ParsedStep): MapStepResult;
```

---

## 任务拆解与执行流 (LoopX Pipeline B)

- [x] **Task 1: [B1] 冻结规范与任务清单**
  - 预期结果: 产出 `.trae/specs/fix-issue-17/spec.md` 与 `tasks.md`，明确 AC1-AC4 与接口契约块 【✅】
- [x] **Task 2: [B2] 检出分支与先红复现测试**
  - 预期结果: 新建分支 `fix/issue-17-navigate-fallback`，新增 `tests/unit/issues/issue-17.test.ts` 复现缺陷（navigate "某页面" 原本返回 click，断言其应为 unmapped-navigation 且整体契约应为 draft），vitest 确认红灯报错 【✅】
- [x] **Task 3: [B3] 外科手术式实现与门禁全绿**
  - 预期结果: 改造 `feature-to-contract.ts` 中的 `mapStep` navigate 分支，返回 `reason: 'unmapped-navigation'`，测试转绿，四大门禁全绿 【✅】
- [x] **Task 4: [B4] L1 独立代码审查与证据落盘**
  - 预期结果: 产出 `.trae/specs/fix-issue-17/l1-review-evidence.md`，逐条核对红线和 AC 【✅】
- [ ] **Task 5: [B5] GitHub MCP 提交与创建 PR**
  - 预期结果: 使用 GitHub MCP 提交代码并开启 PR，注入 `loopx-meta`，生成 L2 报告 【待完成】
- [ ] **Task 6: [B6] Squash & Merge 与核销 Issue #17**
  - 预期结果: GitHub MCP 合并 PR，Issue #17 自动/显式流转为 closed，完成双对账收尾 【待完成】
