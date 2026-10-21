# `tester-army/e2e` 源码级调研评审

> 调研对象：<https://github.com/tester-army/e2e>（npm 包 `e2e` v0.18.0）
> 调研方式：`git clone --depth 1` 读全量源码 + 官方文档站源码（`docs/*.mdx`，随包发布）+ `gh api` 官方元数据
> 调研时间：2026-10-08
> 回答四个问题：**怎么用 · 是否支撑 BS 架构系统测试 · 核心能力 · 是否含「用例生成 / 页面操作&测试 / 报告生成」**

---

## 结论

**这是目前调研过的所有对象里，与 IDWTH 主干最同构的一个 —— 不是「可借鉴」，是「主干已经建好了」。**

一句话：**`e2e` 把「自然语言目标 + 确定性断言」放在同一个测试文件里，用「回放缓存」把模型成本压到零，用「三态判定 + 错误码分类」把「测不出来」和「测出来是坏的」分开。** 你写在 PRD 里的三句边界（Playwright 管怎么做 / JEV 管不确定时选什么 / Evidence+Oracle 管对不对），它在工程上已经落地。

| 维度 | 判定 |
|---|---|
| 是否同一赛道 | ✅ **是**。输出物就是测试报告（用例 / 截图 / 通过与否 / 失败原因 / 可复现过程），不是轨迹或策略产物 |
| 支撑 BS 架构系统测试 | ✅ **强支持**。三步骤模型 + 语义定位 + API 断言 + iframe + 多角色会话 + CI 门禁齐备 |
| 测试用例生成 | ⚠️ **有，但不是你想的那种**。无「PRD/文档 → 用例」的内建能力；生成走 `e2e explore` / bug bash + 编码 Agent（见 §2.1） |
| 页面自动操作 & 测试 | ✅ **强**。`agent.act` 语义目标 + `screen`/`expect` 精确定位，且**模型只输出候选元素序号**（见 §2.2） |
| 测试报告生成 | ✅ **强**。`report.json` / `junit.xml` / `summary.md` / 每用例 `trace.md` + 截图 + 视频 + PR 评论（见 §2.3） |
| 许可 | ✅ **Apache-2.0**（不是「无 license」，可引依赖、可读代码、可派生） |
| 成熟度 | ⚠️ **pre-1.0（0.18.0），API 与配置仍会在 minor 版本间变动** |

---

## 1. 仓库事实

| 项 | 值 |
|---|---|
| 仓库 / 组织 | `tester-army/e2e`（Org: TesterArmy，商业产品 <https://tester.army>） |
| 描述 | Next generation e2e testing framework for web and mobile apps |
| 语言 / 许可 | TypeScript · **Apache-2.0** |
| 星标 / Fork | **7,513** / 345 |
| 创建 / 最近推送 | 2026-07-22 → 2026-10-07（约 2.5 个月，**日更**） |
| 主要贡献者 | Oskar Kwaśniewski（548 commits）、Kacper Kapuściak、Szymon Rybczak（均为 React Native / Expo 核心圈） |
| 版本节奏 | 18 个 minor 版本（0.1 → 0.18），最近 3 周内 6 个 release |
| 文档 | 官网 `e2e.tester.army/docs`；**文档随 npm 包发布**（`node_modules/e2e/docs`），供编码 Agent 离线读 |
| 包结构 | `e2e`（SDK/runner/CLI）· `@e2e-dev/web`（Playwright 引擎）· `@e2e-dev/mobile`（iOS/Android）· `@e2e-dev/github`（PR 评论）· `@e2e-dev/decision`（决策模型执行器）· `@e2e-dev/kernel` / `@e2e-dev/eas` |
| 内置 Skill | ✅ `skills/e2e/SKILL.md` + 8 个 topic 参考（setup / writing-tests / agent / running / explore / debugging / mcp / bug-bash），共约 1,957 行 |
| 关键依赖 | Playwright（Web）、agent-device（移动）、AI SDK（模型）、Standard Schema（Zod/Valibot/ArkType） |
| 环境要求 | Node ≥ 24.8（Node 22 需 ≥ 22.22.3）；**Windows 必须走 WSL** |

---

## 2. 怎么用

### 5 分钟上手

```bash
npx e2e init          # 选 Web(Playwright) / Mobile，选模型 provider（可选的 None = 无 AI）
npx e2e login openai  # 或 API key；纯定位器测试不需要模型
npx e2e run           # 跑；--headed 看浏览器，--no-cache 强制走模型
```

配置文件 `e2e.config.ts`：

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

export default {
  agents: { default: { model: gateway('openai/gpt-6-luna-fast') } },
  targets: [{ engine: web(), app: { url: 'http://localhost:3000',
              command: { executable: 'pnpm', args: ['dev'], log: '.e2e/logs/app.log' } } }],
} satisfies E2EConfig;
```

测试文件 `tests/checkout.e2e.ts`：

```ts
import { test, expect } from 'e2e';

test('a member upgrades to Pro', async ({ app, agent, screen }) => {
  await app.open('/settings/billing');            // 确定性：起点可控
  await agent.act('upgrade the workspace to the Pro plan');   // 语义：模型决定怎么点
  await agent.assert('the invoice preview shows a prorated amount'); // 语义判定
  await expect(screen.getByRole('status')).toContainText('Pro');     // 确定性判定（唯一 FAIL 权威源）
});
```

### 三类步骤 —— 这是整个框架的骨架

| 步骤类型 | API | 调用模型 | 角色 |
|---|---|---|---|
| **Goal**（目标） | `agent.act('...')` | 是（除非缓存回放） | 模型决定「怎么做」 |
| **Assertion**（断言） | `agent.assert` / `waitFor` / `extract` | 是 | 模型按人写好的陈述判定 |
| **Locator**（定位器） | `screen` / `app` / `browser` / `expect` | **否** | 精确定位与精确断言，零成本毫秒级 |

> **这个三分法就是你们「Playwright 管怎么稳定地做 / JEV 管不确定时选什么 / Evidence+Oracle 管对不对」的工程化形式。**

### 常用命令

| 命令 | 用途 |
|---|---|
| `npx e2e run [file:line] [--grep] [--target] [--tag/--exclude-tag]` | 跑测试 |
| `npx e2e run --last-failed` | 只重跑上轮未通过（读 `report.json`，保留上轮产物到 `rerun-1/`） |
| `npx e2e run --shard 1/3` | 分片，CI 矩阵用 |
| `npx e2e run --strict-cache` | ★ 缓存陈旧即报错终止（默认是「悄悄交给 agent 兜底」） |
| `npx e2e run --headed / --video / --trace / --debug / --ai-trace / --no-cache` | 调试与取证 |
| `npx e2e explore '<目标>'` | 无测试文件，给个目标让 Agent 自己探索并报问题 |
| `npx e2e mcp` | 起 MCP server，让编码 Agent 驱动真实浏览器（可 4 会话并行） |
| `npx e2e cache ls\|stats\|clear` | 查/清回放缓存 |
| `npx e2e guide [topic]` | 打印内置 skill 文档（给 Agent 读） |

---

### 2.1 「测试用例生成」——有，但形态和你想的不一样

**没有**「输入 PRD / 接口文档 → 输出用例文件」这种内建生成器。真正落地的是两条路：

**路径 A：`e2e explore` + Bug Bash（官方主推，已产品化）**

```
e2e explore '像首次购买者一样探索结算流程并报告异常'
  → Agent 自己规划步骤 → 操作页面 → 逐步报 findings（issue / warning）→ 写 assessment
```

Bug Bash 是它的规模化形式，由**编码 Agent（Claude Code / Codex / Cursor）按 skill 编排**：

1. 读路由（有分支就读 diff）
2. 写 **5–10 个 charter**（一句话的探索目标 × 一种 posture：新用户 / 数字与文案 / 边缘输入 / 重载后状态 / 错误路径）
3. 为每个 charter 起一个 `e2e explore`，**4 个并发**，各自 `--agent` 人设 + `--output` 目录
4. 合并所有 charter 的发现
5. **剔除已知原因的发现**（探索器自身限制 / 本地环境 / 设计如此 / 种子数据）
6. 为每条剩余发现**写一个复现测试**（断言期望行为），可起子 Agent 并行，各自开 `e2e mcp` 会话核对真实页面定位器
7. **跑复现测试：只有测试以 `ASSERTION_FAILED` 失败，这条才算 bug**
8. 按顺序报告：已确认 bug → 无法本地验证的生产风险 → 按原因剔除的发现 → 告警

> ★ **第 7 步是整套设计里我最看重的一处**：发现的「判定权」不在 Agent 手里，在**一个确定性的复现测试**手里。Agent 只负责「怀疑」，测试负责「定罪」。这就是你们的「独立 Oracle」，而且它把「模型信号恒为 candidate」这条铁律落在了流程上。

复现测试打 tag `bugbash`，被 `--exclude-tag bugbash` 排除在合并门禁之外；修复后去掉 tag 转为回归测试。

**路径 B：`e2e mcp`** —— 编码 Agent 接上真实浏览器，用 `open_session` / `observe` / `locate` 核对待写测试的定位器，再写进 `.e2e.ts` 文件。这是「写用例时的辅助」，不是「批量生成用例」。

**路径 C：从既有框架迁移** —— 官方提供 `cypress` / `playwright` / `detox` / `maestro` / `selenium` 的逐一对照表（含 API 映射 + 不支持的项标注）。已有用例资产可以低成本搬过来。

**缺口明确**：无「需求文档 → 用例」的语义生成；无「用例覆盖率」度量；无「手工用例 → 自动化用例」的批量转换。

---

### 2.2 「页面自动操作 & 测试」——两条执行臂，都值得抄

#### 臂 1：内置 Agent（默认，能力最全）

- 模型拿到的是**可访问性树的脱敏文本快照**（role / name / text / testid / 状态 / 链接目标），**截断到尺寸上限，不含 selector**；链接的 query/fragment 只显示 `?…` / `#…`
- 可用工具：`tap` / `type` / `press` / `select` / `scroll` / `navigate`（+ 声明了凭据时的 `type_secret`）；可开像素工具（截图 + 在点上操作）
- 侧信道防护：**「模型的拒绝」是工具结果，不是异常**；未知工具 / 未声明字段会被拒并让模型重试
- 循环守卫：连续 3 次动作失败 → 要求换策略；连续 5 次 → 要求给结论；预算/时限接近 → 主动要结论
- 单步预算：`act` 25 步 / 25 次模型调用，超时 120s；`assert` / `extract` 各 2 次模型调用，30s
- 视觉：`agent.assert('图表趋势向上', { vision: true })`，`vision: 'only'` 只看截图

#### 臂 2：`@e2e-dev/decision`（决策模型执行器）★ 这条最关键

**它的模型永远不能输出 selector / 坐标 / JS，只能从一个由代码生成的元素表里挑序号。**

源码证据（`packages/decision/src/elements.ts`）：

```ts
// TypeSafe's per-question choice limit; the AI SDK itself has none.
const MAX_CHOICES = 255;
...
// Viewport nodes first, then tree order; drop the rest past the cap so
// the model can scroll to them, and never block on a large screen.
```

```ts
// packages/decision/src/elements.ts
export interface Target {
  readonly description: string;
  run(argument?: string): Promise<void>;   // ← 真正的动作在代码里绑定
  readonly optionLabel?: string;
}
```

文档原话：*"The decision model only ever names an element index. ... **Model output never becomes a selector, a URL, or a key.**"*

配套：
- 请求拆成**多个结构化选择题** —— `operation`（做什么）+ 每个候选 >1 的操作一条 `{op}_target`（点哪个）+ 多密钥时一条 `secret`
- **唯一候选不提问**，直接派发
- 门限 `minProbability` / `minConfidence`（**默认全关**）；不满足 → 该动作被拦
- 截断行为显式建模：超出 255 的部分计入 `omitted`，模型看到计数并可以滚动，**不因为页面大就阻塞**
- 完成判定是**独立的一问**：「任务完成了吗」——确认 `done` 才通过，未确认退回决策模型；第二次仍不确认 → 屏幕与目标矛盾报 `ACTION_FAILED`，否则 `blocked(AUTOMATION_UNSUPPORTED)`
- **明确的能力缺口（官方自陈）**：无视觉（Canvas 控件 / 图片型目标未实现）、无 `navigate`（导航靠 `tap` 链接，URL 归测试代码）、v1 无多选 listbox、无拖拽/上传/悬停

> ★ 这是**规则 12「模型不能创造目标 —— 候选集由代码生成并编号，模型只输出候选集内的 index」**的一次完整工程实现。而且它的 prompt 规则**注明改编自 `jev-ultrafast` 的 `NEXT_ACTION` / `TARGET`**（`packages/decision/src/questions.ts`）——**JEV 血统直接可见**。

#### 确定性臂（Playwright 原生能力，全量可用）

| 能力 | API | 对 BS 系统的意义 |
|---|---|---|
| 语义定位 | `getByRole` / `getByLabel` / `getByTestId` / `getByText` | L1 定位，无障碍名优先 |
| 作用域 | `.filter({ hasText })` / `.first()` / `.nth()` / `{ name }` | **匹配数 >1 直接 `LOCATOR_AMBIGUOUS` 失败** |
| **iframe（含嵌套）** | `browser.frameLocator('#frame')` → 帧内 `screen` 查询 | ★ 云管系统必用（嵌 Grafana / Web 终端） |
| **闭口 Shadow DOM** | 引擎主动追踪 closed shadow root，并保证截图遮罩覆盖 | 能处理「访问树说谎」的场景 |
| API 断言 | `fetch` + `expect(...).toMatchSchema(zod)`，与 UI 测试同文件同轮 | ★ **不必经过 UI** 直接断言后端；`app.baseUrl` 自动带上端口 |
| 登录态请求 | 自定义 fixture 把 `browser.cookies()` 塞进请求头 | 带会话调 API |
| Mock | `browser.route(...)` | 拦截/伪造接口（含错误注入） |
| 对话框 / 下载 | `browser.onDialog` / `browser.waitForDownload` | 原生对话框与文件下载 |
| 页面求值 | `browser.evaluate(...)` | ★ **Canvas 可用 `getImageData` 做确定性像素读取**（见 §4.7） |
| Init 脚本 | `engine.initScripts` | 注入上下文（如 sessionStorage 里的集群身份） |
| 请求头 / BasicAuth | `headers` / `basicAuth`（密码可为 `Secret`） | 受保护预览环境 |
| 上下文模拟 | `viewport` / `userAgent` / `locale` / `timezoneId` | 多语言、多时区、多分辨率 |

---

### 2.3 「测试报告生成」——五要素逐条落点齐全

**产物目录（默认 `.e2e/`，`output` 可改；**缓存与 app 日志不吃 `output`**）：**

| 路径 | 内容 |
|---|---|
| `report.json` | **机器可读主报告**（带 schema 版本号）；脚本与集成读这个 |
| `junit.xml` | `--reporter list,junit` 时生成，CI 测试报告插件直接读（启动失败也进 `run` suite） |
| `summary.md` | markdown reporter，整轮总览；`@e2e-dev/github` 就是把它发成 PR 评论 |
| `results/<test>/trace.md` | **每用例一页追踪报告**（失败/超时/中断/flaky 默认保留） |
| `results/<test>/attempt-N/screenshots/*.png` | 失败截图（**安全字段在源头被涂抹**） |
| `results/<test>/attempt-N/screen-at-failure.txt` | 失败瞬间的脱敏可访问性树 |
| `results/<test>/attempt-N/*.webm\|*.mp4` | 录像（opt-in，**不遮罩**，标 `redaction: "incomplete"`） |
| `results/<test>/attempt-N/downloads/*` | 下载物；文本类会被重写脱敏 |
| `ai-trace.json` | `--ai-trace`：每次模型调用（脱敏后的 prompt，图像字节只留大小） |
| `sessions/<runId>/` | 加密会话（0700 / 0600），运行结束即删 |
| `cache/`（`.e2e/cache/`） | 回放缓存条目，**结构上保证无密钥** |

**`trace.md` 里有什么**（这就是你们的「未通过原因 + 可复现过程」）：

```markdown
# ✗ todos › shows the remaining count
**ASSERTION_FAILED**
```text
expect.toHaveText failed
locator: getByRole("status", name: "Remaining")
expected: text "1 remaining"
observed: text "0 remaining" (match count 1)
```
Ran on: browser `chromium 141.0.7390.37` · user agent `...`
Look at: `tests/todos.e2e.ts:15`

## Steps
1. ✓ app.open /todos (37ms) — tests/todos.e2e.ts:4
2. ✓ agent.act "Add a todo named Milk." (429ms, 2 model calls)
   - cache: recording saved (.e2e/cache/1227d5a6….json)
   - type "Milk" into textbox "New todo" (17ms)
   - ✗ network error: POST /api/todos 500 Internal Server Error
   - screen: 6 changes since step 1 at /todos, 38 nodes
     - added listitem "Milk Delete Milk" testid="todo"
     - changed status "Remaining" text="1 remaining" (was: "0 remaining")
4. ✗ expect.toHaveText ... — ASSERTION_FAILED
   - expect gave up after 16 reads in 1.6s: text "0 remaining" (1 match) x16
```

> **`expected` vs `observed` 对照 + 每一步的节点级屏幕 diff + 应用侧日志（console / 未捕获异常 / 失败请求 / 4xx-5xx）+ 失败瞬间截图与树** —— 你们的五要素在这一个文件里全了。而且它对「断言读到的值一直没变」和「读到的值变过」给出**不同的归因建议**（前者＝期望写错或状态没到达；后者＝与 app 竞速）。这个细节说明它是真做过诊断的。

**CI 集成**：GitHub Actions / EAS Workflows / Bitrise / Codemagic 官方文档齐备；`@e2e-dev/github` 一次运行发一条 PR 评论、重跑**原地编辑**同一条、矩阵任务用 `key` 区分。

---

## 3. 五要素核验（你的验收标准）

| 你要的 | 它的落点 | 判定 |
|---|---|---|
| ① **测试用例** | `tests/**/*.e2e.ts`（TypeScript，`test`/`describe`/hooks，Playwright 心智模型），`--grep` / `--tag` / `--target` / `--agent` / `--shard` 选择 | ✅ 一等人 |
| ② **测试截图** | 失败必截（引擎能截且允许像素时）；`agent.assert` 任一判定后也截（`screenshot:false` 可关）；`app.screenshot('label')` 显式截 | ✅ 达标（**遮罩见 §5**） |
| ③ **是否通过** | **三态** `passed` / `failed` / `blocked` + 错误码分类（test/config/infra/internal/interrupted）→ 退出码 1/2/3/4/130 | ✅ 超出要求 |
| ④ **未通过原因** | `error`（码 + 消息 + 源码行 + 断言 details）+ `failure`（屏幕/截图产物 + 定位器候选）+ `expected` vs `observed` 对照 | ✅ 达标 |
| ⑤ **可复现过程** | 每用例 `trace.md`（节点级步骤与屏幕 diff + 应用日志 + Agent 末轮 + 失败屏幕）+ 录像 + **回放缓存** | ✅ **双路径**：录像给人看，缓存给机器零成本重放 |

**退出码契约（明确定义，可直接接 CI）：**

| Exit | 含义 | 重试有用？ |
|---:|---|---|
| 0 | 通过 | — |
| 1 | 有测试失败 | 仅当 flaky |
| 2 | 配置 / 收集 / 策略问题 | 先修问题 |
| 3 | 引擎 / app 进程 / 模型 provider / 产物失败 | 原因临时则有用 |
| 4 | runner 内部错误 | 上报 |
| 130 | 被中断 | — |

混合运行：`130 > 4 > 3 > 2 > 1 > 0`，报告里保留每个结果的原始码。

---

## 4. BS 架构系统测试适配度（逐项）

| # | 企业系统常见需求 | 它的支持 | 证据 |
|---|---|---|---|
| 4.1 | **登录 / 多角色** | ✅ 强。`test.setup` + `session.save(name)` 存会话；`{ session: 'admin' }` 恢复；同一套测试对多个 persona 各跑一遍（`describe(..., { agent: persona, session: persona })`）。会话含 cookies/localStorage/IndexedDB | `docs/authentication.mdx` |
| 4.2 | **凭据不进模型 / 不进报告** | ✅ 强。`credentials.user('admin').password` 是 **`Secret` 不透明句柄，无 `.value`**；模型只看到名字与用途，**由 runner 校验字段后自己填值**；`secrets` 是独立命名空间（可填任意可编辑输入）；密码 provider 可为函数（直连 vault，不进环境变量）；配置文件里 `process.env` 之外可以完全无明文 | `docs/authentication.mdx`、`docs/security.mdx` |
| 4.3 | **数据通路 / 后端断言** | ✅ 强。`fetch` + `app.baseUrl` + `toMatchSchema(zod)`，与 UI 同文件同轮；带会话请求用 fixture 注入 cookie | `docs/api-testing.mdx` |
| 4.4 | **iframe** | ✅ 支持（含嵌套）：`browser.frameLocator(...)` → 帧内 `screen` 查询。**注意：不在 `docs/web.mdx` 的正文里，只在 `browser.mdx` 与迁移对照表里** —— 是我这次特意去挖的 | `docs/browser.mdx:84` |
| 4.5 | **Shadow DOM（含 closed）** | ✅ 支持。引擎主动追踪 closed shadow root，且**截图遮罩依赖这套坐标**（`closed-shadow.ts:110`：*"a mask that cannot prove its coverage must fail closed"*） | 源码 |
| 4.6 | **多浏览器 / 多分辨率** | ✅ `chromium`（默认）/ `firefox` / `webkit`；多 target 并行；`viewport` 可 `null`（填满窗口）或每 target 固定 | `docs/reference/web.mdx` |
| 4.7 | **Canvas / ECharts（openFuyao 的硬骨头）** | ⚠️ **分两路，都不是模型视觉**：<br>(a) **确定性像素读**：`browser.evaluate` + `canvas.getContext('2d').getImageData` 读某点颜色 / 数某带内某颜色的像素数（官方 benchmark 的 `tests/canvas.ts` 就这么断言 canvas 场景）；<br>(b) 内置 Agent 的 `vision: true` 让**判定模型**看图。<br>而 `@e2e-dev/decision` 执行器**明确声明无视觉** | `apps/web-benchmark/tests/canvas.ts`、`docs/decision-models.mdx#Limits` |
| 4.8 | **数据隔离 / 清理** | ⚠️ **只给了机制，没给语义**。`test.extend` 的 fixture（`use` 前 setup、`use` 后 teardown、失败也 teardown）＋ `afterEach` ＋ `unique()` 保证每次跑的值不同。但**没有内建 runId 命名空间概念** —— 「资源名里嵌 runId」「cleanup 绑 runId 轮询至终态」全要自建 | `docs/reference/test.mdx#Your-own-fixtures`、`docs/cache.mdx` |
| 4.9 | **CI 门禁** | ✅ 强。CI 模式自动切默认值（`retries` 0→1、`workers`→1、`cache` read-write→read-only、`.only` 直接 `ONLY_IN_CI` 拒绝）；必填检查直接卡合并；`--shard` 分片 | `docs/ci.mdx#What-CI-changes` |
| 4.10 | **复用现有浏览器状态（你的关切）** | ⚠️ **有 CDP attach 口子但不是给你用的**。`web({ connect: { cdpEndpoint } })` 存在，文档定位是「hosted-browser engine 的接线」（Kernel / EAS 云真机），`browser` provider 与 `connect` 互斥；`connect.reconnectEndpoint` 断线自愈时**必须用持久化默认上下文**（因为 Chrome 在 transport 断开时会删掉普通 Playwright context）。**没有文档化的「接管我登录好的 Chrome」流程**，也不建议在没有强隔离的前提下把它当主路径 | `docs/reference/web.mdx#Options`、`#Recovering-a-CDP-transport` |

---

## 5. 四条一票否决判据核验

| 判据 | 它的做法 | 判定 |
|---|---|---|
| **1. 断言必须由人显式给出，模型无权发明** | `agent.assert('...')` 的**陈述句写在测试文件里，由人写**；模型只做「真/假/证据不足」判定。定位器断言由人写 selector。**框架从不自己生成正确性标准** | ✅ 通过 |
| **2. 判定必须 ≥ 三态** | `passed` / `failed` / `blocked` 三态；`blocked` 细分为 credential / environment / seed_data / test_setup / budget / automation 六类，各自映射到 config(2) / infra(3) / test(1) 退出码 | ✅ 通过（**但见 §6.1 的例外**） |
| **3. 模型判断与观测事实必须分账** | `error.code` 区分 `ASSERTION_FAILED`（模型判假）与 `LOCATOR_NOT_FOUND` / `ACTION_FAILED`（执行侧）；步骤的 `api` 字段区分 `agent.assert` 与 `expect.toHaveText`；报告里模型判定的原文会「淡化」展示 | ⚠️ **部分通过**：**有分账字段，但模型判定可以直接产出 FAIL 并计入 bug**（见 §6.1） |
| **4. 必须存在零模型调用的回放路径** | ✅ **回放缓存**（下详）。**且这是全套设计中最精彩的一块** | ✅ 通过（**且质量超出预期**） |

### 回放缓存为什么值得单独写一节

**记录时机**：`agent.act` 的执行动作，**只有在「后来的某个验证步骤通过」之后才被保存**。

**算验证的**：`expect(locator).toHaveText(...)` 等定位器匹配器 · `expect(browser).toHaveURL(...)` 等引擎断言 · `locator.waitFor()` / `browser.waitForURL()` · `agent.assert` / `agent.waitFor`
**不算验证的**：`expect(value).toBe(...)` 这类裸值断言 · `expect.poll(...)` · `locator.textContent()` 等读取 · `agent.extract` · 另一个 `act` · **「这个用例自己过了」**

> ★ **「用例自己过了」不算验证** —— 这一条直接掐死了自证陷阱。动作必须被一个**独立于它自身**的检查确认，才会被固化成可回放产物。

**回放的 4 步**（`docs/cache.mdx#How-a-replay-works`）：

1. **核对起点屏幕**（同 origin+path+query；id / token / 时间戳 / cache buster 一律读作 id 占位符，所以 `/orders/42?t=…` 与 `/orders/7?t=…` 是同一路由；但 `?mode=safe` 与 `?mode=unsafe` 是不同屏幕）
2. **逐个找回记录的控件并重放动作**（按 role / name / testid / 上下文匹配；**匹配歧义即停止**；无名控件必须在同一个命名行/列表项/组里按位置定位，否则交给 agent）
3. **核对终点**：路由 + 记录到的控件出现/消失/状态变化。**「至少要有一个变化发生在这次回放的首次屏幕之后」** —— 原文：*"an outcome already on screen before the actions that should produce it proves nothing"*。回放过程中弹出了记录里没见过的告警也会中止。
4. **无模型调用地结束，或者带着「跑了什么、为何停」的记录把控制权交给 agent**

**被显式处理的「假 PASS」通道**：

- 命名了「在数什么」的计数（`3 records imported`）算作效果的一部分，必须一模一样；**裸数字（角标）永不用作效果**；出现在「非本步操作的屏幕」上的计数不算（**上次跑剩的数据会造成它变化**）
- 每次运行都不同的文本（日期/时间/耗时/id）不用于比对，**唯独告警里按占位符读**

**模式与门禁**：

| 模式 | 回放 | 记录 | 默认 |
|---|---|---|---|
| `read-write` | ✅ | ✅ | 本地 |
| `read-only` | ✅ | ❌ | **CI（cache 未配置时）** |
| `off` | ❌ | ❌ | `--no-cache` |

> ★ **`--strict-cache`（或 `cache: { strict: true }`）就是你们的 `replay --verify`**：记录存在但回放不了 → `REPLAY_STALE`，**不调模型、不重试、exit 2**（理由写得极准：*"a retry never replays and would pass live"*）。
> **但默认是 `hand off`（交给 agent 兜底）** —— 也就是**默认 `--heal`，要显式开 `--strict-cache` 才是 `--verify`**。这与你们铁律 3「禁止静默适配状态漂移」**方向一致但默认值相反**，是可讨论的一处。

**缓存条目的内容与密钥边界**：JSON，文件名为 key 的哈希，>1 MiB 拒绝。key = 测试 + target + instruction + params + agent + **agentContext 的脱敏文本哈希** + app identity。条目含动作、目标描述、输入文本、步骤摘要、终点检查；**不含 prompt / 对话 / 截图 / 观察树 / 密钥值**（密钥填充只存名字，回放时重新授权）。

**"gap"（不可回放的动作）显式建模**：`step.cache.derived` 会点名规则 —— `whole-node`（读了一个控件的整段文本再输入）、`minted-token`（app 当场生成的码/id）、`date`、`pixels`（看截图后输入的值）。这些**回放不了就交给 agent 实时跑**，而不是假装成功。

**成本侧证据**：报告里会打 `AI 4.1k tokens · 2 model calls` / `Cache 4 replayed · 1 handed off · 1 missed`；`--debug` 出每步的 token / 缓存命中率 / 成本表。

> ★ **这就是你们的「学习飞轮」的完整实现**：L3 成功 → 固化 → 下次零成本回放 → 改版才重新花一次钱。而且它把「固化产物」的**绑定面**做得很细（instruction + params + agent + context + app identity + engine），改 instruction 或改 agent context 都会 miss —— 这正好对应你们铁律里「固化产物必须绑定，任一不符即拒绝」。

---

## 6. 两处与 IDWTH 铁律相冲突的地方（诚实评估）

> 这两条不是「它做得不好」，而是**它的取舍和你们的取舍不同**。是否需要对齐，取决于你们的报告要不要背「误报率」这个指标。

### 6.1 ❌ 「模型判不出来」被记为**测试失败**（不是 BLOCKED）

**源码证据**（`packages/decision/src/executor.ts:382`）：

```ts
/** Insufficient evidence must never become an assertion pass. */
function inconclusive(summary: string): StepVerdict {
  return { status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE', summary };
}
```

**错误码参考表**：`ASSERTION_INCONCLUSIVE` → class **`test`** → **exit 1**。文档明写：*"A failure, never a pass"*。

**为什么它这么设计**：fail-closed。宁可让门禁变红，也不让「模型没看清」变成绿灯。这个动机是对的 —— 它怕的是**假 PASS**。

**代价**：`agent.assert` 是**唯一会被模型判定翻转的地方**，而模型判定没有置信度门限（内置 Agent 只有循环守卫，没有 `confidence` 阈值；门限只在 `@e2e-dev/decision` 里有，且默认关闭）。于是：

| 场景 | 它报 | 你们铁律要求 |
|---|---|---|
| 页面还在加载，模型没看清 | `failed`(exit 1)，报告写「测试未通过」 | `BLOCKED`，**不计入 bug 检出** |
| ECharts 画在 Canvas、DOM 里没数据、`vision` 未开 | `ASSERTION_INCONCLUSIVE` → `failed` | 应报「此处不可测」 |
| 断言目标区在视口外 | 可能 inconclusive → `failed` | 同上 |

**对你们的直接影响**：如果 IDWTH 的报告对客户承诺「FAIL = 应用有缺陷」，那么**照搬 e2e 的判定语义会把模型的不确定变成假 FAIL**。你们的铁律 2/3 在这一条上**更严格**，应当保留自己的口径。

**可抄的部分**：`ASSERTION_INCONCLUSIVE` 这个**独立错误码**本身非常好 —— 它把「判假」和「判不了」在**码级**分开了（只是归到了 `failed` 类）。抄这个码，改它的 class 即可。

### 6.2 ⚠️ 默认是 heal，不是 verify

`--strict-cache` 才让陈旧记录**报错终止**；默认是**悄悄交给 Agent 兜底**。文档自己点出了这个代价：

> *"A committed recording that stops replaying is **quiet by default**: the agent takes the step over, the test passes, and **every CI run pays for the model calls** until someone re-records."*

也就是说：**默认路径下，UI 改版 → 缓存静默失效 → 每次 CI 悄悄多花钱 → 测试仍然是绿的，而实际执行路径已经不是你录的那条了。** 这与你们铁律 3 的原文（*"禁止静默适配状态漂移"*）**直接冲突**。

**建议**：IDWTH 的 `replay` 默认必须是 `--verify`（漂移即报错终止），`--heal` 显式开启且产物不得入 CI。**e2e 的默认值是从「降低上手摩擦」出发的，你们的默认值应当从「报告可信度」出发。**

---

## 7. 口径校正：哪些数字不能外推

| 项 | 事实 | 提醒 |
|---|---|---|
| 星标数 | 7,513 ★ / 345 fork | 2.5 个月涨到这个数，**有商业公司运营与 Trending 加成**，不等于生产验证量 |
| 性能数字 | 官方 benchmark 报的是自建场景 | 它**自己声明**了哪些场景 `skip` 并写明原因 —— 这种自曝比数字本身更可信 |
| 基准套件的做法 ★ | `apps/web-benchmark` 是一个 **Next.js 硬场景集**：嵌套 shadow root / 纯 Canvas UI / 嵌套 iframe / 原生对话框 / 第二个标签页 / 拖放 / 每秒重挂载的 DOM / 说谎的访问树。**确定性套件与 Agent 套件都卡 PR**，且 `planted-bugs.e2e.ts` **断言的正是「对植入 bug 的正确行为做 `agent.assert` 应当失败」** —— 也就是**在度量漏检，而不是在度量通过率** | ★ **这是全仓库最值得学的一处工程实践**：把「模型漏掉了一个真 bug」变成一条会红的测试 |
| 成本 | 每个 Agent 步骤都花钱 | 缓存命中率决定 CI 账单；带 `vision` 的步骤输入 token 更高；**密钥填充之后整轮不再截图**（省 token 也是安全副产物） |
| 性能对照 | `scripts/bench-ab.ts` 是**配对 A/B 基准**：seeded 随机顺序、先比对行为再比对时间、行为不同就踢出计时行 | 说明作者自己清楚「共享 CI runner 的墙钟时间是噪声」 |

---

## 8. 与 IDWTH 的关系：拿哪一块，自建哪一块

### 可直接用（Apache-2.0，无许可红线）

| 用途 | 做法 |
|---|---|
| **执行臂的工程基线** | 以 `e2e` + `@e2e-dev/web` 为骨架，比自己从 Playwright 起炉灶省掉「语义观察 / 定位器引擎 / 遮罩 / 会话加密 / trace / 报告」五大块 |
| **回放缓存的全部设计** | 记录时机（独立验证后才固化）、起点核对、终点核对、`derived` gap 分类、`REPLAY_STALE`、条目 key 的绑定面 —— **这几页文档可以直接当 IDWTH 的实现规格读** |
| **三步骤心智模型** | Goal / Assertion / Locator 的分工写进文档与 skill，比「全 AI 编排」好解释得多 |
| **决策模型执行器** | `@e2e-dev/decision` 的「元素表 + 序号 + 操作/目标分段提问 + 唯一候选不提问 + 255 上限 + omitted 计数」是现成实现，**且与我们铁律 12 完全一致** |
| **示例与硬场景集** | `apps/web-benchmark` 的 20+ 个「难自动化场景」是现成的靶场，可直接当 IDWTH 的回归基准 |
| **迁移对照表** | cypress / playwright / detox / maestro / selenium 五份 API 映射，客户已有用例可低成本搬 |

### 必须自建（它明确没解决 / 不打算解决）

| # | 事项 | 依据 |
|---|---|---|
| 1 | **runId 命名空间** | fixtures 给你 `use` 前后钩子，但「fixture 名里嵌 runId」「`exists` 断言限定 runId 作用域」「cleanup 绑 runId」全要自建。否则就是你们 E02 已经实测过的**残留 → 假 PASS** |
| 2 | **断言论域收窄 + 系统对象排除项** | 对应你们铁律 9（`kube-root-ca.crt` 致假 FAIL）。FR 层要写进 schema |
| 3 | **cleanup 的终态判据** | 对应铁律 10（DELETE 200 ≠ 完成，需轮询至 404）。这是你们的领域知识，不应指望框架 |
| 4 | **判定语义的 BLOCKED 化** | 见 §6.1。要在它之上包一层：`ASSERTION_INCONCLUSIVE` → IDWTH 的 `BLOCKED(reason)`，且不计入 bug 检出 |
| 5 | **`replay --verify` 作为默认** | 见 §6.2。改成默认 strict |
| 6 | **判定器实现哈希** | 它绑定了 instruction/params/agent/context/app identity，**但没有「判定器源码哈希」** —— 判定口径改了，新旧 verdict 就不可比。对应你们「绑定要覆盖判定侧」那条 |
| 7 | **视觉噪声下界标定** | `vision: true` 直接进模型判定，**没有 `ε_base` 标定、没有 `visual_unstable` 拒绝机制**。你们的铁律 13 在这一层是超集的 |
| 8 | **敏感区域确定性遮罩（文本级）** | 它的遮罩是**输入控件级**（`mask` locator + maskColor，且「无法证明覆盖就 fail closed」）。**页面上渲染出的 kubeconfig 片段 / Bearer token 是 `<div>`/`<pre>`，不在遮罩集里** —— 与你们「两个易漏泄漏口」的判断一致。且密钥填充后整轮禁截图的策略**只覆盖 fill，不覆盖「app 自己渲染出密钥」** |
| 9 | **跨系统时间戳不作归属判据** | 它没有这个问题（不需要），但你们有（E02 已证伪） |
| 10 | **报告的业务语言层** | 它输出的是工程语言（exit code / error code / step diff）。你们要的「未通过原因」若面向非工程读者，需自建叙述层 |

### 一个判断

**`e2e` 在赛道上是「执行 + 证据 + 回放」这一整段的成熟实现，它的空白正好是你们在 E01/E02 里踩出来的那些领域知识。**

所以最省力的路径不是自研执行臂，而是：**以 `e2e` 为执行与证据层 → 在其上加 IDWTH 的判定层（三态语义 / 论域收窄 / runId 隔离 / 判定器哈希）→ 报告层用自己的五要素模板覆盖它的 markdown reporter。**

---

## 9. 风险

| 风险 | 等级 | 说明 / 处置 |
|---|---|---|
| **pre-1.0，API 会在 minor 间变** | 🔴 高 | 官方首页明确声明。**缓存条目在版本升级后会整体 re-key**（`docs/cache.mdx` 原文）—— 意味着升级即重录，CI 成本与证据连续性都会断。**处置：锁版本 + 升级走独立 PR 并重录** |
| **Telemetry 默认开启** | 🟡 中 | CLI 每次调用发一次到 `eu.i.posthog.com`（匿名：命令、引擎、失败位置；**声明不含测试内容/app 内容/凭据**）。内网/合规环境必须 `npx e2e telemetry disable` 或 `E2E_TELEMETRY_DISABLED=1`，**并在 CI job 的 env 里也设** |
| **模型 provider 出网** | 🟡 中 | 未缓存的动作与所有 `agent.assert` 都会出网。**内网部署需接私有/本地模型**（支持本地模型与 OpenAI 兼容端点）。`zeroDataRetention` 可通过 `providerOptions` 传给决策模型（Vercel AI Gateway） |
| **视频不遮罩** | 🟡 中 | `--video` 产物标 `redaction: "incomplete"`，**官方也写了「若探索器输入过密码，分享录像前先检查」**。生产环境建议不录或只 `retain-on-failure` 并加访问控制 |
| **`command.log` 不脱敏** | 🟡 中 | 是 app 的 stdout/stderr 原样落盘。**别让被测应用把密钥打到 stdout** |
| **无 origin 白名单** | 🟠 中高 | 导航与密钥填充**没有 origin allowlist**，Agent 可以带着本步声明的密钥跟到别的站点。对内部系统可控，对公网目标需自加守卫 |
| **Windows 必须 WSL** | 🟢 低 | 官方明说 |
| **重定向 / 弹窗不做二次校验** | 🟢 低 | 文档自陈 |

---

## 10. 建议的三个动作

1. **把它拉进 IDWTH 的选型基线，做一次本地实测**（半天）：用 openFuyao 的 `https://openfuyao-staging.internal.example.com:31616` 建一个 target，写 3 条用例 —— ①纯定位器登录 ②`agent.act` 走一次创建命名空间 ③`fetch` 断言 K8s 代理 API。**实测重点不是「能不能跑通」，而是三件事**：
   - `--strict-cache` 下的**升级/改版行为**（记录陈旧时报错是否干脆）
   - `agent.assert` 在**加载中/Canvas 页面**上到底报什么（验证 §6.1 的假 FAIL 通道）
   - trace.md 里**凭据与渲染密钥的泄漏情况**（`grep` trace 与截图产物）
2. **写一份 IDWTH ↔ e2e 的能力映射表**，把上面 §8 的「可直接用 / 必须自建」两列落到 FR 编号上 —— 这一步做完，你们的「自研 vs 复用」的边界就不再有争议。
3. **把 §6.1 / §6.2 两条冲突写进 `detailed-design.md` 的判定层设计**，明确 IDWTH 的语义是**收窄的**（BLOCKED 化的 inconclusive + verify 默认）—— 否则实现时会不自觉地被上游框架的默认值带走。

---

## 附：本文所有事实的来源

| 类别 | 来源 |
|---|---|
| 仓库元数据 | `gh api repos/tester-army/e2e`（星标/许可/推送时间/贡献者/releases） |
| 文档 | `git clone` 后读 `docs/*.mdx`、`docs/reference/*.mdx`（**随 npm 包发布，是权威版本**） |
| 源码 | `packages/e2e/src/{agent,run,report,cache,locator,expect}/` · `packages/decision/src/` · `packages/web/src/` · `apps/web-benchmark/` · `scripts/bench-ab.ts` |
| Skill | `skills/e2e/SKILL.md` + `skills/e2e/references/*.md`（共 1,957 行） |
| 未做 | 未本地安装运行；未实测性能、成本、flaky 率；未验证内网环境下的模型连通性 |

**本文中标注「源码证据」的结论均已直接读到对应文件行；标注引用的原文均为文档原句。**
