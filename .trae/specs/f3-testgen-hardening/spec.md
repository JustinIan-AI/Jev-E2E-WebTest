# F3 · ai-testgen 生成链路加固（issues #7 / #6 / #4 / #5） — 产品规格

> 上位基线：`docs/loopx/feature-implementation-plan.md`（路线图 F3）
> 关联 issue：#7（中文文件名/静默覆盖）、#6（story parser 静默降级）、
> #4（超时硬编码）、#5（max_tokens 截断仍写盘）
> 改动边界：**仅限 vendored `tools/ai-testgen/`**，不触碰 IDWTH 主仓 `src/`
> 状态：待实现

## 1. 背景与定位

`tools/ai-testgen`（vendored，上游 `mustafaautomation/ai-testgen` v2.0.0）是
IDWTH Authoring 链路的最前端：把 PRD / OpenAPI / 用户故事交给 LLM 生成
Playwright / Gherkin / Markdown 产物，再由 `idwth init --from` 消费。

当前四个缺陷都会产出**"看起来成功、实际不可用"的静默坏产物**，错误被推迟到
下游甚至人眼复核时才暴露，且非中文友好。F3 在生成侧建立"确定性护栏"：
文件名可读且不互覆、解析判定与提取一致、超时/截断显式失败而非沉默成功。

### vendored 处置策略（已决策）

- **直接在 vendored 源码内修复**（本期不推上游、不做 vendor 升级）。
- 修复集中在 `tools/ai-testgen/src/` 与其 `tests/unit/`；在本 spec 记录与上游的偏离，
  并在改动文件顶部不额外加注释（保持可 diff 升级），偏离清单统一登记在本 spec 附录 A。
- 不升级上游版本，不引入新第三方依赖（仅用 Node 内置能力 + 现有 commander/yaml）。

## 2. 范围与非目标

### In Scope

- **#7**：输出文件名 slug 化支持 Unicode（中文不被吃掉）；空 slug 兜底；同名文件不静默覆盖。
- **#6**：`StoryParser` 判定与提取共用一致规则；支持 `As an` / 缺 `so that` / 多行；
  fallback 必须显式 warn，且 `canParse` 与"能提取 ≥1 条"一致。
- **#4**：超时可通过配置与 CLI 调整；AbortError 报可操作消息（含秒数与调整方式）。
- **#5**：检查 `finish_reason === 'length'`；截断时**不写正式文件**、非 0 退出并给可操作提示；
  默认 `maxTokens` 提升；日志输出 token / max_tokens。

### Non-Goals

- 不改 IDWTH 主仓 `src/` 任何运行时/契约逻辑；不动封闭集合 action / dom 原语。
- 不引入网络重试策略重构、不更换 fetch/Abort 机制；不改 Anthropic/Custom provider
  （#4/#5 仅落在 OpenAI provider 与其共享 option 类型；Anthropic 的一致性留待后续）。
- 不做"首 token 后重置计时 / idle timeout"（#4 建议第 5 条列为可选，本期不实现，记录为后续）。
- 不做 Gherkin 全量语法解析器（#5 的写前结构校验仅做轻量引号闭合/末行完整性护栏）。
- 不推送上游、不发外部网络请求；测试默认全部 mock，离线可跑。

## 3. 功能需求

### FR-1 Unicode 安全的输出文件名与重名防护（#7）

- F3-1 slug 化规则改为 Unicode 感知：
  - `NFKC` 规范化 → 小写 → 以 `/[^\p{L}\p{N}]+/gu` 把非字母数字连续片段折叠为单个 `-`
    → 去首尾 `-` → 截断到 40 字符（截断不产生尾 `-`）。
  - 纯中文标题得到可读 slug（如「登录功能」→ `登录功能`），不再退化为 `-.feature`。
- 空 slug 兜底顺序：源输入文件名（`path.parse(filePath).name` 后再 slug 化）→
  仍为空则确定性时间戳 `untitled-<YYYYMMDDHHmmss>`；兜底结果也要过重名防护。
- `BaseOutput.write` 对已存在同名文件**不得静默覆盖**：默认在主名后追加
  `-2` / `-3`…直到不冲突；并把最终写入路径通过返回结果/日志显式告知。
- 两处生成路径（cache 命中分支、主 LLM 分支）必须复用同一 slug 函数，禁止重复实现。

### FR-2 StoryParser 判定/提取一致与显式降级（#6）

- 统一用户故事正则：支持 `As a` 与 `As an`；`so that` / `in order to` 收益段可选
  （缺失时 benefit 留空，不丢弃整条）；支持逗号/换行分隔的多行写法（先 NFKC/空行分块，
  或开启跨行匹配）。
- `canParse(content)` 必须等价于"`extractScenarios(content)` 能提取 ≥1 条结构化条目"；
  消除"过门但提取为 0"。
- 当确实提取为 0 而进入整段文本 fallback 时：
  - 仍产出 1 个占位 scenario（保持下游不崩），但必须通过 logger 发出**显式 warn**，
    文案说明"未能按用户故事语法解析，已按整段文本处理（1 scenario）"；
  - `--dry-run` 输出中必须体现该 warning，让人可见。
- 纯中文用户故事仍允许落到 PRD parser（既有行为），本 FR 只保证"判定与提取自洽 + 降级可见"。

### FR-3 可配置超时与可操作超时错误（#4）

- `GenConfig.options` 新增 `timeoutMs: number`（默认 `300000`）；配置文件可设。
- `Generator` 两条 provider 调用（call/stream）都透传
  `timeout: config.options.timeoutMs`，消除"options.timeout 恒 undefined"。
- CLI 新增 `--timeout <ms>`（generate / from-spec / plan 三命令一致），覆盖配置。
- OpenAI provider 捕获 abort：超时错误消息必须包含实际秒数与调整方式，例如
  `LLM 请求超时（300s），可用 --timeout <ms> 调大或检查网络/模型速度`；
  不再裸抛 `This operation was aborted`。
- **范围限定**：本期仅 OpenAI provider；Anthropic/Custom 不改行为（共享类型加字段不破坏其默认）。

### FR-4 截断显式失败、不落残缺产物（#5）

- `LLMResponse` 新增 `finishReason?: string`；OpenAI `call` 读取
  `choices[0].finish_reason`，`stream` 从最后一个含 `finish_reason` 的 chunk 记录。
- 默认 `maxTokens` 由 4096 提升至 **8192**（`DEFAULT_CONFIG`，文档注明受模型上下文窗口约束）。
- Generator 在 `extractFirstCodeBlock` 之后、`output.write` 之前判定：
  - `finishReason === 'length'`（或代码块引号未闭合等明显截断信号）→ **不写正式文件**，
    抛出可被 CLI 捕获的明确错误（提示增大 `max_tokens` / 拆分输入），CLI 以非 0 退出。
  - 可选产物：仅在显式 debug/verbose 下落 `<name>.partial.*` 供排查；默认不落盘。
- 日志打印 `tokens.output` 与本次 `max_tokens`，便于判断是否触顶。
- CLI 新增 `--max-tokens <n>`（generate/from-spec/plan 一致）覆盖配置。

## 4. 约束与架构红线

- 改动**严格限定** `tools/ai-testgen/`；主仓四门禁（typecheck/lint/build/test）不得回归。
- ai-testgen 子工程自验收命令（在 `tools/ai-testgen/` 下）：
  `npm run typecheck && npm run lint && npm run build && npm run test`（vitest run tests/unit）。
- 单测全 mock provider，**零真实网络 / 零真实 LLM**；新增测试只增不减。
- 不新增第三方依赖；Node 能力沿用 vendored 子工程 engines（`>=18`），正则 Unicode 属性转义
  （`\p{L}\p{N}` + `u` 标志）在现有 TS target 可用（实现前以 typecheck 确认为准）。
- 退出语义：ai-testgen CLI 沿用其既有 0/1/2（成功/用法或显式失败/运行错误）；
  截断、超时属"显式失败"→ 非 0 且 stderr 可操作提示。
- 确定性护栏不依赖模型：文件名 / parser / finish_reason 判定均可纯单测。

## 5. 验收标准

1. **#7**：纯中文标题产出可读文件名（非 `-.feature`）；同目录多次不同标题互不覆盖；
   同名自动加序号且最终路径可见。
2. **#6**：`As an …` / 无 `so that` / 多行 三种写法各提取为独立 scenario；
   无法提取时给出显式 warn，dry-run 可见；`canParse` 与提取结果一致。
3. **#4**：配置文件与 `--timeout` 可设且实际生效；超时错误含秒数与调整方式，
   慢模型在放宽后可完成（用注入式假 provider 模拟，不打真实网络）。
4. **#5**：注入 `finish_reason='length'` 时命令非 0 退出、不产生正式 `.feature`、
   提示可操作；提高 `--max-tokens` 后同输入可完整生成；默认值 8192。
5. 子工程 `typecheck/lint/build/test` 全绿、测试只增不减；主仓四门禁不回归。

## 6. 验证命令

```bash
# 子工程（tools/ai-testgen）
cd tools/ai-testgen
npm run typecheck
npm run lint
npm run build
npm run test                 # vitest run tests/unit，全 mock
# 手工烟雾（离线、dry-run，不触发 LLM）
node dist/cli.js generate tests/unit/fixtures/sample-stories.txt --dry-run

# 主仓回归（仓库根）
cd ../..
npm run typecheck && npm run lint && npm run build && npm run test
```

## 附录 A · 与上游 mustafaautomation/ai-testgen@v2.0.0 的偏离登记

| 文件 | 偏离 | 关联 issue |
|---|---|---|
| `src/core/generator.ts` | 抽出统一 Unicode slug 化；两处路径复用；透传 timeout；写前截断判定；token 日志 | #7 #4 #5 |
| `src/outputs/base.output.ts` | `write` 重名自动加序号、不静默覆盖；返回/暴露最终路径 | #7 |
| `src/parsers/story.parser.ts` | 统一 `As an?`、可选 benefit、多行；canParse≡可提取；fallback 显式 warn | #6 |
| `src/providers/openai.provider.ts` | 可配置超时+可操作 AbortError；记录 finish_reason | #4 #5 |
| `src/core/types.ts` | `options.timeoutMs`；`LLMResponse.finishReason`；默认 maxTokens 8192 | #4 #5 |
| `src/cli.ts` | `--timeout` / `--max-tokens`；dry-run 展示 parser warning；截断非 0 退出 | #4 #5 #6 |
