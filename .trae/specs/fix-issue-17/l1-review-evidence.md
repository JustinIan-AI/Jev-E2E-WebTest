# L1 独立代码审查报告：Issue #17 (navigate 缺 URL 严禁静默降级为 click)

## 1. 审查概况
- **审查对象**：Issue #17 修复实现
- **审查分支**：`fix/issue-17-navigate-fallback`
- **审查人**：Trae (Controller / L1 Auditor)
- **审查结论**：**通过 (PASS)**

---

## 2. 变更文件清单与 diff 审查

### 2.1 `src/runtime/contract/feature-to-contract.ts`
- **改动范围**：
  1. 扩展 `TargetValueFailure` 联合类型，增加 `'unmapped-navigation'`；
  2. 改造 `mapStep` 中的 `NAVIGATE_PATTERN` 分支：
     - 当提取到合法 URL（`URL_PATTERN`）时，正常产出 `{ step: { intent, action: 'navigate', url, risk: 'reversible' } }`；
     - 当未匹配到 URL 时，**删除原本提取 target 并静默降级为 `action: 'click'` 的逻辑**，严格返回 `{ reason: 'unmapped-navigation' }`；
  3. 改造 `mapOneScenario` 中 `!isStepMapping(mapped)` 的 reason 处理：
     - 当 `mapped.reason === 'unmapped-navigation'` 时保留该 reason 并加入 `unmappedSteps`，确保场景状态被标记为 `draft`（而非虚假的 `ready`）。
- **审查评估**：外科手术式微创修改，彻底消除了“契约合法但语义错”的严重安全隐患，遵循“不确定即 draft”原则。

### 2.2 `tests/unit/issues/issue-17.test.ts`
- **改动范围**：新增专属复现与回归单元测试（5 个测试用例）。
- **覆盖点**：
  - 无 URL 的英文 `navigate "页面名"` 步骤返回 `unmapped-navigation`；
  - 无 URL 的中文 `打开 "页面名"` 步骤返回 `unmapped-navigation`；
  - 含完整 URL 的步骤依然正常映射为 `action: 'navigate'`；
  - Issue #17 真实特征文件场景从修复前的虚假 `ready` 正确降级为 `draft`；
  - 含完整 URL 的场景正常产出 `ready`。

### 2.3 `tests/unit/feature-to-contract.test.ts`
- **改动范围**：更新原有一条测试“navigate 无 URL 时降级为 click 语义目标”的旧用例，断言其不再降级为 click，而是安全降级为 draft (`unmapped-navigation`)。

---

## 3. 验收标准逐项核对 (AC 核对)

| 编号 | 验收标准 (AC) | 核对依据 | 结论 |
|---|---|---|---|
| **AC1** | navigate 缺 URL 严禁产生 `action: 'click'`，必须降级为 draft | `tests/unit/issues/issue-17.test.ts` 用例 1、2、4 均通过验证 | ✅ PASS |
| **AC2** | 含完整 URL 的导航保持映射为 `action: 'navigate'` | `tests/unit/issues/issue-17.test.ts` 用例 3、5 均通过验证 | ✅ PASS |
| **AC3** | 存量合法用例 100% 后向兼容 | 存量 57 个测试文件全部通过 | ✅ PASS |
| **AC4** | 标准质量门禁全绿，测试数只增不减 | vitest 58 文件 / 645 用例全绿；typecheck / lint / build exit 0 | ✅ PASS |

---

## 4. 架构与安全红线核对 (AGENTS.md)

1. **封闭集合不被突破**：✅ 未新增未定义 action，未修改 schema 封闭集合。
2. **零模型零网络**：✅ 全部由纯同步确定性正则与字符串处理完成。
3. **退化与降级安全**：✅ 无 URL 语义不明确步骤安全降级为 draft，人工可介入，不产出错误执行契约。
4. **单体目录规范**：✅ 测试严格放置在 `tests/unit/issues/`。

---

## 5. 审查裁决
- **状态**：通过，允许进入 B5（GitHub MCP 提交与开启 PR）。
