# 复用现有浏览器状态的 BS 架构 E2E 测试：实现方案

> 承接《JEV 系 BS 架构系统测试方案调研报告》
> 待决问题：**基于 `browser-use/jev-ultrafast` 叠加 E2E，还是基于 `alibaba/page-agent`？**
> 新增约束：**browser 操作需复用现有浏览器状态**
> 目标：测试用例 → 完整测试报告（用例/截图/是否通过/未通过原因/可复现过程）
> 核验方式：`alibaba/page-agent`（commit 已浅克隆，252 文件）+ `browser-use/jev-ultrafast`（1231850）源码逐行阅读

---

## 一、结论

**两条路都不要当作"基座"——因为它们缺的是同一层。正确做法是自建 runner，把两者降级为可插拔的"执行/定位臂"。**

### 1.1 为什么两者都不是基座（一句话证据）

| 框架 | 判定依据（源码级） | 后果 |
|---|---|---|
| `jev-ultrafast` | `questions.py` 最后一条原则：*"DONE is never independent evidence of success."* | 它自己承认 `DONE` 不可信 → 无判定层 |
| `page-agent` | `PageAgentCore` 的 `done` 工具签名 `{text, success: boolean}`，`ExecutionResult.success` **直接来自模型自述** | 同上，且是纯自述无任何护栏 |

**两者都缺**：断言层、判定层、报告层。所以问题不是"在谁之上叠加"，而是"三者补齐时，把执行臂选在谁身上"。

### 1.2 执行臂决策：**CDP 为主干，page-agent 为降级臂**

| 判据（按重要性排序） | `jev-ultrafast`（CDP） | `page-agent`（in-page JS） |
|---|---|---|
| **① 输入保真度** | ✅ CDP 真实输入：`Input.dispatchMouseEvent`、`Input.dispatchKeyEvent`、`Input.insertText`（`isTrusted=true`） | ⚠️ **JS 合成事件**：`target.dispatchEvent(new PointerEvent(...))`（`isTrusted=false`）+ `getNativeValueSetter` |
| **② 富文本/复杂组件** | 未覆盖（MVP） | ⚠️ 明确不支持：*"Monaco/CodeMirror: Require direct JS instance access"*、*"Draft.js: Not responsive to synthetic/event"* |
| **③ 每 case 隔离** | ✅ `Target.createTarget` 开独立后台标签页，`Target.closeTarget` 销毁 | ❌ 复用当前标签页，**无隔离概念** |
| **④ 导航可控性** | ✅ `Page.navigate(url)` —— 用例起点可控 | ❌ **核心工具集无 goto**；仅扩展版经 `customTools` 注入 `open_new_tab`，且 URL 由模型给 |
| **⑤ 观测新鲜度守卫** | ✅ `fresh()` 比对 `page_key`+per-node guard；`elementFromPoint` 遮挡检查；过期即 `StalePage` | ⚠️ 仅 `assertIndexed()`（要求先 `updateTree()`）；无遮挡检查、无节点守卫比对 |
| **⑥ 每步成本** | ✅ 1 请求/步；`recent_actions` 只留 10 条；协议 1,487 字符 | ❌ 1 请求/步但 `<agent_history>` **全量累积**；系统提示词 **9,794 字节 / 152 行** |
| **⑦ 复用现有浏览器状态** | ✅ 连用户现有 Chrome，开**后台**标签页；`setFocusEmulationEnabled` 保证不抢焦点 | ✅ 扩展直接跑在当前标签页，天然继承会话 |
| **⑧ 被外部驱动** | ✅ Python lib，可直接 import | ⚠️ 官方定位 *"designed for client-side web enhancement, not server-side automation"* |
| **⑨ 生态成熟度** | ⚠️ 16.5k★，3 天内迭代 | ✅ **29,156★**，Chrome 商店在架，持续推送至 2026-09-21 |
| **⑩ 许可** | MIT | MIT |

**①②③④⑤⑥ 全部倾向 CDP —— 这六条都是测试工具的底线要求**，其中①（保真）和③（隔离）是**一票否决级**：

- **保真**：`isTrusted=false` 的合成事件未必触发框架内部逻辑。结果是**测试"通过"而真实用户会失败**，或反之。测试工具的首要义务是忠实，这一条单独就足以淘汰 page-agent 做主干。
- **隔离**：E2E 必须能控制每个 case 的起始状态。跑在用户当前标签页上的 agent，没有"新建干净上下文"的语义。

**⑤⑥ 是工程代价差异**：jev-ultrafast 已经把"决策引用的节点是否还是当初观测的那个"这件事做成了硬守卫（`StalePage`），而 page-agent 只有"是否索引过"的弱检查。这直接决定报告的误报率。

### 1.3 但 page-agent 有不可替代的场景

**唯一能在"完全不装 Python/CDP 环境"下、于用户已登录的真实会话中运行 agent 的方案。** 典型：被测系统有 SSO + MFA，测试环境无法复现登录态。

因此最终形态是**双执行臂**：

```
                     ┌─────────────────────────────┐
   用例文本 ─────────▶│  Runner（自建，确定性）        │
                     │  用例解析 · 导航 · 断言 · 判定 │
                     └──────────┬──────────────────┘
                                │ Adapter 接口
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
        ┌─────────────────┐          ┌──────────────────┐
        │ CDP Adapter      │          │ InPage Adapter    │
        │ 主干（默认）      │          │ 降级（MFA/免安装） │
        │ Playwright ↔ CDP │          │ page-agent 注入    │
        └─────────────────┘          └──────────────────┘
                 └──────────────┬──────────────┘
                                ▼
                     ┌─────────────────────────────┐
                     │  报告层（自建，五要素）        │
                     └─────────────────────────────┘
```

---

## 二、关键前提校正：你要的不是 agent，是 runner

这是整个方案的立论点。Agent 在这条链路里**只需要干一件事**：

> 把「点『登录』按钮」这个语义步骤，映射到当前页面上真实存在的那一个控件。

其余全部应该由确定性代码完成：

| 环节 | 谁做 | 为什么不能交给 agent |
|---|---|---|
| 用例解析 | 代码 | agent 会改写用例（jev-e2e 为此写了 8 项防篡改校验） |
| 导航到起始 URL | 代码（`page.goto`） | agent 靠点链接，起点不可控 → 用例不可复现 |
| 输入值 | 代码（用例里的字面量/fixture） | agent 生成的值每次不同 → 不可复现 |
| 断言 | 代码（Playwright locator） | 模型判定 = 自证（本报告核心结论） |
| 判定 | 代码（三态聚合） | 同上 |
| 截图 | 代码 | — |
| 报告 | 代码 | — |
| **控件定位** | **agent（唯一用途）** | 这是语义模糊性真正所在 |

**把这个边界划清楚，方案立刻从"研究 agent 怎么可靠"变成"写一个普通测试框架，只在定位失败时调一次模型"** —— 工程量下降一个数量级，可靠性上升一个数量级。

---

## 三、浏览器复用的三种挂载方式（源码级对照）

这是本次问题的技术核心，三种方式的**能力和代价完全不同**：

| 方式 | 实现 | 复用哪部分状态 | 隔离 | 保真 | 适用 |
|---|---|---|---|---|---|
| **A. CDP 新建后台标签页**<br>（jev-ultrafast 方式） | `ensure_daemon()` → `Target.createTarget(url, background=True)` → `attachToTarget(flatten)` → `Emulation.setFocusEmulationEnabled` | **同 profile**：cookie/localStorage/已登录态 | ✅ 每 case 一个 owned tab，`closeTarget` 销毁 | ✅ CDP 真实输入 | **默认主干** |
| **B. CDP 接管现有标签页** | 同 A，但用 `Target.getTargets()` 找到目标页并 attach，不新建 | 同 profile **且同标签页**（保留页面内已填一半的表单、SPA 路由历史） | ❌ 污染用户当前页 | ✅ CDP 真实输入 | 需接管"用户正卡在某一步"的现场 |
| **C. in-page 注入**<br>（page-agent 方式） | 扩展 content script，或直接注入 IIFE bundle 到页面主世界 | 页面内一切（含内存态 SPA store） | ❌ 无 | ⚠️ 合成事件 | MFA/无法接管 CDP/免安装 |

**A 的关键细节（值得照抄）**：

```python
# jev_ultrafast/browser.py:21-28
self.target = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
self.session = cdp("Target.attachToTarget", targetId=self.target, flatten=True)["sessionId"]
self.call("Emulation.setDeviceMetricsOverride", width=1120, height=780, ...)
# 让后台标签页正常渲染却不激活用户正在看的标签页
self.call("Emulation.setFocusEmulationEnabled", enabled=True)
self.call("Page.navigate", url=url)
```

`background=True` + `setFocusEmulationEnabled` 这一对组合，解决了"复用用户浏览器"时最大的体验问题——**测试跑起来会抢焦点、把用户的 Chrome 切走**。没有这个，测试框架无法在开发者的日常浏览器里跑。

> ✅ **A 的待验项已实测通过**（2026-09-22，本机 Chrome 153.0.8010.48 + Playwright 1.63.0，临时 profile 隔离，未触碰真实浏览器数据）。完整能力矩阵见 §3.1。

### 3.1 P0 闸门实测结果（14/14 通过）

**测试条件**：Chrome 153.0.8010.48 + Playwright 1.63.0，`--remote-debugging-port` + 临时 `--user-data-dir`（**未触碰真实浏览器 profile**）。

| 能力 | 实测项 | 结果 |
|---|---|---|
| **连接** | `chromium.connectOverCDP('http://127.0.0.1:<port>')` | ✅ contexts=1 |
| **A 复用既有会话** | 读到既有 cookie | ✅ 预置 `PRE-EXISTING-TOKEN` 可读 |
| | 既有 localStorage 可见 | ✅ 预置值可读 |
| **B 每 case 隔离** | `browser.newContext()` 可用 | ✅ **可用**（Playwright CDP 模式的已知薄弱点，实测无问题） |
| | 新 context 的 cookie 隔离 | ✅ **0 条 —— 强隔离成立** |
| | 既有 `context.newPage()` | ✅ 可用（弱隔离：继承会话但不隔离） |
| **C 断言原语** | `getByRole` 可见性断言 | ✅ |
| | `getByLabel().inputValue()` | ✅ 返回 `Dark` |
| | `isChecked()` | ✅ 返回 `true` |
| | `screenshot({mask})` 遮罩 | ✅ 密码框被遮 |
| **D 后台标签页** | `Target.createTarget(background:true)` | ✅ |
| | `Target.attachToTarget(flatten)` | ✅ |
| | `Target.closeTarget` | ✅ |
| **E 破坏性语义** | `browser.close()` 是否杀掉用户浏览器 | ✅ **不会** —— 端点存活、页面仍在（3/3 轮复核一致） |

**结论：§4 的路线 1（Playwright + CDP）全部能力成立，P0 闸门通过，可直接进入 P1。**

**三条实测得来的环境坑（写进实施文档，否则会浪费半天）**：

1. **Chrome 111+ 必须加 `--remote-allow-origins=*`**。否则 WS 连上后立即被 Chrome 以 `code=1006` 断开，Playwright 报 `Timeout 30000ms exceeded`，**错误信息完全不指向真实原因**。
2. **在受限沙箱里启动 Chrome 会失败**：报 `sandbox initialization failed: Operation not permitted` → GPU 进程退出 → `FATAL: GPU process isn't usable. Goodbye.`。需加 `--no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox`。**仅用于 CI/容器等受限环境**；本机日常跑用户真实 Chrome 不需要。
3. **端口复用会污染诊断结论**：连续多次测试复用同一调试端口时，残留进程会导致 `/json/version` 返回 404，看起来像"Playwright 连不上"。**每次测试换端口或先确认端口空闲**。

> 方法论提醒：本次首轮实测曾得出"Playwright 无法连接 Chrome 153"的错误结论——根因实为沙箱拒绝 Chrome 自身沙箱。**凡"连不上"类结论，必须先用原生 WebSocket 直连 CDP 隔离出是哪一侧的问题**，再下判断。

---

## 四、推荐技术栈（两条路线，按团队栈选）

| | 路线 1：**Playwright + CDP**（推荐） | 路线 2：**纯 CDP + Python**（jev-ultrafast 原样） |
|---|---|---|
| 执行层 | `chromium.connectOverCDP('http://127.0.0.1:9222')` | `browser-harness` + 裸 CDP 调用 |
| 断言层 | ✅ 内建 `getByRole`/`getByLabel`/`toHaveText`，**自动重试等待** | ❌ 全手写 |
| 截图 | ✅ `page.screenshot({mask: [...]})` 内建遮罩 | 手写 `Page.captureScreenshot` |
| 富文本/iframe | ✅ 原生支持 iframe、shadow DOM | ❌ MVP 不支持 |
| 复用现有状态 | ✅ contexts/cookies 直接可用 | ✅ |
| 隔离 | ✅ **实测 `newContext()` 可用且 cookie 隔离为 0**（§3.1） | ✅ 已验证 |
| 语言 | TypeScript | Python ≥3.12 |
| 依赖 | Playwright（浏览器自带） | `browser-harness==0.1.13` + `httpx[http2]` |

**推荐路线 1**。理由：你要补的三层（断言/判定/报告）在 Playwright 上几乎是免费的（`expect()` 自带轮询重试、`mask` 自带遮罩、`connectOverCDP` 自带状态复用），而在裸 CDP 上全部要手写——jev-ultrafast 之所以没做，是因为它的目标是"最快 web agent"而不是"测试框架"。

**保留路线 2 作为执行原语来源**：jev-ultrafast 的 `snapshot.js`（元素表 + 节点身份 + 可见性判定）和 `browser.py` 的 `fresh()` 守卫逻辑，可直接移植为 Playwright 侧的自定义观测器，用于给 JEV 决策器构造候选集。

---

## 五、具体实现方案

### 5.1 模块规划

```
packages/
  contracts/        # 用例契约 + 结果契约（唯一真源，双端共享）
  runner/           # 编排：解析 → 导航 → 定位 → 执行 → 断言 → 判定
  adapters/
    cdp/            # 主干：Playwright connectOverCDP
    inpage/         # 降级：page-agent 注入
  locator/          # JEV 决策协议（jev-ultrafast 风格）+ 确定性优先策略
  assertions/       # 断言原语 + 结果归一
  report/           # 五要素报告：report.html / report.json / trace.json / 截图
  cli/              # 退出码契约
cases/              # *.cases 用例文件
fixtures/           # 凭据与认证态（不入库）
runs/<runId>/       # 产物
```

### 5.2 核心契约（沿用 JevTest 已验证的抽象）

三个仓库里，**`JevTest` 的 `Adapter`/`Session`/`Policy`/`Check` 是唯一为"多执行臂 + 确定性断言 + 可回放"设计过的接口**。直接采用它做内部契约（注意：JevTest **无许可证，只能采用设计思路，不可复制代码**）：

```ts
// contracts/session.ts —— 执行臂统一接口（两种臂都实现它）
export interface Session {
  observe(): Promise<Observation>        // 结构化页面状态
  execute(action: Action): Promise<void> // 执行一个已选定的动作
  check(): Promise<Check>                // 跑全部断言，返回逐条结果
  capture(dir: string, name: string): Promise<string[]>  // 落盘截图
  close(): Promise<void>
}
export interface Adapter {
  open(caseSpec: TestCase, runId: string): Promise<Session>  // 每 case 独立会话
}

// contracts/types.ts —— 判定与证据
export interface Observation {
  fingerprint: string                     // 状态指纹，用于回放漂移检测
  url: string; title: string
  elements: ObservedElement[]             // 元素表（喂给 JEV）
  text: string
}
export interface ObservedElement {
  id: string                              // 代码拥有的整数 ID，绝不来自模型
  role: string; label: string; context: string
  value: string; disabled: boolean; checked: boolean | null
  options: string[]; guard: string        // 节点守卫，执行前比对
}
export interface Assertion { name: string; expected: Json; actual: Json; passed: boolean }
export interface Check { complete: boolean; assertions: Assertion[]; invariants?: Assertion[] }

// 三态判定（采纳 jev-e2e）
export type Verdict = 'PASS' | 'FAIL' | 'BLOCKED'
// 问题分类（采纳 JevTest：把模型判断与观测事实分账）
export interface Issue {
  source: 'assertion' | 'execution' | 'model'
  step: number; message: string
  candidate?: boolean        // source==='model' 时恒为 true，不计 FAIL
}
```

### 5.3 定位策略：确定性优先，模型兜底

**这是把模型调用量压到最低的关键，也是与两个参考实现最大的改进。**

```ts
async function locate(session, step, policy): Promise<Control | null> {
  // L1 确定性：语义 → ARIA 角色/标签（覆盖 80%+ 场景，零成本）
  const byRole = await session.tryLocateByRole(step.target, step.action)
  if (byRole) return byRole

  // L2 指纹复用：历史成功流程的控件快照（回放路径，零模型调用）
  const byPrint = await session.tryLocateByFingerprint(step, savedFlows)
  if (byPrint) return byPrint

  // L3 模型兜底：只在 L1/L2 都失败时调用一次 JEV 决策
  return await policy.select(session.currentObservation, step)
}
```

L3 的请求体直接采用 jev-ultrafast 的**投机扇出**结构（`model.py:107-117`）——一次请求同时问 `operation` 与各 `*_target` 头，只执行与 operation 匹配的那个：

```jsonc
{
  "model": "jev-latest",
  "state": {
    "page": { "url": "...", "title": "...", "text": "..." },
    "elements": [ { "index": "1", "role": "button", "label": "Sign in", "operations": ["CLICK"] } ],
    "recent_actions": [ /* 只留最近 10 条 */ ]
  },
  "questions": {
    "operation": { "type": "choice", "criteria": { "CLICK": "...", "TYPE_TEXT": "...", "DONE": "...", "BLOCKED": "..." } },
    "click_target": { "type": "choice", "criteria": { "1": "...", "7": "..." } }
  }
}
```

**必须移植的两条校验**（`model.py:30-45` `validate_choice`）：

1. `choice ∈ criteria keys`，且 `probability keys == criteria keys`，且 `Σp ≈ 1`，且 `p[choice] == max(p)` —— 任一不满足即 **`Invalid TypeSafe response; no action executed.`**，**不派发任何动作**。
2. **只校验 operation 选中的那个 head** —— 未使用的 target 头不得产生副作用（原文注释：*"Unused target heads cannot cause an action."*）。

**必须移植的安全设计**（`snapshot.js:10`）：观测阶段直接排除 `password`/`file`/`hidden` 类型输入 —— *"`const safe = e => !['password','file','hidden'].includes(e.type)`"*。凭据永不进入模型上下文，比事后脱敏更可靠。

### 5.4 断言层（两个参考实现都没有，必须自建）

采用 `jev-e2e` 已验证的**7 个封闭断言原语**——封闭是刻意的，自由句式无法确定性解析：

| kind | 语义 | 对应用例写法 |
|---|---|---|
| `visible` | 目标可见 | `Expect: text "Welcome back" is visible` |
| `absent` | 目标不可见 | `Expect: text "Invalid credentials" is visible` |
| `count` | 匹配数量 | `Expect: project named "Acme" exists exactly once` |
| `value` | 字段值 | `Expect: field "Theme" is "Dark"` |
| `checked` | 勾选态 | `Expect: checkbox "Enable notifications" is checked` |
| `url` | 路径（比 pathname） | `Expect: url is "/projects"` |
| `number` | 数值字段 | `Expect: number in field "Total" is 128.5` |

配套设计（照抄 jev-e2e，都是踩过坑的）：

- **`after reload` 后缀** → 自动追加 `reload` 步骤。把"持久化验证"降维成一个词，覆盖了 SPA 最易漏测的一类缺陷。
- **断言必须显式**：无断言 → 拒绝执行（*"the runner does not invent correctness criteria"*）。
- **凭据必须外置**：`target` 命中 `/password|secret|token|api.?key|email/i` 且带字面量 → BLOCKED，强制 `@fixture`。
- **断言轮询**：`checkAssertion` 以 100ms 间隔轮询至 deadline（默认 2000ms），覆盖异步渲染。
- **作用域歧义即 BLOCKED**：`count > 1` 时抛错而非猜（*"An assertion target is ambiguous"*）。**这条是误报的主要来源，必须保留。**

### 5.5 判定层（两个参考实现都没有，必须自建）

**三态 + 问题三分类**，融合两边的长处：

```ts
function judge(checks: Check[], issues: Issue[], aborted: boolean): Verdict {
  if (aborted) return 'BLOCKED'
  if (checks.some(c => !c.passed)) return 'FAIL'   // 仅确定性断言能产生 FAIL
  if (!checks.complete) return 'BLOCKED'           // 无法求值 → BLOCKED
  return 'PASS'
}
// 模型信号只进 issues，且恒为 candidate，永不产生 FAIL
if (assessment.choice === 'unexpected')
  issues.push({ source: 'model', candidate: true, step, message: '候选问题，需人工复核' })
```

**四条不可妥协的规则**：

1. **只有确定性断言能产生 FAIL。** 模型说"异常"只生成候选问题。
2. **BLOCKED 不计入 bug 检出**（jev-e2e 基准声明：*"BLOCKED is never credited as bug detection"*）。
3. **复杂度不足即 BLOCKED**：控件找不到、作用域歧义、断言无法求值 → BLOCKED，不得退化为 FAIL。
4. **模型置信度门限**：`confidence < 0.6` → 降级为 `uncertain`（JevTest 的 `assessmentConfidence`，默认 0.6）。

**Suite 级聚合**：任一 BLOCKED → BLOCKED；全 PASS → PASS；否则 FAIL。
**退出码**（CI 集成契约）：`0 PASS / 1 FAIL / 2 BLOCKED 或配置错误 / 130 取消`。

### 5.6 报告层（五要素落点）

```
runs/<runId>/
├── report.html        # 人读
├── report.json        # 机读（含完整 plan，可归档）
├── plan.json          # 用例契约 + 控件指纹 flows（回放凭据）
├── trace.json         # 逐步执行轨迹（可复现过程的核心）
├── summary.json       # 汇总计数 + 用量
└── 1.png … n.png      # 每 case 最终态；--steps 时每步 step-N.png
```

**五要素映射**：

| 要素 | 数据来源 | 报告呈现 |
|---|---|---|
| ① 测试用例 | `report.json.plan[].source`（**原文**）+ 解析后的 steps/assertions | 每 case 卡片顶部可折叠原用例 |
| ② 测试截图 | `<n>.png`，`page.screenshot({mask})` 遮罩 `input,textarea,[contenteditable],[data-private]` + fixture 明文 | 卡片底部配图；`--steps` 时为动作时间轴缩略图 |
| ③ 是否通过 | `verdict` | 三色徽章（见 §5.7 配色） |
| ④ 未通过原因 | `reason` + **`Expectation / Expected / Observed / Result` 四列对照表** + `issues[]`（带 `source` 分类） | 表格逐条摊开"期望什么 / 实测什么"，这是定位问题的核心视图 |
| ⑤ 可复现过程 | `trace.json`（逐步 `before/action/after/check`）+ `plan.json.flows` | "复现"按钮输出可直接粘贴的回放命令 |

**报告的头部统计**（jev-e2e 的做法值得照抄）：总 verdict、目标 URL、case 数、总耗时、模型请求数、**美元成本**、实际解析到的模型 ID。

**漂移检测**（采纳 JevTest，比 jev-e2e 更严）：回放时逐步比对 `fingerprint`、断言结果、执行失败与否；不一致即报 `State diverged` **并终止，绝不静默适配**。原文：*"State drift is reported instead of silently adapting the trace."*

> 取舍要点：**回放校验的是"状态是否漂移"，不是"结果是否一致"**。漂移了说明环境变了，测试结论作废——这比"跑过了就绿灯"诚实得多。

### 5.7 报告配色（中国区约定）

判定徽章按国内习惯：**PASS 红、FAIL 绿**会导致歧义，故此处**不用红绿表达通过与否**，改用：

| 判定 | 语义色 | 说明 |
|---|---|---|
| PASS | 中性 / 蓝 | 与涨跌色解耦，避免误读 |
| FAIL | 红 | 需要关注 |
| BLOCKED | 琥珀 | 需人工介入，非应用缺陷 |

> 若你更希望"通过=绿"，需在报告配置里显式声明，避免与 A 股涨红跌绿约定冲突。

---

## 六、page-agent 作为降级臂的接入方式

只在 MFA/免安装场景启用。两种接法：

### 接法 A：扩展 + MCP（零改造，但不适合自动化）
`execute_task({task})` 是**自然语言、阻塞式**接口，无结构化输出 → **不可用于断言驱动**，仅适合人工辅助排查。

### 接法 B：直接注入 `PageAgentCore`（推荐）

`page-agent` 暴露的扩展点足够做测试臂，这是它最有价值的部分：

```ts
import { PageAgent } from 'page-agent'

const agent = new PageAgent({
  // ① per-URL 指令：把测试用例的当前步骤注入 —— 用例可控性的关键
  instructions: {
    system: 'You are the actuator of a test runner. Never decide success.',
    getPageInstructions: (url) => runner.instructionsFor(url),
  },
  // ② 注入确定性工具：断言与取证由代码提供，不靠模型
  customTools: {
    assert_visible: tool({ /* 比对 DOM，返回 PASS/FAIL */ }),
    snapshot:       tool({ /* 触发 harness 截图 */ }),
  },
  // ③ 必须显式打开才有 execute_javascript（可用它做导航与断言）
  experimentalScriptExecutionTool: true,
  maxSteps: 25,
  stepDelay: 0.2,
  // ④ 生命周期钩子：逐步取证
  onBeforeStep: async (a, n) => harness.markStep(n),
  onAfterStep:  async (a, h) => harness.record(h[h.length - 1]),
  transformPageContent: (c) => maskSecrets(c),
})

const result = await agent.execute(stepTarget)
// ⚠️ 忽略 result.success —— 它来自模型的 done(success) 自述
// 判定只取 runner 自己的断言结果
```

**六条必须遵守的红线**：

1. `result.success` **一律忽略**，判定只认代码断言。
2. `execute_javascript` 默认关闭（构造函数里 `tools.delete`），**必须显式开启**才有导航与断言能力；开启后官方警告 *"May bypass some safe guards and data-masking mechanisms"*。
3. **富文本不可信**：Monaco / CodeMirror / Draft.js 明确不支持，用例中涉及这些组件的步骤应直接标 BLOCKED。
4. **成本监控**：`<agent_history>` 全量累积进 prompt，长流程成本非线性上升（系统提示词 9.79KB 起步）。必须设 `maxSteps` 与预算上限。
5. 扩展路径需**用户手动粘贴 auth token**（`localStorage.setItem('PageAgentExtUserAuthToken', ...)`），不适合无人值守 CI。
6. 无 per-case 隔离 → 每个 case 前后必须自建 `setup`/`cleanup` 恢复应用状态（**浏览器隔离 ≠ 数据库隔离**，这一点两个框架都不解决）。

---

## 七、分阶段实施

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| **P0** 可行性闸门 | ~~验证 `connectOverCDP` 能否 `newContext()` / 开后台标签页不抢焦点~~ | ✅ **已完成，14/14 通过**（§3.1）。路线 1 确认可用，无需退回路线 2 |
| **P1** 打通闭环 | contracts + cdp adapter + 7 断言原语 + 三态判定 + 报告五要素 | 在自有 staging 上跑通 1 个 case，报告五要素齐全可读 |
| **P2** 用例库与隔离 | `.cases` 解析器 + fixtures + 每 case setup/cleanup + runId 隔离后端数据 | 10 个 case 稳定可跑；**同一 case 连跑 10 次结论一致** |
| **P3** 接 JEV 定位 | 确定性优先三级定位 + JEV 投机扇出 + `validate_choice` 校验 + 密码字段排除 | 模型调用量降到"每 case ≤ 1~2 次"；非法响应零动作派发 |
| **P4** 回放与 CI | 控件指纹持久化 + 漂移检测 + 退出码接入流水线 | 回放零模型调用；状态漂移能报错终止；BLOCKED 单独告警不混入 FAIL |
| **P5** 降级臂 | inpage adapter + page-agent 注入 + 忽略 `success` 自述 | MFA 场景可跑通；富文本步骤正确标 BLOCKED |

**P2 的验收标准是整条路线成败的关键**：*"同一 case 连跑 10 次结论一致"* —— 做不到就不能上 CI，因为门禁会随机红。

---

## 八、风险与不适用场景

### 8.1 已识别的风险

| 风险 | 证据 | 应对 |
|---|---|---|
| **模型自述被当判定** | jev-ultrafast: *"DONE is never independent evidence of success"*；page-agent: `done(success)` | 硬编码忽略两者的自述字段 |
| **BLOCKED 被滥用** | 观测从标准控件表变为自由文本页时，JEV 更易判 BLOCKED | 给它留独立的"本步不确定"选项，别让 BLOCKED 兼两个语义 |
| **模型算数不可信** | 编号/倍数/百分比类判断会自洽地错 | 算术一律代码算好再写进 state |
| **回放静默适配** | JevTest 的设计动机 | 漂移必须报错终止 |
| **副作用动作重试** | jev-e2e: *"A dispatched mutation can have an unknown outcome. Never repeat it automatically."* | 已派发的变更不得自动重试 |
| **依赖无许可证代码** | JevTest 未授予使用许可 | **只借鉴设计，不复制代码** |
| **真实站点不可外推** | jev-e2e eBay 基准 3 次仅 1 次 PASS | 首期锁自有 staging；测试数据种子化 |

### 8.2 明确不适用

- **原生桌面/移动 App、CAPTCHA、canvas、支付渠道流程、主观视觉判断**
- **iframe / shadow DOM 深嵌套**：CDP 路线可覆盖（Playwright 原生支持），in-page 降级臂不可靠
- **强依赖真实用户数据的流程**：需自建数据脱敏与 fixture 体系
- **要求 100% 无人值守 + 零模型成本**：P4 之后的回放路径可以，首次发现路径不行

---

## 九、附录：核验方式与关键源码索引

三仓库均浅克隆后逐行阅读，非文档转述：

```sh
git clone --depth 1 https://github.com/alibaba/page-agent.git        # 252 files
git clone --depth 1 https://github.com/browser-use/jev-ultrafast.git # 1231850
```

**关键源码位置**

| 事实 | 出处 |
|---|---|
| CDP 后台标签页 + 不抢焦点 | `jev-ultrafast/jev_ultrafast/browser.py:20-33` |
| CDP 真实输入事件 | `browser.py:135-186`（`Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`） |
| 遮挡检查 + 节点守卫 | `browser.py:144-164`（`elementFromPoint`、`fresh()`） |
| 投机扇出（一次请求多 target 头） | `jev_ultrafast/model.py:81-148` |
| 决策响应校验（非法即零动作） | `model.py:30-45` `validate_choice` |
| `DONE` 不可信原则 | `jev_ultrafast/questions.py` `NEXT_ACTION` 末句 |
| 密码字段排除出观测 | `jev_ultrafast/snapshot.js:10` `safe()` |
| page-agent 无 goto、无断言 | `packages/core/src/tools/index.ts`（9 个工具全表） |
| 模型自述成功 | `PageAgentCore.ts:317-325`（`done(success)`） |
| 合成事件点击 | `packages/page-controller/src/actions.ts:64-131` |
| React 补丁（排除根容器） | `packages/page-controller/src/patches/react.ts` |
| 富文本已知失效清单 | `actions.ts:131-190`（Monaco/CodeMirror/Draft.js） |
| 扩展点：customTools / 钩子 / per-URL 指令 | `packages/core/src/types.ts:10-161` |
| 官方定位声明 | `page-agent/README.md:110` |
| 标签页工具（扩展） | `packages/extension/src/agent/tabTools.ts` |
| 历史导出（无断言无判定） | `packages/extension/src/lib/history-export.ts` |

**数据时效**：`page-agent` 29,156★ / 推送至 2026-09-21；`jev-ultrafast` 16,524★ / 推送至 2026-09-18。两者均高速迭代，**引用前请复核**。

> 核验提示：GitHub 匿名 REST API 从本机 IP 出发会 403 限流，需用 `gh`（位于 `/opt/homebrew/bin/gh`，不在默认 PATH）或直接浅克隆。
