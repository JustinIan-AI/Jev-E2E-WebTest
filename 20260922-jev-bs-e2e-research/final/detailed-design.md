# IDWTH 详细设计文档

| 项目 | 内容 |
|------|------|
| 版本 | **V1.2（优化版，替换 V1.0 / V1.1）· 含 D 级交付完整性补充 3 项（DD-27/28/29）+ E 级执行引擎层 7 项（DD-30~DD-36）+ F 级 PRD V1.2 同步与 SUT 中立化 10 项（DD-37~DD-46）+ G 级产品形态 2 项（DD-47/DD-48）** |
| 基线 | V1.0 设计评审稿 → V1.1（29 项修订）→ **V1.2（本文：E 级 7 项 2026-10-08 · F 级 10 项 + G 级 2 项 2026-10-10）** |
| 上游 | **`final/PRD.md` V1.2** + `final/prd-review.md` 5 项阻塞决议（**2026-09-23 全部通过**）+ **`final/e2e-architecture-adjustment.md`（2026-10-08 **已决策，全按建议执行**）** |
| 状态 | **可作开发基线**（A 级 9 项已定稿 · 5 项阻塞决议已确认 · §4.8/§5.5 已补齐落地规格 · **E 级执行引擎层已定稿并落地 9 处** · **F 级 PRD V1.2 同步 + SUT 中立化已落地 10 项** · **G 级产品形态已定稿（V1 = 纯 CLI · `Report Viewer` 定形为单文件静态 HTML）**） |
| 核心技术 | Skills（契约声明）+ **EngineProvider（可替换执行引擎）** + JEV Adapter + Evidence + Judge（Runtime 独占） |

> **本文是 V1.0 的替换版而非增补版。** 变更点集中在 §0.2 的变更清单与 §三（数据模型整节重写）。
> 引用本文件时请以本文为准；V1.0 中有 9 处架构级问题会使既定保证**在实现层不成立**，不宜继续作为基线。
>
> **2026-09-23 交付完整性补充**：新增 **§4.8 七个 `SKILL.md` 完整规格**（DD-27）与 **§5.5 Playwright 脚本层**（DD-28）—— 前者解决"7 个 skill 只有职责级描述、无法照此实现"，后者解决"脚本层缺失、四条已实测硬约束无处落地"。配套正式 PRD 见 [`PRD.md`](PRD.md)。
>
> **2026-10-08 执行引擎层补充（V1.2）**：在实现层与 Tool Layer 之间**新增一层 `EngineProvider`（可替换执行引擎，§2.1 / §5.0）**，默认实现取 `tester-army/e2e`（Apache-2.0 · TypeScript，与本设计同栈 → 可作真实依赖）。**判定内核（Judge / runId 隔离 / 论域收窄 / cleanup 终态 / 绑定校验）完全自研、一行未动。** 依据与安全边界见 [`e2e-architecture-adjustment.md`](e2e-architecture-adjustment.md)；本节落地 9 处，变更清单见 §0.2 E 级。
>
> **2026-10-10 PRD V1.2 同步 + SUT 中立化（V1.2 · F 级）**：把 PRD V1.2 的裁定回流到本文，并把「首个 SUT（openFuyao）的专属事实」与「产品要求」分开 —— 判据一句话：**「离开 openFuyao，这条还成立吗？」**（§八.3 两栏表）。**判定内核（Judge / 论域收窄 / 错误映射）与隔离机制一行未改**；改的是**要求层的措辞**与**隔离单元的抽象**（`ns-idwth-<runId>` → 「run 级作用域，形式由 SUT 决定」，对象名内嵌 `runId + contractId` 两级）。变更清单见 §0.2 **F 级**。
>
> **2026-10-10 产品形态（V1.2 · G 级）**：裁定 **V1 = 形态 A（纯 CLI 单进程）—— 不做常驻服务（daemon）、不做本地 Web 控制台、无前后端分离**（DD-47）；`idwth report --open` 的 `Report Viewer` 定形为**单文件静态 HTML**（零服务端、可离线双击，DD-48）。`product-definition.md` 的**形态 B / C 未采纳** —— 该文 §3.2 与本仓库 `README.md` 摘要第 7 条均已加状态注留痕（**不删早期设想**）。变更清单见 §0.2 **G 级**。

---

## 零、修订说明

### 0.1 五项阻塞决议的落地位置

PRD 评审给出的 5 项阻塞决议，V1.0 详细设计**一项都未落地**。本文的落点如下——它们是本设计的**前置条件**，不是可选项：

> ✅ **2026-09-23 评审确认：5 项全部通过，且本文已按其设计落地 → 本组为"零设计改动"闭环。**
> 评审中对 ① 第 1 项额外澄清：编排者的归属为**拆双 Runtime**（"LLM 统一调度"落在 Agent Runtime 一侧；**CI Runtime 与回放全程确定性、LLM 不进回路**）；
> ② 第 2 项的实质是**判定权的独占**，而非"是否操作 Judge"（Judge 是 Runtime 内的确定性判定代码，要害在"独占"不在"操作"）。
> 执行记录见 `final/verification-checklist.md` §A 与 §2 决议表。

| # | 阻塞决议 | V1.0 状态 | 本文落点 |
|---|---|---|---|
| 1 | CI Runtime 为 P0 验收唯一对象 | ❌ 图只有「Agent / CI Host」一个框 | §2.1 双 Runtime · §4.0 Authoring/Runtime 两阶段 |
| 2 | Judge 调用权 + verdict 写入权归 Runtime；verdict 为纯函数 | ❌ §4.6 只把 Judge 列为 skill，无权限说明 | §4.6 · §6.1 四独占 · §3.6 权威源 · §10 `judge recompute` |
| 3 | 拆 `replay --verify` / `--heal` | ❌ §10 只有 `[--strict]` | §4.7 · §10 |
| 4 | `fixtures` 引入 runId 命名空间 | ❌ `fixtures: object` 无规范 | §3.1 `fixtures` 实例化规则 · §3.2 http 断言时间窗 |
| 5 | 稳定性改为「无 flaky case」硬门禁 | ❌ §9 只写"输出一致性报告" | §9.1 |

### 0.2 变更清单（48 项 = A 9 · B 11 · C 6 · D 3 · E 7 · F 10 · G 2）

#### A 级 —— 架构/正确性，必须定稿（9 项）

| ID | V1.0 位置 | 问题 | 后果 | V1.1 改法 |
|---|---|---|---|---|
| **DD-01** | §3.1 `steps: string[]`、§4.2 `has_stable_locator(step)` | **Contract 里没有任何定位声明**，`steps` 只有自然语言。`has_stable_locator` **恒返回 false** | **Deterministic First 在数据模型层就失效**——所有步骤都会走语义路径，`Semantic Invocation Rate ≈ 0` 不可能达成 | §3.1 `steps` 升级为结构体（`action` + `target` + `risk` + `postcondition`）；§3.3 用「定位解析模型」取代 `has_stable_locator` |
| **DD-02** | §4.2 executor 伪代码 | **Skill 的物理形态未定义**：若 skill 是给模型读的 Markdown，则伪代码无法"执行"；若是代码，则不是 skill | 整个 skill 层无法实现；双 Runtime 无处落地（PRD 评审 §1.1 互斥在 DD 层的具体表现） | §4.0 定义三层形态（声明层/实现层/调用层）+ Authoring/Runtime 两阶段 |
| **DD-03** | §4.2 `if result.failed: recovery` | **对 irreversible 动作失败也触发 recovery**——对着"提交失败"再点一次提交 | CMDB/K8s 上**重复创建资源 = 真实损害**（PRD 评审 D3） | §8.2 按 `risk` 分流：`irreversible` 失败 → 直接 `BLOCKED(decision)`，**不 recovery、不重试** |
| **DD-04** | §3.1 `fixtures: object` | 无 runId 命名空间；`backend: exists: true` 无法区分"本次创建"与"上次残留" | 一条**假 PASS 通道**（PRD 评审 D1） | §3.1 runId 模板注入 + cleanup 绑 runId；§3.2 断言时间窗 |
| **DD-05** | §4.2 伪代码 `if has_stable_locator ... else semantic` | **把"歧义"当成"未命中"**往下走，交给模型猜一个 | **假 PASS 的主要来源**——模型会在多个候选里挑一个看似合理的（PRD 评审 D2/D4） | §3.3：**歧义 ≠ 未命中**。匹配数 >1 立即 `BLOCKED(ambiguity)`，不降级 |
| **DD-06** | §4.6 · §6.1 | Judge 是 skill，但**调用权、写入权、纯函数约束全未定义** | 编排者可"这步不跑 Judge" = **PASS by omission**；转述时改 verdict | §6.1 四独占 · §3.6 权威源 + `verdict_hash` · §10 离线重算命令 |
| **DD-07** | §4.7「默认严格」· §10 `[--strict]` | replay 的「Drift 修复」与「回放」混在一起，单个布尔开关语义不清 | 两次回放**结果不可比**；漂移被吞掉；「零模型调用可回放」这条 P0 验收**无法测** | §4.7 拆为 `--verify`（默认，零模型，漂移即终止）/ `--heal`（显式，产物不入 CI） |
| **DD-08** | §9 稳定性行 | 只写 "`--repeat 10` 输出一致性报告"，**未定义判定口径** | 沿用 PRD 的 95% 单 case 阈值会组合成灾难：50 case suite 仅 7.7% 全绿，门禁不可用 | §9.1 「无 flaky case」二值硬门禁 + suite 绿灯率仅观测 |
| **DD-14** | §3.3 Trace | `verdict` 顶层字段与 `judge_result` **双写且无权威源**；evidence 无分级 | 无法判断哪份是裁定结果；「拒绝截断」与「超限归档」互相矛盾 → **离线重算不成立，决议 2 落不了地** | §3.6 权威源单一 + `verdict_hash`；evidence 按**是否参与判定**分级 |

#### B 级 —— 可实现性，M1 前补齐（11 项）

| ID | V1.0 位置 | 问题 | V1.1 改法 |
|---|---|---|---|
| **DD-09** | §3.1 `assertions` | 断言语义**全未定义**（`dom[].text` 是 contains 还是 equals？`http[].path` 匹配规则？`backend[].key` 从哪来？） | §3.2 断言语义精确表（7 原语逐条给判定口径与匹配规则） |
| **DD-10** | §4.6 判定逻辑 | 「执行完成但业务结果不一致 → FAIL」**一刀切**，断言无法求值时也归 FAIL | §3.2 逐原语区分 `FAIL`（观测事实为否）/ `BLOCKED(evidence)`（无法求值） |
| **DD-11** | §3.2 Action 模型 | `target_index: number` 为必填，但 `navigate`/`done` 不需要索引；**且确定性路径（Playwright Locator）根本没有对应的动作表示** | §3.4 改为 discriminated union + `ResolvedTarget` 统一中间表示 |
| **DD-12** | §5.1 `execute(): Promise<ActionResult>` | **`ActionResult` 结构未定义**——而它正是 execution issue 与三态判定的输入 | §3.5 8 种状态 + 唯一映射表 |
| **DD-13** | §4.2「每次 Mutation 前强制 Freshness Snapshot」 | 只写了要求，**没写由谁强制、怎么校验** | §6.1 第三项独占：Freshness 校验权归 Runtime；§3.3 用 `observationId` 比对实现 |
| **DD-15** | §4.3 置信度策略 | 单一阈值 0.85：对可回退动作过于保守（BLOCKED 泛滥），对不可逆动作仍不够严 | §7.2 按可逆性分级：`reversible ≥ 0.60` / `irreversible ≥ 0.90` |
| **DD-16** | §8.2「Recovery 失败 → BLOCKED / FAIL」 | 斜杠意味着可配置；PRD 评审 Q4 已定**必须 BLOCKED** | §8.2 收紧为 `BLOCKED(recovery)`，**不可配置**；可配置的只是 CI 是否阻断合并 |
| **DD-17** | §3.1 `credentials_ref?: string` | 可选、且未定义解析时机与可见范围 | §5.4 credential 生命周期：Runtime 内存内解析，永不进 Trace/Evidence/Snapshot |
| **DD-18** | §3.1 `preconditions: string[]` | 自然语言，**谁判？** 若模型判，则 BLOCKED 的判定也依赖模型 | §3.1 改为可执行形式（`kind: authenticated / http_ok / selector_present`） |
| **DD-19** | §3.1 `cleanup?: string[]` | 无 finally 保证、无幂等性要求；abort 时不会执行 | §6.1 第四项独占 + §8.1 `finally` 语义 + cleanup 必须幂等（runId 作用域内可重入） |
| **DD-20** | §1.2 / §5 | iframe / Shadow DOM 仍列「不支持」，而首批对象是云管/K8s 系统（**这类平台几乎必然含 iframe**，且 Playwright 原生支持） | 降级为 P1；V1 只排除 Canvas、上传下载 |

#### C 级 —— 一致性与文档（6 项）

| ID | V1.0 位置 | 问题 | V1.1 改法 |
|---|---|---|---|
| **DD-21** | §9 成本行 | `Semantic Invocation Rate` **分母未定义**（per case? per action? per step?） | §9.2 明确 `SIR = 发生 model 定位的 step 数 / 总 step 数`（per case） |
| **DD-22** | §9 延迟行 vs §3.1 `timeout` | 决策延迟 2s 与断言超时 60s 语义混淆 | §9.3 三口径分列：动作超时 / 断言 deadline / 决策延迟 |
| **DD-23** | §6.1 退出码 | 只列 `PASS=0, FAIL=1, BLOCKED=2, ERROR=3`，**配置错误与 BLOCKED 混用**；且未把「用户取消」独立于 BLOCKED | §10 六值：`0/1/2/3 CONFIG/4 RUNTIME/130 CANCELLED`；`CANCELLED` 不进 verdict 聚合，理由见 §8.2 |
| **DD-24** | 全文 | 「Freeze the Strategy」**无产物定义**（PRD 评审 D6） | §3.7 frozen strategy artifact：**六重绑定**（contract / strategy / **judge_impl_hash** / runner_version / env_fingerprint）+ 三处校验作用点 + 写回规则。另见 §3.6 `verdict_hash` |
| **DD-25** | §14 开放问题 | 4 项里有 2 项**已在 PRD 评审关闭**却仍在提问 | §14 收敛至 2 项真开放问题 |
| **DD-26** | §2.1 架构图 | 图中缺 JEV Adapter、缺 Trace 单写点、缺双 Runtime | §2.1 重绘 |

#### D 级 —— 交付完整性补充（3 项 · 应"输出完整详细设计"要求新增）

| ID | 缺口 | 补齐位置 |
|---|---|---|
| **DD-27** | **7 个 skill 只有职责级描述，没有可落地的 `SKILL.md` 规格**（frontmatter / 输入输出 schema / constraints / 降级 / 行为性验收），模型与工程师都无法照此实现 | **§4.8 七个 SKILL.md 完整规格**（含统一骨架 + `stage`/`callable_by` 关键字段 + 逐 skill 规格卡 + 行为性验收） |
| **DD-28** | **Playwright 脚本层缺失**：V1.0/V1.1 只给了 `BrowserTool` 接口与一行目录，没有脚本清单与实现落点（尤其"不抢焦点"「强隔离需引导上下文」「歧义即抛错」「两层遮罩」四个已实测出的硬约束无处落地） | **§5.5 Playwright 脚本层**（11 个脚本清单 + 6 段关键实现骨架 + 退出码骨架） |
| **DD-29** | **术语重命名：Oracle → Judge**（"Oracle" 易与 Oracle 数据库混淆；且实现内函数名本就叫 `judge`，一个概念两个名字） | 全文统一为 **Judge**。同步改名：CLI 子命令 `oracle recompute` → `judge recompute`；字段 `oracle_result` / `oracle_impl_hash` / `oracle_version` → `judge_*`；skill 名 `web-test-oracle` → `web-test-judge`。**共替换 115 处**（PRD 14 · 详细设计 59 · 清单 14 · 评审 17 · README 6 · 审计 skill 5）；**除本行变更说明外，全文无残留** |

#### E 级 —— 执行引擎层（7 项 · 2026-10-08 依 `e2e-architecture-adjustment.md` 落地，**5 项待决问题已全部按建议决策**）

> **性质**：E 级**不改变任何判定语义**。12 条 FR 的安全边界是 —— **FR-6 Judge / FR-11 runId 隔离完全自研未动 · FR-1 保持自研 · FR-2/3/5/7/8 换底层实现 · FR-4/9/10 在引擎之上包一层**。

| ID | 缺口 | 后果 | V1.2 改法 |
|---|---|---|---|
| **DD-30** | **架构里没有「执行引擎可替换」这一层**：实现层直接依赖 Playwright 脚本，换引擎等于重写实现层 | 上游 pre-1.0 改 API 或将来许可变更 → 我们的契约与判定内核被动受牵连 | **§2.1 三层 → 四层**：新增 `EngineProvider` 接口层（与既有 `BackendAdapter` / `JevDecisionProvider` 同手法）+ **§5.0** 接口定义 + §11 目录新增 `engine-provider/` |
| **DD-31** | **绑定面漏了上游引擎自己**：上游**升级即 re-key 全部缓存条目**，等价于 `BLOCKED(drift)`，但它默认 heal **不报错** | 「引擎换了但指纹还在复用」= **新的静默错配通道** | **§3.7 六重绑定 → 六重绑定**，新增第 ⑥ 项 `engine_provider_version` |
| **DD-32** | **上游把「模型判不出来」记为测试失败**（`ASSERTION_INCONCLUSIVE` 归 `failed` 类、exit 1，源码 `packages/decision/src/executor.ts:382`） | 加载中 / 纯 Canvas 页 / 断言区在视口外 → 报告写「测试未通过」，即**假 FAIL** | **§8.2 新增映射行**：抄这个独立错误码，但 class 改 `BLOCKED(decision)`，**不计入 bug 检出** |
| **DD-33** | **A7「离线可跑」的表述不精确**：它只在回放态成立，首次态（缓存未命中）必然出网 | 把「首次态需要模型」误读成「架构有 provider 硬依赖」，验收口径失真 | **§12 拆 A7a / A7b**：A7a 回放态断网全可跑；**A7b 首次态断网 → 需 L3 的 step 必须 `BLOCKED(decision)`，不得假装跑过** |
| **DD-34** | **缺两条针对上游默认值的验收** | 上游的默认值会在实现期悄悄渗透进我们的 verdict，且无验收能拦住 | **§12 新增 A10 / A11**：A10 断言区在视口外/加载中/Canvas → 必须 BLOCKED **不得 FAIL**；A11 陈旧记录用**默认命令**回放 → 必须报错终止，**不得静默 heal 后报通过** |
| **DD-35** | **离线部署缺一项交付物**：引擎的动作缓存未列入交付清单 | 内网环境首次运行必然 `BLOCKED(decision)` → A7b 成常态，产品在目标环境跑不起来 | **§6.2 新增「引擎缓存」为随版本交付的组件**（联网录一轮，缓存产物随包带入内网） |
| **DD-36** | **恢复权的归属未在引擎层说明**：上游默认"失败即交给 agent 兜底"（heal） | Engine 的失败会自动触发上游重试 → 绕过 §8.2 的 `risk` 分流与 §8.3 的 recovery 上限 | **§6.1 新增第 ⑥ 条说明**：**Engine 的失败不得直接触发其自动 heal**；是否恢复由 Runtime 依 §8.2/§8.3 决定 |

#### F 级 —— PRD V1.2 同步 + SUT 中立化（10 项 · 2026-10-10）

> **性质**：F 级**不新增判定语义、不改隔离机制**。它做两件事 —— ① 把 PRD V1.2（2026-10-10 版）的裁定回流；② 用一条判据（**「离开 openFuyao，这条还成立吗？」**）把「SUT 专属事实」从「产品要求」里剥出来。

| ID | 缺口 | 后果 | 改法 |
|---|---|---|---|
| **DD-37** | 上游指针停在 `PRD.md` **V1.0**（落后两版）；版本身份未与 PRD 成对登记 | 读者按错版本对账；本次改动不留痕 | 上游指针改 **`PRD.md` V1.2**；**DD 保持 `V1.2`**（与 PRD 成对）；新增本 F 级清单（**不重排历史项**） |
| **DD-38** | §13 里程碑把 **A7a** 排在 **M2** | M2 尚无 `replay` 命令，A7a（回放态）**当期测不了** → M2 的"通过"成空话 | §13 **M2 去 A7a、M4 加 A7a**；M2 的注解改写为 **A7b（首次态）** 语义 |
| **DD-39** | §12 验收计数写 **11 条**，PRD 写 **12 条**（A7 拆 a/b）；且表格内仍引"PRD §13 只有 1 条"的化石句 | 同一验收集两个数法，读者卡住 | §12 统一为 **12 条**；补**编号只追加、禁止重排**约定 |
| **DD-40** | §4.0 整段仍写「7 → 9 skills」与「验收项 A10–A14」 | 视觉已归 Backlog，正文却像既定规划；且编号与执行引擎层 A10/A11 撞号 | §4.0 改写为 **BACKLOG 声明 + 明确 V1 = 7**；`A10–A14` → **`VB-01…VB-05`**（留改号痕） |
| **DD-41** | §3.6 与 §14 Q1 把 `judgement_set` 体积写成「**实测** <2MB」 | 把**估计写成实测**，两份文档的不可信同源 | 两处改「**估计 ~<2MB（待实测，PRD §十二 D07）**」 |
| **DD-42** | 文档缺一条判据，「实测到的」被顺手写成「要求的」（§八.3 标题即"目标系统约束"，§5.5.4 把"集群上下文键"写成硬要求） | 产品在**第二个 SUT** 上就出问题 | 立**归属判据**；PRD §八.3 重构为**两栏表**；§1.2 / §5.5.4 改为 **SPA 上下文引导（键名由 SUT 适配提供）** |
| **DD-43** | 隔离单元被写死为 **`ns-idwth-<runId>`**（K8s 概念），且对象名**只有 runId、无用例维度** | 非 K8s 系统落不了地；**批次内跨用例串扰**（用例 A 建的对象被用例 B 的断言命中）→ 假 PASS | 隔离单元抽象为「**run 级作用域，形式由 SUT 决定**」；对象名内嵌 **`runId + contractId` 两级**（§3.1 fixtures / §3.2 text_contains） |
| **DD-44** | 隔离的 setup/teardown 归属未定，可能被做成新接口 | 接口膨胀（第 4 个可替换接口） | **复用既有 `BackendAdapter`（provider）**，**不新增接口**（§3.1） |
| **DD-45** | cleanup 无条件清理 → FAIL 时**回不到现场** | 排查只能看 evidence 快照 | **默认仍无条件清理**；`--keep-on-failure` 作 **P1 显式开关**（不进 V1 默认路径）。**因对象带双标识，保留旧对象不污染后续 run** |
| **DD-46** | "suite"、"批量执行"、"测试计划"三个词在文档里未对齐 | "suite 级清理"与"run 级隔离"读者无法确认是否同一件事 | 统一口径：**一次批量执行 = 一个 `run_id` = 一次"测试计划"**；**不引入 `suite_id`**（§8.1 注 · §6.1） |

### 0.3 保留项（V1.0 做得好，不要被修订冲淡）

| # | 保留 | 为什么 |
|---|---|---|
| 1 | 三层职责划分（Skills 管策略 / Tools 管操作 / Runtime 管生命周期） | 边界干净，是本文全部设计的地基 |
| 2 | 「7 个 Skill 通过 Schema Validator」的结构化接口约定 | 契约先行，可校验 |
| 3 | JEV 输出禁止 Selector/XPath/JS/坐标，必须经 Action 校验层 | 与我们源码核验一致（`jev-ultrafast` 的 `validate_choice`） |
| 4 | 三级目录 `schema / adapters / runtime / tools` 的分层 | 与双 Runtime 可共存，保留了 |
| 5 | §12 测试策略的四层划分（单元/集成/验收/回归） | 只需把 9 条对抗性验收归位（§12） |

#### G 级 —— 产品形态（2 项 · 2026-10-10）

> **性质**：G 级**只定义"产品以什么形态交付"**，不触碰任何判定语义、执行路径与数据模型。它关闭的是**一处从未被登记的设计脱落**。

| ID | 缺口 | 后果 | 改法 |
|---|---|---|---|
| **DD-47** | **产品形态未定**：`product-definition.md`（09-22）的**形态 A/B/C**（B = `jev-harness` 常驻 `127.0.0.1` + `jev` CLI + 本地 Web 控制台，**中间唯一契约 = HTTP + JSON**）**从未进入 PRD / DD**，而 README 摘要第 7 条与该文 §3.2 仍把它当既定方向 | 读者会以为 V1 含常驻服务与控制台；"有没有前后端分离"无从判定；`§3.7` 规则 2 里的"控制台按钮"是一个**不存在于本设计的入口** | **裁定：V1 = 形态 A（纯 CLI 单进程）** —— **不做常驻服务（daemon）、不做本地 Web 控制台、无前后端分离**。§1.2 明列；§3.7 规则 2 删去"控制台按钮"，`--freeze` 为**唯一写回入口**。**形态 B/C 未采纳**（保留在 `product-definition.md` 作早期设想留档，加状态注） |
| **DD-48** | M3 交付物列有 **`Report Viewer`** 一词，但**形态无定义** | `idwth report --open` 到底打开什么无从实现；极易被实现成一个本地 Web 服务（正是 DD-47 要排除的形态） | **定形：单文件静态 HTML**（数据内嵌，源自 `report.json`；**零服务端、零运行时依赖、可离线双击打开**）。§10 明确落法，§11 目录给出落点 |

---

## 一、设计目标与边界

### 1.1 设计目标

1. 将 7 个 Skill 与 Minimal Runtime 落地为**可独立实现、可测试**的模块。
2. 保证 **Deterministic First**：稳定路径零模型调用（且该指标**可度量**——见 §9.2）。
3. 保证 **JEV 只输出动作**；Judge 独立且**其调用权与写入权不可被编排者取得**。
4. 所有 Semantic 决策与 Recovery 完整落盘，支持 Replay 与后续反思。
5. Skill 接口稳定，可被不同 Agent Harness / CI Runtime 复用。
6. **（V1.2 新增）执行引擎可替换**：实现层只依赖 `EngineProvider` 接口，不依赖任何具体引擎（§2.1 / §5.0）。默认实现可外购，降级实现自研，**两者切换不触碰判定内核**。

> **目标 2 的补充（V1.1 新增）**：零模型调用**只在 CI Runtime 下定义**。Agent Runtime 的编排调用不计入该指标（PRD 评审决议 1）。

> **目标 6 的理由（V1.2 新增）**：目标 1–5 都在约束"我们做什么"，目标 6 约束"**我们依赖谁**"。若实现层直接写死 Playwright 脚本，则上游执行引擎的任何变化（pre-1.0 改 API、许可变更、能力缺口）都会穿透到判定层。加一层接口，**代价是一个文件，收益是把"换供应商"从架构级改动降为配置级改动**。

### 1.2 设计边界（V1 不做）

- 不实现新浏览器引擎，不替代 Playwright。
- 不实现用例自动生成（Contract 由人或 Authoring Agent 产出一次，之后冻结）。
- 不实现完整测试管理平台。
- **不做控制面（2026-10-10，DD-47）**：**V1 = 纯 CLI 单进程** —— **不做常驻服务（daemon）、不做本地 Web 控制台、无前后端分离**。产品形态只有**形态 A**；`product-definition.md` 的形态 B（常驻服务 + 控制台）/ C（平台化）**未采纳**（该文 §3.2 已加状态注，留档不复用）。报告呈现也不引入服务端（见 DD-48）。
- **Canvas 渲染内容、文件上传/下载完整能力**不做。
- **iframe / Shadow DOM 降级为 P1，不排除**（DD-20）——首批验证对象是云管/K8s 系统，必须覆盖。
- **产品面向任意 B/S 系统**（DD-42）：**实现层不依赖任何具体 SUT 的事实**。openFuyao 是**首个可验证 SUT**，其专属事实（集群态键名、`sessionStorage` 语义、Canvas 图表、i18n 路径）**一律落在适配层，不进 core**。判据：**「离开 openFuyao，这条还成立吗？」**
- 不强制引入 GEPA 进化（只预留 Trace 接口）。

---

## 二、总体架构

### 2.1 逻辑架构（V1.1 重绘 · V1.2 插入 ④ 层）

> **V1.2 的唯一结构改动**：在「实现层」与「Tool Layer」之间插入 **Engine Provider 层**（DD-30，见 §5.0）。其余结构、两个 Stage 的分离、Trace 单写点，全部保持 V1.1 原样。

```
① Authoring Stage —— Agent Runtime（模型参与，产物供人使用）
   Intent / PRD / 手工用例
     │ web-test-contract（唯一的知识型 skill）
     ▼
   Frozen Contract + Frozen Strategy（首次运行后由人确认固化）
     │
     │ ★ 冻结产物（六重绑定，§3.7）—— 唯一跨阶段的通道
     ▼
② Runtime Stage —— CI Runtime（确定性代码，P0 验收唯一对象）

   ②.1 Skill Layer（契约声明层 · 7 个 SKILL.md）
        Executor → Semantic-Action / Recovery → Evidence → Judge
        Replay（--verify / --heal）
          │ UI-C 契约（声明被实现层消费）
          ▼
   ②.2 实现层 —— ③ IDWTH 判定内核    ★ 自研边界：不可替换、不可外购
        Judge（纯函数）· 论域收窄器 · runId 隔离器
        cleanup 终态判据 · 六重绑定校验 · 上游错误码吸附器
        ★ Runtime 独占调用点（§6.1，含 V1.2 新增第 ⑥ 条）
          │ EngineProvider 接口（§5.0）—— 这是唯一的可替换点
          ▼
   ②.3 ★ Engine Provider 层（V1.2 新增 · 可替换执行引擎）
        接口：observe / resolve / act / assert / screenshot / trace
        默认实现：@e2e-dev/web + @e2e-dev/decision（Apache-2.0）
        降级实现：自研 Playwright adapter（CDP 接管臂 / page-agent 臂）
          │
          ▼
   ②.4 Minimal Runtime + Tool Layer
        Minimal Runtime：Context / Artifact / Lifecycle / Timeout / ExitCode / Credential
        Tool Layer：     HTTP / BackendAdapter / Credential / Report
        JEV Adapter（可替换，Mock 优先）
     │
     │ ★ Trace 单写点（只有 Runtime 能写）
     ▼
③ Trace Store
   judge_result（权威 verdict）· evidence（分级）· decisions · usage
```

**四处结构性标注**（第 1–3 条为 V1.1 的 DD-26，第 4 条为 V1.2 的 DD-30）：

1. **两个 Stage 是分离的**，中间只有「冻结产物」一条通道。V1.0 把 Authoring 与 Runtime 画在同一个「Agent / CI Host」框里，这正是「零模型调用」无法验收的图论原因。
2. **`verdict` 的产生位置固定在 Runtime**，不经过 Skill Layer。图中 Judge 虽在 Skill 层，但**箭头穿过它的是「触发」，不是「裁定」**——裁定的写入点在 Runtime（§6.1）。
3. **Trace 是单写点**，只有 Runtime 有写权限，Skill 层只能"提供 evidence"，不能"写结论"。
4. **★ 判定内核与执行引擎之间有一条硬边界（V1.2 新增）**：边界之上（②.2 判定内核）全部自研，**不可外购、不可替换**；边界之下（②.3 Engine Provider）**可整体替换**，默认实现外购、降级实现自研。这条边界的判据是：**凡是"结论必须可复现"或"不能靠第三方行为保证"的，一律放在边界之上。**

### 2.2 运行时数据流

1. Runtime 加载 **Frozen Contract** + **Frozen Strategy**（`contract_hash` 校验，不匹配即 L2 失效）。
2. `preconditions` 逐条**可执行求值**（§3.1）；不满足 → `BLOCKED(env)`。
3. 对每个 step：**定位解析**（L1 role/label/text → L2 fingerprint → L3 JEV，§3.3）→ **Freshness 校验**（Runtime 独占）→ **动作派发**（`risk` 分流）→ **后置条件**。
4. 失败按 §8.2 分流：`reversible` 触发 Recovery（上限见 §8.3）；`irreversible` 直接终止。
5. 全程 `web-test-evidence` 采集 → **判定必需集**实时落盘（不可裁）。
6. `finally`：执行 cleanup（幂等，绑 runId）。
7. Runtime 调用 Judge：`verdict = f(evidence, assertions)` → 写 `judge_result` + `verdict_hash`。
8. 退出码按 §10 映射。

---

## 三、核心数据模型

> **本节是 V1.1 改动最大的一节。** V1.0 的 `steps: string[]` + `has_stable_locator()` 组合在实现层是空操作，必须整体重写。

### 3.1 Test Contract Schema（V1.1）

```yaml
version: "1"
test:
  id: workload.create            # kebab-case，全局唯一
  name: 创建 Deployment
  locale: zh-CN                  # V1 忽略，仅预留（Schema 必须语言无关）
  tags: [smoke]
  priority: P0

environment:
  base_url: https://example.com
  origins_allowlist:             # ★ 新增：导航守卫，越界即 nav_blocked
    - https://example.com
  action_timeout_ms: 30000       # 单个动作超时
  assertion_deadline_ms: 5000    # ★ 断言轮询截止，与动作超时分离（DD-22）

identity:
  role: operator
  credentials_ref: "cred://staging-operator"   # ★ 必需，禁止明文（DD-17）

preconditions:                   # ★ 由 string[] 改为可执行形式（DD-18）
  - kind: authenticated
  - kind: http_ok
    method: GET
    path: /api/healthz
    status: 200

fixtures:                        # ★ runId + contractId 两级模板注入（DD-04 / DD-43）
  # 键名与形式由 SUT 适配决定：K8s 下用 namespace；非 K8s 系统用租户 / 资源名前缀 + 标签集
  namespace: "ns-${runId}"                          # K8s 实例化形式（非产品要求）
  deployment_name: "idwth-${runId}-${contractId}-demo"

goal: 创建一个 Deployment 并确认其进入 Running

steps:                           # ★ 由 string[] 升级为结构体（DD-01）
  - intent: 进入工作负载
    action: click
    target: "工作负载 导航项"
    risk: reversible

  - intent: 创建 Deployment
    action: click
    target: "创建按钮"
    risk: reversible

  - intent: 填写名称
    action: fill
    target: "名称输入框"
    value: "@fixture.deployment_name"
    risk: reversible

  - intent: 提交
    action: click
    target: "确认按钮"
    risk: irreversible           # ★ 决定阈值(§7.2)与重试禁令(§8.2)
    postcondition:               # ★ irreversible 必须声明后置条件
      - kind: visible
        target: "Deployment 详情页标题"

  - intent: 验证已创建
    action: assert_only          # 不产生动作，只校验
    risk: reversible

assertions:
  dom:
    - kind: visible
      target: "deployment-name-cell"
      text_contains: "idwth-${runId}-${contractId}"   # ★ 与 fixture 同源；含完整 runId+contractId，排除残留与批次内串扰（语义见 §3.2）
  http:
    - method: POST
      path_prefix: /api/deployments   # ★ V1.0 的 path 改名，语义见 §3.2
      status: 201
      within_run: true                # ★ 只匹配本次 run 时间窗内的请求（DD-04）
  backend:
    - provider: k8s
      key: deployment.exists
      scope: run                      # ★ runId 作用域
      equals: true
  state:
    - field: deployment.status
      equals: Running
      timeout_ms: 60000

cleanup:
  - kind: backend_call
    provider: k8s
    action: delete_deployment
    scope: run                        # ★ 只删 runId 作用域内的资源

metadata:
  owner: platform-qa
```

#### 校验规则（`idwth validate`，不通过即 `exit 3`）

| # | 规则 | 违反时 | 依据 |
|---|---|---|---|
| 1 | `goal` / `assertions` / `environment.base_url` / `identity.credentials_ref` 必需 | 拒绝 | PRD §3.1 |
| 2 | 无断言 → **拒绝执行** | 拒绝 | *"the runner does not invent correctness criteria"* |
| 3 | 凭据字面量命中 `/password\|secret\|token\|api.?key\|email/i` | 拒绝 | jev-e2e 已验证 |
| 4 | **`risk: irreversible` 的 step 必须有 `postcondition`** | **拒绝**（DD-04 防线） | 无后置条件 = 无法发现"恢复到错误目标" |
| 5 | `steps[].action` 必须属于封闭动作集（`click/fill/select/scroll/wait/navigate/assert_only`） | 拒绝 | 封闭是刻意的 |
| 6 | `assertions.*.kind` 必须属于 §3.2 的 7 个封闭原语 | 拒绝 | 自由句式无法确定性解析 |
| 7 | `target` **禁止出现 CSS/XPath/JS 语法特征**（`#`, `.`, `//`, `>>`, `()`） | 拒绝 | 防退回脆弱脚本 |
| 8 | `id` 全局唯一且 kebab-case | 拒绝 | — |
| 9 | `http[].within_run: true` 时必须有 `run_started_at` 可注入点 | 拒绝 | 否则时间窗无法建立 |

> **规则 4 与规则 7 是 V1.1 新增的**，也是两条最容易被绕过的。规则 4 的理由：`Recovery False Positive`（PRD 评审 D4）当前没有任何检测机制，而**步级后置条件是唯一能在假 PASS 逃逸到最终断言之前捕获它的手段**。规则 7 的理由：一旦允许写 selector，`target` 就退化成 V1.0 抽象里那个"稳定 Locator"，整个三级定位模型失去意义。

#### `fixtures` 实例化规则（DD-04）

| 阶段 | 行为 |
|---|---|
| Run 启动 | Runtime 生成 `runId`（短 UUID，8 字符够用）；对所有 `fixtures` 值做 **`${runId}` + `${contractId}` 两级**模板替换（runId 防「上次残留」，contractId 防「批次内跨用例串扰」） |
| 传参 | 替换后的值注入 `@fixture.*` 引用；**Contract 原文（含模板）进 Trace**，替换后的实例值另存 `fixtures.resolved.json` |
| Cleanup | cleanup 步骤同样接受 `${runId}`/`${contractId}` 模板，且 `scope: run` 保证只作用于本 run 资源。**隔离的 setup/teardown 走与 backend 断言同一套 provider 抽象（`BackendAdapter`），不新增接口**（DD-44） |
| 断言 | `dom` 断言用 `text_contains: "idwth-<runId>-<contractId>"`（**含完整 runId 与 contractId**，不是裸前缀 `"idwth-"`）而非 `equals`，从语义上同时排除「残留」与「批次内跨用例」两类污染 |
| **归属判定** | **只用「名字/标签内嵌 runId + contractId」**，**禁止**用 `created_at > run_start` —— 见下方 ⛔ |

> **隔离单元是 SUT 中立的（DD-43）**：`fixture` 的**键名与实现由 SUT 适配决定**；**runId 必须内嵌在「值」里**（`idwth-${runId}-${contractId}-...`），**不依赖某个键叫 `namespace`**。K8s 下实例化为「每 run 一个 Namespace」；非 K8s 系统用「租户 / 资源名前缀 + 标签集」。
>
> **两级隔离**：① **原生 scope**（SUT 有 namespace / tenant → 直接建/拆）；② **逻辑 scope**（SUT 无原生隔离 → runId 前缀 + 标签集 + 论域收窄 + `excluded_system_objects[]`，铁律 4/9 的机制本就兜底，**不依赖 SUT 能力**）。两者都满足「残留→假 PASS」与「系统注入→假 FAIL」两条铁律。
>
> **为什么这条是假 PASS 通道**：若 `deployment_name` 硬编码为 `idwth-demo`，第二次运行会看到上一次留下的 Deployment，`backend.deployment.exists == true` 恒成立 —— 测试永远绿，且**永远不会创建成功**也不会红。

> ⛔ **`created_at > run_start` 已实测证伪，不得采用**（E02 实测，2026-09-23）
>
> 这条曾被列为 DD-04 的备选修法，**实测证明它不可靠**，且失败模式是静默的：
>
> | 对照 | `created_at − run_start` | 严格 `>` 判定 |
> |---|---|---|
> | 自然节奏（CI 常态） | **−0.019s** | ❌ 假阴性 |
> | 人为延迟 3s | +2.293s | ✅ |
>
> **根因不是时钟偏移**（实测两端偏移仅 −0.5s），而是 **K8s 时间戳只有秒级精度**：从 run 起始到创建只隔一次 HTTP 请求（<1s）时，`created_at` 落在同一秒甚至前一秒。
>
> **泛化原则**：**凡跨系统的时间戳比较，都不能作为"这是本次产生的"判据** —— 时区、精度、时钟偏移三者任一不齐就会翻转，而报告里看不出异常。判断归属要用**身份标识**（名字/标签），不用**时间先后**。
>
> 因此 `text_contains` 必须带**完整 runId 与 contractId**：裸前缀 `"idwth-"` 无法区分本次与其他 run 的残留（也无法区分同批次内其他用例），等于把刚封上的通道又开一半。

### 3.2 断言语义精确表（V1.1 新增，DD-09/DD-10）

V1.0 只说"7 个断言原语"，没说**每条怎么判**。没有这张表，Judge 无法实现。原语沿用 `jev-e2e` 的封闭集（已验证），语义口径由本文补齐。

**先划清范围**：下面 7 个原语只覆盖 `assertions.dom`。`assertions.http` / `backend` / `state` 是另外三类，各自的参数规则见本节后半（HTTP 三条补充规则、Backend provider 契约）。四类都遵循同一个「无法求值 → `BLOCKED(evidence)`」原则。

| kind | 参数 | 精确语义 | 匹配规则 | **无法求值时** |
|---|---|---|---|---|
| `visible` | `target`, `text_contains?` | 存在 **≥1** 个可见且 enabled 的匹配；给了 `text_contains` 时还要求其文本包含该子串 | `target` 子串匹配，case-insensitive，可用 `match: exact` 收紧 | count=0 → **`FAIL`**（"不存在"是可观测事实，属应用缺陷） |
| `absent` | `target`, `text_contains?` | 匹配数 **== 0**（含不可见） | 同上 | — |
| `count` | `target`, `equals`, `text_contains?` | 匹配数 == `equals` | 同上 | count>1 且未声明 `allow_multiple` → **`BLOCKED(ambiguity)`** |
| `value` | `target`, `equals` | 控件 `inputValue()` 严格等于 `equals` | 字符串精确；两侧可解析为 number 时按数值比 | 控件不存在 → **`BLOCKED(evidence)`** |
| `checked` | `target`, `equals` | `isChecked() == equals` | — | 控件不存在 → **`BLOCKED(evidence)`** |
| `url` | `equals` | `new URL(page.url()).pathname` 严格等于 | 精确（不含 query/hash） | — |
| `number` | `target`, `equals` | 从控件值解析数字，`abs(actual-equals) < 1e-9` | — | 解析失败 → **`BLOCKED(evidence)`** |

**`text_contains` 的用途只有一个，但它很关键**：把断言**绑定到本次 run、本条用例创建的资源上**。`target` 只能限定到"某个单元格"，而 `text_contains: "idwth-<runId>-<contractId>"` 才能同时排除**上一次运行残留**与**同一批次内其他用例创建**的同名资源 —— 这是 DD-04 假 PASS 通道在**断言层**的封堵（fixtures 侧已在 §3.1 用 runId + contractId 模板封堵）。

**这张表最关键的一列是最后一列。** V1.0 §4.6 的"执行完成但业务结果不一致 → FAIL"会把 `value` 断言目标不存在也判成 FAIL —— 那是把"工具找不到控件"记成"应用有缺陷"，正是 PRD 原则 3「复杂度不足即 BLOCKED，不得退化为 FAIL」要禁止的。

**判定优先级（Judge 内部顺序，必须固定）：**

```
1. 任一 required 断言无法求值        → BLOCKED(evidence)     ← 先把"不可判"摘出来
2. 任一断言目标歧义                   → BLOCKED(ambiguity)
3. 任一断言 passed == false           → FAIL
4. 全部断言求值完成且 passed          → PASS
```

> 顺序不可换：若先判 FAIL，则"1 条 FAIL + 1 条无法求值"会被记成 FAIL，掩盖"这次运行其实不可判"的事实（PRD 评审 D9 的 `BLOCKED` 细分在此落地）。

**HTTP 断言的三条补充规则：**

1. `path_prefix` 采用**前缀匹配**（比较对象是去掉 query 的 pathname），V1.0 的 `path` 语义模糊故改名。需要精确匹配时用 `path_equals`。
2. `within_run: true` 时，只匹配 `timestamp >= run_started_at` 的请求。**否则会命中上一次运行残留的同名响应**（与 DD-04 同类通道）。
3. 同一 `(method, path_prefix)` 出现多条响应时，**取状态码最匹配的那条的完整响应体**；若状态码全不匹配，按**最后一条**判定并记录 `ambiguous_response: true`。

**Backend 断言的 provider 契约：**

```ts
interface EvidenceProvider {
  id: string;                                    // 'k8s' | 'rest' | 'sqlite' | 'mock'
  query(key: string, params: { scope: 'run'|'global', runId: string, fixtures: Json }):
    Promise<{ value: Json; observed_at: string; source_ref: string }>;
}
```

`scope: run` 时 provider **必须**用 `runId` 过滤（如 `ns-<runId>`）。这条写进 provider 契约而非调用方，是为了让"忘了传 runId"在接口层就不成立（PRD 评审 Q2：把 `backend:` 抽象为可替换的 evidence provider）。

**`scope: run` 的精确语义（E02 实测后补，2026-09-23）：**

| 项 | 规定 |
|---|---|
| 过滤依据 | **只有**「名字 / 标签含 runId」。**禁止**用时间戳（`created_at > run_start` 已证伪，见 §3.1） |
| 返回内容 | 「本次 run 作用域内、由本 run 创建」的对象集 —— **不是**该命名空间的全部对象 |
| **系统自动注入对象** | **必须显式排除**，并在证据里记 `excluded_system_objects[]`（如 `kube-root-ca.crt`、`default` ServiceAccount、`kube-public` 等） |
| 计数类断言 | 语义是 **`run_created_set` 的计数**，**不是**命名空间的绝对计数 |

> ⚠️ **为什么必须排除系统注入对象**（E02 实测发现）：一个**刚创建、什么都没放**的命名空间里，`configmaps` **已经有 1 个** —— K8s 控制面自动注入的 `kube-root-ca.crt`。于是 `backend: {key: configmap.count, equals: 0}` 这类断言会在**全新的干净命名空间上直接失败**，而**这不是应用缺陷**。
>
> 这是与 DD-04 **镜像对称的第二个假结论通道**：
>
> | 通道 | 成因 | 症状 | 性质 |
> |---|---|---|---|
> | DD-04 | 上次运行的**残留**让 `exists` 恒真 | 测试永远绿 | 假 **PASS** |
> | 本节 | 系统的**自动注入**让 `count == 0` 恒假 | 测试永远红，归因指向应用 | 假 **FAIL** |
>
> 两个通道的解法是同一条：**把断言的论域从"命名空间"收窄到"本 run 创建的对象集"**。

### 3.3 定位解析模型（V1.1 新增，替代 `has_stable_locator`）

**这是 DD-01 与 DD-05 的修复点。** V1.0 的核心误判是：以为 Contract 里有"稳定 Locator"，于是用 `has_stable_locator(step)` 二分。但 Contract 里**不应该**有 selector（§3.1 校验规则 7 明确禁止），用户写的是 `target: "创建按钮"` 这样的**语义目标**。

所以真正的判据不是"有没有 locator"，而是 **"语义目标能否被无歧义地确定性解析"** —— 这是**运行期解析结果**，不是 Contract 的静态属性。

```ts
type TargetStrategy = 'role' | 'label' | 'text' | 'fingerprint' | 'model';

type ResolvedTarget = {
  elementId: number;          // 代码拥有的整数 ID，来自当前 observation，绝不来自模型
  strategy: TargetStrategy;
  matched: number;            // 匹配数；>1 即歧义
  confidence: number;         // role/label/text/fingerprint = 1.0；model = JEV confidence
  observationId: string;      // ★ 解析所依据的 snapshot id，Freshness 校验用（DD-13）
};

type ResolveResult =
  | { status: 'resolved';    target: ResolvedTarget }
  | { status: 'ambiguous';   candidates: number; elementIds: number[] }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: string };   // 模型不可用/超预算
```

**解析顺序（严格串行，禁止并行试探）：**

```
L1  语义确定性解析：role(name) → label → text
      ├─ matched == 1  → resolved(strategy = role|label|text)   【零成本】
      ├─ matched  > 1  → ambiguous                              【★立即终止，不降级】
      └─ matched == 0  → 进入 L2

L2  指纹解析：读 Frozen Strategy 的 fingerprint
      ├─ 命中唯一     → resolved(strategy = fingerprint)         【零成本】
      ├─ 命中多个      → ambiguous
      └─ 未命中        → 进入 L3

L3  模型解析（JEV）：仅在 L1/L2 都"未命中"时调用
      ├─ 合法性校验通过 且 confidence ≥ 阈值(§7.2)  → resolved(strategy = model)
      ├─ 校验失败 / 低于阈值                        → unavailable
      └─ 预算耗尽 / 端点不可达                       → unavailable
```

**四条硬规则：**

| # | 规则 | 理由 |
|---|---|---|
| 1 | **歧义 ≠ 未命中**。`matched > 1` 立即返回 `ambiguous`，**不得进入下一级** | 让模型在多个候选里挑一个，是假 PASS 的头号来源。**这条是 V1.0 最危险的漏洞（DD-05）** |
| 2 | L3 是**唯一**的模型介入点，且每个 step **最多 1 次** | 与 PRD「只在必要处调用 JEV」一致 |
| 3 | `ResolvedTarget` 是确定性路径与模型路径的**统一中间表示** | 这样 §5.1 的 `execute()` 只需一个签名（DD-11） |
| 4 | `ResolvedTarget.elementId` **由代码生成**，模型输出只能是"在给定 candidates 里选一个" | 移植 `jev-ultrafast` 的 stance：*"Unused target heads cannot cause an action."* |

**歧义的处理选项（唯一的例外）：** 若 Contract 显式声明 `target` 允许多匹配（如 `allow_multiple: true`），则 `matched > 1` 且**全部候选的 action 语义等价**（如同组按钮）时可取第一个，但**必须在 Trace 记 `resolved_by: allow_multiple`**。默认关闭。

在 CI Runtime 下，L1/L2 的命中率就是产品定义里的 L1/L2 指标（预期 >80%）。**V1.0 的写法会让这个指标恒为 0**，因为它永远走不到 L1。

### 3.4 Action 模型（V1.1 重写，DD-11）

V1.0 的 `target_index: number` 必填，对 `navigate` / `done` 无意义；更要命的是**确定性路径产出的 Playwright Locator 在模型里没有位置**。改为 discriminated union：

```ts
type Action =
  | { kind: 'click';    target: ResolvedTarget; risk: Risk }
  | { kind: 'fill';     target: ResolvedTarget; value: string; risk: Risk }
  | { kind: 'select';   target: ResolvedTarget; value: string; risk: Risk }
  | { kind: 'scroll';   deltaY: number; target?: ResolvedTarget; risk: Risk }
  | { kind: 'wait';     ms: number; risk: Risk }
  | { kind: 'navigate'; url: string; risk: Risk }          // 必须过 origins_allowlist
  | { kind: 'assert_only'; risk: Risk }                     // 不产生动作
  | { kind: 'done'; risk: Risk }
```

**统一的关键在 `ResolvedTarget`**：无论来自 L1/L2 还是 L3，形态一致，`execute()` 一份实现即可。这是 V1.0 §5.1「`execute(action: Action)` 只接受合法 Action」那句话真正成立的前提。

**JEV → Action 的转换（必须经过校验层，不可直连）：**

| JEV 输出 | Action |
|---|---|
| `operation = CLICK` | `{ kind: 'click', target: { elementId, strategy: 'model', confidence, ... }, risk }` |
| `operation = TYPE_TEXT` | `{ kind: 'fill', target, value }` |
| `operation = DONE` | `{ kind: 'done' }` —— **但 done 不产生 verdict**（JEV ≠ PASS） |
| `operation = BLOCKED` | `{ status: 'unavailable' }` → `BLOCKED(decision)` |

`risk` **不由模型给出**，由 Contract 的 step 声明给出。模型无权降低一个动作的风险等级。

### 3.5 ActionResult（V1.1 新增，DD-12）

V1.0 写了 `execute(): Promise<ActionResult>` 却未定义它 —— 而它正是 execution issue 与三态判定的输入。

```ts
type ActionResult =
  | { status: 'ok';            action: Action; observationIdAfter: string; elapsed_ms: number }
  | { status: 'not_found';     reason: string }
  | { status: 'ambiguous';     candidates: number; elementIds: number[] }
  | { status: 'disabled';      reason: string }
  | { status: 'covered';       by: string }        // 遮挡校验（elementFromPoint）
  | { status: 'timeout';       deadline_ms: number }
  | { status: 'nav_blocked';   url: string }
  | { status: 'error';         message: string; dispatched: boolean };  // ★ dispatched 关键
```

**`dispatched` 字段是 V1.1 的关键新增**：它回答"这个 mutation 是否已经发出去了"。这正是 `jev-e2e` 那条 *"A dispatched mutation can have an unknown outcome. Never repeat it automatically."* 的**可执行形式** —— 没有这个字段，"不得重试"就无法在代码里表达。

**ActionResult → 三态的唯一映射表（消除歧义，DD-10）：**

| status | 归属 issue | 触发 Recovery？ | 终态 |
|---|---|---|---|
| `not_found` | execution | ✅（`risk: reversible` 时） | 视 recovery 结果 |
| `ambiguous` | execution | ❌ **禁止** | `BLOCKED(ambiguity)` |
| `disabled` | execution | ✅ | 视 recovery 结果 |
| `covered` | execution | ✅ | 视 recovery 结果 |
| `timeout` | execution | ❌ **禁止** | `BLOCKED(decision)`（`dispatched == true`）|
| `nav_blocked` | — | ❌ | `BLOCKED(env)` |
| `error` | execution | ✅（仅 `reversible` 且 `dispatched == false`） | 视 recovery 结果 |
| （`risk: irreversible` 的任一失败） | execution | ❌ **禁止** | `BLOCKED(decision)` |

> 最后一行是 DD-03 的修复。**注意 `ambiguous` 与 `timeout` 也不许触发 Recovery** —— 前者因为歧义不该靠猜，后者因为动作已派发、重试即重复副作用。

### 3.6 Trace 模型（V1.1 修订，DD-14）

```jsonc
{
  "schema": "idwth.trace.v1",
  "run_id": "a7f3c9e1",
  "test_id": "workload.create",
  "bindings": {                         // ★ 六重绑定，复用问题即 BLOCKED(drift)，见 §3.7
    "contract_hash": "sha256:...",
    "strategy_hash": "sha256:...",
    "judge_impl_hash": "sha256:...",
    "runner_version": "1.0.0",
    "env_fingerprint": "sha256:..."
  },
  "started_at": "ISO8601",
  "finished_at": "ISO8601",
  "execution_policy": "deterministic" | "semantic" | "mixed",
  "runtime": "ci" | "agent",            // ★ 区分本次是否参与 P0 指标

  "judge_result": {                    // ★★ 唯一权威裁决源，仅 Runtime 可写
    "verdict": "PASS" | "FAIL" | "BLOCKED",
    "blocked_reason": "env" | "ambiguity" | "evidence" | "decision" | "recovery" | "postcondition" | "drift" | null,
    "assertions": [ /* 逐条：kind/target/expected/observed/result/evidence_ref */ ],
    "evaluated_at": "ISO8601",
    "judge_version": "1.0"
  },
  "verdict_hash": "sha256(judge_result ‖ evidence_digest ‖ bindings.judge_impl_hash)",

  "verdict_snapshot": "PASS",           // ★ 仅派生显示用；不一致即 ERROR(integrity)

  "episodes": [
    {
      "step_index": 3,
      "intent": "提交",
      "risk": "irreversible",
      "path": "deterministic" | "semantic" | "recovery",
      "resolve": { "strategy": "role", "matched": 1, "confidence": 1.0, "observation_id": "obs-18" },
      "actions": [ /* Action */ ],
      "action_result": { /* ActionResult */ },
      "postcondition": { "assertions": [ /* ... */ ] },
      "jev_calls": [
        { "request_id": "uuid", "request": { /* 原文 */ }, "response": { /* 原文 */ },
          "validated": true, "latency_ms": 269, "cost_usd": 0.0008 }
      ],
      "recovery": {
        "triggered": true,
        "attempt": 1,
        "original_action": { /* ... */ },
        "recovered_action": { /* ... */ },
        "reason": "...",
        "confidence": 0.72,
        "postcondition_verified": true,     // ★ 必须为 true 才允许继续
        "artifacts": { "before": "artifact://...", "after": "artifact://..." }
      },
      "evidence_refs": ["evidence://dom-1", "evidence://http-4"]
    }
  ],

  "evidence": {
    "judgement_set": [ /* ★ 判定必需集：全部参与断言的证据，不可裁 */ ],
    "archived": [ /* 可归档集：截图、完整 DOM、console 全文 */ ]
  },

  "cleanup": { "executed": true, "scope": "run", "issues": [] },

  "metrics": {
    "total_steps": 10,
    "semantic_resolved_steps": 1,        // ★ SIR 分子
    "deterministic_action_count": 8,
    "recovery_count": 1,
    "total_latency_ms": 4520
  }
}
```

#### 权威源规则（DD-14 / 决议 2）

| 规则 | 内容 |
|---|---|
| **单一权威** | `judge_result.verdict` 是唯一裁决结果。顶层 `verdict` 语义已删除，改名 `verdict_snapshot` 并标注"派生显示用" |
| **写入权** | 只有 Runtime 能写 `judge_result`；Skill 层与编排者只有读权限 |
| **可校验** | `verdict_hash = sha256(judge_result ‖ evidence_digest ‖ bindings.judge_impl_hash)`；`idwth judge recompute <run_id>` 重算后不一致 → `ERROR(integrity)`。**绑定含判定器哈希**，因此"判定逻辑改了"与"证据坏了"可区分（§3.7） |
| **纯函数** | `verdict = f(evidence.judgement_set, contract.assertions)`，无隐藏状态、无时间依赖、无随机 |

#### Evidence 分级规则（★ 本设计的核心规则之一）

| 集合 | 内容 | 是否可裁 | 回放时缺失 |
|---|---|---|---|
| **`judgement_set`（判定必需集）** | 参与断言的证据（可见文本片段、HTTP 状态与响应体、backend 查询结果、控件属性值）+ 全部 issues + 全部 recovery 记录 + JEV 请求/响应原文 | **永不截断** | `replay --verify` 直接 `BLOCKED(drift)` |
| **`archived`（可归档集）** | 截图、完整 DOM、console 全文 | 可按字节上限裁剪/外移 | 降级为警告，不影响判定 |

> **一句话规则：按「是否参与判定」分级，不按「体积」分级。**
> V1.0 写"超限时归档并拒绝截断"之所以自相矛盾，是因为它按体积分级却没定义哪些能裁。判定必需集若被裁掉，**决议 2 的"离线重算"就不成立**——这是可验证性的物理下限。
>
> 字节上限的具体参数（B 级遗留，§14）：建议 `judgement_set` 无硬上限（**估计**单 case 约 <2MB —— **待实测**，见 PRD §十二 **D07**），`archived` 默认 50MB/run、超出即外移到 `runs/<id>/archive/` 并写指针，**不做丢失式截断**。

### 3.7 Frozen Strategy artifact 与「六重绑定」（V1.1 新增，DD-24；**V1.2 由五重扩至六重，DD-31**）

V1.0 把 `Freeze the Strategy` 当口号写，没有产物。产物定义如下：

```jsonc
// runs/<runId>/strategy.json —— 固化后提升到项目级 .idwth/strategies/<contract_id>.json
{
  "schema": "idwth.strategy.v1",
  "contract_id": "workload.create",
  "version": 3,                        // 每次固化 +1，保留历史可回退
  "created_at": "ISO8601",
  "created_by": "human-confirm",       // ★ 只接受人确认，不接受运行时自改

  "bindings": {                        // ★★ 六重绑定：任一不符 → 拒绝复用 / BLOCKED(drift)
    "contract_hash":    "sha256:...",  // ① Contract 文件
    "strategy_hash":    "sha256:...",  // ② 本文件自身（防手工改）
    "judge_impl_hash": "sha256:...",  // ③ 判定实现源码（见下方说明）
    "runner_version":   "1.0.0",       // ④ Runtime 与工具层版本
    "env_fingerprint":  "sha256:...",  // ⑤ 浏览器版本 + 目标域 + 时区/locale
    "engine_provider_version": "e2e@0.18.0"  // ⑥ ★ V1.2 新增：执行引擎版本（DD-31）
  },

  "flows": [
    {
      "step_index": 0,
      "intent": "进入工作负载",
      "strategy": "role",
      "fingerprint": {
        "role": "link",
        "name": "工作负载",
        "dom_path_hash": "sha1:...",
        "sibling_ordinal": 3,
        "anchor_text": ["集群管理"]
      },
      "confirmed_runs": 7,
      "last_success_run_id": "a7f3c9e1"
    }
  ]
}
```

#### 六重绑定的作用点（三处，各不相同）

| 校验时机 | 不一致时 | 理由 |
|---|---|---|
| **run 启动**（加载 strategy） | 禁用 L2，降级为 L1 → L3，并告警 | 指纹是**用旧约定采集的**，拿来匹配新页面 = 静默错配 |
| **写回指纹前**（`--freeze`） | 拒绝固化，提示 diff | 防止把"另一份 Contract 的成功经验"写进来 |
| **`replay --verify` 前** | **直接 `BLOCKED(drift)`，不开始回放** | 复用旧轨迹解释新环境，结论没有意义 |

> **第 ⑥ 项（`engine_provider_version`）的作用点与前五项相同**（三处都校验），但它的**触发频率最高**：上游每一次 minor 升级都会 re-key 全部缓存条目，效果等价于一次大规模 drift，而**上游默认是 heal、不报错**。不绑这一项，就等于在绑定面上留了一个静默错配通道（见下方「为什么必须有 ⑥」）。

#### 为什么必须有 ③ `judge_impl_hash`（V1.1 新增，易漏但关键）

前面所有绑定都在保护**执行**（Contract / 指纹 / 环境），唯独漏了**判定本身**。而 `verdict = f(evidence, assertions)` 这个纯函数的可信性，前提是 **`f` 没变**。

若 Judge 实现改了（修了一个断言口径的 bug、加了 `text_contains` 支持），那么：

- **旧 run 归档的 verdict 与新 run 的 verdict 不可比** —— 趋势图会显示"质量突然变化"，而实际是判定器变了
- **A8（归档 evidence 离线重算）会失败** —— 用新 `f` 重算旧 evidence，结果自然不同，但这是**预期行为**，不是缺陷；没有 `judge_impl_hash` 就区分不出"判定器变了"和"证据坏了"

所以：`judge_impl_hash` 参与 `verdict_hash` 的组成（§3.6），且**判定器变更必须走版本号 + 迁移说明**，不能静默发布。

> 这一条来自本项目的 JevHarness 源码评审：它的 `task_contract` 把「评估器源码哈希」列为绑定项之一。我们把它移植到测试语境，对应物就是 `judge_impl_hash`。

#### 为什么必须有 ⑥ `engine_provider_version`（V1.2 新增，DD-31）

③ 保护的是**判定**，⑥ 保护的是**执行**——但它保护的不是我们自己的代码，而是**我们依赖的执行引擎**。

上游 `tester-army/e2e` 明确声明 *"cache entries are re-keyed on version upgrades"*：**升级即全部缓存条目失效**。而它**默认 heal**（陈旧记录悄悄交给 agent 重跑），所以这个"全部失效"**不会报错**，只会让 CI 每跑一次多付一轮模型调用。

| 若不绑 ⑥ | 会发生什么 |
|---|---|
| 引擎升级后缓存已失效 | 上游默认 heal → 静默重跑 → **报告写 PASS，但走的是全新模型路径**，与上一条记录不可比 |
| 引擎能力变化（如定位规则调整） | 指纹按旧引擎语义采集，新引擎按新语义匹配 → **静默错配**（比不命中更危险） |
| CI 成本 | 每 run 多付模型调用，而 `SIR ≈ 0` 这条 P0 指标的分子被悄悄抬高，**趋势图归因错误** |

**与 ④ `runner_version` 的分工**：④ 绑我们自己的 Runtime 与 Tool Layer，⑥ 绑外购引擎。两者分开记账，才能回答"是这次升级我们自己改坏的，还是上游改坏的"。

> 这条与本项目既有判断同源：**"文档没写"≠"不存在"，"没报错"≠"没问题"**。上游不报错不代表缓存还新鲜，只代表它选择了不报。

**其余四条规则：**

| # | 规则 | 理由 |
|---|---|---|
| 1 | `bindings` 任一项变更 → **整份 strategy 按上表三处作用点分别处置**（不再用单一 `contract_hash`） | 单一哈希只保护 Contract，漏了判定器与环境 |
| 2 | **写回只能由显式动作触发**（CLI `--freeze`，**唯一入口**；V1 无控制台，DD-47），且需 diff 预览 + 人确认 | 模型不得写回（与决议 2 同源：禁止静默修改判定相关产物） |
| 3 | 只有 **`confirmed_runs >= 2` 且连续 2 次成功**的 L3 结果才可入 strategy | 防一次偶然成功污染指纹 |
| 4 | 指纹解析命中多个 → `ambiguous`，**不取第一个** | 与 §3.3 规则 1 一致 |

> **规则 3 是 V1.1 新增的**：产品定义里"学习飞轮"的前提是"L3 成功后写回"，但**一次成功可能只是运气**（页面刚好只有一个匹配）。若立即固化，错误指纹会被长期复用，比不固化更糟。连续 2 次的成本远低于污染代价。

**与「学习飞轮」的边界（值得写进产品定义）**：飞轮的**优化动作必须离线**——L3 成功 → 写回候选 → **人确认** → 新版本 strategy → 进 CI。**飞轮优化的是"允许模型决定的那部分"（选哪个控件），它永不产出 verdict。** 因此「模型成本随跑次数单调递减到零」与「判定权 Runtime 独占」可以同时成立，不冲突。

---

## 四、Skill 详细设计

### 4.0 Skill 的物理形态（V1.1 新增，DD-02）

V1.0 用伪代码描述 `web-test-executor`，但从未回答一个前置问题：**Skill 究竟是什么？** 若是给模型读的 Markdown，伪代码无法"执行"；若是代码，那它就不是 skill。这个模糊直接导致双 Runtime 无处落地。

**Skill = 可校验的契约声明，不是可执行的程序。** 分三层：

| 层 | 形态 | 谁维护 | 能否被模型改写 | 例子 |
|---|---|---|---|---|
| **① 声明层** | `SKILL.md`（YAML frontmatter + 输入输出 + constraints + 降级路径） | 人 + 模型 | ✅ | 「semantic-recovery 的输入须含失败后 fresh snapshot」 |
| **② 实现层** | 确定性代码，位于 `runtime/` 与 `tools/` | 工程师 | ❌ | `resolveTarget()`、`evaluateAssertion()`、`judge()` |
| **③ 调用层** | Runtime 独占的 4 个调用点（§6.1） | Runtime | ❌ | Judge 调用、verdict 写入、Freshness 校验、cleanup |

**由此，7 个 skill 按「何时运行」分成两类 —— 这是双 Runtime 的具体落法：**

| 类别 | Skill | 运行阶段 | 编排者 | CI Runtime 是否调用 |
|---|---|---|---|---|
| **知识型（Authoring only）** | `web-test-contract` | **Authoring time（1 次）** | Agent（模型） | ❌ **不调用**——产物是 Frozen Contract |
| **契约型（Runtime）** | `web-test-executor` | Runtime（每次） | **确定性代码** | ✅ 由 `runtime/executor.ts` 实现 |
| | `web-semantic-action` | Runtime（按需） | 确定性代码 + JEV Adapter | ✅ |
| | `web-semantic-recovery` | Runtime（按需） | 确定性代码 + JEV Adapter | ✅ |
| | `web-test-evidence` | Runtime（全程） | 确定性代码 | ✅ |
| | `web-test-judge` | Runtime（终局 1 次） | **Runtime 独占调用** | ✅ |
| | `web-test-replay` | Runtime（回放） | 确定性代码 | ✅ |

**一句话总结**：**Authoring 阶段用模型做"深度推理"（写 Contract、探明页面结构），Runtime 阶段用冻结产物做"确定性执行"** —— 这正是 PRD 想表达的 JevHarness 模式，V1.0 只是没把它落到模块划分上。

**Agent Runtime 下的行为**：模型可以读 SKILL.md 并"编排"，但**它不能产生 `judge_result`**（那是 Runtime 独占），因此它的产物 `runtime: "agent"`，不参与 §9 的任何 P0 指标。

> **⏸ 视觉通道 = BACKLOG · 条件触发 · 非 V1（2026-10-10）**
>
> **本节 7 个 skill 的切分轴不变 —— V1 就是 7 个。** 视觉的模态（DOM / 视觉）是**每个 skill 内部的参数**，不是新的 skill；因此它**不改变本文的 skill 划分**。
>
> **启动条件**：**外部明确提供多模态大模型能力，且主动要求启用视觉断言**（与 `PRD.md` §十二 Backlog · BL-1 逐字一致）。**在该条件成立前：需求不纳入、设计不做、原计划 P4.5 时点已撤销。**
>
> **立项后才议的两件**（现均**不进 V1**）：① 2 个视觉专有的人机接口 skill（`web-visual-baseline` / `web-visual-diff-triage`）；② 3 个**必须落代码**的 Runtime 模块（`VisualOracle` / `VisualStabilityCalibrator` / `SensitiveRegionMasker`）。
>
> **素材指针**：设计素材（含铁律 11/12/13、噪声下界 `ε_base`、`replayable: false` 建模）见 [`visual-dom-matrix.md`](visual-dom-matrix.md)；其验收编号已由 `A10–A14` 改为 **`VB-01…VB-05`**（**2026-10-10 改号，因与执行引擎层 A10/A11 撞号**），**不占 A 序列**。原文**原样保留不删除**，以备立项时复用（含仍未实测的 H02/H03/H04）。

### 4.1 web-test-contract

| 项 | 内容 |
|---|---|
| **触发** | 用户给 PRD / 接口文档 / 手工用例 / 口头描述 |
| **输入** | 需求材料 + 可选环境信息 |
| **输出** | 合法 Test Contract（通过 `idwth validate`） |
| **约束** | 必须澄清缺失的 `base_url`/`goal`/`assertions`；**禁止猜测补全**；`target` 必须是语义描述（禁 selector）；`risk: irreversible` 的 step 必须给出 `postcondition` |
| **降级路径** | 无本 skill 时：人直接写 Contract YAML，`idwth validate` 校验 |
| **阶段** | **Authoring only**（DD-02） |

### 4.2 web-test-executor

**职责**：加载 Frozen Contract + Frozen Strategy，执行 §8.1 状态机。
**实现位置**：`runtime/executor.ts`（确定性代码）—— **不是**给模型执行的伪代码。

```ts
// runtime/executor.ts —— 确定性实现，模型无权改写
async function executeCase(contract: Contract, strategy: Strategy, rt: Runtime): Promise<void> {
  for (const [i, step] of contract.steps.entries()) {
    // ① 定位解析（L1 → L2 → L3），歧义立即终止（§3.3）
    const r = await resolveTarget(step.target, step.action, strategy, rt);
    if (r.status === 'ambiguous')    return rt.terminate('BLOCKED', 'ambiguity');
    if (r.status !== 'resolved')     return rt.terminate('BLOCKED', 'decision');

    // ② Freshness 校验（Runtime 独占，§6.1）
    if (!await rt.verifyFreshness(r.target.observationId)) {
      const r2 = await resolveTarget(/* 重解析一次 */);
      if (r2.status !== 'resolved' || !await rt.verifyFreshness(r2.target.observationId))
        return rt.terminate('BLOCKED', 'drift');
    }

    // ③ 派发
    const ar = await rt.tools.browser.execute(toAction(step, r.target));

    // ④ 失败分流（§8.2）：irreversible / ambiguous / timeout 一律不 recovery
    if (ar.status !== 'ok') {
      if (!mayRecover(step.risk, ar)) return rt.terminate('BLOCKED', 'decision');
      if (!await recoverStep(step, ar, rt))  return rt.terminate('BLOCKED', 'recovery');
      // ★ recovery 后必须校验步级后置条件，否则 BLOCKED(config)
      if (!caseHasPostcondition(step)) return rt.terminate('BLOCKED', 'postcondition');
    }
    await rt.checkPostcondition(step, rt);   // 声明了就必须过
  }
}
```

**关键约束**：
- 确定性路径（strategy ∈ `role/label/text/fingerprint`）**禁止调用 JEV**（编译期可保证：`executeCase` 不持有 JEV provider 引用）。
- 每次 Mutation 前强制 Freshness 校验——**由 Runtime 强制，不由 step 自愿**。
- 所有 `terminate` 走 Runtime，不允许 skill 直接产出 verdict。

### 4.3 web-semantic-action

| 项 | 内容 |
|---|---|
| **输入** | `observation`（fresh）+ `step.intent` + `action_space`（候选元素，仅 index/role/label） |
| **输出** | `ResolvedTarget{strategy:'model'}` 或 `unavailable` |
| **JEV 调用** | state 仅含公开可见信息（DOM 精简 + ARIA + 可见文本 + URL）；`questions` 用 `choice` 类型，`criteria` 由 action_space 动态生成 |
| **约束** | 禁止输出 selector/xpath/js/坐标/cdp；**观测阶段剔除 `password`/`file`/`hidden`**（`snapshot.js:10`），凭据永不进模型上下文 |
| **阈值** | 按 `risk` 分级（§7.2），且**校验优先于阈值**（§7.1） |
| **合并建议** | 与 `web-semantic-recovery` 同构度极高，可合并为 1 个 skill / 2 个 mode（PRD 评审 §二附注）。本文保留 7 个以对齐 PRD，但实现层共用 `resolveTarget` |

### 4.4 web-semantic-recovery

| 项 | 内容 |
|---|---|
| **触发** | 仅 `ActionResult` 属于 §3.5 映射表中"✅ 可触发"的那些，**且** `step.risk == reversible` |
| **输入** | `original_intent` + `failed_action` + `ActionResult` + **失败后的 fresh observation** |
| **输出** | `recovered_action`（`ResolvedTarget`）+ `recovery_reason` + `confidence` |
| **硬规则** | ① 不得修改 `goal` 或任何 `assertion`（违反即终止 + 审计，对应验收 A4）② 必须记录 before/after snapshot ③ 必须写 `episode.recovery` ④ **恢复后必须校验步级后置条件**，未声明则 `BLOCKED(postcondition)` |
| **上限** | **1 次/step、3 次/case**（§8.3） |
| **次数理由** | 无上限的 recovery 链会掩盖定位层的系统性失效 —— 每个 step 都"恢复成功"的 case，实际上已经不是在跑原用例了 |

### 4.5 web-test-evidence

| 项 | 内容 |
|---|---|
| **采集（V1）** | DOM 精简快照（关键节点 + ARIA + 可见文本）、HTTP 请求/响应（含 `within_run` 时间窗标记）、backend 查询结果、ActionResult |
| **采集（P1）** | 截图、Console 日志 |
| **输出** | Evidence 数组，带 `artifact://` 引用；**按 §3.6 分为 `judgement_set` / `archived`** |
| **硬约束** | 不判定结果；**判定必需集实时落盘、永不裁剪**；截图默认遮罩 `input,textarea,[contenteditable],[data-private]` + fixture 明文 |

### 4.6 web-test-judge

| 项 | 内容 |
|---|---|
| **输入** | `contract.assertions` + `evidence.judgement_set`（**只读**） |
| **输出** | `judge_result`（由 **Runtime 写入**，非 skill 写入） |
| **判定顺序** | §3.2 的四步优先级（不可换序） |
| **纯度要求** | `verdict = f(evidence, assertions)`；无隐藏状态、无时间依赖、无随机；可用归档 evidence **离线重算** |
| **验收** | 构造"JEV 认为完成但 HTTP=500" → 必须 **FAIL**（A1）<br>构造"JEV 认为完成但无任何证据" → 必须 **BLOCKED**（A2） |
| **权限** | 见 §6.1 —— 调用权与写入权归 Runtime，**不可由编排者取得** |

`constraints` 必须包含（PRD 评审 §1.2 建议的三条）：

```yaml
constraints:
  - judge_result_is_immutable_by_orchestrator
  - verdict_must_be_recomputable_from_archived_evidence
  - judge_invocation_is_runtime_owned_not_orchestrator_owned
```

### 4.7 web-test-replay

**V1.1 拆为两个显式模式**（DD-07 / 决议 3）：

| 模式 | 模型调用 | 数据来源 | 遇漂移时 | 产物入 CI | 依据 |
|---|---|---|---|---|---|
| `replay --verify`（**默认**） | **0** | Trace 里记录的 `resolved_target` + `actions` | **报 `DRIFT` 并终止**，`BLOCKED(drift)` | ✅ | *"State drift is reported instead of silently adapting the trace."* |
| `replay --heal`（**显式开启**） | 按需 | 同上，允许 L3 重新解析 | 生成 recovery 审计 + **候选**新版 strategy（待人确认） | ❌ | 修复属 Authoring 行为，不属回放 |

**逐步比对内容**（四项，任一不一致即 DRIFT）：`resolve.strategy` / `resolve.matched` / `action_result.status` / `assertion results`。

**输出**：原 `judge_result` vs 回放 `judge_result` 的对比 + 漂移点定位。

> **为什么必须拆**：若 replay 默认会"修复"，两次回放结果不可比（趋势失效）、漂移信号被吞（环境变了却无人知）、且"零模型调用可回放"这条 P0 验收**无法测**。`--heal` 保留价值，但它的产物是**建议**，不是门禁输入。

---

### 4.8 七个 SKILL.md 完整规格（V1.1 新增）

#### 4.8.1 统一骨架

所有 `SKILL.md` 必须含同一套 frontmatter。其中 **`stage` 与 `callable_by` 是双 Runtime 能否落地的关键字段** —— 前者决定 CI Runtime **加不加载**它，后者决定**谁能调用**它（§6.1 调用层归属）：

```yaml
---
name: web-test-executor          # 与目录名一致，kebab-case
version: "1"
layer: declaration               # 恒为 declaration（§4.0）
stage: runtime                   # authoring | runtime   ★ CI Runtime 只加载 runtime
callable_by: runtime             # agent | runtime       ★ §6.1 调用层归属
model_may_rewrite: false         # 恒 false；仅 web-test-contract 为 true
inputs:  schemas/in.json
outputs: schemas/out.json
constraints: [...]               # 硬规则；由实现层代码强制
fallback: <降级路径>
verified_by: [A3, A5]            # 对应的对抗性验收编号（PRD §7.1）
---
```

正文必须含六节：**① 何时使用 ② 输入/输出（内联 JSON Schema）③ constraints ④ 降级路径 ⑤ 行为性验收（给定输入 → 期望输出）⑥ 禁止事项**。

> ⚠️ **约束必须在代码里**：*"a prompt instruction alone is not enforcement"*。
> `constraints` 是**给人读的声明**，真正的强制点是**实现层（§4.0 ②）与 Runtime 独占调用点（§6.1）**。写在 prompt 里的一句话**不算**强制。

#### 4.8.2 `web-test-contract`（唯一的知识型 skill）

```yaml
name: web-test-contract
stage: authoring
callable_by: agent               # ★ CI Runtime 不加载
model_may_rewrite: true          # ★ 全项目唯一允许模型改写的 skill
inputs:  { requirement_doc | manual_case | free_text, env?: { base_url } }
outputs: frozen_contract         # 必过 `idwth validate` 九条校验
constraints:
  - target 禁 selector / xpath / 坐标，只允许语义描述
  - risk: irreversible 的 step 必须给 postcondition
  - 缺失 base_url / goal / assertions 必须澄清，禁止猜测补全
fallback: 人直接写 Contract YAML + `idwth validate`
verified_by: [A4]
```

**输入**

```jsonc
{ "source": { "kind": "manual_case", "content": "登录后进入工作负载页，创建名为 demo 的 Deployment，副本数 2，确认状态为运行中" },
  "env": { "base_url": "https://<host>:31616", "locale": "zh-CN" } }
```

**输出**：一份完整 Contract YAML（§3.1）。**不得**输出任何定位选择器。

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 缺字段 | 用例未提 `base_url` 且环境未给 | **澄清提问**，不产出 Contract |
| 不可逆步无后置条件 | 含"提交"动作但无 `postcondition` | 报错，要求补 `postcondition` |
| 诱导写 selector | 提示词里塞 `#btn-submit` | 忽略并改写为语义 target，记摩擦日志 |

#### 4.8.3 `web-test-executor`

```yaml
name: web-test-executor
stage: runtime
callable_by: runtime
inputs:  { contract: frozen_contract, strategy: frozen_strategy }
outputs: { status: completed | terminated, termination?: { verdict, reason } }
constraints:
  - 歧义（匹配数 >1）立即 BLOCKED(ambiguity)，禁止取第一个
  - mutation 派发前必须过 Freshness 校验
  - 已派发的 mutation 不得自动重试
fallback: ——（核心路径，无降级）
verified_by: [A3, A5]
```

**实现位置**：`runtime/executor.ts`（确定性代码）—— **不是**给模型执行的伪代码（§4.2）。

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 歧义短路 | 页面有 2 个"创建"按钮 | `BLOCKED(ambiguity)`，**零派发** |
| 超时后不重试 | mutation 派发后网络超时 | `BLOCKED`，**不重复提交**（A5） |
| 陈旧 observation | 派发前页面已变（`observationId` 失效） | 重解析一次；仍失效 → `BLOCKED(drift)` |

#### 4.8.4 `web-semantic-action`

```yaml
name: web-semantic-action
stage: runtime
callable_by: runtime
inputs:  { observation: Observation, goal: string, candidates: ChoiceQuestion[] }
outputs: { operation: ActionOp, target_index: number, confidence: number }
constraints:
  - ★ 输出仅 operation + target_index；禁 Selector / XPath / JS / 坐标
  - target_index 越界或 operation 不在白名单 → 零派发
  - confidence < 分级阈值（reversible 0.60 / irreversible 0.90）→ BLOCKED(decision)
  - 成功后指纹写回 strategy（学习飞轮），但不得改写断言
fallback: 纯 L1/L2（SIR = 0）—— 确定性路径不依赖本 skill
verified_by: [A2, A7]
```

**输入（候选问题集结形态）**

```jsonc
{ "observation_id": "obs-18",
  "goal": "执行【创建部署】",
  "questions": [ { "id": "q1", "prompt": "请选择目标控件",
      "choices": [ { "index": 0, "role": "button", "name": "创建", "region": "toolbar" },
                   { "index": 1, "role": "button", "name": "创建", "region": "table-row" },
                   { "index": 2, "role": "link",   "name": "新建", "region": "dropdown" } ] } ] }
```

**输出**：`{ "answers": { "q1": { "choice": 1, "confidence": 0.72 } } }` → 由实现层转成 `{ operation: "click", target_index: 1 }`。

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 非法 operation | 模型返回 `eval_js` / `xpath://...` | **零派发** + 记录拒绝原因 |
| 越界 index | `target_index: 99` | **零派发** + `BLOCKED(decision)` |
| 低置信度 | 不可逆动作 confidence 0.70 | `BLOCKED(decision)`，不猜 |
| 离线 | JEV 端点不可达 | 确定性路径仍全跑（A7） |

#### 4.8.5 `web-semantic-recovery`

```yaml
name: web-semantic-recovery
stage: runtime
callable_by: runtime
inputs:  { failed_action, action_result, fresh_observation, step_postcondition }
outputs: { recovery_action: ActionOp, target_index: number, confidence: number }
constraints:
  - ★ 可改 Recovery 策略；绝不可改 Goal / Assertion
  - 仅 reversible 步可恢复；irreversible 失败 → 直接 BLOCKED(decision)
  - 上限：1/step、3/case
  - 恢复后必须校验步级后置条件，否则 BLOCKED(config)
fallback: 直接 BLOCKED(recovery)，不可配置为 FAIL
verified_by: [A4, A9]
```

> 与 `web-semantic-action` 接口高度同构（都是 `fresh snapshot → operation + target_index`），差别只在多一个 `failed_action` 上下文 + mode 级约束。**建议合并为 1 个 skill 两个 mode（7 → 6）**，见 `prd-review.md` §二 附注；保留独立的价值仅在 `constraints` 不同，而后者可用 mode 级约束表达。**待评审**。

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 试图改断言 | 恢复上下文里注入 `new_assertion` | **拒绝 + 审计 + 终止**（A4） |
| 恢复落到错误目标但最终断言恰好通过 | 步级后置条件缺失 | **必须被步级后置条件捕获**（A9） |
| 超上限 | 同一步连续失败 2 次 | 第 2 次不恢复，`BLOCKED(recovery)` |

#### 4.8.6 `web-test-evidence`

```yaml
name: web-test-evidence
stage: runtime
callable_by: runtime
inputs:  { execution_events, observation, network, backend_results, screenshots }
outputs: { judgement_set: EvidenceRef[], archived: EvidenceRef[] }
constraints:
  - ★ 判定必需集实时落盘、永不截断；归档集超限外移并写指针
  - credential 永不进 judgement_set / evidence / snapshot
  - 截图遮罩 = 输入控件 + 文本级已知密钥明文
  - 去重按 sha256(evidence 内容) 内容寻址
fallback: ——
verified_by: [A2, A8]
```

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 凭据泄漏 | 开 Playwright trace + 网络日志走一次登录 | grep trace 文件**不含明文密码** |
| 文本级明文 | 页面渲染 kubeconfig 片段 / Bearer token | 截图**被遮**（非输入控件也要遮） |
| 超限 | `archived` > 50MB | 外移 + 写指针，**不丢失式截断** |

#### 4.8.7 `web-test-judge`

```yaml
name: web-test-judge
stage: runtime
callable_by: runtime             # ★ 调用权独占（§6.1 ①）
inputs:  { judgement_set: EvidenceRef[], assertions: AssertionSpec[] }
outputs: { verdict: PASS | FAIL | BLOCKED, blocked_reason?, judgement_hash }
constraints:
  - ★ 纯函数：f(evidence, assertions)，同输入必同输出
  - ★ verdict 写入权归 Runtime；任何中介不得改写
  - 判定优先级固定：无法求值 → 歧义 → FAIL → PASS（不可换序）
  - 只有确定性断言能产生 FAIL；模型信号恒为 candidate
fallback: ——
verified_by: [A1, A2, A8]
```

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 自述 vs 事实 | JEV 自述完成 + HTTP 500 | **FAIL**（A1） |
| 无证据 | 自述完成但 judgement_set 为空 | **BLOCKED**，非 PASS（A2） |
| 离线重算 | 归档 evidence 重跑判定 | 与在线 verdict **逐字节一致**（A8） |
| 顺序不可换 | 1 条 FAIL + 1 条无法求值 | **BLOCKED(evidence)**，不是 FAIL |

#### 4.8.8 `web-test-replay`

```yaml
name: web-test-replay
stage: runtime
callable_by: runtime
inputs:  { frozen_artifacts, mode: verify | heal }
outputs: { result: MATCH | DRIFT, drift_points?: DriftPoint[], candidate_strategy? }
constraints:
  - ★ --verify 默认、零模型、漂移即终止 BLOCKED(drift)
  - ★ --heal 产物为建议，不得入 CI 门禁
  - 禁止静默适配状态漂移
fallback: 无回放时全量重跑
verified_by: [A6, A7]
```

**逐步比对四项**（任一不一致即 DRIFT）：`resolve.strategy` / `resolve.matched` / `action_result.status` / `assertion results`。

| 行为性验收 | 给定 | 期望 |
|---|---|---|
| 页面改版 | 按钮位置变化后 `--verify` | 报 DRIFT 并**终止**（A6） |
| 零模型 | 回放全过程统计模型调用 | **= 0** |
| heal 产物 | `--heal` 生成的新版 strategy | 标记为候选，**CI 拒绝使用** |

#### 4.8.9 frontmatter 总表

| Skill | `stage` | `callable_by` | `model_may_rewrite` | §6.1 独占点 |
|---|---|---|---|---|
| `web-test-contract` | authoring | agent | ✅ | —— |
| `web-test-executor` | runtime | runtime | ❌ | —— |
| `web-semantic-action` | runtime | runtime | ❌ | —— |
| `web-semantic-recovery` | runtime | runtime | ❌ | —— |
| `web-test-evidence` | runtime | runtime | ❌ | ③ Freshness 校验 |
| `web-test-judge` | runtime | runtime | ❌ | ① 调用权 · ② 写入权 |
| `web-test-replay` | runtime | runtime | ❌ | —— |
| （Runtime 自身） | —— | —— | —— | ④ cleanup 执行 |

---

## 五、Tool Layer 设计

### 5.0 Engine Provider 层（V1.2 新增，DD-30）

> **本层是 V1.2 唯一的架构新增。** 它是「实现层（判定内核）」与「具体浏览器引擎」之间的接口边界：**边界之上全部自研且不可替换；边界之下可整体替换。**

```ts
// runtime/engine-provider/types.ts —— 只定义接口，不含实现
interface EngineProvider {
  readonly id: string;                 // 如 'e2e' | 'playwright' | 'page-agent'
  readonly version: string;            // ★ 参与六重绑定第 ⑥ 项（§3.7）

  observe(): Promise<Observation>;                                        // §5.1 Observation 结构
  resolve(t: SemanticTarget, mode: ResolveMode): Promise<ResolveResult>;   // L1/L2（零模型）
  act(a: Action): Promise<ActionResult>;                                   // §3.4 合法 Action
  checkAssertion(s: AssertionSpec): Promise<AssertionResult>;
  screenshot(o: { mask: string[] }): Promise<ArtifactRef>;
  trace(): Promise<ArtifactRef>;                                           // 证据与回放载体
  dispose(): Promise<void>;                                                // ★ 只断连，不杀用户浏览器
}
```

**两个实现（并存，由配置选择）**

| 实现 | 构成 | 定位 | 必须自研的部分 |
|---|---|---|---|
| **默认**（`id: 'e2e'`） | `@e2e-dev/web`（引擎）+ `@e2e-dev/decision`（决策 transport） | 省工程量：定位器引擎 / 遮罩 / 会话加密 / trace / 报告渲染全部现成，且经 20+ 硬场景回归 | `attach.ts`（CDP 接管）· `background-tab.ts`（后台标签页不抢焦点）—— **上游不提供这两件** |
| **降级**（`id: 'playwright'`） | 自研 Playwright adapter（§5.5 的 11 个脚本） | 保底：上游变更 / 许可变动 / 内网限制时切换，**判定内核零改动** | 全部 |

> **决策记录（2026-10-08，待决问题 1）**：默认实现**不在 M1 锁定**。M1 先自研骨架，同时**并行跑通 e2e 适配器做对照**，M3 用实测数据（定位命中率 / 误命中率 / 成本 / flaky 率）决定默认值指向哪一侧。理由：M1 就锁死默认实现，会把「能不能跑通」和「用谁的实现」两件事绑在一起。

**四条硬约束（写进实现，不靠文档）**

| # | 约束 | 理由 |
|---|---|---|
| 1 | **Engine 的失败不得直接触发其自动 heal** | 上游默认"失败即交给 agent 兜底"，会绕过 §8.2 的 `risk` 分流与 §8.3 的 recovery 上限（DD-36） |
| 2 | **上游的 `ASSERTION_INCONCLUSIVE` 必经错误码吸附器** | 上游归 `failed` 类、exit 1 → 必须转为 `BLOCKED(decision)`，否则是**假 FAIL 通道**（DD-32，§8.2） |
| 3 | **候选集生成与编号由我们掌控，不委托引擎** | 铁律 12：模型只输出候选集内 index。引擎可以提供元素表，**编号与越界判定在我们这边** |
| 4 | **`version` 必须回传并参与六重绑定** | 上游升级即 re-key 全部缓存（DD-31，§3.7 ⑥） |

> **为什么用「接口 + 双实现」而不是直接依赖**：`EngineProvider` 与既有的 `BackendAdapter`（§5.3）、`JevDecisionProvider`（§7.1）**是同一手法**——可替换性本来就是本设计既有的语言，不是新引入的复杂度。**代价是一个接口文件，收益是把"换供应商"从架构级改动降为配置级改动。**

### 5.1 Browser Tool（Playwright Adapter）

> **V1.2 关系说明**：本接口是 §5.0 `EngineProvider` 的**前身**。V1.2 起 `BrowserTool` 降为**降级实现（`id: 'playwright'`）的内部接口**；面向 Runtime 的对外接口是 `EngineProvider`（多出 `id` / `version` / `trace()`，并把 `navigate()` 移入 `Action` 的 navigate 分支，以便统一过 `origins_allowlist` 校验）。

```ts
interface BrowserTool {
  observe(): Promise<Observation>;                     // 结构化页面状态 + fingerprint + observationId
  resolve(target: SemanticTarget, mode: ResolveMode): Promise<ResolveResult>;  // L1/L2（零模型）
  execute(action: Action): Promise<ActionResult>;      // 只接受 §3.4 的合法 Action
  checkAssertion(a: AssertionSpec): Promise<AssertionResult>;
  screenshot(opts: { mask: string[] }): Promise<ArtifactRef>;
  navigate(url: string): Promise<ActionResult>;        // 必须过 origins_allowlist
  close(): Promise<void>;                              // ★ 只断连，不杀用户浏览器
}
```

**三处与 V1.0 的差异：**

| 差异 | 理由 |
|---|---|
| **新增 `resolve()`** | V1.0 没有定位接口，定位逻辑无处安放（DD-01） |
| `execute()` 接收 `ResolvedTarget` 而非 raw index | 统一两条路径（DD-11） |
| `close()` 明确"只断连" | **P0 实测 3/3 轮复核**：`browser.close()` 不会关闭用户浏览器 |

**Observation 结构**（供 L3 使用）：

```jsonc
{
  "observation_id": "obs-18",           // ★ Freshness 校验锚点
  "fingerprint": "sha1:...",            // 状态指纹，回放漂移检测
  "url": "...", "title": "...",
  "elements": [
    { "id": 0, "role": "button", "name": "新建", "text": "新建",
      "visible": true, "enabled": true, "guard": "sha1(sibling-structure)" }
  ],
  "text_excerpt": "..."                 // 剔除 password/file/hidden 后的可见文本
}
```

`elements[].id` **由代码生成**，不来自模型（移植 `jev-ultrafast` 的 stance）。`guard` 用于执行前结构性守卫校验（`fresh()`）。

### 5.2 HTTP Tool

被动捕获（Playwright 网络监听，带**时间窗过滤**）+ 主动请求（用于 backend 断言与 precondition）。

### 5.3 Backend Adapter

```ts
interface BackendAdapter {
  id: string;
  query(key: string, params: { scope: 'run' | 'global'; runId: string; fixtures: Json }): Promise<Json>;
}
```

V1 提供 `rest` / `sqlite` / `mock`；`k8s` 作为 **reference adapter 放 `examples/`，不进 core**（PRD 评审 Q2）——契约侧已抽象为 `EvidenceProvider`，加 adapter 不改 schema。

### 5.4 Credential（V1.1 新增，DD-17）

| 规则 | 内容 |
|---|---|
| 存储 | 只有 `credentials_ref`（形如 `cred://staging-operator`）进 Contract |
| 解析时机 | **Runtime 在 run 启动时解析一次**，驻留内存 |
| 可见范围 | 仅 `fill`/`select` 的 `value` 注入点；**永不进入** Observation、Evidence、Trace、日志、截图 |
| 遮罩 | 截图默认遮罩上述选择器；`credentials_ref` 指向的所有明文域追加遮罩 |
| 生命周期 | run 结束即清除；`--debug` 模式下也不落盘（只打印 `cred://` 引用） |

---

### 5.5 Playwright 脚本层（V1.1 新增；**V1.2 归属调整**）

> **V1.2 归属调整**：本节的 11 个脚本归属 **`engine-provider/playwright/`（降级实现）**，不再是唯一实现。其中 **`attach.ts` 与 `background-tab.ts` 两种实现都要用** —— 即使默认实现走 `@e2e-dev/web`，CDP 接管与后台标签页也**必须由我们提供**（上游不提供这两件，见 §5.0）。

本节把 §5.1 的接口落成**可执行的脚本清单**。所有脚本位于 `engine-provider/playwright/`，属**实现层**（§4.0 ②）—— **模型无权改写**。

#### 5.5.1 脚本清单

| 脚本 | 职责 | 依据 | 关键约束 |
|---|---|---|---|
| `attach.ts` | `connectOverCDP` 接管既有 Chrome | §5.1 | `close()` **只断连**，不杀用户浏览器（P0 实测 3/3 复核） |
| `background-tab.ts` | 后台标签页执行，**不抢焦点** | §5.1 | `Target.createTarget(background:true)` + `setFocusEmulationEnabled` |
| `isolation.ts` | 每 case `newContext()` 强隔离 | §5.1 | **必须支持 `addInitScript` 引导 SPA 上下文键**（**键名由 SUT 适配提供**；E01 实测：openFuyao 的集群态只在 `sessionStorage`） |
| `locate-l1.ts` | L1 确定性定位（ARIA role / label / text） | §3.3 | **歧义即抛错**，禁 `.first()`、禁 `nth()` 兜底 |
| `fingerprint.ts` | 指纹计算 | §3.3 / §3.7 | `dom_path_hash + sibling_ordinal + anchor_text` |
| `locate-l2.ts` | L2 指纹复用（零模型） | §3.3 | **误命中比不命中更危险**（静默错配） |
| `freshness.ts` | `observationId` 比对 | §3.3 / §6.1③ | **作用域内比对**（只看目标节点子树），否则动态校验行致每次 mutation 都判 stale |
| `assert-primitives.ts` | 7 个断言原语实现 | §3.2 | `count > 1` 且未声明 `allow_multiple` → `BLOCKED(ambiguity)` |
| `screenshot.ts` | 截图 + 两层遮罩 | §9.4 | 输入控件 **+ 文本级已知密钥明文** |
| `trace.ts` | Playwright trace 开关与脱敏 | §9.4 可观测 | trace 文件不得含明文凭据（D12 实测项） |
| `scripts/run-case.mjs` | 端到端骨架（`idwth run` 的示例实现） | §10 | 退出码硬契约，`finally` 必执行 cleanup |

#### 5.5.2 `attach.ts` —— CDP 接管（主干执行臂）

```ts
// tools/browser/attach.ts
import { chromium, type Browser } from 'playwright';

export async function attach(endpoint = 'http://127.0.0.1:9222'): Promise<Browser> {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  // 复用既有 context，从而复用登录态（用户已登录的 Chrome）
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('no existing context: 需要带 --remote-debugging-port 启动的 Chrome');
  return browser;
}

/** ★ 只断连：不关闭用户的浏览器 */
export async function detach(browser: Browser) {
  await browser.close();           // connectOverCDP 下等价于 disconnect
}
```

> **依据**：P0 闸门实测确认 `browser.close()` 在 `connectOverCDP` 下**不会**关闭用户浏览器（CDP 端点存活）。

#### 5.5.3 `background-tab.ts` —— 后台执行，不抢焦点

```ts
// tools/browser/background-tab.ts
export async function openBackgroundTab(page: Page, url: string) {
  const cdp = await page.context().newCDPSession(page);
  // ① 后台创建 target：不激活用户正在看的标签页
  const { targetId } = await cdp.send('Target.createTarget', { url, background: true });
  // ② 关闭焦点模拟：让后台页仍正常渲染与计时
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return { targetId, sessionId, close: () => cdp.send('Target.closeTarget', { targetId }) };
}
```

#### 5.5.4 `isolation.ts` —— 强隔离 + 上下文引导

⚠️ **E01 实测约束（openFuyao 实例）**：该平台把**集群身份只存在 `sessionStorage`**（`sessionStorage.getItem("cluster")`），路由不含该段，且**选集群逻辑只在登录时跑一次**。因此 `newContext()` 的强隔离会**丢掉上下文** → 页面异常或空白。**通用化（DD-42）**：本机制的职责是「**SPA 上下文需在 context 创建时引导**」，`storageSeed` 的**具体键由 SUT 适配提供**（openFuyao 是 `{ cluster: 'host' }`），**core 不假定任何键名**。

```ts
// tools/browser/isolation.ts
export async function newIsolatedContext(browser: Browser, opts: {
  storageSeed?: Record<string, string>;   // 如 { cluster: 'host' }
  cookies?: Cookie[];
  locale?: string;
}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // ★ 引导：在页面任何脚本执行前注入上下文键
  if (opts.storageSeed) {
    await ctx.addInitScript((seed) => {
      for (const [k, v] of Object.entries(seed)) sessionStorage.setItem(k, v as string);
    }, opts.storageSeed);
  }
  if (opts.cookies) await ctx.addCookies(opts.cookies);
  return ctx;
}
```

> **若 `addInitScript` 不足以让 SUT 恢复上下文，则"每 case 强隔离"方案需重新设计**（退化为弱隔离或单 context 顺序执行）。这是 **D17** 的验证内容。

#### 5.5.5 `locate-l1.ts` —— 歧义即抛错（不得兜底）

```ts
// tools/browser/locate-l1.ts
export async function locateL1(page: Page, t: SemanticTarget): Promise<ResolveResult> {
  const cand = page.getByRole(t.role as any, { name: t.name, exact: t.match === 'exact' });
  const n = await cand.count();

  if (n === 0) return { status: 'miss' };                 // → 交 L2
  if (n > 1)   return { status: 'ambiguous', count: n };  // ★ 交 Runtime 立即 BLOCKED(ambiguity)
  // ★ 绝不用 cand.first() 兜底 —— 那正是"歧义 ≠ 用例外"被违反的地方
  return { status: 'resolved', locator: cand, strategy: 'L1' };
}
```

#### 5.5.6 `freshness.ts` —— 作用域内比对

```ts
// tools/browser/freshness.ts   ★ Runtime 独占（§6.1 ③）
export async function verifyFreshness(page: Page, target: ResolvedTarget, scope: string): Promise<boolean> {
  // 只看目标节点子树，避免"每敲一个字符都插入校验提示行"导致每次 mutation 都判 stale
  const current = await page.locator(scope).getAttribute('data-observation-id');
  return current === target.observationId;
}
```

#### 5.5.7 `assert-primitives.ts` —— 7 原语到 Playwright 的映射

| kind | Playwright 实现 | 无法求值时 |
|---|---|---|
| `visible` | `locator.isVisible()` + `textContent` 含 `text_contains` | count=0 → **FAIL** |
| `absent` | `locator.count() === 0` | —— |
| `count` | `locator.count() === equals` | count>1 未声明 `allow_multiple` → **BLOCKED(ambiguity)** |
| `value` | `locator.inputValue() === equals` | 控件不存在 → **BLOCKED(evidence)** |
| `checked` | `locator.isChecked() === equals` | 同上 |
| `url` | `new URL(page.url()).pathname === equals` | —— |
| `number` | 解析后 `abs(a-b) < 1e-9` | 解析失败 → **BLOCKED(evidence)** |

> `text_contains` **必须带完整 runId 与 contractId**（如 `idwth-20260923-a1b2c3-workload-create`），裸前缀 `"idwth-"` 无法区分本次与其他 run 的残留，也无法区分同批次内其他用例（E02 实测）。

#### 5.5.8 `screenshot.ts` —— 两层遮罩

```ts
// tools/browser/screenshot.ts
export async function capture(page: Page, secrets: string[]): Promise<ArtifactRef> {
  // 第 1 层：Playwright 原生 mask（输入控件）
  // 第 2 层：★ 文本级遮罩 —— 页面上"渲染"出来的凭据明文（kubeconfig 片段 / Bearer token）
  //        它们不是 input，原生 mask 遮不住
  await page.evaluate((vals) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    while (walk.nextNode()) {
      const t = walk.currentNode as Text;
      if (vals.some((v) => v.length > 3 && t.data.includes(v))) hits.push(t);
    }
    for (const t of hits) {
      const s = document.createElement('span');
      s.style.cssText = 'background:#000;color:#000';   // 视觉遮罩
      t.replaceWith(s);
      s.setAttribute('data-redacted', '1');             // 供断言与审计识别
    }
  }, secrets);

  return page.screenshot({ mask: [page.locator('input, textarea, [contenteditable], [data-private]')] });
}
```

#### 5.5.9 `scripts/run-case.mjs` —— 端到端骨架与退出码

```js
// scripts/run-case.mjs —— 最小可跑闭环（M1 出口判据：无模型也能跑通一条用例）
import { attach, detach } from '../tools/browser/attach.ts';
import { newIsolatedContext } from '../tools/browser/isolation.ts';
import { locateL1 } from '../tools/browser/locate-l1.ts';
import { judge } from '../runtime/judge.ts';

const EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, CONFIG: 3, ENV: 4, CANCELLED: 130 };
let verdict = 'BLOCKED';

const browser = await attach(process.env.CDP_ENDPOINT);
try {
  const ctx = await newIsolatedContext(browser, { storageSeed: { cluster: 'host' } });
  // …执行 steps（歧义 → BLOCKED(ambiguity)；mutation 超时 → 不重试）…
  // …采集 judgement_set …
} catch (e) {
  process.exitCode = EXIT.ENV;
} finally {
  await cleanup(process.env.IDWTH_RUN_ID);   // ★ 绑 runId，幂等可重入，轮询至终态 404
  await detach(browser);                     // ★ 只断连
}
verdict = judge(judgementSet, assertions);   // ★ 纯函数，Runtime 独占调用
process.exitCode = EXIT[verdict];
```

> **`finally` 里两件事不可省**：cleanup（跨 run 数据污染防线）与 detach（不杀用户浏览器）。
> **cleanup 的「完成」判据是轮询至 404**，不是 `DELETE` 的响应码 —— E02 实测 200 只代表已受理，资源仍在 `Terminating` **6.2s**。

---

## 六、Minimal Runtime 设计

### 6.1 职责与「四个独占」（V1.1 修订，DD-06/DD-13/DD-19；**V1.2 新增 ⑤⑥ 两项条件性独占**）

**只负责**：`run_id` 生成（**一次批量执行 = 一个 `run_id`**，即一次"测试计划"；用例维度由 `contractId` 承担，**不引入 `suite_id`**，DD-46） · Execution Context · Artifact 引用 · 超时与生命周期 · 退出码 · Credential 解析 · **冻结产物加载与 hash 校验**。

**四个独占调用点** —— 编排者只能"触发"，不能"决定是否触发"，更不能改写结果：

| # | 独占项 | 交给编排者会怎样 | 验收 |
|---|---|---|---|
| ① | **Judge 调用权** | "这步不跑 Judge" = **PASS by omission**（漏判即假通过） | A2 |
| ② | **verdict 写入权** | 转述时改写 verdict，裁定不可审计 | A8 |
| ③ | **Freshness 校验权** | "自愿校验" = 可绕过，在陈旧 observation 上派发 mutation | 集成测试 |
| ④ | **cleanup 执行权** | abort 时 cleanup 不执行，跨 run 数据污染 | 集成测试 |

**加分项**：**Credential 解析权**（只在 Runtime 内存，天然不可被 skill 读取）。

**⑤ 噪声闸门校验权（视觉通道启用后由 4 项扩为 5 项，铁律 13）**：仅在 Contract 声明 `kind: visual` 时生效。⚠️ **2026-10-10：视觉通道已移入 Backlog（条件触发、不进 V1 —— 见 `PRD.md` §十二），本项随之一并缓议，V1 仍为 4 个独占调用点。**若允许 step 自带阈值，"标定"即可被绕过 → 阈值退化回经验值 → flaky 回归。强制点：**Runtime 在加载 Contract 时校验 `threshold > k · epsilon_base` 且 `env_fingerprint_hash` 与当前环境匹配**。详见 [`visual-dom-matrix.md`](visual-dom-matrix.md) §4.3、§9.1。

**⑥ 恢复触发权（V1.2 新增，DD-36；仅当 Engine 为外购实现时生效）**：上游默认「失败即交给 agent 兜底」（heal）—— 这是**引擎自己的重试策略**。若允许它生效，§8.2 的 `risk` 分流（`irreversible` 失败直接终止、不 recovery）与 §8.3 的 recovery 上限（1/step、3/case）**同时失效**，而且**Runtime 甚至看不到这个决定**（绕过它们的是引擎，不是编排者）。
强制点：**Runtime 在创建 Engine 实例时显式关闭其自动恢复**，Engine 的失败**只作为 `ActionResult` 返回**；是否恢复由 Runtime 依 §8.2 / §8.3 判定。
验收：集成测试 —— 构造一个上游会自行 heal 的失败（如陈旧缓存），断言**没有发生任何自动重跑**，且终态按 §8.2 映射。

**不负责**：测试策略 · JEV 决策 · 业务判断 · 用例知识。

### 6.2 Artifact 存储

- 引用格式：`artifact://{run_id}/{type}/{name}`，本地落盘 `./.idwth/runs/{run_id}/`。
- **解析规则**：`artifact://` 相对 `.idwth/` 根解析；跨机器使用需 `idwth report --export` 打包（含 `judgement_set`，保证归档 evidence 可离线重算）。
- 目录权限 `0700`；`judgement_set` 与 `archived` 分目录（§3.6）。

#### 引擎缓存（V1.2 新增，DD-35）—— 随版本交付的组件

上游执行引擎的动作缓存（`@e2e-dev/*` 的记录产物）是**离线可跑能力的一部分**，必须与版本一同交付：

| 项 | 要求 |
|---|---|
| 存放 | `.idwth/engine-cache/`，按 `engine_provider_version` 分目录（与 §3.7 ⑥ 同源） |
| **交付** | **内网 / 离线部署时，缓存产物随包交付**（先在联网环境录一轮，产物随版本带入内网） |
| 校验 | 加载时比对 `engine_provider_version`；不匹配 → **失效并告警**，不得沿用 |
| 理由 | 没有它，内网首次运行必然 `BLOCKED(decision)` → **A7b 成为常态，产品在目标环境跑不起来** |

> **为什么这是交付物而不是缓存**：普通缓存丢了只是慢一点；这一份丢了，产品在**离线目标环境（内网 K8s）里根本跑不起来**。它决定的是"能不能用"，不是"快不快"。

---

## 七、JEV Adapter 设计

### 7.1 接口

```ts
interface JevDecisionProvider {
  decide(input: { state: object; questions: Record<string, ChoiceQuestion> }):
    Promise<{ answers: Record<string, ChoiceAnswer>; usage?: Usage; latency_ms: number }>;
}
```

### 7.2 置信度阈值：按可逆性分级（V1.1 修订，DD-15）

| 动作类别 | 阈值 | 依据 |
|---|---|---|
| **可回退**（点击导航、滚动、展开、聚焦） | **≥ 0.60** | `JevTest` 的 `assessmentConfidence` 默认即 0.6。阈值过高会让 BLOCKED 泛滥且无价值 |
| **不可逆**（提交、删除、创建、确认） | **≥ 0.90** | 错了有真实损害 |

> V1.0 的单一 0.85 的问题是双向的：对可回退动作过于保守（BLOCKED 泛滥，`BLOCKED < 15%` 的指标守不住），对不可逆动作仍不够严。

### 7.3 合法性校验优先于阈值（V1.1 新增，必须移植）

**阈值只在合法性校验通过之后才生效。** 校验项（`jev-ultrafast` `validate_choice`，`model.py:30-45`）：

```
① choice ∈ criteria keys
② probability keys == criteria keys
③ |Σp − 1| < 1e-6
④ p[choice] == max(p)
⑤ 只校验被 operation 选中的那个 head；未使用的 target 头不得产生副作用
```

任一不满足 → **`Invalid TypeSafe response; no action executed.`** —— **零动作派发**，`BLOCKED(decision)`。

### 7.4 可替换性与安全

| 项 | 要求 |
|---|---|
| 默认实现 | TypeSafe JEV |
| Mock Provider | **必须支持**（CI 无密钥环境；验收 A7 用它验证"断开 JEV 后确定性路径全跑通"） |
| 预算 | `max_requests` / `max_cost` 每 run，**在发请求前按最坏情况预留额度**（jev-e2e 的做法） |
| Schema | 输出严格校验，任何非法字段直接拒绝 |
| 隔离 | **禁止将 JEV 原始输出直接传给 `BrowserTool.execute`**，必须经 §3.4 的 Action 转换层 |
| 观测 | 剔除 `password`/`file`/`hidden`；`recent_actions` 只留最近 10 条 |

---

## 八、执行策略与错误处理

### 8.1 执行状态机（V1.1 重写）

```
Precheck
  ├─ preconditions 逐条可执行求值
  └─ 不满足 → BLOCKED(env)  [exit 2]

For each step
  ├─ resolveTarget(step.target, step.action)          【L1 → L2 → L3】
  │    ├─ ambiguous  → BLOCKED(ambiguity)  ■ 终止     【★ 不降级】
  │    ├─ not_found  → BLOCKED(decision)   ■ 终止
  │    └─ resolved   → 继续
  ├─ Runtime.verifyFreshness(observationId)           【Runtime 独占】
  │    └─ 不一致 → 重解析一次 → 仍不一致 → BLOCKED(drift) ■ 终止
  ├─ dispatch(action)                                 【Action 校验层】
  │    ├─ ok → checkPostcondition（若声明）→ 不过即 BLOCKED(postcondition)
  │    └─ 失败 → 按 §3.5 映射表分流
  │         ├─ risk == irreversible  → BLOCKED(decision)  ■ 终止，不 recovery、不重试
  │         ├─ status ∈ {ambiguous, timeout, nav_blocked} → ■ 终止，不 recovery
  │         └─ risk == reversible     → Recovery（上限 1/step、3/case）
  │              ├─ 成功 → 必须校验 postcondition（未声明 → BLOCKED(postcondition)）
  │              └─ 失败 → BLOCKED(recovery)  ■ 终止
  └─ 下一 step

finally
  └─ cleanup（幂等，scope = run；失败只记 issue 并打标，不改 verdict）
       ├─ 发起删除（★ 只发一次，不自动重试）
       └─ 轮询只读 GET 至终态（404）── 超时上限 → BLOCKED(cleanup)    ← E02 实测补，见 §3.1 与下表

Judge
  └─ Runtime 调用：verdict = f(evidence.judgement_set, contract.assertions)   【纯函数】
     └─ 写 judge_result + verdict_hash  →  校验（recompute 不一致即 ERROR(integrity)）

Write Trace（单写点）
Exit Code
```

#### cleanup 的「完成」定义（E02 实测补，2026-09-23）

实测：`DELETE namespace` 返回 **200 只代表"已受理"**，资源仍在 `Terminating` **6.2 秒**才真正消失。

```
t=0.0s  DELETE → 200
t=0.0s  GET → 200  phase=Terminating
t=2.1s  GET → 200  phase=Terminating
t=4.1s  GET → 200  phase=Terminating
t=6.2s  GET → 404  ← 真正释放
```

| 规则 | 内容 | 若不这样做 |
|---|---|---|
| 1 | **「完成」的判据是终态（GET → 404），不是 DELETE 的响应码** | 资源仍在释放时就把 run 标为已清理 → 下次运行的基线比对看到"残留" → 误判 |
| 2 | 发起删除 → **轮询至终态**；轮询间隔 2s、超时上限 60s | 无上限时 CI 可能永久挂住 |
| 3 | 超时 → `BLOCKED(cleanup)`，**不静默放过** | 静默放过 = 残留悄悄累积，最后表现为别处的假 PASS |
| 4 | **`DELETE` 只发一次**；之后只做**只读** `GET` 轮询 | ⚠️ 与「已派发 mutation 不得自动重试」不冲突 —— 轮询是只读的，**不是重试删除**。这个区分必须写进实现注释，否则会被误读成违规 |
| 5 | 重复删除返回 **404 属正常**（幂等），不记为失败 | 把它记成错误 → cleanup 不可安全重跑 |

> **对 CI 耗时的影响**：单次清理 ~6s。若串行清理 N 个 case，**总耗时会被 cleanup 主导**。cleanup 分两档：**case 级**只删 case 内创建的业务对象（快）；**run 级**（= 一次批量执行 = 一个 `run_id`）统一拆隔离空间一次（慢但只付一次）。⚠️ **口径统一（DD-46）**：「suite 级」自此**统一称 run 级** —— 一次批量执行即一个 `run_id`，**不引入 `suite_id` 层级**。
>
> **默认无条件清理（DD-45）**：cleanup 在 `finally` 中执行，**FAIL / BLOCKED / abort 一律照做**。若需保留现场供人工排查，用 **`--keep-on-failure`**（**P1 显式开关**，不进 V1 默认路径）—— 因为对象带 `runId + contractId` 双标识，**保留的旧对象不会污染后续 run 的断言**（否则会退化成铁律 4 的残留假 PASS 通道）。

### 8.2 错误分类与终态映射（V1.1 收紧，DD-16）

| 错误类型 | 处理 | 终态 |
|---|---|---|
| 环境不可用 / 权限不足 / precondition 不满足 | 终止 | `BLOCKED(env)` |
| 导航越界（`origins_allowlist`） | 终止 | `BLOCKED(env)` |
| 定位全策略未命中 | 终止 | `BLOCKED(decision)` |
| **定位歧义** | 终止 | `BLOCKED(ambiguity)` |
| **动作已派发后超时** | 终止，**禁止重试** | `BLOCKED(decision)` |
| **`risk: irreversible` 的任一失败** | 终止，**禁止 recovery** | `BLOCKED(decision)` |
| Recovery 失败 | 终止 | `BLOCKED(recovery)` |
| Recovery 后无 postcondition 声明 | 终止 | `BLOCKED(postcondition)` |
| 断言无法求值 | 终止 | `BLOCKED(evidence)` |
| **上游引擎报 `ASSERTION_INCONCLUSIVE`**（模型判不出来 / 证据不足） | 经**错误码吸附器**转换，**不沿用上游的 `failed` class** | `BLOCKED(decision)` |
| 断言求值为否 | 继续跑完全部断言 | `FAIL` |
| Replay 检测到漂移 / 六重绑定任一不符 | 终止 | `BLOCKED(drift)` |
| Runtime 内部异常 | 终止 | `ERROR`（`exit 4`） |
| Contract/schema 校验失败 | 启动前拒绝 | `CONFIG_ERROR`（`exit 3`） |
| **用户 / CI 主动取消**（SIGINT、超总预算） | 立即终止 | **`CANCELLED`（`exit 130`），不是 BLOCKED** |

> **`FAIL` 只由一行产生**：确定性断言求值为否且**全部断言均求值成功**。其余任何路径都不得产生 FAIL。这是「只有确定性断言能产生 FAIL」在代码层的唯一落点。

> **★ 为什么必须做「错误码吸附」（V1.2 新增，DD-32）**
>
> 上游 `tester-army/e2e` 的源码（`packages/decision/src/executor.ts:382`）把"模型判不出来"记为**测试失败**：
> `/** Insufficient evidence must never become an assertion pass. */ function inconclusive(...) { return { status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' } }` —— 该错误码 class = `test`、**exit 1**。
>
> **它的动机是对的**（怕"没证据"被当成 PASS），但代价是**假 FAIL**：断言区在**视口外**、页面**仍在加载**、纯 **Canvas** 页面上做断言 —— 这些情况下报告会写"测试未通过"，而实际是**我们判不了**。
>
> **处置**：独立错误码**保留**（有诊断价值，进入报告附加字段 `upstream_error_code`），但 **class 改 `BLOCKED(decision)`，不计入 bug 检出**。主状态永远用 IDWTH 的三态 —— 避免非工程读者读到 `ASSERTION_INCONCLUSIVE` 就以为发现了 bug。对应验收：**A10**（§12）。

> **为什么 `CANCELLED` 必须独立于 `BLOCKED`**（V1.1 新增）：`BLOCKED` 的语义是"**无法取得可靠证据**"，它对使用者意味着"去看系统或工具"；而取消意味着"**本次运行不构成一次测试**"，看谁都没用。若把取消并入 `BLOCKED`，会出现两个后果：① `BLOCKED 占比 < 15%` 这个指标会因人为取消而虚高，失去诊断价值 ② 报告上会写着"无法判定"，而真实原因是"有人按了 Ctrl-C"。**取消是运行状态，不是判定结果**——它甚至不应进入 verdict 聚合。

### 8.3 Recovery 上限（V1.1 新增）

| 层 | 上限 | 超限终态 |
|---|---|---|
| 单 step | 1 次 | `BLOCKED(recovery)` |
| 单 case | 3 次 | `BLOCKED(recovery)` |

**理由**：无上限的 recovery 链会掩盖定位层的系统性失效。一个每步都"恢复成功"的 case，实际上已经不是在跑原用例了 —— 它的 PASS 没有意义。

---

## 九、非功能设计落地

### 9.1 稳定性（V1.1 重写，DD-08 / 决议 5）

V1.0 只写"支持 `--repeat 10`，输出一致性报告"，未定义判定口径。而 PRD 的「单 case 一致性 ≥ 95%」**不组合**：门禁是 suite 级的，`suite 绿灯率 ≈ p^n`。

| 单 case 一致性 p | n = 20 | n = 50 | n = 100 |
|---|---|---|---|
| **0.95（PRD 现值）** | 35.8% | **7.7%** | 0.6% |
| 0.99 | 81.8% | 60.5% | 36.6% |
| 0.999 | 98.0% | 95.1% | 90.5% |

**改写为两条：**

| 条款 | 要求 | 性质 |
|---|---|---|
| **Flaky 计数** | `idwth run --repeat N`（N ≥ 10）出现结论不一致 → **该 case 判为 flaky 缺陷**，阻断合并 | **硬门禁（二值）** |
| **Suite 绿灯率** | 目标 ≥ 95% | 观测趋势，**不作门禁阈值** |

> 反推：要让 50 case 的 suite 有 95% 绿灯率，单 case 必须达 **99.9%**（`0.95^(1/50)`）。所以"95% 单 case"与"可进 CI 门禁"是互斥的两句话，必须二选一 —— 选前者则门禁不可用。

### 9.2 成本（V1.1 明确口径，DD-21）

```
SIR (per case) = 发生 model 定位的 step 数 / 总 step 数
```

| 项 | 目标 | 说明 |
|---|---|---|
| SIR（稳定期） | **≤ 0.15** | 对应 PRD「≤ 15%」。**分母是 step 不是 case** —— 否则一个 10 步 case 只调 1 次模型，SIR 会显示为 1.0，指标失去意义 |
| 确定性路径模型调用 | **≡ 0** | 编译期保证：`executeCase` 不持有 provider 引用 |
| 每 run 成本 | 有上限告警（`--max-cost`） | 请求前按最坏情况预留额度 |
| 阈值告警 | SIR 上升即告警 | 防"飞轮失效"被忽视 |

### 9.3 延迟（V1.1 三口径分列，DD-22）

V1.0 的"决策延迟 2s"与"断言超时 60s"容易读成矛盾，其实量的是不同东西：

| 口径 | 定义 | 目标 |
|---|---|---|
| **决策延迟** | `resolveTarget` 的 L3 段 + JEV 往返 | 中位数 ≤ 2s（确定性路径 ≤ 2s 含 L1/L2，基本为 0） |
| **动作超时** | 单个动作的 `action_timeout_ms` | 默认 30000ms |
| **断言 deadline** | `checkAssertion` 100ms 轮询至 `assertion_deadline_ms` | 默认 5000ms；`state` 类可单独设 60000ms |

三者**互不包含**：决策延迟不含页面加载与断言等待。

### 9.4 安全与可观测

| 类别 | 要求 |
|---|---|
| **安全** | Action 校验层 + Trace 强制审计 + Credential 仅引用（§5.4）+ 截图遮罩 + 观测剔除 `password/file/hidden` + artifact 目录 `0700` |
| **可观测** | 每次运行强制生成完整 Trace；`judgement_set` 永不裁剪；`verdict_hash` 完整性校验 |
| **可替换** | `JevDecisionProvider` + `BackendAdapter` + **`EngineProvider`（V1.2 新增，§5.0）** 三接口，配置注入 |
| **可复核** | `idwth judge recompute <run_id>` 离线重算，结果必须与在线一致 |

---

## 十、CLI 设计

```bash
idwth init                                  # 生成骨架 + 环境探测（Chrome 可达性 / 调试端口 / JEV 端点 / 权限）
idwth validate <contract> [--json]          # Schema + 可执行性校验（§3.1 九条规则）
idwth run <contract> [--repeat N] [--provider mock|jev] [--max-cost X] [--freeze] [--json]
idwth replay <trace> --verify               # 默认：零模型；漂移即 DRIFT 终止 → BLOCKED(drift)
idwth replay <trace> --heal                 # 显式：允许 recovery；产物不入 CI
idwth report <run_id> [--open] [--export]   # --open 渲染单文件静态 HTML（零服务端）；--export 打包含 judgement_set，可离线重算
idwth judge recompute <run_id>             # ★ 新增：从归档 evidence 离线重算 verdict（决议 2 的可验收动作）
idwth doctor                                # ★ 新增：端口污染自愈、残留进程清理（实测踩过 /json/version 404）
```

**退出码（V1.1 六值，DD-23）：**

| 码 | 语义 | 说明 |
|---|---|---|
| `0` | PASS | — |
| `1` | FAIL | 确定性断言不通过 |
| `2` | BLOCKED | 含全部 7 个子类（env / ambiguity / evidence / decision / recovery / postcondition / drift） |
| `3` | **CONFIG_ERROR** | schema 校验失败 / 缺少必需字段 / 无 postcondition |
| `4` | **RUNTIME_ERROR** | 内部异常（含 `verdict_hash` 不一致） |
| `130` | **CANCELLED** | SIGINT / 超总预算。**不是 BLOCKED**，不进 verdict 聚合（§8.2） |

> **为什么把 CONFIG_ERROR 从 BLOCKED 拆出来**：PRD 写的是「2 = BLOCKED 或配置错误」。但这两者对使用者的含义完全相反 —— `BLOCKED` 是"环境/应用/能力不足"，配置错误是"**你的用例写错了**"。混在一个码里，CI 报告无法区分"去看系统"还是"去看用例"，也破坏了 `SIR`、`BLOCKED 占比 < 15%` 这类指标的纯净性（配置错误会虚高 BLOCKED 占比）。**同理，`CANCELLED` 也必须独立**：取消不是一次测试，它连判定阶段都不该进入。

**`idwth init` 的具体职责**（DD 遗留）：生成 `.idwth/` 目录 + 示例 Contract + 环境探测报告（Chrome 是否带调试端口可达 / `--remote-allow-origins` 是否已配 / JEV 端点连通性 / 目标域权限）。

**`idwth report --open` 的形态（V1.2 新增，DD-48）**：渲染**单文件静态 HTML** —— 五要素数据与截图**内联进单个 `.html`**（源自 `report.json` 与 `judgement_set`），**零服务端、零运行时依赖、可离线双击打开、可直接作为 CI artifact 或文件附件分发**。**不启动任何本地服务、不起端口、不做前后端分离**（与 §1.2「不做控制面」一致）。`--export` 只负责打包归档（含 `judgement_set`，供 `judge recompute` 跨机器重算），**与渲染互不依赖**。

---

## 十一、目录结构

```
idwth/
├── skills/                       # ① 声明层：只有 SKILL.md
│   ├── web-test-contract/SKILL.md
│   ├── web-test-executor/SKILL.md
│   ├── web-semantic-action/SKILL.md
│   ├── web-semantic-recovery/SKILL.md
│   ├── web-test-evidence/SKILL.md
│   ├── web-test-judge/SKILL.md
│   └── web-test-replay/SKILL.md
├── runtime/                      # ② 实现层 · ③ 调用层（确定性代码）· ★ IDWTH 判定内核（自研边界，不可替换）
│   ├── executor.ts               # 状态机（§8.1）
│   ├── resolve.ts                # 三级定位调度（§3.3）★ 委托 EngineProvider；候选编号与越界判定留本层
│   ├── judge.ts                  # 判定（§3.2 四步优先级）· 纯函数
│   ├── freshness.ts              # ★ Runtime 独占
│   ├── cleanup.ts                # ★ Runtime 独占（finally）· 终态轮询
│   ├── scope.ts                  # ★ V1.2 新增：论域收窄 + excluded_system_objects（铁律 9）
│   ├── error-adapter.ts          # ★ V1.2 新增：上游错误码吸附（§8.2）
│   ├── bindings.ts               # ★ V1.2 新增：六重绑定校验（§3.7，含 engine_provider_version）
│   ├── context.ts  artifact.ts  lifecycle.ts  credential.ts
├── engine-provider/              # ★ V1.2 新增：④ Engine Provider 层（§5.0）· 唯一的可替换边界
│   ├── types.ts                  # EngineProvider 接口（observe/resolve/act/assert/screenshot/trace/dispose）
│   ├── e2e-adapter.ts            # 默认实现：@e2e-dev/web + @e2e-dev/decision
│   ├── playwright/               # 降级实现：原 tools/browser/ 的 11 个脚本整目录移入
│   │   ├── attach.ts             # ★ CDP 接管 —— 两种实现都要用（上游不提供）
│   │   ├── background-tab.ts     # ★ 后台标签页不抢焦点 —— 两种实现都要用（上游不提供）
│   │   └── ...（其余 9 个）
│   └── cache/                    # ★ 引擎缓存（§6.2）· 随版本交付的组件
├── tools/
│   ├── http/
│   └── backend/                  # EvidenceProvider 实现（rest / sqlite / mock）
├── adapters/jev/                 # JevDecisionProvider + MockProvider
├── schema/
│   ├── contract.schema.json      # §3.1
│   ├── action.schema.json        # §3.4
│   ├── strategy.schema.json      # §3.7 ★ 新增
│   └── trace.schema.json         # §3.6
├── examples/
│   └── k8s-adapter/              # ★ reference adapter，不进 core
├── cli/
│   └── assets/report-viewer.html  # ★ DD-48：单文件报告渲染（零服务端）
└── tests/                        # 含 engine-provider 契约测试（两实现同一套用例）
```

> **`runtime/resolve.ts` 与 `runtime/freshness.ts` 是 V1.1 新增的两个模块** —— V1.0 的目录结构里没有它们的位置，这正是 DD-01/DD-13 在工程结构上的体现。

> **V1.2 新增 `engine-provider/` 目录**（DD-30）—— 它是本次架构调整在工程结构上的唯一体现。注意三点：① `tools/browser/` 整目录**降级**为 `engine-provider/playwright/`；② `attach.ts` / `background-tab.ts` **两种实现都要用**，不是降级实现专属；③ `runtime/` 下新增的 `scope.ts` / `error-adapter.ts` / `bindings.ts` **全在自研边界之上**。

---

## 十二、测试策略

| 层级 | 内容 |
|---|---|
| **单元测试** | `resolveTarget` 的 L1/L2/L3 分支与歧义短路 · `judge` 四步优先级 · Action 校验层 · `validate_choice` 五条校验 · Schema 校验九条规则 |
| **契约测试**（★新增） | `contract/action/strategy/trace` 四个 schema 的**版本兼容性**；`judge recompute` 与在线 verdict 一致性 |
| **集成测试** | 确定性路径端到端 · Recovery 场景 · Mock Provider 场景 · Freshness 拦截 · cleanup 在 abort 时仍执行 |
| **对抗性验收** | 下表 **A1–A11 共 12 条**（其中 A7 拆为 **A7a / A7b** 两条；**编号全局唯一，只追加不重排**） |
| **回归** | Reference Suite（**首个 Reference Suite = openFuyao 类 K8s / 云管系统；套件机制对任意 B/S 通用**）+ 稳定性 `--repeat 10` |

### 12 条对抗性验收（PRD 评审 §三，归位到模块；A7a/A7b · A10 · A11 为 V1.2 新增）

> **编号约定（2026-10-10）**：验收编号**全局唯一**；A 序列新增一律**追加到最大号之后，禁止按主题重排**。视觉通道的验收改用 **`VB-` 独立序列**（见 [`visual-dom-matrix.md`](visual-dom-matrix.md)），**不占 A 序列**。

| # | 构造场景 | 期望 | 归属模块 | 测的边界 |
|---|---|---|---|---|
| A1 | JEV 自述完成 + HTTP = 500 | **FAIL** | `judge` | JEV ≠ PASS |
| A2 | JEV 自述完成 + **无任何证据** | **BLOCKED** | `judge` + Runtime 独占① | 无证据 ≠ 通过 |
| A3 | 断言目标**多条匹配**（歧义） | **BLOCKED(ambiguity)**，不取第一个、不 FAIL | `resolve` §3.3 规则 1 | 歧义 ≠ 用例外 |
| A4 | Recovery 试图**修改 Assertion** | **拒绝 + 审计 + 终止** | `semantic-recovery` 硬规则① | 禁止静默改判定标准 |
| A5 | 提交后**网络超时** | **不重试 mutation** → BLOCKED | `ActionResult.dispatched` + §8.2 | 副作用不可重复 |
| A6 | Replay 时页面结构变化 | **报 DRIFT 并终止** → BLOCKED(drift) | `replay --verify` | 回放不得静默适配 |
| **A7a** | **回放态**（引擎缓存命中）断开 JEV 端点 | 确定性路径**全部可跑**，SIR = 0 | `executeCase` 不持 provider 引用 + `replay --verify` | 模型不是硬依赖（回放态） |
| **A7b** | **首次态**（缓存未命中）断开 JEV 端点 | 走 L1/L2 的 step 可跑；**需 L3 / `agent.act` 的 step 必须 `BLOCKED(decision)`**，不得假装跑过 | EngineProvider 的模型调用失败处理 + §8.2 | 模型不是硬依赖（首次态）—— **V1.2 新增：原 A7 的表述只在回放态成立** |
| A8 | 归档 evidence **离线重算 Judge** | verdict 与在线**完全一致** | `judge` 纯函数 + `judge recompute` | 判定可复核 |
| A9 | Recovery 落到**错误但看似合理的目标**，最终断言恰好通过 | **步级后置条件必须捕获** | `risk: irreversible` 强制 postcondition + §4.4 ④ | 假通过防线 |
| **A10** | 断言区在**视口外** / 页面**加载中** / **纯 Canvas 页**上做断言（上游会判 `ASSERTION_INCONCLUSIVE`） | **`BLOCKED(decision)`**，**不得报 FAIL** | `error-adapter.ts` + §8.2 + Engine 硬约束 ② | **上游默认值不得渗透进我们的 verdict**（V1.2 新增） |
| **A11** | 引擎缓存记录**陈旧**（对应上游 `REPLAY_STALE`）时以**默认命令**回放 | **报错终止（exit ≠ 0）**，不得静默 heal 后报通过 | `replay` 默认 `--verify` + §4.7 + Engine 硬约束 ① | **`--verify` 是真的默认，不是文档话术**（V1.2 新增） |

> **A4 / A6 / A8 是三条最容易被跳过、但最值钱的**：分别守住"不得改判定标准""不得静默适配环境""判定必须可复核"。

> **★ V1.2 新增 A10 / A11 的理由**：这两条不是新能力，而是**针对"外购执行引擎的默认值"设的防线**。
> 上游 `tester-army/e2e` 有两个默认行为与我们的铁律相反 —— ① 把"模型判不出来"记为**测试失败**（exit 1）；② 回放默认 **heal** 而非 verify。
> 这两条默认值**会被实现者在无意中沿用**（它就在引擎里，不改就用），且**不会体现在任何架构评审里**。所以必须有验收在运行期拦住它们：**A10 保证 verdict 不被上游改写，A11 保证 `--verify` 真的生效。**

> **A7 为什么必须拆 a/b（V1.2 修正）**：原表述「断开 JEV 端点 → 确定性路径全部可跑」在**回放态**成立，在**首次态不成立** —— 首次运行缓存未命中，需 L3 的 step 必然要出网。若不拆，会出现两种误读：① 把"首次需要模型"误判成"架构有 provider 硬依赖"；② 用一条笼统的 A7 掩盖"首次态在内网跑不起来"这个真实部署约束。**配套动作：引擎缓存进交付物清单（§6.2，DD-35）。**

---

## 十三、里程碑与验收对应

| 阶段 | 设计交付物 | 覆盖的对抗性验收 | PRD P0 对应 |
|---|---|---|---|
| **M1** 确定性闭环 | Contract Schema（§3.1 九条校验）+ `resolve` L1 + `executor` 状态机 + **`EngineProvider` 接口 + `playwright/` 降级实现（§5.0）** + `judge` + Trace + CLI 骨架 | **A3**（歧义短路）· **A8**（纯函数 + recompute） | 「Skill Loader + Schema Validator」「Contract Schema + Validator」「Playwright 确定性执行」「Judge (PASS/FAIL/BLOCKED)」「CLI 5 命令」 |
| **M2** 语义能力 | JEV Adapter + `validate_choice` + Semantic-Action + Recovery + 完整 Trace + 分级阈值 + **`error-adapter.ts`（上游错误码吸附）** + **`e2e-adapter.ts`（并行对照，不设为默认）** | **A1** · **A2** · **A4** · **A5** · **A7b** | 「JEV Decision Adapter」「Semantic Recovery + 审计」「DOM + HTTP Evidence」 |
| **M3** 价值验证 | Reference Suite + 指标采集 + **Report Viewer（单文件静态 HTML，DD-48）** + `examples/k8s-adapter` + **`apps/web-benchmark` 硬场景集纳入回归基准** + **两实现对照数据 → 据此定默认实现** | **A9**（步级后置条件）· **A10** | 「Replay」部分 + §14 指标 |
| **M4** 进 CI | `replay --verify`（**真默认**）+ `--repeat N` 硬门禁 + 稳定性达标 + `doctor`（含**引擎缓存新鲜度**自检）+ **引擎缓存入交付包** | **A6** · **A11** · **A7a** | 「Replay：成功路径零模型调用可回放」+ §12 稳定性 |

> **A7 的里程碑归属（2026-10-10 修正，DD-38）**：**M2 用 `A7b`（首次态）验证** —— 清空引擎缓存 + 断开模型端点 → 确定性路径可跑、**需 L3 的 step 必须 `BLOCKED(decision)`**（不得假装跑过）。**`A7a`（回放态）随 `replay --verify` 到 M4 再验**（M2 尚无 replay 命令，测不了）。本条测的是"模型不是硬依赖"，越早发现架构里藏着 provider 引用越好。

> **★ V1.2 对里程碑的三处调整（均不推翻原安排）**：
> 1. **M1 的「Playwright Adapter」改为「`EngineProvider` 接口 + `playwright/` 降级实现」** —— 架构先定接口，实现后议。
> 2. **M2 并行跑通 `e2e-adapter.ts` 但不设为默认** —— 这是待决问题 1 的决策（两条并存、M3 用数据定默认值），避免把"能不能跑通"和"用谁的实现"绑在一起。
> 3. **M3 增加一项出口判据：两实现对照数据**（定位命中率 / **误命中率** / 成本 / flaky 率）。**误命中率是这里的重点** —— 它比不命中更危险（静默错配，见 §5.5 `locate-l2.ts`）。

---

## 十四、开放设计问题（V1.1 收敛至 2 项；**V1.2 另关闭执行引擎层 5 项**）

### V1.2 关闭：执行引擎层 5 项决议（2026-10-08 · **全部按建议执行**）

| # | 问题 | 决议 | 落点 |
|---|---|---|---|
| **E-Q1** | 默认实现走 e2e，还是先自研再逐步替换？ | **两条并存**：M1 自研骨架 + 并行跑通 e2e 适配器做对照；**M3 用实测数据定默认值** | §5.0「决策记录」· §13 M1/M2/M3 |
| **E-Q2** | 是否把 `apps/web-benchmark` 硬场景集纳入回归基准？ | **纳入**（现成的 20+ 硬场景靶场，含 `planted-bugs.e2e.ts` **度量漏检而非通过率**的做法） | §13 M3 |
| **E-Q3** | 「引擎缓存」进不进版本交付物？ | **进**。否则内网离线场景下 A7b 成常态，产品在目标环境跑不起来 | §6.2 · §12 A7b |
| **E-Q4** | 是否采用上游 `trace.md` 作证据呈现？ | **仅作可选渲染，不作权威产物**。权威产物是本设计的五要素 `report.json` | §4.5 · §9.4 |
| **E-Q5** | 上游错误码要不要在报告里露出？ | **露出但降级为附加字段** `upstream_error_code`；主状态永远用 IDWTH 三态 | §8.2 · §12 A10 |

> **五项的共性**：它们都不是"选哪个更好"，而是**"不要把两件事绑在一起"** —— 不把"能不能跑通"和"用谁的实现"绑（E-Q1）、不把"证据呈现"和"报告契约"绑（E-Q4）、不把"上游诊断信息"和"我们的 verdict"绑（E-Q5）。**绑定越少，将来可替换的空间越大。**

### V1.1 遗留：真开放 2 项

V1.0 提了 4 项，其中 2 项已在 PRD 评审关闭：

| V1.0 问题 | 状态 | 结论 |
|---|---|---|
| 置信度阈值是否固化为 0.85 | ✅ **已关闭** | **否** —— 按可逆性分级：`reversible ≥ 0.60` / `irreversible ≥ 0.90`（§7.2），依据 `JevTest` 默认值 |
| Recovery 失败默认 BLOCKED 还是 FAIL | ✅ **已关闭** | **必须 BLOCKED，不可配置**（§8.2）。FAIL 的前提是"有确定性断言作证据"，而 recovery 失败时动作根本没执行成功。可配置的只是 CI 是否把 BLOCKED 也阻断合并 |

**真开放（需评审确认）：**

| # | 问题 | 建议 | 影响范围 |
|---|---|---|---|
| **Q1** | Trace 字节上限与去重策略的具体参数 | `judgement_set` **无硬上限**（**估计** ~<2MB —— **待实测**，见 PRD §十二 **D07**）；`archived` 默认 50MB/run，超出外移并写指针，**不做丢失式截断**。去重按 `sha256(evidence 内容)` 内容寻址 | 存储与归档；直接影响决议 2 能否落地 |
| **Q2** | 何时引入完整轨迹反思接口（GEPA 风格） | **V1 不做，但 P0 就留对接口**：Trace 必须含五元组 `(intent, 页面可观测状态, JEV 请求/响应原文, 决策, 结果)`。反思产物**必须是一版新 frozen strategy，经人确认后替换，不得运行时自改**；**可改 Recovery 策略，绝不可改 Goal/Assertion** | 若反思能自动改断言，§4 的 Freeze 名存实亡 |

---

## 附：一句话记住本文相对 V1.0 / V1.1 的改动

> **V1.0 把「确定性优先」写成了目标却没有可表达它的数据模型** —— Contract 里没有定位声明，`has_stable_locator()` 恒为假；把「歧义」当「未命中」交给模型猜；对着已提交的动作做 recovery；Judge 的调用权与写入权悬空；判决结果双写无权威源。
>
> **V1.1 只做一件事：给每一条承诺找到它在代码里的唯一的落点。** 定位落到 §3.3 的三级解析，判定落到 §3.2 的四步优先级，可信度落到 §6.1 的四个独占，可复核落到 §3.6 的 `judgement_hash` 与 `judge recompute`。

> **V1.2 只做一件事：给「判定内核」划一条边界。** 边界之上（Judge / 论域收窄 / runId 隔离 / cleanup 终态 / 绑定校验）**全部自研、不可外购**；边界之下（浏览器执行引擎）**可整体替换**（`EngineProvider`，§5.0）。这次**不新增任何判定语义**，只把"我们依赖谁"从架构级问题降为配置级问题。
>
> 配套的两个小改动同源：**六重绑定加 `engine_provider_version`**（把上游也纳入漂移检测，§3.7 ⑥）、**A7 拆成 a/b**（把"回放态能离线"与"首次态必须断网降级"分开，§12）。
>
> **V1.2 · F 级（2026-10-10）只做一件事：把「SUT 的专属事实」与「产品的要求」分开。** 判据一句话 —— **「离开 openFuyao，这条还成立吗？」**（§八.3 两栏表）。隔离单元从「K8s 命名空间」抽象为「**run 级作用域，形式由 SUT 决定**」，对象名内嵌 **`runId + contractId` 两级**（堵住此前被忽略的「批次内跨用例串扰」假 PASS 通道）；隔离的实现归属**复用既有 `BackendAdapter`，不新增接口**。**判定内核、隔离机制、错误映射一行未改。**
