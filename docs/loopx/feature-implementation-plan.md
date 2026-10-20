# IDWTH 后续 Feature 实施计划（LoopX + Codex CLI 驱动）

> 工具基线：LoopX 1.0.2（持久状态/证据/门禁层）｜ Codex CLI 0.162.1（agent runtime）
> 角色：**Trae 负责每个 Feature 的计划制定、code review、进度确认**；**Codex 经 LoopX 心跳循环负责实现**
> 配套手册：[loopx-usage-manual.md](./loopx-usage-manual.md)
>
> **版本：终版（2026-10-20 重排）**——F1 已合并入 `main`；testgen-hardening 依用户决策（「决策三顺延」）
> 编号固定为 **F3**；原旧队列整体顺延；新增 F8「replay/doctor CLI 装配收口」（接缝核查新发现的真实缺口）。

---

## 一、当前项目诊断结论

### 1.1 交付状态（健康）
| 项 | 实测结果 |
|---|---|
| 工程形态 | 单体 Node ≥22 / TypeScript CLI（`src/` + `tests/`），无前后端分离 |
| V1 基线 | spec 的 Task 1~19 全部 `completed【✅】` |
| F1 | draft-autocomplete（`idwth complete`）**已 squash 合入 `main`（dfc7bf5）** |
| 测试 | `npm test` → **52 文件 / 593 用例全绿**（含真实 Chrome CDP 集成） |
| 类型/构建 | `npm run typecheck` 0 错误；`npm run build` 通过 |
| Git | 远端 `JustinIan-AI/Jev-E2E-WebTest`；CI 已在 GitHub Actions 全绿 |

### 1.2 已知缺口（F2 / F8 的立项依据）
| 缺口 | 现状 | 归属 |
|---|---|---|
| 命令级端到端证据 | run/report/judge 功能与模块均已就绪，但缺一条「真实 bin shim 子进程跑通确定性用例」的命令级闭环；M1 Task 11 Notes 保留项未回链 | **F2** |
| replay / doctor CLI 装配 | `src/runtime/replay/verify.ts`、`src/runtime/doctor.ts` 模块已实现并有测试，但 CLI 默认 deps 为 `{}` 未接线，`idwth replay` / `idwth doctor` 当前 exit 4 | **F8** |
| ai-testgen 四个缺陷 | issues #7（中文文件名退化覆盖）/ #6（canParse 静默降级）/ #5（max_tokens 截断无提示）/ #4（超时硬编码）位于 vendored `tools/ai-testgen/` | **F3** |

### 1.3 工具链状态
| 项 | 结果 | 说明 |
|---|---|---|
| loopx 安装 | 正常（1.0.2，pip venv + homebrew shim） | 控制面 `ready`，全局注册表可写 |
| codex-cli | 正常（0.162.1，`~/.local/bin/codex`） | 作为唯一 agent runtime |
| Codex 侧 LoopX skill | 已安装 `loopx-project` 等 | 可直接 `/loopx` |
| install freshness | `repair_recommended`（可升级） | **非阻塞**，单独变更处理，不与 Feature 混做 |
| loopx-benchmark skill | 路由 routes=0 | 仅影响基准能力，不影响开发主链路 |

### 1.4 结论
V1 + F1 已交付，可直接进入 F2 起的 Feature 迭代。后续工作不改动 V1 已冻结契约，以本文件队列与各 Feature spec 为范围，逐个经 LoopX 编排实施。

## 二、实施总原则

1. **计划驱动**：每个 Feature 先在 `.trae/specs/<feature>/` 产出 spec + tasks，含验收标准与**可复跑验证命令**，Trae 评审通过后才开工（对齐用户"遵循 spec/plan"规则）。
2. **LoopX 为状态底座**：一个 Feature = 一个 LoopX goal；任务以 todo + task-lease 管理；完成必须用 `loopx todo complete`（非 `update --status done`）回写并附 validation/evidence/note。
3. **Codex CLI 为唯一实现 runtime**：作为注册 agent 走 LoopX 回路（claim → TDD → 验证 → state writeback），不绕开回路本地直驱。
4. **TDD 不可省**：测试先写且置于根目录 `tests/`（vendored `tools/ai-testgen/` 子工程的测试置 `tools/ai-testgen/tests/`）；done 必须附 validation-command + evidence。
5. **Trae 双门禁**：每个 Feature 必须经过 ① code review（精确 diff，`review-packet`）② 进度确认（tasks.md 置【✅】+ 提交/PR），二者均由 Trae 完成。
6. **架构红线不被用户目录约定覆盖**：本仓库 spec 明确豁免 `backend/`/`frontend`，**继续维持单体 `src/`**，评审中以此为准。
7. **确定性/安全红线**：封闭集合不被突破；时间顺序正确（postcondition 严格在步骤之后）；数量守恒；原文不丢、草稿不被破坏；Authoring 阶段零网络零模型，不进 Runtime 主回路。
8. **退出码边界**：配置/契约不合法 → `3 CONFIG_ERROR`；外部资源运行时取不到 / IO 失败 → `4 RUNTIME_ERROR`；无法自动落定（存在 medium/无法补全）→ `3` 且不产出 ready 产物。

## 三、Feature 候选队列（终版编号，按执行顺序）

| 序号 | Feature | 来源依据 | 优先级 | 规模 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| **F1** | draft 未映射步骤自动补全（`idwth complete`） | Task 19 `_draft.unmapped_steps` 接缝 | high | M | 无 | ✅ **已合并 main `dfc7bf5`** |
| **F2** | M1 命令级闭环收口（run/report/judge recompute 真实 shim 子进程证据 + Task 11 回链） | M1 出口定义 + Task 11 Notes 保留项 | high | S | 无 | spec 就绪 |
| **F3** | ai-testgen 硬化（issues #7/#6/#5/#4） | GitHub issues，vendored `tools/ai-testgen/`；用户决策「决策三顺延」 | high | M | 无 | spec 就绪 |
| **F4** | `--keep-on-failure` FAIL 现场保留（P1 显式开关） | V1 spec Non-Goals 明示 P1 | high | S | F2 | 待立项 |
| **F5** | iframe / Shadow DOM 定位支持 | V1 spec Non-Goals 延后 P1 | medium | M | 无 | 待立项 |
| **F6** | 完整 Eventually 语义（带 deadline 的轮询断言） | V1 spec Non-Goals | medium | M | 无 | 待立项 |
| **F7** | `replay --heal` 审计增强（heal 候选隔离 + 产物禁入 CI） | V1 spec Non-Goals / FR-7 | medium | S | F8 | 待立项 |
| **F8** | replay / doctor 命令装配收口（默认 deps 接线 + 命令级证据） | 接缝核查：模块就绪、CLI 默认 exit 4 | high | S | F2 | 待立项 |
| **F9** | 文件上传 / 下载完整能力 | V1 spec Non-Goals 延后项 | low | M | F5 | 待立项 |
| **F10** | 跨浏览器矩阵 / 移动端测试 | V1 spec Non-Goals 延后项 | low | L | F8 | 待立项 |

> 执行顺序说明：
> - F2、F3 均已具备 spec，且无相互依赖；按本队列先 **F2**（补齐 M1 命令级基线）再 **F3**。
> - F8 是核查中新发现的真实装配缺口（功能已写、命令不可达），优先级提到 medium 队列前部之后、heal 增强（F7）之前——F7 的审计增强以 F8 命令可达为前置。
> - 队列按"high 优先 + 依赖就绪"推进；每个 Feature 开工前可依据最新需求重排，但需 Trae 在 plan 中留痕并经用户确认。

### Backlog（不主动启动）

| 项 | 立项条件 |
|---|---|
| 多模态 Canvas 渲染断言（`VB-01~VB-05`） | **仅当外部明确提供多模态大模型能力且主动要求时立项**；不占 A 序列，不计入 F1~F10 执行序 |
| 自动 GEPA 进化 | 反思产物只能作为经人确认的新版 Frozen Strategy；不做自动闭环 |
| Web 管理页面 / 常驻服务 / 桌面 GUI | V1 已明确不做（2026-10-10 澄清），不立项 |

## 四、单 Feature 标准开发计划模板（八步）

> 每个 Feature 复制本模板落到 `.trae/specs/<feature-id>/tasks.md`，并按手册第 5 节执行。

```
Feature: <id> - <名称>
Goal ID(LoopX): <注册后回填>
Agent ID: idwth-feat-<短名>
分支: feature/<短名>

阶段 T1 计划（Trae）
  - 研读接缝代码，产出 spec.md / tasks.md
  - tasks 中先冻结接口契约块（类型签名 + 不变量注释），再列子任务
  - 门禁：人工确认计划后才进入 T2

阶段 T2 注册（Trae）
  - loopx start-goal（goal-text "<目标>"，项目目录 .）
  - loopx register-agent --goal-id <G> --agent-id 'idwth-feat-<短名>' --require-new --execute
  - 按 tasks 以 loopx todo add 拆入 goal（带优先级 / task_class）

阶段 T3–T6 实现（Codex，注册 agent 走 LoopX 回路）
  - heartbeat-prompt 挂载；quota should-run 放行
  - claim → 先写 tests/（RED）→ 实现（GREEN）
  - 每步：npm run typecheck && npm run lint && npm run build && npm run test
  - 每个子任务用 loopx todo complete 回写：
      --validation-command/--validation-label、--evidence、--note
      无后继显式 --no-follow-up，否则 --follow-up 登记

阶段 T7 Code Review（Trae）
  - loopx review-packet --goal-id <G> --agent-id <A>
  - 按手册第 6 节清单逐项核对精确 diff 与 AC / 架构红线
  - loopx change-quality verify
  - 通过→T8；不通过→回 T3 开修复 todo（意见入证据）

阶段 T8 进度确认与提交（Trae）
  - tasks.md 任务置 completed【✅】+ 证据摘要（与 LoopX 状态双对账）
  - 提交/PR：分支 feature/<短名>，不直推 main，CI 绿后合并
  - loopx goal-lifecycle --operation stop（先 dry-run 再 --execute）；确认无残留
```

### 每个执行 tick 的收尾义务
执行 agent 每个 tick 结束必须给出：**变更文件、验证结果、残余风险、下一步动作**，并完成 state_writeback。
执行档约束：`cadency=bounded_progress_segment`、`spend_rule=spend_only_after_artifact_validation_writeback`、`checkpoint_accounting=advancement_only`。

## 五、当前执行 Feature 细则

### F2：M1 命令级闭环收口（先执行）
- spec：`.trae/specs/f2-m1-closure/spec.md` + `tasks.md`（已就绪）。
- 范围：不新增运行时功能，仅补三件事——
  1. run/report/`judge recompute` 穿过真实 bin shim 子进程的命令级闭环证据（唯一新增测试 `tests/integration/cli-command-e2e.test.ts`）；
  2. A3 断言目标多匹配 → BLOCKED(ambiguity) 且零动作派发的全链证据；
  3. M1 Task 11 Notes / checklist 的回链闭环。
- Trae 门禁重点：退出码 + 产物文件双取证；零派发（真实副作用计数 = 0）；不新增生产接口。

### F3：ai-testgen 硬化（F2 完成后执行）
- spec：`.trae/specs/f3-testgen-hardening/spec.md` + `tasks.md`（已就绪）。
- 范围（全部位于 vendored `tools/ai-testgen/`）：
  | Todo | 对应 issue | 要点 |
  |---|---|---|
  | F3-1 | #7 | 中文标题 slug 化：`slugify`/`safeSlug`，文件名不再退化为 `-.feature`、不相互覆盖 |
  | F3-2 | #6 | story parser：`canParse` 与提取正则对齐，"判定为故事但提取不到"不再静默降级（`StoryParseWarning`） |
  | F3-3 | #5 | `max_tokens` 截断显式化：输出被截断不静默写入（`ContentTruncatedError` 带 output/max tokens） |
  | F3-4 | #4 | 超时可配置：`GenConfig.options.timeoutMs`（默认 300000）替换硬编码 60s/120s |
  | F3-5 | — | 子工程测试全绿 + 主仓四门禁 + 收尾 |
- Trae 门禁重点：确定性、失败显式不静默；子工程测试位于 `tools/ai-testgen/tests/unit/`；不向主仓引入运行时依赖。

## 六、度量与出口（每个 Feature）

| 度量 | 出口要求 |
|---|---|
| 测试 | 新增有效测试；全量 `npm test` 全绿，数量 ≥ 开工基线（当前 main 基线 **52 文件 / 593 用例**，只增不减） |
| 质量门禁 | `npm run typecheck` && `npm run lint` && `npm run build` && `npm run test` 四条全绿 |
| 质量回执 | `loopx change-quality verify` 通过 |
| 评审 | Trae review 清单全部满足，0 个阻断项 |
| 合规 | 无未许可依赖、无明文凭据、无 `backend/frontend` 越界、无本地绝对路径/私有 IP 入提交 |
| 进度 | tasks.md 置【✅】且与 LoopX todo 双对账；PR 合并、CI 绿；goal `stop` 收尾无残留 |
