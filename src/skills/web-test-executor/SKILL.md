---
name: web-test-executor
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "schemas/contract.schema.json+schemas/strategy.schema.json"
outputs: "runtime.execution.result"
constraints:
  - 歧义（匹配数 >1）立即 BLOCKED(ambiguity)，禁止取第一个
  - mutation 派发前必须通过 Freshness 校验
  - 已派发的 mutation 不得自动重试
  - 确定性路径（strategy ∈ role/label/text/fingerprint）禁止调用 JEV
fallback: 无（核心路径，不提供降级）
verified_by: [A3, A5]
---

# web-test-executor

## ① 何时使用

Runtime 加载 Frozen Contract 与 Frozen Strategy 后，按状态机逐步执行用例时调用。由 `runtime/executor.ts` 以确定性代码实现，**不是**给模型执行的伪代码。

## ② 输入 / 输出

- **输入**：`contract: frozen_contract` + `strategy: frozen_strategy`
- **输出**：`{ status: completed | terminated, termination?: { verdict, reason } }`

## ③ constraints

- 定位歧义（候选数 >1）立即终止并返回 `BLOCKED(ambiguity)`，零派发。
- 每个 mutation 派发前必须通过 Freshness 校验（Runtime 强制）。
- `ActionResult.dispatched === true` 后超时/未知结果一律不重试。
- 确定性路径不持有 JEV provider 引用（编译期保证 SIR = 0）。

## ④ 降级路径

无。这是核心执行路径，不可降级。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 歧义短路 | 页面存在 2 个"创建"按钮 | `BLOCKED(ambiguity)`，零派发 |
| 超时不重试 | mutation 派发后网络超时 | `BLOCKED`，不重复提交（A5） |
| 陈旧 observation | 派发前 `observationId` 已失效 | 重解析一次；仍失效 → `BLOCKED(drift)` |

## ⑥ 禁止事项

- 禁止在歧义时取第一个候选。
- 禁止对已派发 mutation 自动重试。
- 禁止由 Skill 直接产出 verdict（verdict 由 Runtime / Judge 独占写入）。
