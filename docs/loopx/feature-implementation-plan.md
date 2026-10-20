# IDWTH 后续 Feature 实施计划（LoopX + Codex CLI 驱动）

> 工具基线：LoopX 1.0.2（持久状态/证据/门禁层）｜ Codex CLI 0.162.1（agent runtime）
> 角色：**Trae 负责每个 Feature 的计划制定、code review、进度确认**；**Codex 经 LoopX 心跳循环负责实现**
> 配套手册：[loopx-usage-manual.md](./loopx-usage-manual.md)

---

## 一、当前项目诊断结论

### 1.1 交付状态（健康）
| 项 | 实测结果 |
|---|---|
| 工程形态 | 单体 Node ≥22 / TypeScript CLI（`src/` + `tests/`），无前后端分离 |
| V1 基线 | spec 的 Task 1~19 全部 `completed【✅】` |
| 测试 | `npm test` → **49 文件 / 568 用例全绿**（含真实 Chrome CDP 集成） |
| 类型/构建 | `npm run typecheck` 0 错误；`npm run build` 通过 |
| Git | `main` 干净；远端 `JustinIan-AI/Jev-E2E-WebTest`；CI 已在 GitHub Actions 全绿 |
| 工作区 | 无未提交改动 |

### 1.2 工具链状态
| 项 | 结果 | 说明 |
|---|---|---|
| loopx 安装 | 正常（1.0.2，pip venv + homebrew shim） | 控制面 `ready`，全局注册表可写 |
| codex-cli | 正常（0.162.1，`~/.local/bin/codex`） | 作为唯一 agent runtime |
| Codex 侧 LoopX skill | 已安装 `loopx-project` 等 | 可直接 `/loopx` |
| install freshness | `repair_recommended`（可升级） | **非阻塞**，单独变更处理，不与 Feature 混做 |
| loopx-benchmark skill | 路由 routes=0 | 仅影响基准能力，不影响开发主链路 |

### 1.3 结论
项目处于 **V1 已完整交付、可直接进入后续 Feature 迭代** 的状态。后续工作不改动 V1 已冻结契约，以 spec 中明确列入 Backlog/P1 的范围为候选 Feature，逐个经 LoopX 编排实施。

## 二、实施总原则

1. **计划驱动**：每个 Feature 先在 `.trae/specs/<feature>/` 产出 spec + tasks，含验收标准与**可复跑验证命令**，Trae 评审通过后才开工（对齐用户"遵循 spec/plan"规则）。
2. **LoopX 为状态底座**：一个 Feature = 一个 LoopX goal；任务以 todo + task-lease 管理；每轮先过 `quota should-run`。
3. **Codex CLI 为唯一实现 runtime**：保持可见 TUI，`/goal <thin task_body>` 挂载，不用隐藏 headless。
4. **TDD 不可省**：测试先写且置于根目录 `tests/`；done 必须附 validation-command + evidence。
5. **Trae 双门禁**：每个 Feature 必须经过 ① code review（精确 diff）② 进度确认（tasks.md 置【✅】+ GitHub MCP 提交/PR），二者均由 Trae 完成。
6. **架构红线不被用户目录约定覆盖**：本仓库 spec 明确豁免 `backend/`/`frontend/`，**继续维持单体 `src/`**，评审中以此为准。

## 三、Feature 候选队列（基于 spec 的 Backlog / P1，按优先级）

| 序号 | Feature | 来源依据 | 优先级 | 预估规模 | 依赖 |
|---|---|---|---|---|---|
| F1 | `init --from` 未映射步骤的 Skills 自动补全 | Task 19 预留的 `_draft.unmapped_steps` 数据基础 | high | M | 无 |
| F2 | `--keep-on-failure` FAIL 现场保留（P1 显式开关） | spec Non-Goals 明示 P1 | high | S | 无 |
| F3 | iframe / Shadow DOM 定位支持 | spec Non-Goals 明示延后 P1 | medium | M | 无 |
| F4 | 完整 Eventually 语义（带 deadline 的轮询断言） | spec Non-Goals | medium | M | 无 |
| F5 | `replay --heal` 审计增强 | spec Non-Goals | medium | S | F1 |
| F6 | 多模态 Canvas 渲染断言（VB-01~VB-05） | spec：**仅当外部提供多模态能力且主动要求才立项** | 待定 | L | 外部能力前置 |

> 队列按"high 优先 + 依赖就绪"顺序执行；F6 不主动启动。每个 Feature 开工前可依据最新需求重排，但需 Trae 在 plan 中留痕。

## 四、单 Feature 标准开发计划模板

> 每个 Feature 复制本模板落到 `.trae/specs/<feature-id>/tasks.md`，并按手册第 5 节八步执行。

```
Feature: <id> - <名称>
Goal ID(LoopX): <注册后回填>
Agent ID: idwth-feat-<短名>
分支: feat/<短名>

阶段 T1 计划（Trae）
  - 产出 spec.md / tasks.md：范围、验收标准、验证命令、非目标
  - 门禁：人工确认计划后才进入 T2

阶段 T2 注册（Trae）
  - loopx start-goal --guided --project . --goal-text "<目标>"
  - loopx register-agent --goal-id <G> --agent-id 'idwth-feat-<短名>' --require-new --execute
  - 按 tasks 拆 agent todo（每个 todo 绑定 validation-command）

阶段 T3 挂载（Codex CLI）
  - loopx heartbeat-prompt --goal-id <G> --runtime-profile codex_cli --thin
  - 可见 TUI 内 /goal <task_body>
  - loopx quota should-run --goal-id <G> --runtime-profile codex_cli 放行

阶段 T4 实现（Codex，TDD）
  - task-lease 领取 → 先写 tests/（RED）→ 实现（GREEN）
  - 每步：npm run typecheck / npm test

阶段 T5 todo 收尾（Codex）
  - todo --status done 必须附 --evidence 与 --validation-command 结果

阶段 T6 评审包（Codex → Trae）
  - loopx change-quality prepare
  - loopx review-packet --goal-id <G> --agent-id <A>

阶段 T7 Code Review（Trae）
  - 按手册第 6 节清单逐项核对精确 diff
  - loopx change-quality verify
  - 通过→T8；不通过→回 T4 开修复 todo（意见入证据）

阶段 T8 进度确认与提交（Trae）
  - tasks.md 任务置 completed【✅】+ 证据摘要
  - GitHub MCP：push feat 分支 → 开 PR →（CI 绿）合并 main
  - loopx goal-lifecycle 收尾；确认 status 无残留
```

## 五、首个 Feature（F1）执行计划细则

**Feature F1：Draft 契约未映射步骤的 Skills 自动补全**
- 背景：Task 19 已让未映射 Gherkin 步骤落入 `.draft.yaml` 的 `_draft.unmapped_steps`（三类：`unmapped-precondition` / `unmapped-action` / `unrecognized-assertion`），并明确"为后续 Skills 自动补全预留数据基础"。F1 即兑现该接缝。

| Todo | 内容 | 验证命令 |
|---|---|---|
| F1-1 | 读取 `_draft.unmapped_steps`，基于 7 个 Skill 的封闭动作集/七断言原语生成**候选映射**（仍不猜测：低置信只给候选、不自动落定） | `tests/unit/` 新增单测 |
| F1-2 | 新增 CLI 子命令（如 `idwth complete <draft>`）输出补全建议/交互确认；ready 后经 `validateContract` 九规则校验 | `tests/contract/` CLI 测试 + 退出码断言 |
| F1-3 | 全程中英文步骤分类准确；无法补全项保持 draft 且不丢失 | 特征夹具回归（sample.feature） |
| F1-4 | 文档与 skill 行为声明同步（仅在逻辑不自明处） | typecheck |

- 验收标准：
  1. 三类未映射步骤均能给出候选或明确"无法补全"，**绝不静默猜测成 ready**；
  2. 补全后产物通过九规则契约校验，可被 `validate`；
  3. 确定性/CI 路径模型调用为 0 的约束不变（补全在 Authoring 阶段，不进 Runtime 主回路）；
  4. 全量测试新增且不回归（基线 568 只增不减），typecheck/build 全绿。
- Trae 门禁：T7 重点核对"不猜测、不伪造 ready"和"Authoring/Runtime 边界"。

## 六、度量与出口（每个 Feature）

| 度量 | 出口要求 |
|---|---|
| 测试 | 新增有效测试；全量 `npm test` 全绿，数量 ≥ 开工基线 |
| 质量回执 | `loopx change-quality verify` 通过 |
| 评审 | Trae review 清单全部满足，0 个阻断项 |
| 合规 | 无未许可依赖、无明文凭据、无 `backend/frontend` 越界 |
| 进度 | tasks.md 置【✅】；PR 合并、CI 绿；goal 收尾无残留 |
