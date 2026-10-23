# L1 独立代码审查报告：Issue #16 (Then 动作式断言与 4 种缺失原语映射)

## 1. 审查概况
- **审查对象**：Issue #16 修复实现
- **审查分支**：`fix/issue-16-then-assertions`
- **审查人**：Trae (Controller / L1 Auditor)
- **审查结论**：**通过 (PASS)**

---

## 2. 变更文件清单与 diff 审查

### 2.1 `src/runtime/contract/feature-to-contract.ts`
- **改动范围**：重构并增强 `mapThenStep`，新增动作式断言与 4 种原语模式识别。
- **改动点**：
  1. 正则常量定义：
     - `ASSERT_ONLY_PREFIX`：识别 `assert only\b` 与 `断言(仅|只)?`；
     - `URL_ASSERT_PATTERN`：识别 `current url is`、`url is` 与 `当前(页面)?(地址|url|网址)[是为]`；
     - `NUMBER_EXTRACT_PATTERN`：提取数字字面量；
  2. URL 原语分支：提取单 URL 或带引号 URL，返回 `{ kind: 'url', expected }`，action 为 `assert_only`；
  3. 动作式断言分支（`ASSERT_ONLY_PREFIX`）：
     - 2 个引号参数：第 1 个为 target，第 2 个为 expected，生成 `value` 原语；
     - 1 个引号参数：检查 `checked`（含 not 判定）、`number`、`absent`（not visible / absent / 不可见）、`visible`；
  4. 结构化中文/叙述断言分支：
     - `"X" 的值[是为] "Y"` → `value` 原语；
     - `"X" 已勾选/未勾选` → `checked` 原语；
     - `"X" 的数值为 N` → `number` 原语；
  5. 兼容兜底：原有 `should not see`、`显示/展示`、`should see [N]` 逻辑 100% 保持在后续分支运行。
- **审查评估**：纯函数、确定性算法，无复杂副作用，未突破 schema 封闭集合。

### 2.2 `tests/unit/issues/issue-16.test.ts`
- **改动范围**：新增专属复现与回归单元测试（7 个测试用例）。
- **覆盖点**：
  - 动作式 visible / absent 中英文断言；
  - value 断言（含 Issue #16 原文复现：`assert only "用户列表中的zhangsan01状态" is "已启用"`）；
  - checked 勾选与未勾选状态断言；
  - number 数值提取断言；
  - url 当前地址比对断言；
  - 端到端 Gherkin → Contract 映射：Issue #16 提供的特征文件从修复前的 draft 直接落定为 ready 契约，并通过 `validateContract` 校验。

---

## 3. 验收标准逐项核对 (AC 核对)

| 编号 | 验收标准 (AC) | 核对依据 | 结论 |
|---|---|---|---|
| **AC1** | 支持动作式断言 `assert only "X" is visible / absent` | `tests/unit/issues/issue-16.test.ts` 用例 1、2 通过 | ✅ PASS |
| **AC2** | 支持 `value`、`checked`、`number`、`url` 4 种缺失原语 | `tests/unit/issues/issue-16.test.ts` 用例 3、4、5、6 通过 | ✅ PASS |
| **AC3** | 存量叙述句式 100% 后向兼容 | 存量 56 个测试文件全部通过 | ✅ PASS |
| **AC4** | 标准质量门禁全绿，测试数只增不减 | vitest 57 文件 / 640 用例全绿；typecheck / lint / build exit 0 | ✅ PASS |

---

## 4. 架构与安全红线核对 (AGENTS.md)

1. **封闭集合不被突破**：✅ 断言原语严格处于 `visible / absent / count / value / checked / url / number` 封闭集内，未新增任何未定义原语；动作严格为 `assert_only`。
2. **零模型零网络**：✅ 全部由离线纯正则匹配与确定性字符串处理完成，不发外部网络请求，不调任何 LLM。
3. **退化与降级安全**：✅ 不匹配的非断言句式返回 `null`，安全触发上游的 `unrecognized-assertion` 降级逻辑，不会产生脏契约。
4. **单体目录规范**：✅ 测试严格位于 `tests/unit/issues/`，无新建违规分层目录。

---

## 5. 审查裁决
- **状态**：通过，允许进入 B5（GitHub MCP 提交与开启 PR）。
