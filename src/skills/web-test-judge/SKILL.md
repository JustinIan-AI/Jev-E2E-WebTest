---
name: web-test-judge
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "{ judgement_set: EvidenceRef[], assertions: AssertionSpec[] }"
outputs: "{ verdict: PASS|FAIL|BLOCKED, blocked_reason?, judgement_hash }"
constraints:
  - 纯函数：verdict = f(evidence, assertions)，同输入必同输出
  - verdict 写入权归 Runtime；任何中介不得改写
  - 判定优先级固定：无法求值 → 歧义 → FAIL → PASS（不可换序）
  - 只有确定性断言能产生 FAIL；模型信号恒为 candidate
fallback: 无
verified_by: [A1, A2, A8]
---

# web-test-judge

## ① 何时使用

用例执行终局，Runtime 以 `evidence.judgement_set` 与 `contract.assertions` 为输入，一次性产出 verdict。**调用权与写入权归 Runtime 独占**。

## ② 输入 / 输出

- **输入**：`judgement_set: EvidenceRef[]`（只读）+ `assertions: AssertionSpec[]`
- **输出**：`{ verdict: PASS | FAIL | BLOCKED, blocked_reason?, judgement_hash }`，由 Runtime 写入 `judge_result`

## ③ constraints

- 纯函数：`verdict = f(evidence, assertions)`，无隐藏状态、无时间依赖、无随机；可由归档 evidence 离线重算。
- 写入权归 Runtime；Skill 与编排者只读。
- 判定优先级固定（不可换序）：① 任一断言无法求值 → `BLOCKED(evidence)`；② 任一目标歧义 → `BLOCKED(ambiguity)`；③ 任一断言 `passed == false` → `FAIL`；④ 全部通过 → `PASS`。
- 只有确定性断言能产生 `FAIL`；模型自述完成等信号恒为 candidate，不直接产生 `PASS`/`FAIL`。

## ④ 降级路径

无。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 自述 vs 事实 | JEV 自述完成 + HTTP 500 | `FAIL`（A1） |
| 无证据 | 自述完成但 judgement_set 为空 | `BLOCKED`，非 PASS（A2） |
| 离线重算 | 归档 evidence 重跑判定 | 与在线 verdict 逐字节一致（A8） |
| 顺序不可换 | 1 条 FAIL + 1 条无法求值 | `BLOCKED(evidence)`，不是 FAIL |

## ⑥ 禁止事项

- 禁止编排者或 Skill 写入 `judge_result`。
- 禁止换序判定优先级。
- 禁止让模型信号直接产生 PASS / FAIL。
