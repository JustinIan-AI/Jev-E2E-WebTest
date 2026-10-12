---
name: web-semantic-action
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "schemas/action.input.json"
outputs: "{ operation: ActionOp, target_index: number, confidence: number }"
constraints:
  - 输出仅 operation + target_index；禁止 selector / xpath / js / 坐标
  - target_index 越界或 operation 不在白名单 → 零派发
  - confidence 低于分级阈值（reversible 0.60 / irreversible 0.90）→ BLOCKED(decision)
  - 观测阶段剔除 password / file / hidden，凭据永不进模型上下文
fallback: 纯 L1/L2（SIR = 0），确定性路径不依赖本 Skill
verified_by: [A2, A7]
---

# web-semantic-action

## ① 何时使用

当 L1（role/label/text）与 L2（fingerprint）均未命中目标时，Runtime 调用本 Skill 通过 JEV 在候选元素集合中做语义决策。

## ② 输入 / 输出

- **输入**：`observation`（fresh）+ `step.intent` + `action_space`（候选元素，仅 index/role/label/region）
- **输出**：`{ operation: ActionOp, target_index: number, confidence: number }`，或 `unavailable`

## ③ constraints

- 输出严格限定为 `operation` + `target_index`，禁止返回 selector / xpath / js / 坐标。
- `target_index` 越界或 `operation` 不在白名单 → 零派发并记录拒绝原因。
- 置信度阈值分级：`reversible` 需 ≥ 0.60，`irreversible` 需 ≥ 0.90，低于阈值 → `BLOCKED(decision)`。
- 进入模型上下文的观测信息必须剔除 `password` / `file` / `hidden` 类型控件，凭据永不入上下文。

## ④ 降级路径

纯 L1/L2 确定性路径（SIR = 0），不依赖本 Skill。JEV 不可达时确定性步骤照常执行，需 L3 的步骤 `BLOCKED(decision)`。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 非法 operation | 模型返回 `eval_js` / `xpath://...` | 零派发 + 记录拒绝原因 |
| 越界 index | `target_index: 99` | 零派发 + `BLOCKED(decision)` |
| 低置信度 | 不可逆动作 confidence 0.70 | `BLOCKED(decision)`，不猜 |
| 离线 | JEV 端点不可达 | 确定性路径仍全跑（A7） |

## ⑥ 禁止事项

- 禁止输出定位选择器或可执行代码。
- 禁止降低 Contract 声明的 `risk` 等级。
- 禁止携带凭据进入模型上下文。
