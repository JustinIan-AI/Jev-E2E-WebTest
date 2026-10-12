---
name: web-semantic-recovery
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "schemas/action.input.json"
outputs: "{ recovery_action: ActionOp, target_index: number, confidence: number }"
constraints:
  - 可改 Recovery 策略；绝不可修改 goal 或任何 assertion
  - 仅 reversible 步可恢复；irreversible 失败 → 直接 BLOCKED(decision)
  - 恢复上限：1 次/step、3 次/case
  - 恢复后必须校验步级后置条件，未声明则 BLOCKED(postcondition)
fallback: 直接 BLOCKED(recovery)，不可配置为 FAIL
verified_by: [A4, A9]
---

# web-semantic-recovery

## ① 何时使用

仅当 `ActionResult` 属于可触发 recovery 的状态，且 `step.risk === reversible` 时，Runtime 调用本 Skill 进行步级恢复。

## ② 输入 / 输出

- **输入**：`original_intent` + `failed_action` + `ActionResult` + 失败后的 fresh observation + `step.postcondition`
- **输出**：`{ recovery_action: ActionOp, target_index: number, confidence: number }` + `recovery_reason`

## ③ constraints

- 绝对禁止修改 `goal` 或任何 `assertion`（违反即终止 + 审计，A4）。
- 仅 `reversible` 步骤允许恢复；`irreversible` 失败直接 `BLOCKED(decision)`。
- 恢复次数上限：每 step 1 次、每 case 3 次。
- 恢复后必须校验步级后置条件；未声明后置条件 → `BLOCKED(postcondition)`。
- 必须记录 before/after snapshot 并写入 `episode.recovery`。

## ④ 降级路径

直接 `BLOCKED(recovery)`，不可降级为 FAIL。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 试图改断言 | 恢复上下文注入 `new_assertion` | 拒绝 + 审计 + 终止（A4） |
| 恢复落错目标但最终断言恰好通过 | 步级后置条件缺失 | 必须被步级后置条件捕获（A9） |
| 超上限 | 同一步连续失败 2 次 | 第 2 次不恢复，`BLOCKED(recovery)` |

## ⑥ 禁止事项

- 禁止修改 goal / assertion。
- 禁止对 `irreversible` 步骤执行 recovery。
- 禁止在未校验步级后置条件时继续执行。
