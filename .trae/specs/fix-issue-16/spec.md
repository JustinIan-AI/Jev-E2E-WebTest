# Feature Specification: Issue #16 - Then 断言动作式句式与缺失原语映射扩展

## 1. 缺陷背景与问题陈述
- **Issue 来源**: #16 (关联 #11)
- **问题根因**: 
  `src/runtime/contract/feature-to-contract.ts` 中的 `mapThenStep` 仅识别三类叙述句式（`should see / 应该看到`、`should not see / 不应该看到`、`显示/展示`）。
  导致：
  1. 动作式断言（如 `Then assert only "用户列表页面" is visible`）无法映射，直接报 `reason: unrecognized-assertion` 并降级为 `.draft.yaml`；
  2. schema 封闭允许的 7 种 DOM 断言原语（`visible / absent / count / value / checked / url / number`）中，`value`、`checked`、`number`、`url` 四种完全没有 Gherkin 语法映射规则，用户被迫只能手写契约。

## 2. 修复目标与验收准则 (Acceptance Criteria)
- **AC1: 动作式 visible / absent 断言映射**
  - `assert only "<target>" is visible` / `断言仅 "<target>" 可见` 成功映射为 `assert_only` + `kind: 'visible', target`。
  - `assert only "<target>" is not visible` / `assert only "<target>" is absent` / `断言仅 "<target>" 不可见` 成功映射为 `assert_only` + `kind: 'absent', target`。
- **AC2: 四类缺失 kind 映射覆盖**
  - **`value`**: 支持 `assert only "<target>" is "<val>"`、`"<target>" 的值为 "<val>"`、`"<target>" 的值是 "<val>"` 映射为 `kind: 'value', target, expected: val`。
  - **`checked`**: 支持 `assert only "<target>" is checked`、`"<target>" 已勾选`、`"<target>" 未勾选` 映射为 `kind: 'checked', target, expected: true/false`。
  - **`number`**: 支持 `assert only "<target>" number is <N>`、`"<target>" 的数值为 <N>` 映射为 `kind: 'number', target, expected: N`。
  - **`url`**: 支持 `current url is "<url>"`、`当前地址是 "<url>"`、`当前 URL 是 "<url>"` 映射为 `kind: 'url', expected: url`。
- **AC3: 零破坏与后向兼容**
  - 原有 3 类叙述句式（`should see`、`should not see`、`显示/展示`）及数量 count 断言完全向后兼容，所有存量用例 100% 通过。
- **AC4: 质量门禁全绿与不可篡改**
  - 四大门禁全绿（typecheck / lint / build / test），且测试用例数只增不减。

## 3. 边界与防御原则
- 零模型零网络：所有映射必须为纯确定性正则表达式匹配与引号安全提取。
- 歧义防御：若结构缺少必要参数（如缺少 target 或 expected），拒绝瞎猜，返回 `null` 并由外层安全归入 `unrecognized-assertion` 降级草稿。
