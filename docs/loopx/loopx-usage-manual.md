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

## 5. 标准工作流（双管线全景）

LoopX 在本项目中支持两条标准化研发管线，分别针对不同业务场景：

- **管线 A（Feature 迭代流）**：适用于新增功能特性、架构增强与大型重构；
- **管线 B（Issue 修复流）**：适用于 Bug 修复、行为缺陷校正与紧急补丁。

```
┌────────────────────────────────────────────────────────────────────────┐
│ 管线 A: Feature 研发流（T1-T8）                                         │
│ [T1 计划] ──> [T2 注册] ──> [T3 挂载] ──> [T4 TDD实现]                 │
│                                              │                         │
│ [T8 收尾] <── [T7 L1/L2审查] <── [T6 评审包] <── [T5 证据回写]          │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 管线 B: Issue 修复流（B1-B6）                                           │
│ [B1 Feasibility分流] ──> [B2 分支与先红复现] ──> [B3 外科手术式修复]      │
│                                                        │               │
│ [B6 审批合入与收尾] <── [B5 PR与L2 Exact-Head] <── [B4 L1独立审查落盘]  │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 管线 A：Feature 研发八步流（T1–T8）

1. **[T1 计划]** Trae 研读接缝代码，产出 `.trae/specs/<feature>/spec.md` + `tasks.md`；在 tasks 中**先冻结接口契约块**（类型签名 + 不变量注释），再列子任务。
2. **[T2 注册]** Trae 使用 `loopx start-goal` 注册 goal；使用 `register-agent` 注册执行 agent；将子任务以 `loopx todo add` 拆入 goal。
3. **[T3 挂载]** Codex CLI 挂载 `/goal <task_body>` 心跳体，运行前必须经 `loopx quota should-run` 放行。
4. **[T4 TDD实现]** Codex 逐 todo 实现，测试必须首先写入根目录 `tests/`，使用 `task-lease` 防并发踩踏。
5. **[T5 证据回写]** 每个 todo 完成必须使用 `loopx todo complete`，附带 `--validation-command` 与 `--evidence`。
6. **[T6 评审包生成]** 全部 todo 结束后，运行 `loopx change-quality prepare` 产出精确 diff 评审包。
7. **[T7 审查验证]** Trae 独立进行代码审查（核对 AC 逐条对账、7 大架构红线核对与 L1 证据落盘）。
8. **[T8 提交确认]** 进度确认将 tasks.md 标记为【✅】→ GitHub MCP 提交 feature 分支与 PR → 审批后 Squash 合入并收尾 goal。

---

### 5.2 管线 B：Issue 修复标准六步流（B1–B6）

针对 Issue 缺陷修复，必须严格遵循以下步骤，杜绝"无复现直改代码"或"无审查直接合入"：

1. **[B1 Feasibility 分流]**：
   - 运行可行性评估，决定分流模式：
     - `Fast-Path`：改动量 ≤20 行、无任何接口/契约变动；
     - `Standard PR-Path`：改动 >20 行或涉及接口/类型修改（必须建独立 PR 与完备审查）；
     - `Comment-Only` / `Triage-Only`：非代码 Bug 或无法复现的咨询。
2. **[B2 分支与 Failing Repro 先行]**：
   - 分支命名：统一采用 `fix/issue-<id>`（如 `fix/issue-11`）；原则上一个 PR 对应核销一个主 Issue。
   - **红箱先行原则（强制）**：必须先在旧基线代码上编写单元复现用例，路径规范固定为 `tests/unit/issues/issue-<id>.test.ts`。在未改动任何生产代码前执行该测试，获取并留存真实的**失败（RED）报错证据**。
3. **[B3 外科手术式修复]**：
   - 保持最小改动范围，禁止顺带重构、格式化无关文件或修改不相干逻辑；
   - 修复后使 `tests/unit/issues/issue-<id>.test.ts` 变绿，且确保既有测试无任何回归。
4. **[B4 L1 独立代码审查与证据落盘]**：
   - 控制器执行独立审查，逐条核对 Issue AC 与项目 7 大架构红线；
   - 审查结论与复测证据落盘至 `.trae/specs/<issue-or-fix>/l1-review-evidence.md`。
5. **[B5 PR 发布与 L2 Exact-Head 报告生成]**：
   - 优先通过 GitHub MCP 提交代码并由 `gh` CLI 建立 PR（分支合并目标为 `main`）；
   - PR 正文按规范包含 `Fixes #<id>` 以及机器可读的 `<!-- loopx-meta: {...} -->`；
   - 运行 `loopx pr-review --target-exact-head <PR_NUMBER>@<HEAD_OID>`，生成结构化**五 Block 中文审查报告**并自动发布为 PR 审查意见；
   - 验证云端 GitHub Actions CI checks 实际跑绿。
6. **[B6 审批合入与收尾闭环]**：
   - 审批人依据《标准化审批清单》进行最终核验；
   - 经授权执行 **Squash and merge** 原子合入；
   - 联动关闭关联 Issue 并核销目标里程碑；
   - 执行 `loopx goal-lifecycle` 收尾关闭 goal。

---

## 6. 三级审查体系与 L1/L2 审查防伪标准

为了彻底消除"AI 自述完成即信任"的风险，本项目确立了**L0 门禁、L1 独立审查、L2 PR 防伪审查**三级质量防线：

```
               ┌───────────────────────────────────────┐
               │    L0: 自动化门禁 (Local & CI)         │
               │  typecheck / lint / build / vitest    │
               └──────────────────┬────────────────────┘
                                  │ 全绿通过
                                  ▼
               ┌───────────────────────────────────────┐
               │    L1: 独立代码审查 (Gatekeeper Review) │
               │  AC对账 / 红线审查 / 先红后绿 / 证据落盘 │
               └──────────────────┬────────────────────┘
                                  │ PASS 且证据齐备
                                  ▼
               ┌───────────────────────────────────────┐
               │    L2: PR 级防伪审查 (Exact-Head)      │
               │  五 Block 报告 / English Verdict      │
               │  HEAD OID 精确对齐 / loopx-meta 锚定  │
               └──────────────────┬────────────────────┘
                                  │ APPROVED
                                  ▼
                        进入最终审批与合入决策
```

### 6.1 L0 自动化门禁防线

交付代码必须在本地与云端两端通过以下四大门禁：

```bash
npm run typecheck    # TypeScript 类型检查，0 errors
npm run lint         # ESLint 静态代码检查，0 warnings/errors
npm run build        # TypeScript 编译构建，生成 dist 产物
npm run test         # Vitest 全量单元/集成/契约测试，测试数只增不减
```

- **门禁不变量**：测试数量基线必须严格保持**只增不减**，不允许为了掩盖错误而删除或注释测试用例。
- **云端一致性**：PR 底部 GitHub Actions Checks 必须有真实执行通过记录，本地测试全绿不能豁免云端 CI。

---

### 6.2 L1 独立代码审查（Gatekeeper Review）标准

L1 审查由控制器（Trae）以独立审计人身份执行，严禁由编写代码的 Agent 代替。

#### 1. 核心核查维度
- **先红后绿真实性**：查验复现测试是否真实先在基线报错，且报错信息准确命中 Issue 描述；在 HEAD 上必须一次性转绿。
- **AC（验收标准）逐条对账**：逐条对比规范中声明的 AC，确认每一条都有明确对应的代码实现与测试断言，严禁遗漏。
- **项目 7 大架构红线核验**：
  1. **单体边界**：统一在 `src/`，严禁新建 `backend/` 或 `frontend/` 分层目录；无后台守护常驻服务（单次运行退出）。
  2. **封闭动作集合**：仅允许 `click / fill / select / scroll / wait / navigate / assert_only` 7 个动作，严禁擅自新增。
  3. **封闭断言原语**：DOM 断言仅允许 `visible / absent / count / value / checked / url / number` 7 种原语。
  4. **时间顺序严格**（R4）：不可逆步骤（`risk=irreversible`）必须有严格位于其**之后**的 postcondition 断言；严禁借用该步骤之前的断言。
  5. **语义目标纯洁性**（R7）：`target` 字段严禁使用 CSS 选择器、XPath、屏幕绝对坐标或 JS 脚本片段，仅允许自然语言语义短语。
  6. **零网络零模型调用**：CLI 纯函数与解析执行路径中严禁引入非受控外网请求或未授权的大模型 Runtime 调用。
  7. **依赖安全性**：严禁私自引入无商用许可证或非必要的第三方运行时 npm 包。

#### 2. 审查中缺陷的处理规范
若 L1 审查发现缺陷（例如契约提示漏列原语、类型不匹配、边界条件遗漏）：
- 审计人必须详细记录缺陷原因与行号；
- 编写修复补丁后，**必须重新全量复测四大门禁**；
- 记录修正前后的 diff 与验证证据。

#### 3. 证据落盘规范
审查完成后，审计人必须在 `.trae/specs/<feature-or-fix>/l1-review-evidence.md` 落盘标准证据文档，结构包含：
- 审查基本信息（审查人、分支、HEAD commit SHA、对应 Issue/Goal）；
- 先红后绿执行日志；
- AC 逐条核对清单；
- 7 大红线判定结果；
- 审查中发现的缺陷与闭环修复记录；
- 最终结论：`PASS` 或 `FAIL（附原因）`。

---

### 6.3 L2 Exact-Head Review（PR 级防伪报告）标准

L2 审查针对已推送到 GitHub 的 PR HEAD commit 进行精确审查，生成机器与人工可核验的审查卡。

#### 1. 执行命令与防伪机制
使用严格锁定 HEAD OID 的命令发起：

```bash
loopx pr-review --target-exact-head <PR_NUMBER>@<HEAD_OID>
```

- **防伪核对**：工具必须校验传入的 `<HEAD_OID>` 与 GitHub 远端 PR 当前最新的 `head.sha` 完全一致；如果在此期间开发者推送了新 commit 导致 SHA 漂移，审查工具必须拒绝执行并报错，杜绝"审的是 A 提交，合的是 B 提交"。

#### 2. 固定五 Block 中文审查报告格式
发布的 PR Review Comment 必须严格遵守五 Block 结构，语言为中文，末尾附带英文裁决词：

```markdown
## LoopX L2 Code Review: PR #<PR_NUMBER> @ <HEAD_OID>

### 1. 动机与背景
[清晰说明本次修复/特性的原因、关联的 Issue 编号以及解决的根本问题]

### 2. 改动思路
[说明解决该问题的架构方案、设计权衡、状态流转与边界考虑]

### 3. 具体改动与关键代码讲解
[逐文件解析改动内容，对核心逻辑代码片段进行深入解读，列举新增测试用例]

### 4. 对主干的风险与缓解措施
[评估合入主干后的潜在兼容性影响、性能变化、异常降级路径及对应缓解策略]

### 5. 我的整体评价
[汇总审查结论，包含门禁数据、红线核查结果、L1 独立审查闭环确认]

**Verdict: APPROVED** （或 **Verdict: CHANGES_REQUESTED**）
```

---

## 7. PR 规范与机器元数据（`loopx-meta`）

为支持自动化流水线识别与防伪核验，所有提交的 PR 必须遵循结构化规范。

### 7.1 PR 描述结构要求

PR 正文必须分为人类可读部分与机器可读部分：
1. **标题**：遵循语义化前缀，如 `fix(contract): resolve ambiguous quoted targets and align error messages (fixes #11, #12)`。
2. **正文内容**：
   - 概述说明；
   - 关联 Issue 语法（必须包含 `Fixes #<id>` 或 `Closes #<id>`）；
   - 四大门禁通过凭证；
   - 测试用例与覆盖面说明。
3. **机器元数据块**：在 PR 正文末尾嵌入 HTML 注释 `<!-- loopx-meta: {...} -->`。

### 7.2 `loopx-meta` 机器元数据规范

元数据采用标准 JSON 格式，字段定义如下：

```html
<!-- loopx-meta: {
  "schema_version": "loopx-meta/v1",
  "goal_id": "fix-issue-11-12",
  "head_oid": "349fb1e57c8bfbc43ff8e91f13fa9aa66e70ad60",
  "pipeline": "pipeline-b-issue-fix",
  "gates": {
    "typecheck": "pass",
    "lint": "pass",
    "build": "pass",
    "test": {
      "status": "pass",
      "files": 55,
      "passed": 630,
      "failed": 0
    }
  },
  "l1_evidence_path": ".trae/specs/fix-issue-11-12/l1-review-evidence.md",
  "closes_issues": [11, 12]
} -->
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `schema_version` | string | 固定为 `"loopx-meta/v1"` |
| `goal_id` | string | 对应的 LoopX Goal ID |
| `head_oid` | string | 该次 PR 的完整 40 位 HEAD commit SHA |
| `pipeline` | string | `"pipeline-a-feature"` 或 `"pipeline-b-issue-fix"` |
| `gates` | object | 包含 typecheck, lint, build, test 的最新结果与测试数 |
| `l1_evidence_path` | string | L1 审查证据的相对路径或公开 URL |
| `closes_issues` | array | 关联解决并需核销的 GitHub Issue 编号列表 |

---

## 8. 审批人标准：核验清单、一票否决与决策矩阵（The Approval Standard）

> **审批人的定位与核心价值**：
> 审批人**无需**通读整套复杂变更的每一行实现细节，而是作为质量与架构把关人，基于**结构化证据链**（L1 独立审查结论 + L2 五 Block 审查报告 + 4 大门禁数据 + 云端 CI 状态 + 机器元数据一致性）进行精准决议。

### 8.1 8 项审批事实核验清单（Approval Checklist）

审批人在点击 Approve 或授权合入前，必须逐项核对以下 8 项客观事实：

| # | 核验项 | 证据来源 | 合格判据 |
|---|---|---|---|
| **1** | **改动范围** | PR Files / git diff | 生产代码聚焦，无无关格式化或无关重构；Issue 修复代码量通常 ≤500 行 |
| **2** | **契约稳定性** | spec 冻结块 vs 代码 | 公开接口、类型签名、退出码（0/1/2/3/4/130）无非预期漂移 |
| **3** | **四大门禁全绿** | 本地跑测输出 / PR 报告 | typecheck / lint / build / test 全 PASS，测试用例数只增不减 |
| **4** | **L1 审查闭环** | `l1-review-evidence.md` | 证据文档真实落盘，AC 逐条对账完毕，7 大红线全守，结论为 PASS |
| **5** | **分支可干净合并** | PR mergeable 状态 | base 上无冲突，合入路径清晰，无未解决的变更保护阻断 |
| **6** | **loopx-meta 锚定** | PR Body 注释块 | 机器元数据齐备，`head_oid`、`gates`、`goal_id` 真实无缺漏 |
| **7** | **L2 报告与 SHA 一致** | PR Review 评论 | 五 Block 齐备，Verdict 为 `APPROVED`，报告中 HEAD OID 与 PR 完全吻合 |
| **8** | **云端 CI Checks 全绿**| PR 底部 Checks | GitHub Actions 实际运行并通过（`conclusion: success`），非 0 记录 |

---

### 8.2 五大一票否决红线（Fast Reject / Changes Requested）

只要命中以下任意一项，审批人**必须一票否决**，立即打回并要求补正，严禁"先合入再补票"：

1. 🚫 **无先红复现证据**：Issue 修复未提供在原始基线上的先红报错记录，属于"凭空猜测修复"。
2. 🚫 **触犯 7 大架构红线**：如突破封闭动作集、新增未授权断言原语、颠倒不可逆步骤 postcondition 顺序、新增未经许可依赖等。
3. 🚫 **HEAD SHA 脱节漂移**：L2 审查报告中审查的 Commit SHA 与 PR 当前最新 HEAD OID 不一致（存在偷跑改动风险）。
4. 🚫 **证据链断裂**：PR 缺失 `<!-- loopx-meta -->`，或本地/PR 上缺失 L1 独立审查证据文件。
5. 🚫 **门禁或 CI 异常**：测试出现用例净减少、存在跳过/失败用例，或云端 Actions CI 处于失败/未执行状态。

---

### 8.3 审批决议与状态流转

```
                    ┌─────────────────────────┐
                    │    审批人发起 8 项核验    │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │ 命中一票否决 或 关键证据缺失? │
                 └───────┬───────────────┬───────┘
                         │ 是            │ 否 (全部核验通过)
                         ▼               ▼
        ┌─────────────────────────┐  ┌─────────────────────────┐
        │ 决议: Request Changes   │  │ 决议: Approve           │
        │ 列明具体问题与补正要求  │  │ 授权执行 Squash & Merge │
        │ 退回开发者重走闭环      │  │ 进入合入与收尾三件套    │
        └─────────────────────────┘  └─────────────────────────┘
```

---

## 9. 合入与收尾三件套（Lifecycle Closure）

审批通过后，必须按以下三步完成物理与生命周期的严格收尾：

### 9.1 原子合入：Squash and Merge
- 本项目禁止使用直接 Merge Commit（会产生大量微小、fixup 提交污染主干 git log）；
- 必须选择 **Squash and merge**，并将所有中间提交合并为一条整洁、语义清晰的规范提交，格式示例：
  ```
  fix(contract): resolve ambiguous quoted targets and align error messages (#15)

  - parseTargetValue strict validation
  - sanitize target without stripping dots
  - add number DOM assertion guidance
  - full test coverage: 55 files / 630 tests
  - Closes #11, #12
  ```

### 9.2 Issue 状态联动与核销
- 若 PR body 包含 `Fixes #<id>`，GitHub 会在 PR 合入 main 后自动将该 Issue 标记为 Closed；
- **多 Issue 场景核销**：若一个 PR 同时解决了辅助 Issue（如关联的技术债务或重构 Issue），必须在 PR 合入后立即由负责人手工核销该辅助 Issue，并在关闭备注中回链本次合入 Commit SHA。

### 9.3 Goal 严格生命周期关闭（账实相符原则）
- **严禁倒置**：严禁在 PR 处于 open 状态时提前执行 `stop` 关闭 goal，必须在代码真实合入 main 后才能收尾；
- **执行命令**：
  ```bash
  # 先预览
  loopx goal-lifecycle --goal-id <GOAL_ID> --operation stop --actor-kind controller
  # 确认无误后执行
  loopx goal-lifecycle --goal-id <GOAL_ID> --operation stop --actor-kind controller --execute
  ```
- **账实相符验证**：运行 `loopx status`，确认当前队列中该 goal 状态已归档，注意力队列中无挂起任务。

---

## 10. 故障与异常处理

| 现象 | 处理 |
|---|---|
| `heartbeat-prompt: goal_id not found` | goal 未进注册表；先 `start-goal`/`bootstrap-command-pack` |
| `quota should-run` 拒绝/退避 | 按 scheduler_hint 等待，不重复强跑 |
| doctor `repair_recommended` | 非阻塞；安排单独的 `loopx update` 变更，不与 Feature 混做 |
| Agent 行为异常/中途跑偏 | `loopx diagnose --goal-id` + `evidence-log --thin` 取证后再 replan |
| todo 疑似被并发执行 | 用 `task-lease inspect` 核对租约归属，必要时 transfer/release |
| diff 与回执对不上 | `change-quality verify` 会失败；以精确 diff 为准重新 record |

## 11. 实战复盘与案例沉淀

### 11.1 F1 实战复盘（管线 A：首个完整走完八步的 Feature）

> Feature：`f1-draft-autocomplete` —— Draft 未映射步骤的确定性 Skills 自动补全（CLI 子命令 `idwth complete`）。
> 产出：PR [#2](https://github.com/JustinIan-AI/Jev-E2E-WebTest/pull/2) ｜ 51 文件 / 590 测试全绿（基线 568 只增不减）。
> 下面沉淀的是**实际踩到、且后续 Feature 可直接复用**的经验，不是流程复述。

#### 1. 排兵布阵：先冻结「接口契约」，再放 Codex 跑 TDD
F1 的 tasks.md 在子任务之前先放了一段 **接口契约（实现前对齐）**：明确 `completeDraft({draft, featureRaw}) → CompletionResult` 的字段、`Confidence`/`StepCandidate` 形状、`candidates` 与 `unmapped_steps` 数量守恒的注释。
- 好处：Codex 分多个 todo（F1-1 引擎 / F1-2 顺序 / F1-3 CLI / F1-4 回归）独立实现时，模块边界一次定死，中途没有返工改签名。
- 复用建议：凡是"纯函数引擎 + CLI 外壳"类 Feature，T1 的 tasks 里**先写接口块再写任务清单**，把不变量写成字段注释（如"与未映射步骤一一对应、数量守恒"），让测试天然可对照。

#### 2. 跨会话重启：状态在 LoopX + spec/tasks，不在对话记忆里
F1 实际经历了"重启 Codex 续跑"。能无损接上，靠的是：goal/todo/evidence 落在 LoopX，进度与预期结果落在 `.trae/specs/<feature>/tasks.md`，代码在工作区——**不依赖上一段对话的上下文**。
- 复用建议：换会话/重启 Agent 后，先 `loopx status` + 读 tasks.md 核对每个 `[x]` 的"预期结果"，再决定续跑点；不要凭对话摘要判断完成度。

#### 3. T7 真正抓到的关键缺陷：R4「时间顺序」被放宽（最有价值的一条）
Codex 初版在重建 Contract 时，对不可逆步骤（terminate sessions）补 postcondition，会把**位于该步骤之前**的可见性断言也借来当后置条件，导致一个本质不可逆、且之后无任何确认断言的步骤被保留为 `irreversible`——属于 Recovery False Positive 逃逸，违反 R4。
修复（`complete.ts`）：
- 引入 `assertionOrigins: number[]`，记录每条断言来自第几步；
- R4 收尾只接受 `origin > stepIndex`（断言严格位于该步骤**之后**），找不到就**保守降级 `reversible`**，而不是硬凑 postcondition；
- 新增回归用例 `F1-2.4a`：不可逆步骤"之后无断言、之前有断言"时，不得借用早先断言。

#### 4. 确定性补全引擎的五条 Review 不变量
F1 review 沉淀出适用于本项目所有"映射/补全/生成 Contract"类改动的硬性检查点：
1. **封闭集不被突破**：不得产出基线 7 动作 / dom 断言原语之外的新 action/kind（R5/R6）。
2. **时间顺序正确**：postcondition 严格在步骤之后。
3. **数量守恒**：输出候选数 == `unmapped_steps` 数，一一对应。
4. **原文不丢、draft 不被破坏**：无法补全/medium 时 `--apply` 返回 3，原 draft 文件与 `_draft.unmapped_steps` 原样保留。
5. **零网络零模型**：补全在 Authoring，纯函数，不进 Runtime 主回路；file 上传只产语义 target，禁止文件路径字面量/选择器（R7）。

#### 5. 退出码边界：3（CONFIG_ERROR）与 4（RUNTIME_ERROR）要分场景钉测试
- draft **自身非法**（缺 `_draft`、缺 `source_feature` 字段）→ **3 CONFIG_ERROR**；
- draft 合法，但它**引用的外部 feature 文件不存在**（运行期 IO 失败）→ **4 RUNTIME_ERROR**；
- `--apply` 时存在 medium/无法补全（业务上不允许落定）→ **3**，且不产出 contract。
判据口诀：**配置/契约内容不对 = 3；依赖的外部资源在运行时取不到 = 4。**

---

### 11.2 Issue #11/#12 实战复盘（管线 B：缺陷修复全流程补正与真实 Bug 拦截）

> 修复目标：Issue [#11](https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/11)（解析目标多引号歧义与错误指引对齐）+ [#12](https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/12)（中期里程碑收尾）。
> 产出：PR [#15](https://github.com/JustinIan-AI/Jev-E2E-WebTest/pull/15)（Commit `4508677`）｜ 55 文件 / 630 测试全绿。
> 意义：本项目首个**端到端完整补正管线 B 规范**的典型案例。

#### 1. 历史执行的反模式清单（本次补正重点整治的误区）
1. **流程倒置与账实不符**：PR 仍处于 open 状态时，执行者已提前运行 `loopx goal-lifecycle stop`，导致活跃状态账实脱节；且本地工作区挂着未提交改动。
2. **无红箱复现证据**：修复前未保留先红测试输出日志，导致无法在审计时证明"原先确实存在 Bug"以及"改动是否精准修复了对应缺陷"。
3. **元数据缺失与 L2 审查失踪**：PR 正文缺少 `<!-- loopx-meta -->`，未执行 `loopx pr-review` 生成五 Block 报告，审批人在 GitHub 上看不到任何结构化结论与风险说明。

#### 2. L1 独立代码审查的真实价值：拦截两处隐藏缺陷
在 Trae 独立进行 L1 Gatekeeper Review 时，并未轻信"测试已绿"，而是逐行核对 `src/` 与基线契约，成功拦截了两处若合入必将产生次生 Bug 的缺陷：
- **缺陷 1：契约引导提示遗漏原语**
  - 在 `src/runtime/contract/init-from.ts` 的 `unrecognized-assertion` 提示中，原始实现列举了 6 种原语，漏掉了第 7 种 `数量为（number）`。L1 审查将其补全，确保了 7 种 DOM 断言原语完全闭环。
- **缺陷 2：TypeScript 契约类型缺失属性（TS2739 风险）**
  - 修改 `feature-to-contract.ts` 时，调用 `contractError('unrecognized-assertion', ...)` 漏填了契约必须的 `availablePrimitives` 属性，导致潜在类型检查报错风险。L1 审查现场纠正并补充测试。

#### 3. 规范先红用例的标准路径与写法
- 用例路径固定在 `tests/unit/issues/issue-11.test.ts`；
- 在改动前基线上执行，明确捕获 **6 个用例失败（RED）**，分别验证了多引号错误抛错、非末尾引号容忍、中文填写模式、错误提示原语完整性等；
- 修复后该测试转为 **7/7 全绿（GREEN）**，四大门禁提升至 55 files / 630 tests。

#### 4. 标准审批包的呈现与高效合入
通过汇总包含：
- **L1 独立审查证据**（`.trae/specs/fix-issue-11-12/l1-review-evidence.md`）
- **L2 Exact-Head 报告**（PR #15 评论中的五 Block 报告，SHA `349fb1e` 严格对应）
- **PR `loopx-meta` 机器元数据**（绑定 gates 与 closes_issues）
- **GitHub Actions 云端全绿证据**
审批人仅需花费 1 分钟核验 8 项指标，即可明确批准。随后经 Squash and merge 合入，Issue #11 自动关闭，Issue #12 联动收尾，完成了真正的工业级闭环。

---

## 12. 最小命令 Cheat Sheet

```bash
# === 1. 环境与状态 ===
loopx doctor                                     # 环境全面体检
loopx status                                     # 全局目标、任务与队列状态

# === 2. Goal 生命周期 ===
loopx start-goal --guided --project . --goal-text "<目标描述>"
loopx goal-lifecycle --goal-id <G> --operation pause|resume|stop --actor-kind controller [--execute]

# === 3. Agent 注册与心跳 ===
loopx register-agent --goal-id <G> --agent-id '<id>' --require-new --execute
loopx heartbeat-prompt --goal-id <G> --runtime-profile codex_cli --thin
loopx quota should-run --goal-id <G> --runtime-profile codex_cli

# === 4. Todo 与租约生命周期 ===
loopx todo --goal-id <G> --role agent --text "<任务>" --add
loopx todo --goal-id <G> --todo-id <ID> --claim-operation-id <OP> --claimed-by <A>
loopx todo --goal-id <G> --todo-id <ID> --status done \
  --validation-command "npm test" --evidence "<证据路径>"
loopx task-lease acquire|renew|release --goal-id <G> --todo-id <ID>

# === 5. 审查、报告与 PR 流程 ===
loopx review-packet --goal-id <G> --agent-id <A>
loopx change-quality prepare|record|verify
loopx pr-review --target-exact-head <PR_NUMBER>@<HEAD_OID>   # 生成 L2 五 Block 审查报告

# === 6. 诊断与取证 ===
loopx diagnose --goal-id <G>
loopx history --goal-id <G>
```
