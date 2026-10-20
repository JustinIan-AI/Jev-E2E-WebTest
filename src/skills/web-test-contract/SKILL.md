---
name: web-test-contract
version: "1"
layer: declaration
stage: authoring
callable_by: agent
model_may_rewrite: true
inputs: "schemas/contract.input.json"
outputs: "schemas/contract.schema.json"
constraints:
  - target 禁止 selector / xpath / 坐标 / JS，只允许语义描述
  - risk: irreversible 的 step 必须声明 postcondition
  - 缺失 base_url / goal / assertions / credentials_ref 必须澄清，禁止猜测补全
  - 不得输出定位选择器；所有 target 必须为人可读的语义短语
fallback: 人直接编写 Contract YAML，由 idwth validate 执行九条校验
verified_by: [A4]
---

# web-test-contract

## ① 何时使用

Authoring 阶段唯一的知识型 Skill。当用户提供 PRD、接口文档、手工用例或口头描述，需要产出一份可执行的 IDWTH Test Contract 时使用。

## ② 输入 / 输出

- **输入**：需求材料（requirement_doc | manual_case | free_text）+ 可选环境信息 `env.base_url`、`env.locale`
- **输出**：合法 Test Contract，必须通过 `idwth validate` 的九条校验（见 `schemas/contract.schema.json`）

## ③ constraints

- `target` 必须是语义描述，禁止包含 `#`、`.`、`//`、`>>`、`()` 等 CSS/XPath/JS 语法特征。
- `risk: irreversible` 的 step 必须声明 `postcondition`。
- `environment.base_url`、`goal`、`assertions`、`identity.credentials_ref` 缺失时必须向用户澄清，不得猜。
- 凭据只允许引用 `cred://...`，禁止明文。

## ④ 降级路径

无本 Skill 时：人工直接编写 Contract YAML，由 `idwth validate` 校验合法性。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 缺字段 | 用例未提 `base_url` 且环境未给 | 澄清提问，不产出 Contract |
| 不可逆步无后置条件 | 含"提交"动作但无 `postcondition` | 报错，要求补 `postcondition` |
| 诱导写 selector | 提示词中塞 `#btn-submit` | 忽略并改写为语义 target |

## ⑥ 禁止事项

- 禁止猜测补全缺失字段。
- 禁止输出任何形式的定位选择器（CSS / XPath / JS / 坐标）。
- 禁止在 Contract 中写入明文凭据。

## ⑦ Draft 自动补全能力（Skills 补全）

- **确定性 Authoring 能力**：`idwth complete` 发生在 Authoring 阶段，由确定性扩展映射表纯函数驱动，**零网络调用、零模型派发**。
- **Runtime 模型约束不变**：补全能力完全独立于测试执行回路，Runtime 路径（run/replay）模型调用为 0 的硬约束保持不变。
- **守恒与安全**：未映射步骤与候选 1:1 数量守恒，逐条保留原文；仅全部高置信且通过九规则校验时才允许产出 ready Contract。
