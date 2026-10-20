# Aegis 使用手册（JEV-E2E-Test / IDWTH 项目）

> Aegis Method Pack：让 AI 编程 Agent 先对齐真实基线再动手、用新鲜证据证明完成、简单任务不背流程。
> 本手册基于 2026-10-20 的全局安装（Trae 宿主）。

## 1. 安装信息

| 项 | 路径 / 值 |
| --- | --- |
| 方法包检出（更新与验证用） | `~/.trae/aegis` |
| 技能发现目录 | `~/.trae/skills/<skill-name>/SKILL.md` |
| 本地配置 | `~/.config/aegis/config.toml` |
| 安装验证 | `ok: true` / `workspaceSupport: available` / `configStatus: configured` |
| 激活模式 | `auto`（自动匹配，也可显式点名） |
| TDD 模式 | `off`（不自动强制 TDD，完成前验证始终生效） |

已安装 23 个技能，重启 Trae 或新建会话后全部可被发现。

## 2. 在本项目中怎么用

正常描述任务即可，Aegis 按风险自动选方法；需要确定性时直接点名。

### 2.1 日常触发语（自然语言）

```text
replay --verify 出现 drift 误报，先复现并追到真实根因，再改代码。
这个 L3 语义兜底改动会不会破坏 SIR=0？用第一性原理审查后再动手。
Aegis goal: 修复 Freshness 校验漏判，但不改变 Judge 的纯函数语义。
合并前独立审查这个 diff，并列出未覆盖的范围。
审问我这个离线包构建方案，每轮只问一个决策问题。
```

### 2.2 显式入口（消除歧义时使用）

| 入口 | 作用 |
| --- | --- |
| `Aegis goal: ...` | 走 `goal-framing`：固定目标、成功证据、停止条件、非目标 |
| `审问我 ...` / `Grill me ...` | 走 `brainstorming`：一次一个决策问题，不规划不实施 |
| `TDD Route: strict` / `strict TDD` | 该任务严格 RED → GREEN → REFACTOR |
| `aegis:first-principles-review` | 实现前压力测试复杂方向 |
| `aegis:update` | 更新已安装的方法包 |

## 3. 技能地图（按本项目场景）

### 诊断与修复 —— 适用于 Judge / Provider / Replay 类问题

- **systematic-debugging**：bug、回归、异常行为的默认入口；复现 → 因果追踪 → 定位 canonical owner，禁止症状层补丁。
- 问题跨层时可要求"七层诊断"：症状 → 逻辑 → 组件边界 → 架构/所有权 → 跨系统契约 → 平台约束 → 规格缺口，在证据闭合层停止。
- **first-principles-review**：新增 fallback / adapter / 兼容路径前审查其存在必要性（本项目已有 L1/L2/L3 与多 Provider，严防第四套兜底）。

### 规划与执行 —— 与 spec/tasks 工作流配合

- **brainstorming**：需求模糊时先澄清再实施（如 F1 草稿自动补全类功能）。
- **writing-plans**：把已确认意图转成实施计划；产出后仍以 `.trae/specs/**/plan.md` 和 `tasks.md` 为任务执行准绳。
- **executing-plans** / **subagent-driven-development**：按 tasks.md 顺序切片执行。
- **dispatching-parallel-agents**：仅当任务 owner 彼此独立时并行（如 `src/runtime/replay/` 与 `src/cli/` 的独立改动）。
- **long-task-continuation**：长任务配合 Aegis 工作区 checkpoint，上下文压缩后可安全续接。

### 审查与收尾

- **requesting-code-review**：完成后、合并前的自检。
- **receiving-code-review**：评审反馈先判断是否应采纳，再动手。
- **verification-before-completion**：说"完成"前必须给出新鲜证据、已覆盖/未覆盖范围、残余风险。
- **finishing-a-development-branch**：选择 PR / 合并 / 清理方式，不擅自执行 git 动作。
- **anti-entropy-governance**：改动后检查复杂度增量，旧路径必须删除、有据保留或安排退役（防"幽灵代码"）。
- **recording-architecture-decisions**：已实施并验证的架构决策按需沉淀 ADR。

### 其他

- **test-driven-development**：仅在显式要求或 `tdd-mode auto` 时加载。
- **ui-ux-governance**：改动涉及 `src/cli/assets/report-template.html` 等报告界面时组合使用。
- **establishing-project-context**：新会话快速建立项目上下文（读取最小权威文档集）。
- **communicating-concisely**：输出约束。
- **using-git-worktrees** / **writing-skills** / **update-aegis**。

## 4. 本项目的强制约定（Aegis 不会覆盖）

用户/项目规则优先级高于 Aegis，执行中始终遵守：

1. 遵循 `.trae/specs/**` 下规范，严格按 `plan.md` 计划、按 `tasks.md` 顺序执行。
2. 每个任务完成后核对预期结果，并将 `tasks.md` 中状态改为【✅】。
3. 测试用例只放 `tests/`；前端代码放 `frontend/`，后端代码放 `backend/`。
4. 提交代码优先通过 GitHub MCP 完成。
5. 维护项目关键不变量：Judge 纯函数语义、CI 路径 SIR=0、mutation 前 Freshness 校验、六值退出码。任何 Aegis 规划若与这些不变量冲突，以不变量为准并提示风险。

## 5. Aegis 项目工作区（长任务按需启用）

中高复杂度或跨会话长任务时，Aegis 可在项目内 `docs/aegis/` 持久化意图、baseline、checkpoint、证据与 drift 状态；微小任务默认不创建。

```text
为这个任务建立 Aegis 工作区记录，每个切片后保存 checkpoint。
从 Aegis 工作区续接；先比对 checkpoint 与当前 worktree 是否漂移。
```

生命周期（helper 支持）：`init` → `new-work` → `add-checkpoint` / `add-evidence` / `add-drift-check` → `bundle` → `check`。
工作区记录是 draft/hint/evidence，不是项目事实的权威来源；项目正式 spec 与 tasks.md 优先。

## 6. 开关与维护

```bash
# 切换激活模式（默认 auto；Trae 下 explicit 不覆盖原生匹配，需显式点名技能）
cd ~/.trae/aegis && python3 scripts/aegis-doctor.py activation-mode explicit
cd ~/.trae/aegis && python3 scripts/aegis-doctor.py activation-mode auto

# 让 Aegis 按任务风险自动选择 strict/light/skip TDD
cd ~/.trae/aegis && python3 scripts/aegis-doctor.py tdd-mode auto

# 更新（之后重启 Trae）
cd ~/.trae/aegis && git pull && cp -R skills/* ~/.trae/skills/
# 或直接在对话中说：aegis:update / 更新 Aegis

# 重新验证安装（必须在方法包根目录运行，勿在项目目录运行）
cd ~/.trae/aegis && python3 scripts/aegis-doctor.py --write-config --json --discovery-root ~/.trae/skills
```

卸载：删除 `~/.trae/skills/` 中由 Aegis 复制的技能目录后重启 Trae（需要时再删 `~/.trae/aegis`）。

## 7. 故障排查（技能未触发）

按触发链路依次检查，不要先堆关键词：

1. `~/.trae/aegis` 检出与版本是否存在；
2. `~/.trae/skills/<skill>/SKILL.md` 是否就位（重启 Trae / 新建会话）；
3. 激活模式与 Trae 原生匹配行为；
4. 任务到技能的路由是否清晰（改用第 2.2 节显式入口）；
5. 上下文压缩导致的压力（长任务改用工作区 checkpoint）。

## 8. 边界

Aegis 是方法层（workflow discipline + advisory judgment + 项目内证据），不是运行时平台、daemon，也不拥有完成、合并、发布的最终权威。完成声明以新鲜验证证据为准，最终决策权在用户。

参考：
- Aegis 仓库：https://github.com/GanyuanRan/Aegis
- Trae 安装说明：`~/.trae/aegis/docs/README.trae.md`
- 速通秘籍（中文）：`~/.trae/aegis/docs/current/AEGIS_FAST_TRACK_PLAYBOOK_ZH.md`
