# F1 · Draft 未映射步骤的 Skills 自动补全 — 产品规格

> 上位基线：`.trae/specs/idwth-v1-development-baseline/spec.md`
> 实施计划：`docs/loopx/feature-implementation-plan.md`（F1）
> 状态：待实现

## 1. 背景与定位

Task 19 已打通 ai-testgen → IDWTH 的衔接：能映射的 Gherkin 步骤生成 `.contract.yaml`，
无法安全映射的步骤不丢弃、不猜测，整体降级为 `.draft.yaml`，并把未映射步骤原文与三类
原因写入 `_draft.unmapped_steps`：

- `unmapped-precondition`（Given 前置条件无法映射）
- `unmapped-action`（When 动作无法映射）
- `unrecognized-assertion`（Then 断言无法映射）

F1 兑现 feature-to-contract.ts 中预留的承诺：**“后续按 _draft 中沉淀的场景类别用 Skills
自动补全，人只审核报告。”**

## 2. 范围与非目标

### In Scope

- 新增确定性的“扩展映射（Skills 补全）”纯函数引擎：在基线 7 动作 / 7 断言原语之上，
  覆盖 V1 已识别的高频未映射场景类别（文件上传、会话终止、清除类断言等）。
- 新增 CLI 子命令 `idwth complete <draft>`：读取 draft 与其 `source_feature`，按原步骤
  顺序产出补全候选与置信度；高置信可落定，低置信仅给候选；全部高置信且通过九规则校验
  时产出 ready contract。
- 中英文步骤同等分类准确；无法补全项保持 draft、逐条保留原文，绝不丢失。
- 文档与 Skill 行为声明同步。

### Non-Goals

- **不在 Runtime 主回路调用任何模型 / JEV / LLM**。补全发生在 Authoring 阶段；确定性 /
  CI 路径模型调用为 0 的约束不变。
- 不做交互式 TUI 问卷（本期保持非交互，适配 CI）；交互确认以后续 Feature 演进。
- 不引入 CSS/XPath/JS 选择器产出，不放宽 R7；不降低既有风险分级语义。
- 不改变 `init --from`、`validate`、`run` 等既有命令行为。

## 3. 功能需求

### FR-1 扩展映射引擎（纯函数、零网络、零模型）

- F1-1 新增模块 `src/runtime/contract/complete.ts`，提供：
  - `completeDraft(draft, options): CompletionResult`（核心纯函数）。
  - 复用基线 `mapStep` / `mapThenStep` 的封闭集合与清洗规则，新增**扩展动作/断言
    识别表**，至少覆盖：
    | 场景类别 | 典型步骤（中/英） | 产出 |
    |---|---|---|
    | 文件上传 | `I upload a profile picture` / `我上传头像` | `action: 'click'`（语义目标=上传控件），并标记需 file 控件（见约束） |
    | 终止/关闭会话 | `I terminate all active sessions` / `我终止所有活动会话` | `action: 'click'`，risk=irreversible + postcondition 要求 |
    | 清除/消失断言 | `the session risk badge is cleared` / `风险徽标已清除` | dom 断言 `kind: 'absent'` |
  - 识别表必须同时支持中英文关键词；`file` 上传在 Authoring 阶段以**语义目标**表达
    （target 描述上传控件），严禁产出文件路径字面量或选择器。
- 每个候选必须带 `confidence: 'high' | 'medium'` 与 `matched_rule`（命中规则名），可追溯。
- 扩展引擎无法识别时返回 `null`（无法补全），该步骤原样保留。
- 扩展引擎不得输出基线封闭集合之外的 action / dom 原语（R5/R6 不变）。

### FR-2 顺序保持与重映射

- 补全必须依据 `_draft.source_feature` 重新解析 feature，按 **Background + Scenario 原始
  步骤顺序**合并候选，而非仅消费无序的 unmapped_steps。
- 通过 `test.id` / `goal`（场景名）/ source_feature 路径定位 draft 对应的目标场景；
  同名场景回退到 draft 自身顺序匹配，且必须可解释（输出匹配依据）。
- 已映射的基线步骤保持其原始映射结果不变；扩展引擎仅处理基线未映射步骤。

### FR-3 `idwth complete` CLI

- 用法：`idwth complete <draft.yaml> [--apply] [--json] [--out <dir>]`
  - 默认（无 `--apply`）：只输出补全建议（每条：原文 / 原因 / 候选 action 或断言 kind /
    target / confidence / matched_rule），**不写 ready 文件**，退出码 0。
  - `--apply`：仅当全部未映射步骤均有 **high** 候选时，落定候选，删除 `_draft` 段，产出
    `<id>.contract.yaml`（默认与 draft 同目录，可用 `--out` 覆盖）；写盘前必须通过
    `validateContract` 九规则 + schema。原 draft 文件保留（不自动删除）。
  - 存在 `medium` 候选或无法补全项时，`--apply` 不得产出 ready：输出未解决清单并返回
    CONFIG_ERROR(3)；draft 不被破坏。
  - `--json`：输出结构化 CompletionResult（建议或 apply 结果/错误），供 CI 消费。
- 不可逆步骤按既有 R4 收尾：apply 时 irreversible 必须补到 postcondition，取不到则保守
  降级 reversible（与 feature-to-contract 行为一致）。
- draft 文件缺失、不是合法 draft（无 `_draft`）、source_feature 缺失或不可解析 →
  CONFIG_ERROR(3)；source_feature 文件不存在 → RUNTIME_ERROR(4)。

### FR-4 不丢失与不静默猜测

- 任何步骤都不会被静默丢弃：输出中“已补全 / 需人工 / 无法补全”三类必须与输入未映射步骤
  一一对应，数量守恒。
- 只有 high + 九规则通过才允许 ready；medium 永远不自动落定。
- 无法补全的 draft 在 `--apply` 后仍为 draft，原文与原因分类保留。

### FR-5 文档与 Skill 声明同步

- `src/cli/index.ts` 的 USAGE 增补 `complete`。
- 相关 Skill（`web-test-contract`，authoring/model_may_rewrite 唯一允许者）或文档需说明：
  Skills 补全为确定性 Authoring 能力，零模型派发；不改变 Runtime 模型调用约束。

## 4. 约束与架构红线

- 单体 `src/` 工程：F1 不新增 `backend/` / `frontend/`（spec 2026-10-10 已豁免分层）。
- 退出码固定：0 PASS / 1 FAIL / 2 BLOCKED / 3 CONFIG_ERROR / 4 RUNTIME_ERROR / 130 CANCELLED。
- 无 daemon / server；`complete` 单次执行后退出。
- 不新增运行时第三方依赖（沿用 yaml / 现有内部模块）。
- 测试全部置于 `tests/`，新增不回归（基线 568 只增不减）。

## 5. 验收标准

1. 三类未映射步骤均能给出候选或明确“无法补全”，绝不静默猜测成 ready。
2. `--apply` 且全 high 时产物通过九规则 + schema，可被 `idwth validate` 与 `run` 消费。
3. 确定性 / CI 路径模型调用为 0 的约束不变（补全在 Authoring，不进 Runtime 主回路）。
4. 全量测试新增且不回归（≥568），`npm run typecheck` / `build` / `lint` 全绿。
5. 中英文未映射步骤分类准确；medium/无法补全场景下 draft 原文逐条保留、数量守恒。

## 6. 验证命令

```bash
npm run typecheck
npm run test
npm run lint
npm run build
# 手工烟雾（夹具）
node bin/idwth.js complete <draft.draft.yaml> --json
node bin/idwth.js complete <draft.draft.yaml> --apply
node bin/idwth.js validate <id>.contract.yaml
```
