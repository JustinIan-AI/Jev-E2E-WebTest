---
name: web-test-replay
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "{ frozen_artifacts, mode: verify|heal }"
outputs: "{ result: MATCH|DRIFT, drift_points?, candidate_strategy? }"
constraints:
  - --verify 默认、零模型、漂移即终止 BLOCKED(drift)
  - --heal 产物为候选建议，不得进入 CI 门禁
  - 禁止静默适配状态漂移
fallback: 无回放时全量重跑
verified_by: [A6, A7]
---

# web-test-replay

## ① 何时使用

Runtime 对已冻结产物（Trace + Strategy + Evidence）执行复跑，用于验证环境稳定性或生成候选修复。

## ② 输入 / 输出

- **输入**：`frozen_artifacts` + `mode: verify | heal`
- **输出**：`{ result: MATCH | DRIFT, drift_points?: DriftPoint[], candidate_strategy? }`

## ③ constraints

- `--verify`（默认）：零模型调用；逐步比对 `resolve.strategy` / `resolve.matched` / `action_result.status` / `assertion results`，任一不一致即报 `DRIFT` 并终止 → `BLOCKED(drift)`。
- `--heal`（显式开启）：按需允许 L3 重新解析，产物为候选 strategy，**不得进入 CI 门禁**。
- 禁止静默适配状态漂移。

## ④ 降级路径

无可用冻结产物时，回退为全量重跑（不视为 replay）。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 页面改版 | 按钮位置变化后 `--verify` | 报 DRIFT 并终止（A6） |
| 零模型 | 回放全过程统计模型调用 | = 0 |
| heal 产物 | `--heal` 生成的新版 strategy | 标记为候选，CI 拒绝使用 |

## ⑥ 禁止事项

- 禁止在 `--verify` 模式下调用模型。
- 禁止静默适配漂移。
- 禁止将 `--heal` 产物直接用于 CI。
