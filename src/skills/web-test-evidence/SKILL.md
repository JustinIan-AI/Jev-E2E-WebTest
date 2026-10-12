---
name: web-test-evidence
version: "1"
layer: declaration
stage: runtime
callable_by: runtime
model_may_rewrite: false
inputs: "runtime.execution.events"
outputs: "{ judgement_set: EvidenceRef[], archived: EvidenceRef[] }"
constraints:
  - 判定必需集实时落盘、永不截断；归档集超限外移并写指针
  - credential 永不进入 judgement_set / evidence / snapshot
  - 截图遮罩 = 输入控件 + 文本级已知密钥明文
  - 去重按 sha256(evidence 内容) 内容寻址
fallback: 无
verified_by: [A2, A8]
---

# web-test-evidence

## ① 何时使用

Runtime 全程采集执行过程中的可观测数据，为 Judge 提供判定必需集，为审计与回放提供归档集。

## ② 输入 / 输出

- **输入**：`execution_events`、`observation`、`network`、`backend_results`、`screenshots`
- **输出**：`{ judgement_set: EvidenceRef[], archived: EvidenceRef[] }`，引用以 `artifact://` / `evidence://` 表示

## ③ constraints

- `judgement_set`（判定必需集）实时落盘、永不截断，缺失即 `replay --verify` → `BLOCKED(drift)`。
- `archived`（可归档集）超字节上限时外移到 `runs/<id>/archive/` 并写指针，禁止丢失式截断。
- 凭据永不进入 `judgement_set` / `evidence` / `snapshot`。
- 截图遮罩覆盖 `input` / `textarea` / `[contenteditable]` / `[data-private]`，并对页面渲染的已知密钥明文做文本级遮罩。
- 证据去重按 `sha256(evidence 内容)` 内容寻址。

## ④ 降级路径

无。

## ⑤ 行为性验收

| 场景 | 给定 | 期望 |
|---|---|---|
| 凭据泄漏 | 开启 Playwright trace + 网络日志走一次登录 | grep trace 文件不含明文密码 |
| 文本级明文 | 页面渲染 kubeconfig 片段 / Bearer token | 截图被遮罩（非输入控件也要遮） |
| 超限 | `archived` > 50MB | 外移 + 写指针，不丢失式截断 |

## ⑥ 禁止事项

- 禁止裁剪 `judgement_set`。
- 禁止凭据落入任何证据文件。
- 禁止以时间戳归属判定（归属以身份标识 runId/contractId 为准）。
