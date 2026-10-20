# LoopX × IDWTH 系统测试长程执行闭环调研报告

> 调研问题：生成一个完整的系统测试用例集后，如何根据 goal 自动拆分任务、长程执行直至所有系统测试结束，并让人在过程中监控与纠偏。
> 工具基线：LoopX 1.0.2 ｜ IDWTH 单体 TS CLI ｜ Codex CLI（agent runtime）
> 配套文档：[loopx-usage-manual.md](./loopx-usage-manual.md)

---

## 1. 结论速览

**LoopX 能承担"目标持久化 + 任务拆分 + 执行驱动 + 人审门禁"的编排层，但不是开箱即用。** 需要在 IDWTH 侧补三个接缝：

1. **Suite 清单**：把"完整系统测试"显式定义为一组契约（当前目录里只有散落的 `.contract.yaml`，无集合概念）。
2. **批量执行器**：`idwth run` 当前一次只接受一个契约，需要 `idwth suite run` 支持顺序执行、断点续跑与结果聚合。
3. **契约→Todo 分解器**：LoopX 不懂 IDWTH 契约，需要一个幂等同步动作把每个契约映射为一个 LoopX todo。

映射一句话：**一个系统测试集 = 一个 LoopX goal；一个契约 = 一个可领取的 todo；FAIL/BLOCKED = 一个等人裁决的 user_gate；全部 todo done = 系统测试结束。**

---

## 2. 现状链路与缺口

### 2.1 现有链路（已实现）

```
需求/接口文档
   │  ai-testgen generate -f gherkin
   ▼
*.feature
   │  idwth init --from（Scenario Outline 自动展开）
   ▼
.idwth/contracts/<id>.contract.yaml   ← ready，可执行
.idwth/contracts/<id>.draft.yaml      ← 含未映射步骤，需补全
   │  idwth run <contract>            ← 【只支持单契约】
   ▼
.idwth/runs/<runId>/（report.json + 证据 + Judge 裁决）
   │  idwth report <runId>
   ▼
静态 report.html
```

### 2.2 与目标闭环的差距

| # | 缺口 | 实测依据 |
|---|---|---|
| G1 | 无 suite 概念：无法声明"本次系统测试包含哪 N 个契约、顺序、失败策略" | `src/cli/` 中 grep 不到 suite/batch/glob/readdir |
| G2 | 无批量 runner：`run` 只接单契约；`--repeat > 1` 明确返回"暂不支持" | [run-handler.ts](../../src/cli/run-handler.ts#L259-L262) |
| G3 | 无"契约清单 → LoopX todo"的自动分解器 | LoopX 只管理自己的 goal/todo，不识别 contract.yaml |
| G4 | FAIL/BLOCKED 后没有自动"升级为等人裁决"的规则，Agent 可能无脑继续跑 | 需在心跳体/material-rule 中固化 |
| G5 | 长程无人时段的环境失效（Chrome 崩溃、登录态过期）无前置体检与监控 | 需 doctor/ready-score + continuous_monitor |
| G6 | draft 契约无法执行，拆单时若简单 glob `*.contract.yaml` 会静默漏掉一批用例 | 需把 draft 显式列为 user_action（人工补全或走 F1 `complete`） |

---

## 3. LoopX 能力盘点（与本场景逐项对应）

| 场景诉求 | LoopX 能力 | 关键命令 |
|---|---|---|
| 全集目标持久化、中断/换会话无损续跑 | Goal | `start-goal`、`goal-lifecycle --operation stop/resume` |
| 根据 goal 自动拆成小步 | `--fine-grained` 细粒度规划 + todo 建议 + Goal Studio | `start-goal --fine-grained`、`todo suggest`、`chat` |
| 逐用例执行、防并发踩踏 | Todo claim + 硬租约 | `todo claim`、`task-lease acquire/renew/inspect` |
| 控制成本与节奏 | Quota 门禁 | `quota should-run`、`quota spend-slot` |
| 每轮可复跑证据 | Evidence Log + done 强制附验证命令 | `evidence-log --thin`、`todo --status done --evidence --validation-command` |
| 人实时监控执行过程 | 本地 Dashboard + 状态 + 历史 | `loopx dashboard`、`status`、`history` |
| 人中途纠偏 | Goal Studio 预览写回 / 暂停 goal / 手动改 todo | `loopx chat`、`goal-lifecycle stop`、`todo ...` |
| 人不在屏幕前的异步门禁 | Goal Channel（IM 通知 + Kanban） | `goal-channel setup`、`goal-channel notify-gate` |
| 独立第三方挑刺（只提案不执行） | Supervisor 同伴监督 | `supervisor-prompt`、`supervisor-observe`、`supervisor-event` |
| 环境/就绪度体检 | Doctor / Ready Score | `loopx doctor`、`ready-score` |

---

## 4. 目标闭环设计

### 4.1 对象映射

```
系统测试集（Suite）            →  LoopX Goal
  goal-text = "执行 suite <name> 下全部契约，直至每个用例出权威 verdict 并汇总"

每个 .contract.yaml           →  advancement_task todo
  validation-command = "idwth run <contract> --json"   ← 退出码即证据
  evidence           = run_id + verdict + report.json 路径

每个 .draft.yaml              →  user_action todo（先补全/complete，再转执行 todo）

任一用例 FAIL / BLOCKED       →  user_gate todo（阻塞该 lane，等人裁决）
  裁决选项：修 SUT 后重跑 / 修契约后重跑 / replay --verify / replay --heal(不入CI) / 接受风险

全部执行 todo done            →  汇总 todo：聚合 N 份 report.json → suite-report
```

### 4.2 端到端流程

```
[S0 用例生成] ai-testgen → *.feature → idwth init --from → contracts/（N ready + M draft）
      │
[S1 建档]    idwth suite init（扫描 contracts → suite.yaml，含顺序/失败策略）
      │      loopx start-goal --guided --fine-grained --project . --goal-text "跑完 <suite>"
      │
[S2 拆单]    分解器：suite.yaml 中每个 contract → loopx todo add（幂等，幂等键=contract id）
      │      draft → user_action todo，先补全再补执行 todo
      │
[S3 驱动]    loopx heartbeat-prompt --goal-id <G> --runtime-profile codex_cli --thin
      │      Codex 可见 TUI 挂 /goal；每轮先过 quota should-run
      │
[S4 执行]    todo claim + task-lease acquire
      │      → idwth run <contract> --json
      │      → todo done --evidence "<run_id>/<verdict>" --validation-command "idwth run ..."
      │
      ├─ PASS                 → 领取下一个 todo
      ├─ FAIL / BLOCKED       → 自动开 user_gate todo + goal-channel notify-gate（IM 通知）
      │                         ▼ 人裁决后继续（见第 5 节）
      └─ 环境异常(CDP/登录态) → blocker todo + ready-score 取证，等人处理
      │
[S5 监控]    人随时：loopx dashboard / status / history / evidence-log --thin
      │
[S6 收尾]    全部 done → 汇总 todo 产出 suite-report（verdict 分布、FAIL/BLOCKED 清单、复现命令）
             → change-quality prepare/verify → Trae review
             → tasks.md 置【✅】→ GitHub MCP 提交/PR → goal-lifecycle 收尾
```

**结束判据（不靠 Agent 自述）**：goal 下 `advancement_task` 全部 done 且每个都带可复跑 validation 记录；`loopx status` 注意力队列无残留；suite-report 与各 run 的 `verdict_hash` 一致。

---

## 5. 人在过程中的监控与纠偏（四个入口）

| 入口 | 用法 | 适用时机 |
|---|---|---|
| **① 实时可视化** | `loopx dashboard`（本地 Web：goal 进度、todo 状态、门禁、下一步），`status`/`history` 看紧凑视图 | 人在电脑前，想随时掌握进度 |
| **② 过程证据** | `evidence-log --goal-id <G> --agent-id <A> --thin`；每个 todo 的 `validation-command` 可直接复跑 | 怀疑 Agent 跑偏，要核对真实产物而非自述 |
| **③ 主动纠偏** | · `loopx chat`：问只读 Agent 要一个 bounded todo，**预览后批准才写回**（不让实现者私自改计划）<br>· `goal-lifecycle stop/resume`：一键暂停/恢复整个长程任务<br>· 手动 `todo add` 追加修复任务、`todo --status blocked --reason` 标记问题 | 发现方向错、要插需求、要紧急叫停 |
| **④ 异步门禁** | `goal-channel notify-gate`：出现 user_gate 时向飞书推送 bounded 通知，人在 IM 里 approve/reject，处理结果经回执写回 | 人不在屏幕前，但 FAIL/BLOCKED 需要人决策 |

可选增强：`loopx supervisor-prompt` 挂一个**提案-only 的同伴监督 Agent**，它只观察并提改进提案（supervisor-event），不直接执行；由人或主控决定是否采纳，形成"执行者不能自己改判、监督者不能自己动手"的双隔离。

---

## 6. 建议落地的三个接缝（TDD，测试先写 tests/）

### 接缝一：Suite 清单（解 G1/G6）

新增 `.idwth/suites/<suite>.yaml`：

```yaml
suite: <name>
contracts:
  - glob: "../contracts/*.contract.yaml"   # 只收 ready
drafts:
  - glob: "../contracts/*.draft.yaml"      # 显式列为人补全项，不静默漏掉
on_failure: gate            # gate=遇 FAIL/BLOCKED 停等人；continue=跑完再统一审
resume: skip_passed         # 断点续跑：已 PASS 的用例跳过
```

### 接缝二：批量执行器 `idwth suite run`（解 G2）

- 顺序执行 suite 中的契约（默认并发 1，避免同一 Chrome/登录态被并发污染）；
- 断点续跑：依据历史 run 记录跳过已 PASS 用例；
- 聚合退出码：全部 PASS → 0；存在 FAIL → 1；仅 BLOCKED → 2；配置非法 → 3；内部错误 → 4；SIGINT → 130（沿用六值语义）；
- 产出 `suite-report.json`：聚合各用例 verdict、failure_reason、run_id、复现命令。

### 接缝三：Suite → LoopX Todo 分解器（解 G3/G4）

- 幂等同步：以 contract id 为幂等键，重复执行不产生重复 todo；
- 每个执行 todo 绑定 `--validation-command "idwth run <contract> --json"` 与 `--task-class advancement_task`；
- 固化门禁规则（写入心跳体 material-rule）：**用例 verdict 为 FAIL/BLOCKED 时，不得自行继续，必须开 `user_gate` todo 并 `notify-gate`**；
- draft 同步为 `user_action`，补全完成后再生成对应执行 todo。

**架构红线（沿用既有 spec）**：三个接缝全部落在单体 `src/cli` + `src/runtime` 内，不新增 `backend/`/`frontend/` 分层、不引入 daemon/常驻服务/监听端口。LoopX dashboard 是仓库外的外部工具，不属于 IDWTH 组件。

---

## 7. 建议分期

| 阶段 | 内容 | 出口 |
|---|---|---|
| P0 | 接缝一 + 接缝二 + 接缝三：可本地"一键 goal 跑完全集、断点续跑、FAIL 即停等人" | 新增测试全绿；mock provider 下完整跑通一个含 PASS/FAIL/BLOCKED 的 suite |
| P1 | `goal-channel` 接飞书：user_gate 自动通知 + IM 回执写回 | 无人值守时 FAIL 能叫到人 |
| P2 | dashboard 常驻 + supervisor 提案监督 | 长程过程可实时观察、有独立挑刺 |

测试分层：`tests/unit/`（聚合/续跑/幂等分解纯函数）、`tests/contract/`（suite CLI 与退出码）、`tests/integration/`（mock provider 跑整套 suite）。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 长程执行中用例间状态污染、顺序耦合 | 每例 cleanup + runId 命名空间隔离（已有能力）；suite 默认顺序执行 |
| 模型成本随用例数失控 | quota should-run 门禁 + 每例 `--max-cost` 预算；回放/CI 路径零模型（SIR=0） |
| 人过度信任 Agent 自报进度 | 结论只认 Judge + verdict_hash；todo done 必须附可复跑 validation；Trae review 双门禁不变 |
| LoopX 状态在仓库外（`~/.codex/loopx/`），换机不跟随 | 计划与进度双写 suite.yaml / tasks.md（对齐用户"计划驱动"规则），状态只做运行时加速 |
| Chrome/登录态在无人时段失效 | 开工前 doctor + ready-score；长程期间挂 continuous_monitor 探测 CDP 活性 |
