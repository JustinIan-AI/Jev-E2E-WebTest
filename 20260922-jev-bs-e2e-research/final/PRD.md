# IDWTH 产品需求文档（PRD）

| 项目 | 内容 |
|---|---|
| 产品名 | **IDWTH**（Intent-Driven Web Test Harness）· 中文名：意图驱动的 Web 系统测试工具集 |
| 版本 | **V1.2（正式版）** · 2026-10-10 与 `detailed-design.md` V1.2 对齐：**FR-9 改为「六重绑定」**（补 `judge_impl_hash` / `engine_provider_version`，三项旧提案留档）· 验收计数修正为 **12 条**并加编号约定 · 里程碑与 A7a/A7b · A10/A11 对齐 + **「引擎缓存」入交付物** · **视觉通道移入 §十二 Backlog（不进 V1）** · 待关闭项补 **D07** · **§八.3 重构为「SUT 适配注记」两栏表（立「产品要求 vs SUT 适配项」判据）· FR-11 隔离单元改为 SUT 中立的「run 级作用域 + runId/contractId 双标识」· 术语表补「测试计划 = 一次批量执行」** · **追加裁定（同日，与 DD G 级对齐）：产品形态 = 纯 CLI（单进程）—— 不做常驻服务 / 本地控制台、无前后端分离；`Report Viewer` 定形为单文件静态 HTML（零服务端）** |
| 上一版 | V1.1 · 2026-10-08 同步执行引擎层调整（A7 拆 a/b · 新增 A10/A11 · NFR 增「可替换」「可离线」· 核心技术改列 `EngineProvider`） |
| 状态 | 可评审 → 可作开发基线 |
| 上游依据 | `product-definition.md`（产品定义）· `prd-review.md`（**5 项阻塞决议已于 2026-09-23 全部通过**）· `e01-openfuyao-recon.md`（目标系统侦察）· `e02-namespace-isolation.md`（数据隔离实测）· **`e2e-architecture-adjustment.md`（2026-10-08 执行引擎层决策）** |
| 下游文档 | `detailed-design.md` **V1.2**（详细设计） |
| 首批验证对象 | openFuyao 管理平台（K8s 容器管理平台，单集群 `host`） |
| 核心技术 | **JEV（语义决策）+ LLM（决策提供者）+ EngineProvider（可替换执行引擎）+ Evidence + Judge（独立判定）** |

> **本文是"产品要什么"，不含"怎么实现"。** 实现细节见 `detailed-design.md`。
> 本 PRD 与 `prd-review.md` 的关系：`prd-review.md` 评审的是**外部 PRD V1.2**，其结论已被本文吸收为**已定稿的架构前提**，不再作为待议项。

---

## 一、产品定位

### 1.1 一句话定义

> **输入测试用例，输出完整测试报告。**
> 用 JEV + LLM 处理"不确定时选哪个控件"，用 Playwright 处理"怎么稳定地做"，用独立 Judge 处理"到底对不对" —— 三者职责不可混淆。
>
> **产品边界（2026-10-10）**：本产品面向**任意 B/S 系统**；**openFuyao 只是首个可验证的待测系统（SUT）**，其专属事实属**适配项，不进产品要求**。判据一句话：**「离开 openFuyao，这条还成立吗？」成立 → 产品要求；不成立 → SUT 适配项。**

报告五要素（缺一不可）：

| # | 要素 | 来源 |
|---|---|---|
| 1 | 测试用例 | Frozen Contract |
| 2 | 测试截图 | Evidence（关键步 + 失败步 + 终局） |
| 3 | 是否通过 | Judge verdict（PASS / FAIL / BLOCKED） |
| 4 | 未通过原因 | 断言失败明细 + 错误分类 + BLOCKED 子类 |
| 5 | **可复现过程** | Playwright 原生 trace（`.zip` + viewer）+ Rerun 命令 |

### 1.2 三句边界（不可妥协）

| 组件 | 只负责 | 绝不负责 |
|---|---|---|
| **Playwright** | 怎么**稳定地做**（定位、等待、派发、断言原语） | 不确定时该点哪个 |
| **JEV + LLM** | 不确定时**选什么动作**（输出 `operation + target_index`） | 操作是否成功、结果对不对 |
| **Evidence + Judge** | 到底**对不对**（判定） | 任何执行动作 |

### 1.3 产品不是什么（明确排除）

- ❌ **不是 LLM 驱动的浏览器 Agent**（那类是"模型边走边决定"，本产品是"确定性优先、模型按需兜底"）
- ❌ **不是录制回放工具**（录制只是副产品，核心是契约 + 独立判定）
- ❌ **不是单测/接口测试框架**（聚焦 B/S 系统的浏览器端系统测试）
- ❌ **V1 不做**：Canvas 图表内容断言（走 backend 旁路）、文件上传下载、Web 终端页、移动端、跨浏览器矩阵
- ❌ **不是 Web 平台 / 控制台**：**V1 为纯 CLI（单进程）** —— 不做常驻服务（daemon）、不做本地控制台、**无前后端分离**。报告以 `idwth report --open` 打开的**单文件静态 HTML** 呈现（数据内嵌、零服务端、可离线双击）
- 🔒 **视觉 / Canvas 渲染层断言属「可选补充分支」**：**不进 V1、本期不做设计**，仅当外部**明确提供多模态大模型能力并主动要求启用视觉**时立项（见 §十二 Backlog）

---

## 二、目标用户与核心场景

| 角色 | 他要什么 | 本产品给他的 |
|---|---|---|
| **测试工程师** | 用例能被机器稳定执行，失败能说清原因 | 契约编写 + 报告五要素 |
| **开发工程师** | 改代码后快速知道有没有碰坏页面 | `replay --verify` 零模型回归 + flaky 门禁 |
| **CI / 发布负责人** | 一个可信的红绿信号，不能天天误报 | 二值门禁 + 退出码硬契约 + BLOCKED 分级 |
| **系统负责人（任意 B/S 系统；示例：云管 / K8s / CMDB）** | 上线前的关键路径覆盖证据 | 对抗性验收 + 可归档、可重算的判定 |

### 五个核心场景

| # | 场景 | 产品行为 |
|---|---|---|
| **S1** | 新功能回归：写一条"创建 Deployment 并验证"的用例 | Contract → 确定性执行 → 报告 |
| **S2** | 存量系统补测试：已有手工用例，想自动化 | `web-test-contract` skill 把自然语言用例转成 Contract |
| **S3** | 发版门禁：每次 PR 都要跑 50 条核心用例 | `replay --verify`（零模型）+ `--repeat N` flaky 检测 |
| **S4** | 环境变化：前端改版导致回放失败 | **报 `BLOCKED(drift)` 终止**，人工确认后重新固化（不静默自愈） |
| **S5** | 生产问题复现：报告要能给审计看 | Trace + evidence 归档 + `judge recompute` 离线重算 |

---

## 三、问题与产品主张

### 3.1 必须解决的三个问题

| # | 问题 | 现状（同类方案的通病） | 后果 |
|---|---|---|---|
| **P1** | **AI 测试不可信** | 模型说"我做完了"就记通过 | 假 PASS 进报告，测试结果不能作为依据 |
| **P2** | **不可复现** | 环境一变就静默适配，或干脆跑不起来 | 两次结果不可比；绿灯不代表覆盖了原路径 |
| **P3** | **成本不收敛** | 每次都调模型，跑越多越贵 | 无法进 CI 门禁 |

### 3.2 三条产品主张（一一对应）

| 主张 | 机制 | 对应问题 |
|---|---|---|
| **① 确定性优先** | Contract 显式声明定位；L1（ARIA role/label）→ L2（指纹复用）→ L3（模型兜底）；**模型只在 L1/L2 都失败时才被调用** | P1 / P3 |
| **② 判定独立** | `verdict = f(evidence, assertions)` 是**纯函数**；Judge 的**调用权与写入权归 Runtime 独占**，编排者只能"触发"不能"决定是否触发、更不能改写结论" | P1 |
| **③ 学习飞轮** | L3 成功后把**指纹写回**策略产物 → 下次走零成本 L2 → **模型成本随跑次数单调递减到零** | P3 |

> **成本曲线是本产品的核心经济性主张**：第 1 次跑贵（要问模型），第 10 次跑便宜，第 50 次跑为零。
> 若编排者由 LLM 全程担任（含回放），这条曲线永不成立 —— 因此 **CI Runtime 与回放全程为确定性代码，LLM 不进回路**。

---

## 四、功能需求（FR）

> 每条含**验收口径**。标注 `[P0]` 者为 V1 必须交付。

### FR-1 契约编写 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 把 PRD / 接口文档 / 手工用例 / 口头描述，转成合法 Test Contract（YAML） |
| **契约含** | `steps[]`（`action` + `target` 语义描述 + `risk` + `postcondition`）· `assertions[]`（7 原语）· `preconditions[]` · `fixtures` · `cleanup` · `base_url` |
| **硬约束** | ① `target` **禁止 selector / XPath / 坐标**，只允许语义描述；② `risk: irreversible` 的 step **必须**给 `postcondition`；③ 缺失的 `base_url`/`goal`/`assertions` **必须澄清，禁止猜测补全** |
| **验收** | 给定一份手工用例，产出的 Contract 通过 Schema 九条校验；人为删掉 `base_url` → 必须报错而非猜一个 |

### FR-2 确定性执行 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 加载 Frozen Contract + Frozen Strategy，按状态机逐步执行 |
| **定位三级** | **L1** 确定性（ARIA role/label/text 精确命中）→ **L2** 指纹复用（`dom_path_hash + sibling_ordinal + anchor_text`）→ **L3** JEV + LLM 语义兜底 |
| **硬规则** | ① **目标歧义（匹配数 >1）立即 `BLOCKED(ambiguity)`，禁止取第一个**；② mutation 派发前必须过 **Freshness 校验**；③ **已派发的 mutation 不得自动重试** |
| **验收** | 构造一个页面有 2 个"创建"按钮 → 必须 BLOCKED，不得任选一个继续 |

### FR-3 语义决策（JEV + LLM）`[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 在 L1/L2 均无法命中时，把**页面可观测状态**转成候选问题集，交由 JEV/LLM 输出 `{operation, target_index}` |
| **输出限定** | JEV 只允许输出 **`operation` + `target_index`**，**禁止** Selector / XPath / JS / 坐标 —— 从接口层堵死注入面 |
| **校验** | `validate_choice` 五条校验：非法响应 → **零动作派发** |
| **置信度阈值** | 按可逆性分级：`reversible ≥ 0.60` / `irreversible ≥ 0.90`；低于阈值 → `BLOCKED(decision)`，不猜 |
| **验收** | 让 JEV 返回非法 operation（如 `eval_js`）→ 必须零派发 + 记录拒绝原因 |

**具体交互形态（示例）**

```
① 页面观察  → 快照：{ role: "button", name: "创建", index: 3, 位置/可见性/父容器 }
② 组装问题  → ChoiceQuestion: "当前要执行【创建部署】，请选择目标控件"
               候选：[0] 工具栏"创建"  [1] 表格行内"创建"  [2] 下拉"新建" ...
③ 调用      → JEV Adapter → LLM → { operation: "click", target_index: 1, confidence: 0.72 }
④ 校验      → target_index 在候选范围内？operation 在白名单内？confidence ≥ 阈值？
⑤ 派发      → Playwright 执行；越界/非法 → BLOCKED(decision)
⑥ 飞轮      → 成功且经确认 → 把该控件的指纹写回 Strategy（下次走 L2，零模型成本）
```

### FR-4 语义恢复 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | step 失败后按 `risk` 分流：`reversible` 可尝试恢复；`irreversible` **直接 `BLOCKED(decision)`** |
| **上限** | 每 step ≤1 次、每 case ≤3 次 |
| **硬约束** | ① 恢复**可以**改 Recovery 策略，**绝不可以**改 Goal / Assertion；② 恢复后**必须**校验步级后置条件；③ 恢复失败 → `BLOCKED(recovery)`，**不可配置为 FAIL** |
| **验收（对抗性）** | 让恢复逻辑试图修改 Assertion → 必须拒绝 + 审计 + 终止 |

### FR-5 证据采集 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 全程采集，分两级：**判定必需集**（`judgement_set`，实时落盘、不可截断）/ **归档集**（`archived`，可外移） |
| **证据类型** | DOM 快照 · 网络请求响应 · 截图 · backend 查询结果 · JEV 请求/响应原文 · recovery 审计 |
| **安全红线** | credential **只在 Runtime 内存解析**，**永不进** Trace / Evidence / Snapshot 的**判定必需集**；截图须遮罩（输入控件 + **文本级已知密钥明文**） |
| **验收** | 走一次登录后 grep trace 文件，**不得含明文密码** |

### FR-6 判定（Judge）`[P0]`

| 项 | 内容 |
|---|---|
| **能力** | `verdict = f(evidence.judgement_set, assertions)`，输出三态 |
| **三态** | `PASS` / `FAIL` / **`BLOCKED`**（子类：`env` / `decision` / `drift` / `ambiguity` / `recovery` / `evidence` / `cleanup` / `storage`） |
| **判定优先级** | ① 无法求值 → `BLOCKED(evidence)`；② 断言被证否 → `FAIL`；③ 全部成立 → `PASS` |
| **硬规则** | **只有确定性断言能产生 FAIL**；模型信号恒为 candidate；**BLOCKED 永不计入 bug 检出** |
| **可复核** | 归档 evidence 可**离线重算**，结果必须与在线一致（`judge recompute`） |

### FR-7 回放 `[P0]`

| 项 | 内容 |
|---|---|
| **两个模式（必须拆）** | `replay --verify`（**默认**，零模型，漂移即 `BLOCKED(drift)` **报错终止**）/ `replay --heal`（显式开启，产物**不得入 CI**） |
| **硬规则** | **禁止静默适配状态漂移** |
| **验收（对抗性）** | 改页面结构后回放 → 必须报 DRIFT 并终止，不得"自己想办法跑完然后报通过" |

### FR-8 报告 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 输出报告五要素；支持 `--export` 打包（含 `judgement_set`，保证可离线重算） |
| **呈现形态** | `idwth report --open` 渲染**单文件静态 HTML**（五要素与截图内联，**零服务端**、可离线双击打开）；`--export` 只打包归档，与渲染互不依赖 |
| **配色约定** | **PASS 中性/蓝 · FAIL 红 · BLOCKED 琥珀**。⚠️ **不用红绿表达通过与否**（避免与 A 股涨红跌绿冲突） |
| **验收** | 报告能独立说明：哪条用例、哪一步、哪条断言、为什么、如何复现 |

### FR-9 冻结产物与漂移检测 `[P0]`

| 项 | 内容 |
|---|---|
| **能力** | 固化产物绑定并校验；任一不符 → **拒绝执行并报 `BLOCKED(drift)`** |
| **绑定项（六重）** | 与 `detailed-design.md` §3.7 **逐字同源**：① `contract_hash` · ② `strategy_hash`（产物自身，防手工改）· ③ **`judge_impl_hash`**（判定实现源码 —— 最易漏但关键）· ④ `runner_version` · ⑤ `env_fingerprint` · ⑥ **`engine_provider_version`**（上游升级即 re-key 全部缓存） |
| **留档：并入项** | `执行器源码哈希` → 并入 ④（JevHarness 原文 `source_hash`）· `观测契约哈希` → 并入 ⑤ 的可观测面说明 |
| **留档：未采纳** | `模型传输通道`（不属冻结产物层 → 改由 `JevDecisionProvider` 版本表达）· `数据用例集哈希`（当前不以 suite 为冻结单元；将来若需要则**追加为第 ⑦ 项**）。依据见 `jevharness-review.md` |
| **环境指纹须含** | ① locale ② **UI 文案资源哈希** ③ SPA bundle 哈希 ④ **环境/部署标识**（SUT 中立说法；K8s 下实例化为集群名） |
| **依据** | 目标平台 UI 文案**完全外置**（`/locales/{{lng}}/{{ns}}.json`）→ **"翻译改了、DOM 没变、可访问名却变了"** 是 L1 定位失效的真实成因，静态层面看不出来 |

### FR-10 CLI 与退出码 `[P0]`

| 命令 | 作用 |
|---|---|
| `idwth init` | 生成 Contract 骨架 + 环境探测（浏览器可用性 / JEV 端点连通性 / 权限） |
| `idwth validate` | Contract Schema 九条校验 |
| `idwth run` | 执行 |
| `idwth replay` | `--verify`（默认）/ `--heal`；`--repeat N` |
| `idwth report` | 输出 / `--open`（单文件静态 HTML）/ `--export` |
| `idwth doctor` | 环境自检 |
| `idwth judge recompute` | 归档证据离线重算判定 |

**退出码硬契约**

| 码 | 含义 |
|---|---|
| `0` | PASS |
| `1` | FAIL |
| `2` | BLOCKED |
| `3` | 配置/契约错误 |
| `4` | 环境不可用 |
| `130` | 用户取消（`CANCELLED`，**不进聚合**） |

### FR-11 数据隔离与清理 `[P0]`

| 项 | 内容 |
|---|---|
| **隔离单元** | **run 级作用域，形式由 SUT 决定**（K8s 下实例化为 `ns-idwth-<runId>`；非 K8s 系统用租户 / 资源名前缀 + 标签集）。**隔离空间建在 run 级，对象名/标签内嵌 `runId + contractId` 两级** —— runId 防「上次残留」，contractId 防「批次内跨用例串扰」 |
| **硬规则** | ① 断言的**论域收窄到"本 run 创建的对象集"**（每个对象须带 `runId` + `contractId` 双标识）；② 系统自动注入对象须显式排除并记 `excluded_system_objects[]`；③ cleanup 的「完成」判据是**终态（轮询至 404）**，不是 DELETE 响应码；④ cleanup 绑 runId 且**幂等可重入**；`DELETE` 只发一次，之后仅做**只读轮询** |
| **实测依据（SUT 实例：openFuyao）** | K8s 下 `ns-idwth-<runId>` 20/20 通过；DELETE 200 → `Terminating` **6.2s** → 404；重复 DELETE 返回 404（幂等）。**这些是 K8s 适配下的实测，不作为其他 SUT 的前置要求** |

### FR-12 稳定性门禁 `[P0]`

| 项 | 内容 |
|---|---|
| **判据形态** | **二值**：任一 case 连跑 `N≥10` 次结论不一致 → 判该 case 为缺陷，**阻断合并** |
| **不作门槛** | suite 绿灯率**仅作观测趋势**，不设阈值 |
| **依据** | 单 case 95% × 50 条 → 全绿概率仅 **7.7%**（50 条要 95% 全绿，单条需 **99.9%**）；取平均会让门禁 92% 时间在红，团队转而"重跑几次"→ 门禁失效 |
| **遗留** | `--repeat N` 放每 PR 还是 nightly（耗时 ×10）→ 见 §十二 |

---

## 五、Skills 规格（7 个）

> **Skill = 可校验的契约声明，不是可执行的程序。** 分三层：① 声明层 `SKILL.md`（人 + 模型可维护）② 实现层确定性代码（工程师维护，模型**无权**改写）③ 调用层 Runtime 独占的 4 个调用点。
> **按「何时运行」分两类** —— 这是"双 Runtime"的具体落法：

| # | Skill | 类别 | 运行阶段 | 输入 | 输出 | CI Runtime 是否调用 |
|---|---|---|---|---|---|---|
| 1 | `web-test-contract` | **知识型** | Authoring（1 次） | 需求材料 + 环境信息 | Frozen Contract | ❌ **不调用** |
| 2 | `web-test-executor` | 契约型 | Runtime（每次） | Contract + Strategy | 执行结果 / 终止原因 | ✅ |
| 3 | `web-semantic-action` | 契约型 | Runtime（按需） | 页面快照 + 目标语义 | `{operation, target_index}` | ✅ |
| 4 | `web-semantic-recovery` | 契约型 | Runtime（按需） | 失败上下文 + fresh snapshot | 恢复动作 | ✅ |
| 5 | `web-test-evidence` | 契约型 | Runtime（全程） | 执行过程 | evidence（分级） | ✅ |
| 6 | `web-test-judge` | 契约型 | Runtime（终局 1 次） | evidence + assertions | verdict | ✅ **独占调用** |
| 7 | `web-test-replay` | 契约型 | Runtime（回放） | 冻结产物 | 复跑结果 / DRIFT 报告 | ✅ |

**每个 Skill 的强制约束（必须写进各自 `SKILL.md`）**

| Skill | 强制约束 | 降级路径 |
|---|---|---|
| `web-test-contract` | 禁止猜 selector；缺失字段必须澄清；`irreversible` 必给 `postcondition` | 人直接写 YAML + `validate` |
| `web-test-executor` | 歧义即 `BLOCKED(ambiguity)`；mutation 不重试 | —— |
| `web-semantic-action` | 输出仅 `operation + target_index`；置信度低于分级阈值即 `BLOCKED(decision)` | 纯 L1/L2（SIR = 0） |
| `web-semantic-recovery` | **绝不可改 Goal / Assertion**；恢复后必校验步级后置条件 | 直接 `BLOCKED(recovery)` |
| `web-test-evidence` | credential 不进判定必需集；截图遮罩含文本级密钥 | —— |
| `web-test-judge` | 纯函数；**调用权与写入权归 Runtime**；verdict 可离线重算 | —— |
| `web-test-replay` | **禁止静默适配漂移** | 无回放时全量重跑 |

**Agent Runtime 下的行为**：模型可读 `SKILL.md` 并"编排"，但**不能产生 `judge_result`**（Runtime 独占）→ 其产物 `runtime: "agent"`，**不参与任何 P0 指标**。

---

## 六、非功能需求（NFR）

| 类别 | 指标 | 口径 |
|---|---|---|
| **成本** | 稳定路径 **Semantic Invocation Rate ≈ 0**；模型成本随跑次数**单调递减至零** | **仅 CI Runtime 口径** |
| **延迟** | 决策延迟中位数 ≤ 2s（**不含**页面加载与断言等待） | 同上 |
| **稳定性** | **无 flaky case**（二值）；绿灯率仅观测 | 同上 |
| **可信度** | 判定可离线重算，与在线**完全一致** | `judge recompute` 契约测试 |
| **安全** | credential 只存内存；截图遮罩；报告可分享（不含密钥） | 见 FR-5 |
| **合规** | **禁止引入无许可证代码**（见 §八） | 法务审阅前阻断 |
| **可移植** | 同一套 Skills 可被**不同 Agent Harness 与 CI Runtime 复用** | 契约声明与实现层解耦 |
| **可替换**（2026-10-08 新增） | 执行引擎可整体替换（`EngineProvider`），**判定内核不随之改动** | 见 `detailed-design.md` §5.0 |
| **可离线**（2026-10-08 新增） | 回放态**完全离线可跑**；首次态离线时需 L3 的步骤报 `BLOCKED(decision)`，**不假装跑过** | 离线部署须随版本交付「引擎缓存」（DD §6.2） |

---

## 七、验收标准

### 7.1 对抗性验收（12 条 · P0 全量 · 编号 A1–A11，其中 A7 拆为 a/b）

> **2026-10-08 更新**：A7 拆为 **A7a / A7b**，并新增 **A10 / A11**。三条新条目全部针对**外购执行引擎的默认值**——它们不会体现在架构评审里，只能靠运行期验收拦住（依据见 [`e2e-architecture-adjustment.md`](e2e-architecture-adjustment.md)）。
>
> **编号约定（2026-10-10）**：验收编号**全局唯一**；A 序列新增一律**追加到最大号之后，禁止按主题重排**。视觉通道的验收改用 **`VB-` 独立序列**并归入 Backlog（见 §十二），**不占 A 序列**。

> 这是本产品最有效的验收形态。每条都是"构造一个能骗过普通实现的反例"。

| # | 构造场景 | 期望 | 测的边界 |
|---|---|---|---|
| **A1** | JEV 自述完成 + HTTP = 500 | **FAIL** | JEV ≠ PASS |
| **A2** | JEV 自述完成 + **无任何证据** | **BLOCKED** | 无证据 ≠ 通过 |
| **A3** | 断言目标**多条匹配**（歧义） | **BLOCKED(ambiguity)**，不取第一个 | 歧义 ≠ 用例外 |
| **A4** | Recovery 试图**修改 Assertion** | **拒绝 + 审计 + 终止** | 禁止静默改判定标准 |
| **A5** | 提交后**网络超时** | **不重试 mutation** → BLOCKED | 副作用不可重复 |
| **A6** | Replay 时页面结构变化 | **报 DRIFT 并终止** | 回放不得静默适配 |
| **A7a** | **回放态**（引擎缓存命中）**断开 JEV 端点**（离线） | 确定性路径**全部可跑**，SIR = 0 | 模型不是硬依赖（回放态） |
| **A7b** | **首次态**（缓存未命中）断开 JEV 端点 | 走 L1/L2 的 step 可跑；**需 L3 的 step 必须 `BLOCKED(decision)`**，不得假装跑过 | 模型不是硬依赖（首次态）；**离线部署须随版本交付「引擎缓存」** |
| **A8** | 归档 evidence **离线重算** | verdict 与在线**完全一致** | 判定可复核 |
| **A9** | Recovery 落到**错误但看似合理的目标**，最终断言恰好通过 | **步级后置条件必须捕获** | 假通过防线 |
| **A10** | 断言区在**视口外** / 页面**加载中** / **纯 Canvas 页**上做断言 | **BLOCKED(decision)**，不得报 FAIL | 执行引擎的默认值不得改写我们的 verdict |
| **A11** | 引擎缓存记录陈旧时用**默认命令**回放 | **报错终止**，不得静默 heal 后报通过 | `replay --verify` 是真的默认，不是文档话术 |

### 7.2 结构性验收

- 7 个 `SKILL.md` 全部通过 Schema Validator
- 每个 skill 另有 **1 条行为性验收**（给定输入 → 期望输出），**不止于 schema 通过**
- `contract / action / strategy / trace` 四个 schema 的版本兼容性通过
- 连续两次运行同一 case，**第二次不因上次残留而 PASS**
- `--repeat 10` 能输出 flaky 判定

### 7.3 P0 / P1 分级

| 级别 | 内容 |
|---|---|
| **P0** | FR-1~FR-12 全部；A1–A11 全部（12 条，A7 拆 a/b）；退出码契约；报告五要素；**「已录制的引擎缓存」作为交付物**（`.idwth/engine-cache/`，按 `engine_provider_version` 分目录 —— A7a / A7b 的离线前提） |
| **P1** | iframe / shadow DOM 支持；`examples/k8s-adapter` reference adapter；Eventually 断言语义；`--heal` 审计流程完善；**`--keep-on-failure`**（FAIL 时保留现场供人工排查；**默认仍无条件清理**，此开关不进 V1 默认路径） |
| **V1 排除** | Canvas 图表内容断言 · 文件上传下载 · Web 终端页 · 移动端 · 跨浏览器矩阵 |

---

## 八、技术选型与依赖红线

### 8.1 执行臂

| 项 | 决策 |
|---|---|
| **主干** | **CDP**（Playwright `connectOverCDP` 接管现有 Chrome），可复用登录态 |
| **焦点** | 后台标签页执行（`Target.createTarget(background:true)` + `setFocusEmulationEnabled`）**不抢用户焦点** |
| **隔离** | 每 case `browser.newContext()` 强隔离 |
| **降级臂** | `page-agent` 仅用于 MFA / 免安装场景 |

### 8.2 ⛔ 许可红线（法务级硬约束）

| 仓库 | 许可 | 可用方式 |
|---|---|---|
| `CorieW/JevTest` | **无 LICENSE** | ⛔ **只可借鉴设计，禁止复制代码、禁止引入依赖**。其 `Adapter`/`Session`/`Policy` 抽象**只能重写不能搬运** |
| `TianyuCodings/JevHarness` | **无 LICENSE** | ⛔ 同上。只移植**字段设计与思路**（五重绑定、`authoring_contract` 手法），**不引代码** |
| `perixtar/jev-e2e` | MIT | ✅ 可商用、可引依赖、可复制（保留版权声明） |
| `browser-use/jev-ultrafast` | MIT | ✅ 同上 |
| `alibaba/page-agent` | MIT | ✅ 同上 |

> **可借鉴的设计（不引代码）**：三态判定 · 判定权独占 · 漂移报错而非静默适配 · `operation + target_index` 输出限定 · 冻结产物多重绑定 · 规则注入同源 · 约束必须在代码里 · 超上限≠通过。

### 8.3 SUT 适配注记（首个对象 openFuyao）

> **归属判据**：**「离开 openFuyao，这条还成立吗？」** 成立 → 导出为**通用原则**（进产品要求）；不成立 → 仅是该 SUT 的**特例**（留在适配层，**不进 core**）。左栏是首个 SUT 的实测事实，右栏是其导出的通用原则。

| openFuyao 实测事实（左：SUT 适配项） | 导出的通用原则（右：产品要求） |
|---|---|
| 登录含 **per-request CSRF + `state`**，密码以**字节数组**提交 | **交互式登录不可进冻结产物** → 降为 case `precondition`；凭据由 Runtime 内存注入（FR-5） |
| 集群态**只存 `sessionStorage`**，路由不含 cluster 段 | **SPA 上下文需在 context 创建时引导**（`addInitScript` 等）；**具体键由 SUT 适配提供，core 不假定任何键名** |
| K8s API 经 `/clusters/<c>/api/kubernetes/...` 代理 | **backend 断言可（且应）完全绕开 UI** —— 走 `BackendAdapter`；`runId` 隔离**在 K8s 下实例化为 Namespace**，非 K8s 系统另择形式（FR-11） |
| UI 文案**完全外置**（i18n） | `env_fingerprint` **必须绑文案资源哈希**（否则「翻译改了、DOM 没变、可访问名却变了」） |
| 图表为 **Canvas（ECharts）** | 图表/监控类断言**必须走 backend**，不能靠 DOM。⚠️ **末句为该 SUT 特例**：其通用原则是「**非 DOM 渲染内容需另择证据通道**」，候选方案见 §十二 Backlog |

---

## 九、风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | L1 确定性定位命中率不足（目标 >80% 未实测） | M1 前实测；不足则调整 L2/L3 权重与成本预期 |
| R2 | L2 指纹在真实 SPA 上误命中（比不命中更危险） | 实测命中率与**误命中率**；误命中须能触发歧义短路 |
| R3 | `judgement_set` 体积失控 | 判定必需集**永不截断**，超限优先扩容；真无法承载 → `BLOCKED(storage)` |
| R4 | 真实站点不可外推（同类方案在真实站点 3 次仅 1 次 PASS） | **首期只跑自有可控环境** |
| R5 | CI 账号权限面未知 | 提供 CI 账号后实测 RBAC 权限面 |
| R6 | 3 个参考仓库极新（2026-09-16~18 创建）且迭代快 | 进入开发前复核一次数据快照 |

---

## 十、里程碑

| 阶段 | 交付物 | 覆盖的对抗性验收 | 出口判据 |
|---|---|---|---|
| **M1** 确定性闭环 | Contract Schema + L1 定位 + executor 状态机 + Playwright Adapter + judge + Trace + CLI 骨架 | **A3 · A8** | 无模型也能跑通一条用例并产出报告 |
| **M2** 语义能力 | JEV Adapter + `validate_choice` + semantic-action + recovery + 完整 Trace + 分级阈值 | **A1 · A2 · A4 · A5 · A7b** | 断开 JEV 端点：走 L1/L2 的 step 可跑；**需 L3 的 step 必须 `BLOCKED(decision)`**（不得假装跑过） |
| **M3** 价值验证 | Reference Suite + 指标采集 + **Report Viewer（单文件静态 HTML）** + `examples/k8s-adapter` + **「已录制的引擎缓存」**（首批 3~5 条代表性用例，按 `engine_provider_version` 分目录） | **A9 · A10** | 真实系统上跑出可用报告与成本曲线 |
| **M4** 进 CI | `replay --verify` + `--repeat N` 二值门禁 + `doctor` + **引擎缓存随版本分发**（离线部署前提） | **A6 · A11 · A7a** | 进 CI 且门禁不长期误报；**离线可跑（回放态）** |

> **A3（歧义短路）与 A8（纯函数可重算）必须在 M1** —— 它们决定架构是否正确，不能推到 M2。

---

## 十一、术语表

| 术语 | 含义 |
|---|---|
| **JEV** | 语义决策体系：把页面状态转成候选问题，返回 `operation + target_index` |
| **LLM 决策提供者** | JEV 背后真正产出决策的模型；通过 `JevDecisionProvider` 可替换（Mock 优先） |
| **Contract** | 测试契约（YAML）：用例的可执行、可校验声明 |
| **Frozen Strategy** | 首次运行后经人确认固化的策略产物（含定位指纹） |
| **SIR** | Semantic Invocation Rate，语义（模型）调用率 |
| **Evidence** | 证据；分「判定必需集」与「归档集」 |
| **Judge** | 独立判定器：`verdict = f(evidence, assertions)`，纯函数 |
| **BLOCKED** | 三态之一：**无法判定**（非通过、非失败），不计入 bug 检出 |
| **runId** | **一次批量执行**的唯一标识（= 一次"测试计划"）；fixture 名、资源标签、断言论域均绑它 |
| **测试计划** | **即一次批量执行**（一个 `run_id`）。**不新增 `suite_id` 层级**；唯一性来源 = `run_id`，用例维度由 `contract_id` 区分 |
| **flaky case** | 同一用例重复运行结论不一致者，本身即缺陷 |

---

## 十二、待关闭项与 Backlog（不阻塞本文评审）

> 本节只列**与本文直接相关**的待关闭项；**完整未决清单以 [`verification-checklist.md`](verification-checklist.md) 为准（58 项，已闭 14 项）**。

| # | 事项 | 归属 |
|---|---|---|
| 1 | `--repeat N` 放每 PR 还是 nightly（耗时 ×10） | 稳定性门禁的成本项 |
| 2 | Trace 字节上限与去重策略的具体参数 | 存储参数 |
| 3 | 是否引入完整轨迹反思接口（GEPA 风格） | **V1 不做**，但须留对接口：反思产物**必须是新版 frozen strategy 经人确认**；**可改 Recovery，绝不可改 Goal/Assertion** |
| 4 | 平台侧是否实现 `idwth.io/ttl` 自动回收 | 目标系统侧 |
| 5 | **`judgement_set`「实测 <2MB」的措辞无实测支撑**（checklist **D07**，🔴 P0） | 二选一：补一次实测，或措辞改为"估计" |
| 6 | 全量未实测假设与合规时效复核 | 见 [`verification-checklist.md`](verification-checklist.md)（58 项，已闭 14 项） |

### 12.1 Backlog（条件触发 · 非 V1 范围 · 不进评审队列）

| ID | 事项 | 启动条件 | 当前状态 |
|---|---|---|---|
| **BL-1** | **视觉 / Canvas 渲染层测试通道**（视觉 + DOM 双通道、视觉 Oracle、噪声闸门标定、敏感区遮罩） | **外部明确提供多模态大模型能力，且主动要求启用视觉断言** | 需求**不纳入 V1** · 设计**不做** · 原计划 P4.5 时点**已撤销**。素材见 [`visual-dom-matrix.md`](visual-dom-matrix.md)（其验收编号为 **`VB-01…VB-05`**，**不占 A 序列**） |
