# AGENTS.md — 项目协作主规则

> 本文件是本仓库所有 AI Agent / 人类协作者的**唯一主规则（single source of truth）**。
> 任何其他规则文件（如 `projects_rules.md`）只引用本文件，不得复制或分叉其中内容。
> 当本文件与对话记忆、历史摘要或其他本地规则冲突时，**以本文件为准**。

---

## 1. 项目概述

- **IDWTH**（Intent-Driven Web Test Harness）：意图驱动的 Web 系统测试工具。
- 形态：**单体 Node.js（`>=22`）/ TypeScript CLI**，`"type": "module"`。
- 代码主体在 `src/`，CLI 入口 `bin/idwth.js`。
- 所有命令**单次执行后退出**，无 daemon / server 模式。

## 2. 目录与分层约定

- 后端 / 业务逻辑、前端等代码：常规项目应分别置于 `backend/`、`frontend/`；
  **本项目已获豁免**（spec 2026-10-10）：单体工程，统一放在 `src/`，不新建分层目录。
- **所有测试用例必须放在 `tests/` 目录**（`tests/unit`、`tests/contract`、`tests/integration`、`tests/fixtures`、`tests/helpers`）。
- Feature 规格与任务清单放在 `.trae/specs/<feature>/` 下：`spec.md` + `tasks.md`。
- 流程 / 手册类文档放在 `docs/`。

## 3. 工程基线与退出码

- 固定退出码：`0=PASS · 1=FAIL · 2=BLOCKED · 3=CONFIG_ERROR · 4=RUNTIME_ERROR · 130=CANCELLED`。
- 封闭集合：动作仅 `click / fill / select / scroll / wait / navigate / assert_only`；
  dom 断言原语仅 `visible / absent / count ...`（以 `validate.ts` 与 schema 为准），不得擅自新增。
- 关键规则：
  - **R4**：`risk=irreversible` 的步骤必须有非空 `postcondition`，且该断言必须严格位于该步骤**之后**；取不到则保守降级 `reversible`。
  - **R7**：`target` 禁止 selector / xpath / 坐标 / JS，只允许语义短语。
- 不新增运行时第三方依赖（沿用现有 `yaml` / `ajv` 等）；如需新增必须先说明并经确认。

## 4. 标准质量门禁（每次交付必须全绿）

```bash
npm run typecheck
npm run lint
npm run build
npm run test        # vitest run；测试数只增不减，不允许回归
```

- TDD：先在 `tests/` 写失败用例 → 实现 → 全量回归。
- 提交前必须确认以上四条门禁通过，并记录测试文件数 / 用例数。

---

## 5. LoopX 驱动的任务执行流程（**后续任务以 LoopX 为主**）

> 自 F1 起，任务编排、状态与证据以 LoopX 为事实来源，禁止"绕开回路本地直驱后不回写"。

### 5.1 标准八步工作流

| 阶段 | 执行者 | 动作 |
|---|---|---|
| **T1 计划** | Trae（控制器） | 研读接缝代码，产出 `.trae/specs/<feature>/spec.md` + `tasks.md`；在 tasks 中**先冻结接口契约块**（类型签名 + 不变量注释），再列子任务。 |
| **T2 注册** | Trae | `loopx start-goal` 注册 goal；`register-agent` 注册执行 agent；将子任务以 `loopx todo add` 拆入 goal（带优先级 / task_class）。 |
| **T3–T6 实现** | Codex（执行 agent） | 作为**注册 agent 走 LoopX 回路**执行：`claim → TDD 实现 → 验证 → state writeback`，不得脱离回路本地直驱。 |
| **T7 评审** | Trae | `loopx review-packet` 收集证据，独立 code review，核对验收标准（AC）与架构红线。 |
| **T8 提交/确认** | Trae | 进度确认 + GitHub MCP 提交 / PR；并完成 LoopX 收尾（见 5.4）。 |

### 5.2 LoopX 状态回写约束（强制）

- 每个子任务完成后，**必须**用 `loopx todo complete`（不是 `todo update --status done`）回写，
  并携带：
  - `--validation-command` / `--validation-label`：可复跑的验证命令（如 `npm test`）；
  - `--evidence`：产物路径与结果（测试计数、构建结果）；
  - `--note`：关键变更 / 风险 / 修复点；
  - 若无后续动作，显式 `--no-follow-up`；否则用 `--follow-up` 登记后继。
- 任务完成判定以 **LoopX 状态 + tasks.md 双对账**为准：
  - `tasks.md` 中勾选 `[x]` 并把"预期结果"标记为【✅】；
  - 同步保证 LoopX todo 状态一致，**不允许只维护其一**。
- 跨会话 / 重启 Agent 后：先 `loopx status` + `loopx todo list` + 读 `tasks.md` 核对，再决定续跑点；不得凭对话摘要判断完成度。

### 5.3 每个执行 tick 的收尾义务

执行 agent 每个 tick 结束时必须给出：**变更文件、验证结果、残余风险、下一步动作**，并完成 `state_writeback`。
- 执行档约束：`cadence=bounded_progress_segment`、`spend_rule=spend_only_after_artifact_validation_writeback`、
  `checkpoint_accounting=advancement_only`。
- 默认只读；未获明确批准，不得对生产系统做不可逆操作。

### 5.4 Goal 收尾

- 全部 todo 为 done、AC 达成、门禁全绿后：
  - `loopx goal-lifecycle --goal-id <id> --operation stop`（先 dry-run 确认，再 `--execute`）；
  - 合并完成、确无后续后按需 archive runtime。
- 不允许 goal 长期停留在 active 而任务实际已结束的"账实不符"状态。

### 5.5 确定性 / 安全红线（适用于所有映射 / 补全 / 生成 Contract 类改动）

1. 封闭集合不被突破（不新增 action / dom kind）。
2. 时间顺序正确（postcondition 严格在步骤之后；不得借用早先断言）。
3. 数量守恒（输出与输入未映射项一一对应）。
4. 原文不丢、草稿不被破坏（无法自动落定时保留 draft 并返回对应错误码）。
5. **零网络零模型**：Authoring 阶段的确定性能力不派发任何模型 / JEV / LLM，不进 Runtime 主回路。

### 5.6 退出码边界（配置 vs 运行时）

- 配置 / 契约内容不合法 → `3 CONFIG_ERROR`；
- 依赖的外部资源在运行时取不到（如被引用的 feature 文件不存在、IO 失败）→ `4 RUNTIME_ERROR`；
- 不允许自动落定（存在 medium / 无法补全）→ `3`，且不产出 ready 产物。

---

## 6. 提交与 PR 规则

- **优先使用 GitHub MCP 提交**（用户规则）；不直接推送 `main`。
- 分支命名：`feature/<feature短名>`（如 `feature/f1-draft-autocomplete`），经 PR 合入 `main`。
- 提交实操：
  - 多文件用 `push_files`（单 commit）；payload 过大时改为**单文件 / 小批量**推送，避免瞬态错误。
  - 更新已存在文件用 `create_or_update_file`，需先取目标分支上的 **sha**。
  - MCP 的 token 若缺 Pull Requests 写 scope（`Permission Denied ... personal access token`），
    重试无意义，改用本机已登录的 `gh` CLI 创建 PR 兜底；**代码提交仍以 MCP 为主**。
- 保持 PR 聚焦：只提交该 Feature 相关文件；流程文档（`docs/`）单独提交，不混入特性 PR。
- `.codex/`、`.loopx/` 等本地运行时目录必须加入 `.gitignore`，不得提交心跳 / 会话 / 私有证据。
- 禁止把凭据、私有 IP、本地路径、原始日志写入公开提交。

## 7. 规则文件关系

- 本文件 `AGENTS.md` 为主规则；`projects_rules.md` 仅做指针引用。
- 修改规则时只改本文件，避免多处分叉。
