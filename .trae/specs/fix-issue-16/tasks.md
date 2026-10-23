# Tasks: Issue #16 - Then 断言动作式句式与缺失原语映射扩展

## 接口契约冻结块 (Frozen Interface Contract)

```typescript
// src/runtime/contract/feature-to-contract.ts

export interface StepMapping {
  step: ContractStep;
  assertion?: Record<string, unknown>;
}

/**
 * mapThenStep: 将 Then 步骤安全映射为 (assert_only 步骤, dom 断言)
 * 输入: raw: ParsedStep
 * 输出: StepMapping | null
 * 不变量:
 * 1. 纯确定性同步解析，零网络零模型；
 * 2. 产生的 assertion.kind 严格限制在 7 种封闭原语内：
 *    'visible' | 'absent' | 'count' | 'value' | 'checked' | 'url' | 'number'；
 * 3. 语法不合法或目标/期望值缺失时返回 null，由调用方打上 'unrecognized-assertion' 降级为 draft；
 * 4. 严格向后兼容存量句式。
 */
export function mapThenStep(raw: ParsedStep): StepMapping | null;
```

---

## 任务拆解与执行流 (LoopX Pipeline B)

- [x] **Task 1: [B1] 冻结规范与任务清单**
  - 预期结果: 产出 `.trae/specs/fix-issue-16/spec.md` 与 `tasks.md`，明确 AC1-AC4 【✅】
- [x] **Task 2: [B2] 检出修复分支与先红复现测试**
  - 预期结果: 新建分支 `fix/issue-16-then-assertions`，新增 `tests/unit/issues/issue-16.test.ts` 包含动作式断言、4 种缺失 kind 的解析失败用例，运行 vitest 确认红灯报错 【✅】
- [x] **Task 3: [B3] 外科手术式实现与门禁全绿**
  - 预期结果: 改造 `feature-to-contract.ts` 的 `mapThenStep`，使 Issue #16 测试转绿，全量测试 pass，四大门禁全绿 【✅】
- [x] **Task 4: [B4] L1 独立代码审查与证据落盘**
  - 预期结果: 产出 `.trae/specs/fix-issue-16/l1-review-evidence.md`，逐条核对红线和 AC 【✅】
- [ ] **Task 5: [B5] GitHub MCP 提交与创建 PR**
  - 预期结果: 使用 GitHub MCP 提交代码并开启 PR，注入 `loopx-meta`，生成 L2 报告 【待完成】
- [ ] **Task 6: [B6] Squash & Merge 与核销 Issue #16**
  - 预期结果: GitHub MCP 合并 PR，Issue #16 自动/显式流转为 closed，完成双对账收尾 【待完成】
