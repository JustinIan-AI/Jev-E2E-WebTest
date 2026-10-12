# PRD 评审意见：IDWTH V1.2

> 评审对象：Intent-Driven Web Test Harness（IDWTH）Skill-First 产品需求文档 V1.2（评审稿）
> 评审基准：本项目前序产出 —— `final/report.md`（四仓库源码级核验）、`final/implementation-plan.md`（CDP 复用实测 14/14）、`final/product-definition.md`（产品定义与 skill 边界）
> 评审日期：2026-09-23

---

## 〇、总评

**结论：可以进评审，但有 1 处架构级互斥必须先定稿，2 处隔离保证不够硬，13 项具体问题，1 组验收标准需扩强（从 1 条扩到 9 条），5 个开放问题可直接关闭。**

**做得好的地方（值得保留，不要被评审意见冲淡）**：

| # | 亮点 | 为什么重要 |
|---|---|---|
| 1 | **三句边界**：Playwright 管"怎么稳定地做"、JEV 管"不确定时选什么动作"、Evidence+Judge 管"到底对不对" | 一句话把最容易混淆的三个职责切开。本领域绝大多数失败项目都死在把后两者混一起 |
| 2 | **P0 里那条对抗性验收**："构造 JEV 认为完成但 HTTP=500 → 必须 FAIL" | **整份文档含金量最高的一行**。它直接测试了"判定不自证"这条生命线（建议按 §三 扩成 9 条） |
| 3 | **JEV 输出限定为 `operation + target_index`**，禁 Selector / XPath / JS / 坐标 | 与我们源码核验一致：`jev-ultrafast` 的 `validate_choice` 就是"非法响应零动作派发"。这条堵住了最大的注入面 |
| 4 | **§19 "同一套 Skills 可被不同 Agent Harness 与 CI Runtime 复用"** | **这是我们此前方案没有的视角**，也是本 PRD 相对我们那份产品定义更强的地方 —— 见 §六 |
| 5 | **Freeze the Strategy + 预留轨迹接口（不强制 V1 做 GEPA）** | 收敛得当。没有为了追热点把 V1 拖进反思循环 |

**主要问题一句话**：**"Skill-first"这个定位被写得过于字面** —— §0 说"可被 Agent 加载的 Skills"，§12/§13 又要求"确定性路径禁止调用模型 / Semantic Invocation Rate ≈ 0"。这两句在同一架构下互相否定。

---

## 一、架构级问题（P0 阻塞，评审前必须定稿）

### 1.1 ⛔ 互斥：确定性路径"零模型调用" ⟷ "Skills 可被 Agent 加载"

| 出处 | 原文 |
|---|---|
| §0 | "它是一套**可被 Agent 加载**的 Web Testing Skills，配合最小 Runtime 与外部 Tools" |
| §12 | "**确定性路径禁止调用模型**" |
| §13 P0 | "Playwright 确定性执行 → 稳定路径 **Semantic Invocation Rate ≈ 0**" |
| §19 | "同一套 Skills 可被**不同 Agent Harness** 与 CI Runtime 复用" |

**矛盾**：若编排者是 LLM Agent，那么**编排本身就是一次（以上）模型调用**。此时"确定性路径 ≈ 0 次模型调用"在物理上不可能达成 —— 除非把"模型调用"重新定义为"不含编排"，但那是定义上的回避，P0 验收无法通过。

这不是文字问题，它决定 P0 验收怎么写。

**解法（保留 PRD 原意，只把 Runtime 拆成两种）**：

| | **Agent Runtime** | **CI Runtime** |
|---|---|---|
| 编排者 | LLM Agent | **确定性代码** |
| 模型调用 | 每 case ≥ 1 次 | **仅 L3 语义动作按需调用** |
| 用途 | 开发、调试、探索、写新用例 | 回归、门禁、留档 |
| §12 预算 | **不适用** | **全部适用** |
| P0 验收对象 | ❌ 不是 | ✅ **是** |

**必须写进 PRD 的一句话**：
> §12 的全部非功能指标与 §13 的全部 P0 验收标准，**一律在 CI Runtime 下定义**。Agent Runtime 的产物仅供人使用，不参与门禁，不纳入成本与延迟指标。

这样既保住了 §19 的"skills 跨 harness 可移植"（同一套 skill 被两种 runtime 加载），又让"零模型调用"成为可验收的硬指标。

### 1.2 ⚠️ Judge 是 Skill，但"独立判定"的隔离保证不够硬

§6 把 `web-test-judge` 列为 Skill，§6 又要求"独立于 JEV"。方向对，但**隔离不彻底会从两个口子漏**：

| 漏洞 | 场景 | 后果 |
|---|---|---|
| **调用权在编排者手里** | LLM 编排者决定"这步不用跑 Judge"，或跑了但不采纳 | **PASS by omission** —— 漏判等于假通过 |
| **写入权可被中介** | 编排者读到 Judge 输出，转述时改写 verdict | 裁定结果不可审计 |

**解法：把"Judge 是什么形式"与"谁有权调用/写入"分开。**

| 项 | 归属 | 说明 |
|---|---|---|
| Judge 的实现 | 可以是 skill（封装无妨） | 判定逻辑可以是确定性函数 |
| **Judge 的调用权** | **Runtime 独占** | 编排者只能"触发"，不能"决定是否触发" |
| **verdict 的写入权** | **Runtime 独占** | 编排者只读，不可写、不可改 |
| verdict 的可复核性 | **必须是纯函数** | `verdict = f(evidence, assertions)`，可用归档 evidence 离线重算 |

**建议新增约束**（加进 §6.1 的 `constraints`）：
```yaml
- judge_result_is_immutable_by_orchestrator
- verdict_must_be_recomputable_from_archived_evidence
- judge_invocation_is_runtime_owned_not_orchestrator_owned
```

这条同时解决了一个隐藏问题：**§14 的 `Judge Accuracy` 怎么度量？** 答案就是"离线重算 + 人工抽样"。没有纯函数保证，这个指标无从计算。

### 1.3 ⚠️ Replay 的"Drift 修复"会破坏跨次可比性

§6 原文：`web-test-replay | Trace 记录与 **Drift 回放修复** | 成功路径优先零模型调用`

**"修复"和"回放"是两件事，混在一起会让回放失去意义**。参考实现里的明确立场（`JevTest`）：*"State drift is reported instead of silently adapting the trace."*（状态漂移要报出来，不能静默适配）。

若 replay 默认会"修复"漂移：
- 两次回放的结果**不可比** → 无法用于趋势判断
- 漂移被吞掉 → "环境变了所以测试结论作废"这个信号丢失
- P0 验收"成功路径零模型调用可回放"**无法测**（修复需要模型）

**解法：拆成两个显式模式，把"修复"从默认路径赶出去。**

| 命令 | 模型调用 | 遇漂移时 | 可用作门禁 |
|---|---|---|---|
| `idwth replay --verify`（**默认**） | **0** | **报 DRIFT 并终止**，verdict = `BLOCKED(drift)` | ✅ |
| `idwth replay --heal`（显式开启） | 按需 | 生成 recovery 审计 + 新版 frozen strategy | ❌ |

---

## 二、具体问题清单（13 项，按严重度排序）

| ID | 位置 | 问题 | 依据 | 建议 | 严重度 |
|---|---|---|---|---|---|
| **D1** | §7 `fixtures` | 无 `runId` 命名空间，`deployment_name: idwth-demo` 硬编码；`backend: deployment.exists: true` **无法区分"本次创建"与"上次残留"** | 连跑/并发即跨 run 冲突 → **这是一条假 PASS 通道** | Runtime 把 `runId` 注入所有 fixture 名（`idwth-${runId}-demo`）；cleanup 绑 runId；`exists` 断言改为断言 runId 作用域资源，或追加 `created_at > run_start` | **高** |
| **D2** | §8.2 硬规则 | 缺"目标歧义 → BLOCKED" | `jev-e2e` 原文 *"An assertion target is ambiguous"* 直接抛错而非猜测 | 匹配数 > 1 即 BLOCKED，**禁止取第一个** | **高** |
| **D3** | §8.2 硬规则 | 缺"**已派发的 mutation 不得自动重试**" | `jev-e2e` 原文：*"A dispatched mutation can have an unknown outcome. Never repeat it automatically."* | 列为硬规则。CMDB / K8s 场景重复提交 = **真实损害**（重复创建资源），不是测试噪声 | **高** |
| **D4** | §14 `Recovery False Positive` | 被列为"最重要的三个"之一，**但无任何检测机制** | 不可度量即不可管理 | ① **强制 recovery 后做步级后置条件断言**（否则假通过会藏在最终断言后面）② 报告给每次 recovery 打"待复核"标 + 抽样复核流程 ③ 指标定义写清分母（recovery 次数）/ 分子（判定为错误目标） | **高** |
| **D5** | §15 vs §13 vs §3.2 | §15 把 iframe / shadow DOM 归入"复杂组件"，缓解措施是"V1 明确排除"；§13 明确不做；**但 §3.2 建议首批验证对象是 OpenFuyao 类云管 / K8s 系统** | **云管平台几乎必然含 iframe**（嵌 Grafana、Web 终端、外部控制台）→ 直接砍掉首批对象的覆盖面。且 Playwright **原生支持** iframe 与 shadow DOM（我们 P0 实测已确认断言原语可用） | iframe / shadow DOM **降级为 P1，不要排除**；只排除 Canvas、上传下载 | **高** |
| **D6** | §4 原则 6 | "**Freeze the Strategy**" 未定义冻结产物 | 无产物即无法验收 | 新增 **frozen strategy artifact**（等价 `plan.json`）：schema、版本号、与 Contract 的绑定关系、存放位置、失效条件 | **高** |
| **D7** | §13 P0 验收 | "7 个 Skill 标准接口全部通过 Schema Validator" 是**结构性**验收 | **通过 schema 校验的 skill 仍可能毫无用处** | 每个 skill 增加 1 条**行为性**验收（给定输入 → 期望输出），见 §三 A2/A4 | 中 |
| **D8** | §10 / §11 | 提到 Exit Code，**未定义具体值** | CI 集成需要硬契约 | `0` PASS / `1` FAIL / `2` BLOCKED 或配置错误 / `130` 取消 | 中 |
| **D9** | §8.3 Verdict | `BLOCKED` 一个词兼了 4 种语义：环境不可用 / 权限不足 / JEV 无法安全决策 / 证据不足 | 混在一起则**诊断不了**，也无法按原因统计 | 细分：`BLOCKED(env)` / `BLOCKED(decision)` / `BLOCKED(drift)` / `BLOCKED(ambiguity)`，报告与指标按子类统计 | 中 |
| **D10** | §12 vs §7 | §12 "决策延迟中位数 ≤ 2s" 与 §7 `assertions.timeout: 60s` 未区分语义 | 评审会当成矛盾 | 明确 §12 是**决策延迟**（不含页面加载与断言等待）；断言 deadline 单列口径 | 低 |
| **D11** | §3.2 优先场景 | "JEV 参与度 高/中/低" 无操作定义 | 无法验收 | 改为预期 Semantic Invocation Rate 区间（如"低 = 0，中 = <0.3，高 = <1.0"） | 低 |
| **D12** | §5 vs §6 | §5 主流程图缺 Replay；§6 列了 7 个 skill | 图文不一致 | 补 Replay 到流程图，或明确它是横切能力 | 低 |
| **D13** | §11 CLI | `idwth init` 职责未定义 | 无法验收 | 明确为"生成 Contract 骨架 + 环境探测（Chrome 可用性 / JEV 端点连通性 / 权限）" | 低 |

### 另附 1 项判断建议（非缺陷）

**`web-semantic-action` 与 `web-semantic-recovery` 接口高度同构** —— 都是 `fresh snapshot → operation + target_index`。差别只在 recovery 多一个 `failed_action` 上下文。
按 PRD 自己"减少原则重复"的收敛精神，建议**合并为 1 个 skill、两个 mode**，7 → 6。保留独立的价值仅在于 `constraints` 不同（recovery 不得改 Goal/Assertion）—— 但这可以用 mode 级约束表达。

---

## 三、验收标准扩强：从 1 条到 9 条

PRD §13 只有 1 条对抗性验收（"JEV 认为完成但 HTTP=500 → FAIL"）。**这是全文最有效的写法，应该做成一套**。

对抗性验收的价值在于：它测的不是"功能能不能跑"，而是"**信任边界会不会破**"。每一条对应一个一旦破了就会静默摧毁可信度的口子。

| # | 构造场景 | 期望结果 | 现状 | 测的边界 |
|---|---|---|---|---|
| A1 | JEV 自述完成 + HTTP = 500 | **FAIL** | ✅ PRD 已有 | JEV ≠ PASS |
| A2 | JEV 自述完成 + **无任何证据** | **BLOCKED**（不得 PASS） | ❌ 新增 | 无证据 ≠ 通过 |
| A3 | 断言目标**多条匹配**（歧义） | **BLOCKED**（不得取第一个、不得 FAIL） | ❌ 新增 | 歧义 ≠ 用例外 |
| A4 | Recovery 试图**修改 Assertion** | **拒绝 + 审计记录 + 运行终止** | ❌ 新增 | 禁止静默改判定标准 |
| A5 | 提交后**网络超时** | **不得自动重试 mutation** → BLOCKED | ❌ 新增 | 副作用不可重复 |
| A6 | Replay 时页面结构变化 | **报 DRIFT 并终止**，verdict = `BLOCKED(drift)` | ❌ 新增 | 回放不得静默适配 |
| A7 | **断开 JEV 端点**（离线） | 确定性路径**全部可跑**，Semantic Invocation Rate = 0 | ❌ 新增 | 模型不是硬依赖 |
| A8 | 用**归档 evidence 离线重算 Judge** | verdict 与在线运行**完全一致** | ❌ 新增 | 判定可复核（纯函数） |
| A9 | Recovery 落到**错误但看似合理的目标**，最终断言恰好通过 | **必须有步级后置条件断言捕获它** | ❌ 新增 | 假通过防线 |

**A4 / A6 / A8 是三条最容易被跳过、但最值钱的**：它们分别守住了"不得改判定标准""不得静默适配环境""判定必须可复核"。

---

## 四、指标修正

### 4.1 ⛔ "单 case 一致性 ≥ 95%" 会组合成灾难（数学论证）

§12 原文：*"同一 Case 连续 10 次执行，结果一致性 ≥ 95%"*。

单看 95% 很合理。但**门禁是 suite 级的**，而 suite 级绿灯率 ≈ `p^n`（p = 单 case 一致性，n = case 数，独立近似）：

| 单 case 一致性 p | n = 20 | n = 50 | n = 100 |
|---|---|---|---|
| 0.95（PRD 当前要求） | 35.8% | **7.7%** | 0.6% |
| 0.99 | 81.8% | 60.5% | 36.6% |
| 0.999 | 98.0% | 95.1% | 90.5% |

**读法**：按 PRD 的 95%，一个 50 case 的 suite **只有 7.7% 的运行是全绿的** —— 门禁 92% 的时间在红。这不是"稳定性达标"，这是"门禁不可用"。

**反推**：要让 50 case 的 suite 有 95% 的绿灯率，单 case 一致性必须达到 **99.9%**（`0.95^(1/50) = 0.99898`）。

> 注：这是独立近似，真实 flake 有相关性（同源缺陷会同时红），会让数字变好或变坏；但量级结论不变。

**建议改写 §12 稳定性条款为两条**：

| 条款 | 要求 | 为什么 |
|---|---|---|
| **Flaky 计数（硬门禁）** | **无 flaky case** —— 任一 case 连跑 N 次（N ≥ 10）出现结论不一致，**即判该 case 为缺陷**，阻断合并 | 二值、可执行、无歧义。flaky 是缺陷不是指标 |
| **Suite 绿灯率（观测）** | 目标 ≥ 95%（作为趋势指标，不作为门禁） | 用于观察系统健康，不当门禁阈值 |

### 4.2 `Recovery False Positive` 缺检测机制

§14 把它列为"最重要的三个"，但全文没有定义**怎么发现**一次 recovery 恢复了错误目标。仅靠"独立 Judge"不够 —— 如果 recovery 点错了控件、而最终断言恰好通过（例如进错了菜单但页面里也有目标文案），Judge 也会 PASS。

**三层防线（建议全部写进 P0）**：
1. **步级后置条件断言（最关键）** —— 任何 recovery 之后，**必须**验证该步的后置条件（如"已在系统命名空间下"），不得只靠最终断言
2. **报告打标** —— 每次 recovery 生成 `recovery.json` 并在报告中标"待复核"
3. **抽样复核流程** —— 定义抽样率与复核责任角色，复核结论回写为 False Positive 的分子

---

## 五、五个开放问题的建议答案

### Q1. JEV 置信度阈值默认策略（原建议：≥0.85 自动执行，否则 BLOCKED）
**不建议单一阈值，建议按"可逆性"分级**：

| 动作类别 | 阈值 | 理由 |
|---|---|---|
| 可回退（点击导航、滚动、展开、聚焦） | **≥ 0.60** | 错了能退。阈值过高会让 BLOCKED 泛滥，指标难看且无价值 |
| **不可逆**（提交、删除、创建、确认类） | **≥ 0.90**，且不达标直接 BLOCKED | 错了有真实损害 |

依据：`JevTest` 的 `assessmentConfidence` 默认就是 **0.6**。单一 0.85 的问题在于"可回退动作过于保守 + 不可逆动作仍不够严格"。

**另注（重要）**：阈值只在**合法性校验通过之后**才生效。JEV 响应必须先满足 `choice ∈ criteria`、`probability keys == criteria keys`、`Σp ≈ 1`、`p[choice] == max(p)` —— 任一不满足即 **零动作派发**（这是 `jev-ultrafast` `validate_choice` 的做法，应移植为硬规则）。

### Q2. 是否在 V1 内置轻量 K8s Adapter
**V1 Core 不内置，但 M3 前必须提供 reference adapter（放 `examples/` 而非 core）**。
理由：内置会把 V1 绑死在特定领域，违背 §19 的"skills 可被不同 harness 复用"；但 §13 P0 的 `backend: deployment.exists` 与 §3.2 的 OpenFuyao 首批验证对象**需要真实 K8s 查询才能验证三重断言**，纯 mock 会让 M3 的价值验证落空。

**契约侧要做的准备**：把 Contract 的 `backend:` 段抽象为**可替换的 evidence provider 接口**，而不是硬编码 Kubernetes 语义。

### Q3. Contract 是否支持多语言 Intent 输入
**V1 不做多语言功能，但 Schema 必须语言无关，并预留 `locale` 字段。**
- 自由文本字段（`goal` / `steps[].intent`）本身语言无关
- 结构化字段（`assertions.*` 的键、状态枚举）**固定英文** —— 这是可以被机器判定的部分，不能多语言
- 加 `locale: zh-CN` 占位，V1 忽略它

这样将来加多语言不必改 schema（改 schema = 所有已有 Contract 失效）。

### Q4. Recovery 失败后的默认策略：立即 FAIL 还是 BLOCKED
**必须 BLOCKED，且不可配置为 FAIL。** 这不是开放问题，是语义必然：

| 结果 | 前提 | Recovery 失败满足吗 |
|---|---|---|
| **FAIL** | "执行完成，但业务结果与预期不一致" —— 需要一条**确定性断言失败**作为证据 | ❌ 动作根本没执行成功，没有观测事实可反驳预期 |
| **BLOCKED** | "无法可靠完成" | ✅ 正是这个语义 |

若允许 FAIL，就等于**把"工具能力不足"记成"应用有缺陷"** —— 这正是误报的主要来源，会直接破坏 §14 的 `Judge Accuracy`。

**可配置的部分是 CI 策略，不是 verdict 语义**：CI 可以选择"BLOCKED 也阻断合并"（退出码仍是 2），但 verdict 本身不许变。

### Q5. 是否在 M3 后引入完整轨迹反思接口（GEPA 风格）
**V1 不做，但 P0 就要把接口留对；且反思产物必须经人工确认才能替换策略。**

| 项 | 要求 |
|---|---|
| P0 就要留的接口 | Trace 必须含五元组：`(intent, 页面可观测状态, JEV 请求/响应原文, 决策, 结果)`，且无损去重 + 字节上限 |
| 反思产出的形态 | **必须是一版新的 frozen strategy**，经人工确认后版本替换 —— **不得运行时自改** |
| 硬约束 | 反思**可以**改 Recovery 策略；**绝不可以**改 Goal / Assertion |

> 最后一条是关键：如果反思能自动改断言，§4 原则 6 的 "Freeze" 就名存实亡，且 §8.2 的"禁止静默修改 Goal/Assertion"被绕过。

---

## 六、与本项目前序结论的对齐

### 6.1 完全一致（可互相加强）

| 结论 | 本 PRD | 我们前序核验 |
|---|---|---|
| JEV 只做动作选择，不判定 | §4 原则 4 | 源码级：`jev-ultrafast` *"DONE is never independent evidence of success"*；`page-agent` `done(success)` —— **两者都靠自述** |
| 三态判定 | §8.3 | `jev-e2e` PASS/FAIL/BLOCKED，且 *"BLOCKED is never credited as bug detection"* |
| 确定性优先 | §4 原则 2 | 我们定位策略 L1/L2/L3，L1 目标命中率 > 80% |
| 明确排除"自动生成全部用例" | §13 | 我们的反定位："产品性格是没有断言就拒绝执行" |
| 副作用不自动重试 | 缺失（D3） | 已有源码原文依据 |

### 6.2 ⚠️ 需要修正的是**我们上一轮的结论**，不是这份 PRD

> 我们在 `product-definition.md` 里写过：**"执行、断言、判定、取证、写盘、回放必须落代码，只允许创作/解读/分诊类能力做成 skill。"**
>
> **这份 PRD 促成了对该结论的一处重要修正。**

修正后的表述更准确：

> **"做成 skill" 与 "确定性" 不是对立属性 —— Skill 只是封装形式，确定性是实现属性。真正的判据是「调用权与写入权在谁手里」。**
>
> 所以：**判定可以封装为 skill，但 Judge 的调用权与 verdict 的写入权必须独占归 Runtime**（即 §1.2 的三条约束）。

这个修正同时解释了为什么本 PRD 的"7 个 skill"并不必然违反隔离原则：**只要编排者是确定性 CI Runtime，skill 化就是安全的**。反过来说，也正因如此 —— **§1.1 那条互斥必须先定稿**，否则整个 skill 化方案的隔离前提不成立。

### 6.3 本 PRD 比我们方案更强的一处（应吸收进产品定义）

| 维度 | 我们此前方案 | 本 PRD |
|---|---|---|
| 产品形态 | `daemon + CLI + 本地控制台` | **Skills 层可被不同 Agent Harness 与 CI Runtime 复用** |
| 可移植性 | 绑定在我们的 daemon 上 | **同一套 skills 不绑定任何 harness** |
| 长期价值 | 工具价值 | **接口价值** —— §19 说得对："接口一旦成立，同一套 Skills 可被复用，这才是 Skill-first 的核心产品价值" |

**建议**：把我们的"形态 A/B/C"与 PRD 的"双 Runtime"合并表述为 ——
> 引擎（CI Runtime）是**可信基线**，skills 是可移植的**能力封装**，Agent Runtime 是**开发期加速器**。三者共用同一套 skill 契约。
>
> ⚠️ **状态（2026-10-10）**：上表"我们此前方案"栏的 `daemon + CLI + 本地控制台` **未采纳** —— 裁定 **V1 = 纯 CLI（单进程），不做控制面、无前后端分离**（见 `PRD.md` §1.3 · `detailed-design.md` DD-47 / DD-48）。本条建议**只保留「双 Runtime」部分**。

---

## 七、建议的评审决议项（供会议逐条过）

| # | 决议 | 归属章节 | 阻塞 P0？ |
|---|---|---|---|
| 1 | 明确 **CI Runtime 为 P0 验收唯一对象**，"零模型调用"仅在此下定义 | §0 / §12 / §13 | ✅ **是** |
| 2 | 明确 **Judge 调用权与 verdict 写入权归 Runtime 独占**；verdict 为 `f(evidence, assertions)` 纯函数 | §5 / §6 | ✅ **是** |
| 3 | 拆分 **`replay --verify`（默认，零模型，漂移即终止）/ `replay --heal`** | §6 | ✅ **是** |
| 4 | `fixtures` 引入 **runId 命名空间**；cleanup 绑 runId | §7 | ✅ **是** |
| 5 | 稳定性指标改写为 **"无 flaky case" 硬门禁 + suite 绿灯率观测**（95% 单 case 不组合） | §12 | ✅ **是** |
| 6 | 把 §13 的 1 条对抗性验收 **扩为 9 条**（§三） | §13 | 否 |
| 7 | iframe / shadow DOM **从"不做"改为 P1**（否则首批对象是云管系统时覆盖面被砍） | §13 / §15 | 否 |
| 8 | 补 4 条硬规则：歧义即 BLOCKED / mutation 不重试 / Exit Code 值 / BLOCKED 子类 | §8 / §10 / §11 | 否 |
| 9 | 新增 **frozen strategy artifact** 定义 | §4 | 否 |
| 10 | 关闭 §18 五个开放问题（答案见 §五） | §18 | 否 |

**决议 1 / 2 / 3 / 4 / 5 是阻塞项** —— 它们决定 P0 验收能不能写、能不能过。其余可在评审后并入 V1.3。

---

## 附：一句话记住这份 PRD 的风险点

> **它的方向是对的，边界也划得比同类项目清楚。唯一的隐患是"Skill-first"写得太彻底 —— 一旦编排者是模型，"零模型调用"就成了自我否定的指标。把编排者固定为确定性 Runtime，这份 PRD 就成立了。**
