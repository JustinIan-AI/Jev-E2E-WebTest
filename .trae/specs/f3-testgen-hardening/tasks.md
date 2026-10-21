# F3 · ai-testgen 生成链路加固（#7/#6/#4/#5） — 任务清单

> 执行顺序自上而下；每个任务完成后核对"预期结果"，并将状态改为【✅】。
> TDD：先写失败测试（`tools/ai-testgen/tests/unit/` 下）→ 实现 → 全量回归。
> 编排：LoopX goal `f3-testgen-hardening` + 注册 agent；Trae 计划 / review / 进度确认。
> 边界：**只改 `tools/ai-testgen/`**；不新增第三方依赖；测试零真实网络。

## 接口契约（实现前对齐，冻结）

```ts
// ── tools/ai-testgen/src/core/types.ts ──────────────────────────────
export interface LLMResponse {
  text: string;
  model: string;
  tokens: { input: number; output: number };
  latencyMs: number;
  /** 模型终止原因；'length' 表示因 max_tokens 截断（OpenAI call/stream 均回填）。 */
  finishReason?: string;
  raw?: unknown;
}

export interface GenConfig {
  // …provider/output 不变…
  options: {
    includeNegative: boolean;
    includeBoundary: boolean;
    maxTokens: number;   // 默认由 4096 提升为 8192
    temperature: number;
    timeoutMs: number;   // 新增，默认 300000
  };
  // …
}

// ── tools/ai-testgen/src/utils/slug.ts（新增纯函数，唯一定义点）──────
/** Unicode 感知 slug：NFKC→小写→非字母数字折叠为单 '-'→trim→截断 40。
 *  不变量：① 纯中文不被吃空（'登录功能'→'登录功能'）；
 *         ② 结果无首尾 '-'；③ 长度 ≤ 40；④ 确定性（同入同出）。 */
export function slugify(input: string): string;

/** 在 slugify 基础上做空 slug 兜底：源文件名 → 时间戳；结果再次 slugify。 */
export function safeSlug(title: string, sourceFilePath?: string, now?: Date): string;

// ── tools/ai-testgen/src/outputs/base.output.ts ─────────────────────
export interface WrittenFile extends GeneratedFile {
  /** 实际落盘的相对路径（重名加序号后可能与传入 path 不同）。 */
  writtenPath: string;
}
export abstract class BaseOutput {
  /** 不变量：① 不静默覆盖已存在文件，冲突时主名追加 -2/-3…；
   *         ② 返回每个文件的最终 writtenPath；③ 目录递归创建。 */
  write(files: GeneratedFile[], outputDir: string): WrittenFile[];
  createFile(name: string, content: string): GeneratedFile; // 签名不变
}

// ── tools/ai-testgen/src/parsers/story.parser.ts ────────────────────
export interface StoryParseWarning {
  code: 'STORY_FALLBACK_WHOLE_TEXT';
  message: string;   // 显式中文提示：未能按用户故事语法解析，已按整段文本处理（1 scenario）
}
export class StoryParser {
  parse(content: string): ParsedInput & { warnings?: StoryParseWarning[] };
  /** 不变量：canParse(content) === (extractScenarios(content).length >= 1 的结构化条目)。
   *  支持 'As a' / 'As an'；so that|in order to 可选；多行逗号/换行写法。 */
  canParse(content: string): boolean;
}

// ── tools/ai-testgen/src/core/generator.ts ──────────────────────────
/** 截断错误：finish_reason==='length'（或代码块明显不完整）时抛出，
 *  CLI 捕获后非 0 退出；抛出前禁止写正式产物。 */
export class ContentTruncatedError extends Error {
  constructor(public readonly detail: { outputTokens: number; maxTokens: number });
}
```

**跨文件不变量（红线）**
1. slug 逻辑全工程只有 `utils/slug.ts` 一份；generator 两条路径（cache 命中 / 主路径）必须复用。
2. `finish_reason==='length'` 时**先判定后写盘**——任何正式文件都不得在此之前落盘。
3. `canParse` 与提取共用同一判定来源，禁止再维护两套正则。
4. 超时/截断的用户可见消息必须包含可操作信息（秒数/`--timeout`；maxTokens/`--max-tokens`）。
5. 全部 provider 测试用注入 fetch / 假 provider，零真实网络。

---

## F3-1 · Unicode 文件名 + 重名防护（#7）

- [ ] F3-1.1 先写单测 `tests/unit/slug.test.ts`（新）：
  纯中文→可读非空；`TDS-C 需求文档`→无首尾 `-`；长度≤40；确定性；空串兜底走源文件名；
  源文件名也为空→`untitled-<时间戳>`。
- [ ] F3-1.2 实现 `src/utils/slug.ts`（`slugify` + `safeSlug`，NFKC + `\p{L}\p{N}` + `u`）。
- [ ] F3-1.3 单测 `tests/unit/outputs.test.ts` 扩展：目标已存在 → 第二次写得到 `-2`，
  原文件不被覆盖；返回 `writtenPath` 反映真实路径。
- [ ] F3-1.4 改 `base.output.ts`：冲突自动加序号、返回 `WrittenFile[]`。
- [ ] F3-1.5 改 `generator.ts`：删除两处内联 slug，统一 `safeSlug(input.title, filePath)`；
  消费 write 返回的最终路径并日志可见；cache 命中与主路径一致。

预期：纯中文标题产出可读文件名；多次不同标题互不覆盖；同名加序号。状态：【 】

## F3-2 · StoryParser 一致性与显式降级（#6）

- [ ] F3-2.1 先写单测 `tests/unit/parsers.test.ts` 扩展三写法：
  `As an admin, I want …, so that …`；省略 `so that`；多行逗号/换行块 → 各成独立 scenario。
- [ ] F3-2.2 单测：`canParse` 与 `parse` 结果一致（能过门必能提取 ≥1；不能提取必返回 false）。
- [ ] F3-2.3 单测：确实无法结构化时 `parse` 仍给 1 个占位 scenario，但带
  `STORY_FALLBACK_WHOLE_TEXT` warning。
- [ ] F3-2.4 实现：统一正则（`As an?`、benefit 可选、多行）；`canParse` 改为基于提取结果；
  fallback 经 logger.warn 显式提示并挂到返回 warnings。
- [ ] F3-2.5 CLI `--dry-run` 展示 parser warnings（cli.ts generate 分支）。

预期：三种写法正确提取；判定与提取一致；降级在普通运行与 dry-run 均可见。状态：【 】

## F3-3 · 可配置超时 + 可操作 AbortError（#4）

- [ ] F3-3.1 先写单测 `tests/unit/providers.test.ts` 扩展：注入永不返回的 fetch +
  极小 `timeoutMs`（用 fake timer 或短超时）→ 抛错消息含秒数与 `--timeout`。
- [ ] F3-3.2 单测：`generator` call/stream 两条路径都把 `config.options.timeoutMs`
  透传进 provider（断言假 provider 收到的 options.timeout）。
- [ ] F3-3.3 改 `types.ts`：`options.timeoutMs=300000`；改 generator 两处透传。
- [ ] F3-3.4 改 `openai.provider.ts`：识别 abort（DOMException name==='AbortError'/signal.aborted），
  包装为含秒数与调整方式的错误；call 与 stream 一致。
- [ ] F3-3.5 改 `cli.ts`：generate/from-spec/plan 增加 `--timeout <ms>` 覆盖
  `config.options.timeoutMs`。

预期：超时可配置并实际生效；超时消息含秒数与调整方式（假 provider，离线）。状态：【 】

## F3-4 · 截断显式失败、不落残缺产物（#5）

- [ ] F3-4.1 先写单测：假 provider 返回 `finish_reason='length'` 的 call 响应 →
  generator 抛 `ContentTruncatedError`，且 output 目录无正式文件。
- [ ] F3-4.2 单测：stream 路径最后一个 chunk 带 `finish_reason='length'` 同样被识别。
- [ ] F3-4.3 单测：正常 `finish_reason='stop'` 正常落盘；日志含 outputTokens/maxTokens。
- [ ] F3-4.4 实现：`LLMResponse.finishReason`；openai call/stream 回填；
  generator 在 `extractFirstCodeBlock` 后、write 前判定 length → 抛错不写盘。
- [ ] F3-4.5 默认 `maxTokens=8192`；CLI generate/from-spec/plan 增加 `--max-tokens <n>`；
  CLI 顶层 catch 把 `ContentTruncatedError` 映射为非 0 + 可操作 stderr。
- [ ] F3-4.6 （轻量护栏，可选）代码块引号未闭合也视为截断信号；verbose 下允许落 `*.partial.*`。

预期：截断非 0 退出、无"看似成功"的残缺 `.feature`；提高 max-tokens 后可完整生成。状态：【 】

## F3-5 · 子工程全量回归 + 主仓不回归 + 偏离登记

- [ ] F3-5.1 `tools/ai-testgen`：`npm run typecheck && lint && build && test` 全绿，测试只增不减。
- [ ] F3-5.2 离线烟雾：`node dist/cli.js generate tests/unit/fixtures/sample-stories.txt --dry-run`
  正常（含中文 story 行为可见），不触发网络。
- [ ] F3-5.3 仓库根四门禁 `typecheck/lint/build/test` 不回归（52 文件 / 593 用例基线）。
- [ ] F3-5.4 核对 spec 附录 A 偏离登记与实际改动一致；产出 LoopX review packet 交 Trae review。

预期：子工程与主仓门禁全绿、零网络；偏离可追溯。状态：【 】

---

## 验收对照（出口）

| AC（spec §5） | 覆盖任务 | 证据 |
|---|---|---|
| #7 可读文件名 / 不互覆 / 加序号可见 | F3-1.1/1.3/1.5 | slug.test / outputs.test |
| #6 三写法提取、判定一致、降级可见 | F3-2.1~2.5 | parsers.test + dry-run 烟雾 |
| #4 超时可配、消息可操作（离线） | F3-3.1~3.5 | providers.test（注入 fetch） |
| #5 截断非 0、不落残缺、可调大 | F3-4.1~4.5 | generator/provider 单测 + CLI |
| 门禁全绿、零网络、偏离登记 | F3-5.1~5.4 | 两套门禁输出 + 附录 A |
