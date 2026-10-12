# JEV 系 BS 架构系统测试方案调研报告

> 调研对象：`perixtar/jev-e2e`、`CorieW/JevTest`、`browser-use/jev-ultrafast`
> 核心诉求：**输入测试用例 → 输出完整测试报告**，报告须含 ①测试用例 ②测试截图 ③是否通过 ④未通过原因 ⑤可复现的测试过程
> 调研日期：2026-09-22 ｜ 方式：三仓库全量浅克隆 + 源码逐行核验（非文档转述）

---

## 一、结论先行

**三个仓库不是同一层的三个竞品，而是「成品 / 进阶原型 / 执行引擎」三个层次。**

| 仓库 | 本质 | 对你诉求的定位 |
|---|---|---|
| `perixtar/jev-e2e` | **唯一端到端成品**：用例 → 规划 → 执行 → 报告 | **可直接照抄的骨架**（MIT / TypeScript / 端到端可跑） |
| `CorieW/JevTest` | 同思路的**进阶原型**：多状态图发现 + 四态判定 + 候选问题机制 | **机制蓝本**（但**无许可证**，不可依赖） |
| `browser-use/jev-ultrafast` | **执行引擎 / 决策协议参考**，不产出测试报告 | **抄它的观测与决策协议** |

**一句话结论**：你要的东西 `jev-e2e` 已经完整实现了。真正决定成败的不是"能不能驱动浏览器"，而是三个设计决策——**强制显式断言**、**三态判定（PASS/FAIL/BLOCKED）**、**控件指纹持久化以实现零模型回放**。这三点是所有同类方案里唯一被 200+ 次受控实验验证过的组合。

---

## 二、三仓库事实核验

| 维度 | perixtar/jev-e2e | CorieW/JevTest | browser-use/jev-ultrafast |
|---|---|---|---|
| 语言 / 运行时 | TypeScript / Node 22+ | TypeScript / Node 24 + pnpm 11 | Python 3 / uv |
| **许可证** | **MIT** ✅ | **无（未授予使用许可）** ⚠️ | MIT |
| Star / Fork | 4 / 1 | 0 / 0 | **16,524 / 1,041** |
| 创建 | 2026-09-18 | 2026-09-17 | 2026-09-16 |
| 最后推送 | 2026-09-19 | 2026-09-20 | 2026-09-18 |
| Open Issues | 1 | 9 | 111 |
| 状态自述 | alpha，仅源码安装，未发 npm | initial working implementation，**发布被禁用** | 已上云 Waitlist |
| 是否产出测试报告 | ✅ report.html/json + 截图 | ✅ report.html + trace/graph | ❌ 只有运行 trace，无报告层 |

> **⚠️ 硬约束**：JevTest 的 README 明确写 *"no usage license is granted yet and package publishing remains disabled"*。**只能当架构参考读，不能引入代码、不能依赖、不能商用。**

---

## 三、核心机制拆解

### 3.1 用例输入契约（自研方案最该抄的一环）

`jev-e2e` 的 `.cases` 格式，是**人可读 + 可机器解析 + 可被 LLM 补全**的三重折中：

```text
Case: Create and persist a project
Auth: @signed-in
Input: Project name = "Acme"
Expect: project named "Acme" exists exactly once after reload
```

关键设计（源码 `src/plan.ts:29-57` `parseExpectation`）：

| 要素 | 规则 |
|---|---|
| 分块 | `Case:` / `##` / `1.` 三种起头，一个 suite 最多 **10** case，总量 ≤ 100 KB |
| `Goal:` | 自然语言目标，必须恰好一条 |
| `Input:` | 只能 `= "字面量"` 或 `= @fixture`，**两者必须二选一** |
| `Step:` | 显式动作，与 `Input:` 推断**互斥**，不可混用 |
| `Expect:` | **封闭模板集**（见下），不支持自由句式 |
| `after reload` 后缀 | 自动在尾部补一个 `reload` 步骤，把"持久化验证"降维成一个词 |
| `Auth:` | 引用认证 fixture（storageState 文件），**由调用方拥有，planner 无权发明** |

**期望断言是封闭模板，共 7 种**（这是可复现的前提——自由句式无法确定性解析）：

```text
project named "X" exists exactly (once|zero times|N times)
(text|record) "X" (count is|exists exactly) N
text "X" [in record "Y"] is (visible|absent)
field "X" is "Y"
checkbox "X" is (checked|unchecked)
url is "X"
number in field "X" is N
```

对应 7 个确定性断言原语：`visible / absent / count / value / checked / url / number`。

**两道"拒绝执行"闸门**（`src/types.ts:67-90` `validateSuite`）：

1. **没有断言 = 拒绝跑**：`if (!test.steps.length || !test.assertions.length) throw BlockedError`——原文措辞是 *"the runner does not invent correctness criteria"*（运行器不发明正确性标准）。
2. **凭据不得出现在用例里**：target 命中 `/password|secret|token|api.?key|email/i` 且带了字面量值 → 直接 BLOCKED，强制走 fixture 引用。

> 这两条是"AI 跑一遍就说通过"这类伪测试的**唯一有效解药**，建议在你的自研方案里原样保留。

### 3.2 三层分离架构（规划 / 决策 / 执行）

```
用例(纯文本)
   │
   ├─[规划层] 可选·LLM    prose → 结构化 steps+assertions     gpt-4.1-mini
   │            └ 编译后逐项校验 planner 未篡改（见 3.6）
   │
   ├─[决策层] JEV 决策API 观测控件表 → 选哪个控件（概率输出）  typesafe/jev-1.13
   │            └ 无文本产出，只出 choice + probabilities
   │
   └─[执行层] Playwright   点击/填值/断言 · 确定性 · 与模型无关
```

**为什么要三层分离**：模型只被允许做两件事——**把散文翻译成步骤**、**在已知控件里选一个**。**它无权决定成功与否**。断言由 Playwright 独立执行（`src/assertions.ts`），这是整套方案可信度的根。

`jev-ultrafast` 把中间层压到极致，可作为决策层的性能参照：**一次请求同时问 operation + 三个 target 头**（speculative fan-out），只执行与 operation 匹配的那个。

```
                      one TypeSafe request
page → element table → operation          │
                     │ click_target       │
                     │ type_text_target   │
                     │ select_target      │
                     └─────────┬──────────┘
                    CLICK [7] ─┘─→ browser
```

元素表形态：`[1] button  Change ticket type · Round trip`，序号即行动空间索引。**默认循环里没有截图**——JEV 吃的是结构化状态，不是像素。

### 3.3 三态判定：这套方案能落地的最关键设计

`jev-e2e` 的判定（`src/runner.ts:169-173`）：

| 判定 | 触发条件 |
|---|---|
| **PASS** | 所有断言均被检查且全部通过 |
| **FAIL** | 断言数量齐全但有一条不成立 |
| **BLOCKED** | 其余一切：控件找不到、页面歧义、超预算、超时、导航越界、凭据缺失… |

Suite 级聚合优先级：**任一 BLOCKED → BLOCKED；全 PASS → PASS；否则 FAIL**。退出码：`0 PASS / 1 FAIL / 2 BLOCKED / 130 取消`。

**为什么必须有 BLOCKED**：没有它，模型"没选对控件"会被记成"应用有 bug"，报告立刻失去可信度。`jev-e2e` 在基准里明确写 *"BLOCKED is never credited as bug detection"*（BLOCKED 不计入 bug 检出）。

`JevTest` 把同一思想展开成**四态**，更精细：

| 状态 | 含义 |
|---|---|
| `passed` | 到达终态且全部确定性断言通过 |
| `failed` | 确定性要求或动作执行失败 |
| `incomplete` | 中止/取消/步数-重复-时间限制/API 预算耗尽 |
| `error` | 配置、供应商或运行器基础设施问题 |

**它最值得抄的一招**：把模型判断与确定性事实**彻底分账**（`src/types.ts:1` 注释原文：*"Public contracts keep model judgments separate from observed application facts"*）。

- 模型判断三值：`expected` / `unexpected` / `uncertain`
- 模型说 `unexpected` → 只生成 **candidate issue（候选问题）**，**即使断言全通过也不构成 bug 证明**
- `confidence < 0.6`（可配）→ 自动降级为 `uncertain`

报告页脚原话：*"Unexpected model judgments are candidate issues, not confirmed bugs. A pass requires deterministic assertions."*

### 3.4 报告五要素映射（直接回答你的诉求）

| 你的要求 | `jev-e2e` 落点 | `JevTest` 落点 |
|---|---|---|
| ① **测试用例** | `report.json` 内嵌完整 plan（含 `source` 原文）+ `plan.json` | `summary.json` → `runs[].flow`（含 goal/fixtures/successCriteria） |
| ② **测试截图** | `1.png … n.png`，**每 case 一张最终态**，已遮罩 | `initial.png` + **每步** `step-N.png`，粒度更细 |
| ③ **是否通过** | `verdict: PASS/FAIL/BLOCKED` | `status: passed/failed/incomplete/error` |
| ④ **未通过原因** | `reason` 字符串 + `checks[]` 逐条「期望 vs 实测」对照 | `issues[]`，带 `source: assertion\|model\|execution` + `step` + `message` |
| ⑤ **可复现过程** | `plan.json` 的 `flows` + `run --replay`（**零模型调用**） | `trace.json` + `replay`（**逐步状态比对**） |

**报告 HTML 的实际结构**（`src/report.ts`，单文件内联 CSS + CSP `default-src 'none'`）：

- 顶部 header：总 verdict、目标 URL、case 数、总耗时、模型请求数、**美元成本**、实际解析到的模型 ID
- 每 case 一个 `<article>`：
  - 标题 + verdict 徽章（`pass`/`fail`/`blocked` 三色）
  - `goal` + `reason`
  - **期望对照表**：`Expectation | Expected | Observed | Result` ← 这张表是"未通过原因"的核心，把"期望什么/实测什么"并排摊开
  - 折叠区 `Actions · N.Ns`：**有序动作清单**，每条带 `replay` 标记
  - 遮罩截图

> **落地建议**：`Expectation/Expected/Observed/Result` 四列表格 + `issues[].source` 分类，这两个设计把"未通过原因"从一句废话变成了可定位的证据。建议两者合并采用。

### 3.5 可复现性：控件指纹 + 零模型回放

这是"可复现测试过程"的实现方式，也是三个仓库里最有工程价值的部分。

`jev-e2e` 的做法：

1. 每次观测给每个控件打 `fingerprint = JSON.stringify([tag, type, role, label, context])`（`src/browser.ts:25`）
2. 执行成功（PASS）的 case，把实际用到的控件快照存进 `plan.json` 的 `flows`
3. 回放时 `replayControl()`（`src/browser.ts:45-49`）按 fingerprint 精确匹配，**必须唯一命中才复用**
4. 命中 → 零模型调用直接执行；未命中（页面改版）→ 交给 JEV 修复该步
5. `plan.json` 存 `sha256(plan)`，回放前校验 plan 完整性，不一致直接 BLOCKED

实测：**replay 中位 0.977s vs 健康发现 1.832s，模型调用为 0**。手写 Playwright 基线是 1.049s——**回放已经和手写脚本同速了**。

`JevTest` 的做法更严（`src/replay.ts`），逐步断言六项全部一致：

```
initial fingerprint → initialCheck → 每步 before fingerprint
→ action 定义(stable 比对) → 执行失败与否与 issue 一致
→ after fingerprint → check 一致
```

**任何不一致 → 抛 `State diverged` 并终止，绝不静默适配**。原话：*"State drift is reported instead of silently adapting the trace."* 回放时**不重跑模型判断**（模型判断本就不确定，重跑无意义）。

> 这是个值得记下的取舍：**回放校验"状态是否漂移"，而不是"结果是否一致"**。漂移了说明环境变了，测试结论作废——比"跑过了就绿灯"诚实得多。

### 3.6 planner 防篡改校验（仅在启用 LLM 规划时需要）

启用散文规划时，`jev-e2e` 在 LLM 返回后做**逐项回归校验**（`src/plan.ts:139-168`），任何一项不符即 BLOCKED 且**不启动浏览器**：

| 校验项 | 目的 |
|---|---|
| case 数量一致 | 防 LLM 合并/拆分用例 |
| `source` / `name` 逐字一致 | 防篡改用例身份 |
| 所有 `@fixture` 引用仍在 | 防丢凭据绑定 |
| 显式 `Step:` 序列完全一致 | 防偷偷改动作顺序 |
| 所有双引号字面量仍在最终产物中 | 防丢输入值 |
| 显式 `Expect:` 逐条仍在 | 防丢断言 |
| `after reload` 仍在 | 防丢持久化验证 |
| 负向意图仍在（`invalid/wrong password` → goal 里仍有 `invalid/wrong`） | 防把"错密码应失败"测成"登录成功" |

最后一条尤其必要——**负向测试被 LLM 悄悄"修正"成正向测试，是这类方案最隐蔽的失效模式**。

---

## 四、横向对比决策表

| 能力 | jev-e2e | JevTest | jev-ultrafast |
|---|---|---|---|
| 输入形态 | `.cases` 文本（7 种封闭断言模板） | TS 配置文件（`successCriteria[]`，代码即配置） | 单条自然语言 goal |
| 断言来源 | **人工显式**（LLM 不可发明） | **人工显式**（config 里写死） | 无（外部独立校验） |
| 决策模型 | OpenRouter Decisions API | 直连 `api.typesafe.ai/v1/systemone` | TypeSafe |
| 判定状态数 | **3**（PASS/FAIL/BLOCKED） | **4**（+incomplete/error 细分） | 2（DONE/BLOCKED，且 DONE 不可信） |
| 截图粒度 | 每 case 1 张（最终态） | **每步 1 张** | 默认无（可选开） |
| 状态发现 | 无（按用例线性走） | ✅ **有界 BFS 状态图**（depth 5/50 states/100 edges） | 无 |
| 回放 | ✅ 指纹匹配，可漂移修复 | ✅ 六项逐步比对，**报漂移不修复** | 无报告层 |
| 候选问题机制 | ❌ | ✅ `source: model` 独立分账 | ❌ |
| 工作台 UI | ✅ 本地 Web workbench (4007) | ❌ | ✅ Inspector (8766) |
| 预算控制 | `$0.05` + 100 请求 + 60s/case | 250k tokens + 100 请求 + payload ≤24KB | 60 步 |
| **受控实验量** | **200 healthy + 200 broken + 100 replay** | 12 flow（6 健康 + 6 植入缺陷） | 6 次交替运行 |
| **真实站点成绩** | eBay 3 次仅 1 次 PASS | 未测真实站点 | Google Flights 3/3 |
| 许可可商用 | ✅ MIT | ❌ **无许可** | ✅ MIT |

### 实测性能（受控 demo 应用，非真实站点）

| 模式 | 样本 | 中位耗时 | p95 | 模型调用 | 成本 |
|---|---|---|---|---|---|
| JEV 发现，planner off | 100 | **1.832s** | 2.644s | 220 JEV | $0.0295 |
| JEV 发现，planner on | 100 | 4.516s | 6.055s | 100 规划 + 220 JEV | $0.1611 |
| 保存流程回放 | 100 | **0.977s** | 1.118s | **0** | $0 |
| 手写 Playwright 基线 | 30 | 1.049s | 1.556s | 0 | $0 |

**两个必须点明的口径**：

1. **planner on 比 off 贵 5.5 倍、慢 2.5 倍**（$0.1611 vs $0.0295；4.516s vs 1.832s）。散文规划是奢侈品，稳定期应固化 plan 后关掉它。
2. **发现比手写 Playwright 慢**（1.832s vs 1.049s）。该方案的收益是**降低编写与维护成本**，不是跑得更快。原文也自认这点。

### 真实站点基准（eBay，2026-09-18，每模型 3 次）

| 模型 | 完成 case 中位耗时 | 每完成 case 成本 | PASS/次数 | 控件选择正确 |
|---|---|---|---|---|
| Jev 1.13 | **47.46s** | **$0.006678** | 1/3 | 30/31 |
| GPT-5.6 Luna | 61.99s | $0.027704 | 2/3 | 32/32 |
| Claude Sonnet 5 | 78.62s | $0.406216 | 1/3 | 19/19 |

**这份表比上面那份受控表重要得多**：真实站点上最好的也就 2/3 通过，成本差 60 倍。作者自己也加了口径声明——*"Completed-case sample sizes are 1/2/1; these small, unequal samples do not establish a general accuracy ranking."*

---

## 五、自研方案建议（BS 架构系统测试）

### 5.1 推荐架构

直接以 `jev-e2e` 为骨架（MIT 可商用、端到端已跑通），按下面分工吸收另两个仓库的长处：

| 层 | 抄谁 | 抄什么 |
|---|---|---|
| 用例契约 | jev-e2e | `.cases` 7 种封闭断言模板 + `after reload` 后缀 + `@fixture` 凭据外置 |
| 校验闸门 | jev-e2e | 无断言拒跑 + 凭据字面量拒跑 + planner 逐项防篡改 |
| 决策层 | jev-ultrafast | 一次请求出 operation + 多 target 头；元素表序号即行动空间 |
| 执行层 | jev-e2e | fingerprint 指纹 + 执行前重查（控件未被替换/可见/可交互） |
| 判定层 | JevTest | **四态** + `issues[].source` 三分类（assertion/execution/model） |
| 报告层 | 二者合并 | jev-e2e 的 `Expected/Observed` 对照表 + JevTest 的候选问题分账 + 每步截图 |
| 复现层 | jev-e2e 为主 | 指纹回放零模型调用；借鉴 JevTest 的漂移检测（不一致即报，不静默修） |

### 5.2 必须自己补的三件事（三仓库都没解决）

1. **后端数据隔离**。JevTest 说得很直白：*"Browser isolation alone does not isolate a shared database."* 每 flow 独立 context 只隔离了浏览器，**数据库是共享的**。必须自己实现 `setup`/`cleanup` + runId 隔离。
2. **测试数据的重置归属**。jev-e2e 原文：*"Application database reset belongs to the test owner."* 这是必须显式设计的接口。
3. **真实站点的期望值管理**。eBay 那份 1/3~2/3 的成绩说明：受控 demo 的漂亮数字不能外推。**首期应锁定在自有可控环境**（预发/staging + 测试数据种子），不要直接上第三方站点。

### 5.3 分阶段落地

| 阶段 | 目标 | 关键动作 |
|---|---|---|
| P0 | 打通闭环 | 照搬 jev-e2e 跑通 demo，确认报告五要素齐全 |
| P1 | 接入自有系统 | 写 `.cases` + fixtures；编排 setup/cleanup 隔离后端数据 |
| P2 | 固化与提速 | `plan` 产出 plan.json 入库；关掉 planner，日常走 replay（零成本） |
| P3 | 增强可观测 | 改造成四态 + `issues.source` 分类 + 每步截图 |
| P4 | CI 集成 | 用退出码 `0/1/2/130` 接入流水线；BLOCKED 单独告警，不与 FAIL 混为一谈 |

---

## 六、风险与边界

### 6.1 明确的失效模式

| 风险 | 证据 | 应对 |
|---|---|---|
| **DONE 不是成功证据** | jev-ultrafast 原则原文：*"DONE is never independent evidence of success"* | 判定必须由外部确定性断言给出，绝不采信模型自述 |
| **BLOCKED 被滥用** | 观测从"标准控件表"变成"带自由文本的页面"时，JEV 更易判 BLOCKED | 给它留独立的"本步不确定"选项，别让 BLOCKED 兼两个语义 |
| **模型算术不可信** | 编号/倍数/百分比类判断易自洽地错 | 算术一律用代码算好再写进 state |
| **负向测试被悄悄修正** | jev-e2e 专门为此写了校验 | 保留负向意图校验 |
| **回放静默适配** | JevTest 的设计动机 | 状态漂移必须报错终止，不得自动改流程 |

### 6.2 能力边界（alpha 阶段）

不支持：原生桌面/移动 App、CAPTCHA、canvas、复杂 iframe、支付渠道流程、主观视觉判断。jev-ultrafast 另需排除：Shadow DOM、iframe、文件上传、弹出标签页、嵌套滚动、任意键盘控件。

另外注意 `jev-e2e` 的几个工程限制：
- 弹出标签页直接**关闭**并记 BLOCKED（`runner.ts:112`）
- 导航被 origin 白名单拦截（越界即 BLOCKED）
- 副作用动作**只派发一次，失败不重试**（原文：*"A dispatched mutation can have an unknown outcome. Never repeat it automatically."*）
- **未实现原始 Playwright trace 导出**（这是报告"可复现"的一个缺口，需自行补）

### 6.3 隐私

`jev-e2e` 的做法：已知 fixture 值从观测与报告中脱敏；截图 mask 覆盖 `input, textarea, [contenteditable], [data-private]` 及已知密钥明文；报告文件 `0600`；API key 只留在服务端进程。

**但必须注意**：*页面可见文本会被送往 OpenRouter*，且**无关页面内容可能残留在报告里**。原文提醒：*"Inspect evidence before sharing it."*

---

## 七、可直接引用的原文结论

| 结论 | 出处 |
|---|---|
| 运行器不发明正确性标准 | `jev-e2e` `src/plan.ts:111` |
| BLOCKED 永不计为 bug 检出 | `jev-e2e` `TEST_RESULTS.md:29` |
| 模型判断必须与观测事实分离 | `JevTest` `src/types.ts:1` |
| 异常模型判断只是候选问题，不是确认的 bug | `JevTest` `README.md:57` |
| 状态漂移必须上报，而非静默适配 | `JevTest` `README.md:59` |
| DONE 从不是成功的独立证据 | `jev-ultrafast` `README.md:126` |
| 浏览器隔离不等于数据库隔离 | `JevTest` `README.md:46` |
| 数据库重置归测试所有者 | `jev-e2e` `TEST_RESULTS.md:69` |
| 派发过的副作用变更不得自动重试 | `jev-e2e` `src/browser.ts:88` |
| 模型输出永不成为选择器/坐标/Shell/JS | `jev-ultrafast` `README.md:105` |

---

## 附录：核验方式

三仓库均为浅克隆后逐行阅读源码，非文档转述：

```sh
git clone --depth 1 https://github.com/perixtar/jev-e2e.git      # 51 files
git clone --depth 1 https://github.com/CorieW/JevTest.git        # 40 files
git clone --depth 1 https://github.com/browser-use/jev-ultrafast.git  # 41 files
```

关键源码文件：`jev-e2e/src/{types,plan,runner,report,assertions,browser,providers,cli}.ts`、
`JevTest/src/{types,runner,report,replay,graph,jev}.ts`、
`jev-ultrafast/jev_ultrafast/{agent,questions,model,browser,snapshot.js}.py|js`。

**注意**：本报告中的 star/fork/issue 数为 2026-09-22 当日快照。三个仓库均极新（创建于 2026-09-16 至 09-18），迭代速度快，**引用前请复核**。

> 数据来源核验提示：GitHub 匿名 REST API 从本机 IP 出发会 403 限流；本文档中仓库元数据经 `gh`（已认证）取得，性能与验证数据来自各仓库自带的 `TEST_RESULTS.md` / `docs/performance.md` / `examples/shop/README.md`，属**作者自测**，非独立复现。
