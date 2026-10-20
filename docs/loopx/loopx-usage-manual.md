# JEV-E2E-Test (IDWTH) 项目 LoopX 使用手册

> 版本基线：loopx 1.0.2 ｜ codex-cli 0.162.1 ｜ Node ≥22
> 适用仓库：`JustinIan-AI/Jev-E2E-WebTest`（IDWTH 单体 TypeScript CLI）
> 角色分工：**Trae = 计划者 / Code Reviewer / 进度确认人**；**Codex CLI（经 LoopX 编排）= Agent Runtime / 实现者**

---

## 1. LoopX 是什么，在本项目解决什么问题

LoopX 是一个**长周期 Agent 工作的持久化状态与证据层**。它不替代 Codex，而是在 Codex 之上提供：

| 能力 | 本项目用途 |
|---|---|
| Goal（目标）持久化 | 每个 Feature 注册为一个 goal，中断/换会话后可无损续跑 |
| Todo 生命周期 + 租约（task-lease） | Feature 拆成可领取/可完成的任务，防止重复执行与并发踩踏 |
| Quota 门禁（`quota should-run`） | 决定下一轮 Agent turn 是否该跑，控制成本与退避 |
| Evidence Log（thin ledger） | 每轮工作的公开安全证据账，replan/交接前必读 |
| Review Packet / Change Quality | 为精确 diff 生成评审包并校验回执，支撑 Trae 的 code review |
| Doctor / Ready Score | 环境与就绪度体检 |
| Heartbeat Prompt | 生成可粘贴进 Codex CLI `/goal` 的受控循环体 |

**与本项目既有规范的衔接**：IDWTH spec/tasks 的证据原则（证据必须来自可复跑命令，不以主观判断替代验证）与 LoopX 的 evidence-ledger 模型天然一致；`.idwth/` 是产品运行产物目录，LoopX 状态在仓库外（`~/.codex/loopx/`），两者互不污染。

## 2. 关键路径与状态位置

```
/opt/homebrew/bin/loopx                         # CLI 入口（homebrew shim）
~/.local/share/loopx-venv/                      # 实际安装（pip venv）
~/.codex/loopx/registry.global.json             # 全局注册表（goal/agent/quota）
~/.codex/loopx/                                 # runtime root
~/.codex/skills/loopx-project/SKILL.md          # Codex 侧已安装的 LoopX skill
```

- LoopX **全局状态默认在仓库外**（`~/.codex/loopx/`），不进入 git 工作区。
- 但 Codex/LoopX 在**项目根目录本地**也可能落下运行时目录 `.codex/`、`.loopx/`（心跳、会话、本地证据缓存）。这类目录必须加入仓库 `.gitignore`，不要误提交（F1 已补上，见第 10 节）。
- 全局注册表可写（doctor 已验证 `global_registry_writable=True`）。

## 3. 环境自检（每次开工前）

```bash
loopx doctor                                    # 安装/PATH/skill/注册表体检
loopx status                                    # 当前 goal、门禁、注意力队列、下一步
```

doctor 输出解读（本项目当前实测）：
- `ok: True`，`typescript_control_plane: ready` —— 控制面可用。
- `install_freshness: repair_recommended` / `requires_upgrade: True` —— 提示有新版本，**非阻塞**；升级走 `loopx update plan` → 人工确认 → `loopx update apply`，不自动升级。
- `loopx-benchmark` skill routes=0 —— benchmark skill 路由异常，仅影响基准测试能力，不影响 Feature 开发主链路。

升级命令（需人工批准后执行）：

```bash
loopx update check          # 查看安装归属与可升级版本
loopx update plan           # 预览升级计划
loopx update apply          # 显式应用升级
```

## 4. 核心命令速查

### 4.1 Goal 生命周期

```bash
# 为一个 Feature 创建/续接 goal（guided 预览，安全）
loopx start-goal --guided --project . --goal-text "<Feature 目标描述>"

# 生成 Codex CLI 宿主接入包（本项目固定 agent-type=codex-cli）
loopx agent-onboard --agent-type codex-cli --project .

# goal 的暂停 / 恢复（不删除历史、todo、证据）
loopx goal-lifecycle --help

# 状态总览
loopx status
loopx diagnose --goal-id <GOAL_ID>             # 行为异常时生成紧凑证据包
loopx history --goal-id <GOAL_ID>              # 紧凑运行历史
```

### 4.2 Agent 身份注册（Feature 首次开工）

LoopX 默认要求**注册一个新的公开安全 agent id**（避免误占他人 lane）：

```bash
loopx register-agent --goal-id <GOAL_ID> --agent-id '<idwth-feat-xxx>' --require-new --execute
```

命名约定：`idwth-feat-<feature短名>`，如 `idwth-feat-draft-autocomplete`。

### 4.3 Todo 生命周期

```bash
loopx todo --goal-id <GOAL_ID> --role agent --text "<任务>" --add      # 新增（见 4.3.1）
loopx todo --goal-id <GOAL_ID> --todo-id <ID> --status open            # 领取前置
# claim：领取任务（携带幂等键）
loopx todo --goal-id <GOAL_ID> --todo-id <ID> --claim-operation-id <OP_ID> --claimed-by <AGENT_ID>
loopx todo --goal-id <GOAL_ID> --todo-id <ID> --status done \
  --evidence "<证据摘要/链接>" \
  --validation-command "npm test" \
  --validation-label "full-suite"               # 带验证证据完成
loopx todo --goal-id <GOAL_ID> --todo-id <ID> --status blocked --reason "<原因>"
```

> 注：新增子命令的准确写法以 `loopx todo --help` 实际参数为准（`--text` + `--role`，完成用 `--status done`）。

**硬租约（防止两个 turn 同时改一个任务）**：

```bash
loopx task-lease --help        # acquire / renew / transfer / release / inspect
```

完成 todo 时**强制**附 `--validation-command` 与 `--evidence`，对齐项目"证据必须可复跑"规则。

### 4.4 Quota 门禁

```bash
loopx quota should-run --goal-id <GOAL_ID> --runtime-profile codex_cli
```

- 返回允许 → 进入下一轮 Codex turn；
- 返回退避（scheduler_hint）→ 按提示等待，不强行重跑；
- 该命令也是每个心跳 turn 进入实现工作前的第一道闸门。

### 4.5 心跳体（Codex CLI 循环驱动）

Codex CLI 的标准用法是**保持可见 TUI**，用 `/goal <task_body>` 挂载受控循环体：

```bash
# goal 已注册后，生成 thin 心跳体（按实际 goal-id）
loopx heartbeat-prompt --goal-id <GOAL_ID> --runtime-profile codex_cli --thin
```

操作步骤：
1. 先 `start-goal` 让 goal 进入注册表（否则 heartbeat-prompt 报 `goal_id not found`）；
2. 复制生成的 `task_body`；
3. 在 Codex CLI 可见 TUI 中执行 `/goal <task_body>`；
4. 全程保持可见 TUI，**不切换到隐藏的 `codex exec` headless 模式**（bootstrap 路径的明确要求）。

首次接入若 TUI 无法直接挂载，用：

```bash
loopx codex-cli-bootstrap-message            # 生成一次性 setup 消息（不是心跳体本身）
```

### 4.6 评审包与变更质量（Trae Review 的工具支撑）

```bash
# 为一个 goal 生成评审/交接包
loopx review-packet --goal-id <GOAL_ID> --agent-id <AGENT_ID>

# 针对"当前精确 diff"的三段式质量校验
loopx change-quality prepare                 # 为当前 diff 建评审包
loopx change-quality record                  # 针对精确 diff 校验 Agent 结果并存回执
loopx change-quality verify                  # 用 goal policy 与回执校验当前精确 diff
```

## 5. 标准工作流（每个 Feature 固定八步）

```
[T1] Trae 写 Feature 计划（spec/tasks，含验收标准与验证命令）
        │
[T2] Trae 注册 LoopX goal + agent 身份，拆 todo
        │
[T3] Codex CLI 挂载 /goal 心跳体，quota should-run 放行
        │
[T4] Codex 逐 todo 实现（TDD：测试先写入 tests/），task-lease 防并发
        │
[T5] 每个 todo done 必须附 validation-command 证据
        │
[T6] Codex 完成全部 todo → change-quality prepare，产出精确 diff 评审包
        │
[T7] Trae Code Review（review-packet + 人工审查，见第 6 节清单）
        │
        ├─ 不通过 → 回 T4 开修复 todo（review 意见入证据）
        └─ 通过 ↓
[T8] Trae 进度确认：更新 tasks.md 状态为【✅】→ GitHub MCP 提交/PR → goal 收尾
```

## 6. Trae Code Review 清单（T7 强制项）

Review 必须基于 `loopx review-packet` / `change-quality` 的**精确 diff 与可复跑证据**，不得凭实现者自述通过。

**功能与正确性**
- [ ] 实现与 Feature spec 的验收标准逐条对应；无超出范围的改动（不做未要求的重构/加功能）。
- [ ] 新增测试位于根目录 `tests/`（unit / integration / contract 分层正确），且测试能真正失败（RED 证据或断言有效）。
- [ ] 边界与错误路径有覆盖；失败映射到正确退出码（0/1/2/3/4/130）。

**项目架构红线**（来自 spec，违反即打回）
- [ ] 单体 `src/` 工程：**无 `backend/`/`frontend/` 新增分层、无 server/daemon/.listen(、无 GUI 依赖**（用户全局规则中的前后端目录约定不适用于本仓库——以 spec/tasks 明确豁免为准）。
- [ ] 无新增无许可证依赖；外购代码许可证可商用；SUT 适配项不进 core。
- [ ] CI/回放路径模型调用为 0 的约束未被破坏。

**安全与证据**
- [ ] diff 与产物无明文凭据；脱敏链路未被绕过。
- [ ] `npm run typecheck`、`npm test`（全量）、`npm run build` 全绿，证据为命令输出。
- [ ] `loopx change-quality verify` 通过；每个 todo 均有 evidence 与 validation 记录。

Review 结论只有两种：**通过（进入 T8）** / **打回（列具体问题，回 T4）**。不允许"基本可以先合并"。

## 7. Trae 进度确认规则（T8）

1. Review 通过后，将对应 Feature tasks 文件中任务状态改为 `completed【✅】`，并附可复跑证据摘要（对齐用户规则）。
2. 提交优先走 **GitHub MCP**（用户规则）：分支命名 `feature/<feature短名>`（如 `feature/f1-draft-autocomplete`），经 PR 合入 `main`，不直接推主分支。
3. 同步 goal：`loopx goal-lifecycle` 暂停/收尾；确认 `loopx status` 注意力队列无残留。
4. 在进度确认记录中回链：PR 链接、测试数量、review-packet、change-quality 回执。

## 8. 故障与异常处理

| 现象 | 处理 |
|---|---|
| `heartbeat-prompt: goal_id not found` | goal 未进注册表；先 `start-goal`/`bootstrap-command-pack` |
| `quota should-run` 拒绝/退避 | 按 scheduler_hint 等待，不重复强跑 |
| doctor `repair_recommended` | 非阻塞；安排单独的 `loopx update` 变更，不与 Feature 混做 |
| Agent 行为异常/中途跑偏 | `loopx diagnose --goal-id` + `evidence-log --thin` 取证后再 replan |
| todo 疑似被并发执行 | 用 `task-lease inspect` 核对租约归属，必要时 transfer/release |
| diff 与回执对不上 | `change-quality verify` 会失败；以精确 diff 为准重新 record |

## 9. F1 实战复盘（首个完整走完八步的 Feature）

> Feature：`f1-draft-autocomplete` —— Draft 未映射步骤的确定性 Skills 自动补全（CLI 子命令 `idwth complete`）。
> 产出：PR [#2](https://github.com/JustinIan-AI/Jev-E2E-WebTest/pull/2) ｜ 51 文件 / 590 测试全绿（基线 568 只增不减）。
> 下面沉淀的是**实际踩到、且下个 Feature 可直接复用**的经验，不是流程复述。

### 9.1 排兵布阵：先冻结「接口契约」，再放 Codex 跑 TDD

F1 的 tasks.md 在子任务之前先放了一段 **接口契约（实现前对齐）**：明确 `completeDraft({draft, featureRaw}) → CompletionResult` 的字段、`Confidence`/`StepCandidate` 形状、`candidates` 与 `unmapped_steps` 数量守恒的注释。

- 好处：Codex 分多个 todo（F1-1 引擎 / F1-2 顺序 / F1-3 CLI / F1-4 回归）独立实现时，模块边界一次定死，中途没有返工改签名。
- 复用建议：凡是"纯函数引擎 + CLI 外壳"类 Feature，T1 的 tasks 里**先写接口块再写任务清单**，把不变量写成字段注释（如"与未映射步骤一一对应、数量守恒"），让测试天然可对照。

### 9.2 跨会话重启：状态在 LoopX + spec/tasks，不在对话记忆里

F1 实际经历了"重启 Codex 续跑"。能无损接上，靠的是：goal/todo/evidence 落在 LoopX，进度与预期结果落在 `.trae/specs/<feature>/tasks.md`，代码在工作区——**不依赖上一段对话的上下文**。

- 复用建议：换会话/重启 Agent 后，先 `loopx status` + 读 tasks.md 核对每个 `[x]` 的"预期结果"，再决定续跑点；不要凭对话摘要判断完成度。

### 9.3 T7 真正抓到的关键缺陷：R4「时间顺序」被放宽（最有价值的一条）

Codex 初版在重建 Contract 时，对不可逆步骤（terminate sessions）补 postcondition，会把**位于该步骤之前**的可见性断言也借来当后置条件，导致一个本质不可逆、且之后无任何确认断言的步骤被保留为 `irreversible`——属于 Recovery False Positive 逃逸，违反 R4。

修复（`complete.ts`）：
- 引入 `assertionOrigins: number[]`，记录每条断言来自第几步；
- R4 收尾只接受 `origin > stepIndex`（断言严格位于该步骤**之后**），找不到就**保守降级 `reversible`**，而不是硬凑 postcondition；
- 新增回归用例 `F1-2.4a`：不可逆步骤"之后无断言、之前有断言"时，不得借用早先断言。

**复用经验**：对任何"按序重放/重映射步骤"的确定性引擎，"前置 vs 后置"是位置敏感的，review 时必须有一个用例专门钉死**方向**（断言在步骤之前不能算 postcondition）。

### 9.4 确定性补全引擎的五条 Review 不变量

F1 review 沉淀出适用于本项目所有"映射/补全/生成 Contract"类改动的硬性检查点：

1. **封闭集不被突破**：不得产出基线 7 动作 / dom 断言原语之外的新 action/kind（R5/R6）。
2. **时间顺序正确**：postcondition 严格在步骤之后（见 9.3）。
3. **数量守恒**：输出候选数 == `unmapped_steps` 数，一一对应。
4. **原文不丢、draft 不被破坏**：无法补全/medium 时 `--apply` 返回 3，原 draft 文件与 `_draft.unmapped_steps` 原样保留。
5. **零网络零模型**：补全在 Authoring，纯函数，不进 Runtime 主回路；file 上传只产语义 target，禁止文件路径字面量/选择器（R7）。

### 9.5 退出码边界：3（CONFIG_ERROR）与 4（RUNTIME_ERROR）要分场景钉测试

F1 用测试明确了易混边界，后续 Feature 应沿用同一判据：

- draft **自身非法**（缺 `_draft`、缺 `source_feature` 字段）→ **3 CONFIG_ERROR**；
- draft 合法，但它**引用的外部 feature 文件不存在**（运行期 IO 失败）→ **4 RUNTIME_ERROR**；
- `--apply` 时存在 medium/无法补全（业务上不允许落定）→ **3**，且不产出 contract。

判据口诀：**配置/契约内容不对 = 3；依赖的外部资源在运行时取不到 = 4。**

### 9.6 GitHub MCP 提交实操（T8）

用户规则要求"优先 GitHub MCP 提交"，F1 全程代码提交走 MCP，实测经验：

| 做法 | 经验 |
|---|---|
| 多文件提交 | 用 `push_files`（单 commit 多文件）；**payload 过大时曾瞬态报 `MCP server is not found`**，改为**单文件 / 小批量**推送后 6 次全部一次成功，不要一次塞整棵树。 |
| 更新已存在文件 | 用 `create_or_update_file`，需先取该文件在目标分支的 **sha**。 |
| 工作区隔离 | MCP 直接推**远端 feature 分支**，不动本地仍停在 `main` 的工作区，未提交改动不受影响。 |
| **创建 PR 失败兜底** | MCP 的 PAT 若缺 Pull Requests 写 scope，`create_pull_request` 会报 `Permission Denied: Resource not accessible by personal access token`（重试无意义）。此时改用本机 `gh` CLI（已登录、含 `repo` scope）执行 `gh pr create` 兜底——**代码提交仍以 MCP 为主，仅 PR 动作降级**。 |

提交前先用 `gh auth status` 确认 scope（本项目账号 `JustinIan-AI` 具备 `repo`/`workflow`）。

### 9.7 提交边界：保持 PR 聚焦

- 本次只提交 F1 特性相关文件（引擎 / CLI / 基线 export / Skill 声明 / 测试 / spec / tasks / `.gitignore`）。
- `docs/loopx/` 的手册与实施计划**不混入** Feature PR（属流程文档，单独提交）。
- 运行时目录 `.codex/`、`.loopx/` 已加入 `.gitignore`，避免本地心跳/会话状态入库。

### 9.8 F1 验证命令与出口口径

```bash
npm run typecheck && npm run lint && npm run build
npm run test          # F1 出口：51 files / 590 tests，基线 568 只增不减
node bin/idwth.js complete <draft.draft.yaml> --json     # 只建议、退出 0
node bin/idwth.js complete <draft.draft.yaml> --apply    # 全 high 才落 contract
node bin/idwth.js validate <id>.contract.yaml
```

T8 进度确认记录应回链：PR、测试计数（基线/现状）、review 修复点（F1 为 R4 时间顺序 + 回归 F1-2.4a）、提交方式（MCP 推送 + gh 建 PR）。

## 10. 最小命令 Cheat Sheet

```bash
loopx doctor
loopx status
loopx start-goal --guided --project . --goal-text "<goal>"
loopx agent-onboard --agent-type codex-cli --project .
loopx register-agent --goal-id <G> --agent-id '<id>' --require-new --execute
loopx heartbeat-prompt --goal-id <G> --runtime-profile codex_cli --thin
loopx quota should-run --goal-id <G> --runtime-profile codex_cli
loopx todo --goal-id <G> ...                 # add/claim/done(+evidence)/blocked
loopx task-lease --help
loopx review-packet --goal-id <G> --agent-id <A>
loopx change-quality prepare|record|verify
loopx diagnose --goal-id <G>
loopx goal-lifecycle --help
```
