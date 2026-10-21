# JEV 系 BS 架构 E2E 测试方案调研

调研 `perixtar/jev-e2e`、`CorieW/JevTest`、`browser-use/jev-ultrafast`、`alibaba/page-agent` 四仓库，
回答三个递进问题：

1. **如何实现**「输入测试用例 → 输出完整测试报告」的 BS 架构系统测试？
   （报告须含：测试用例、测试截图、是否通过、未通过原因、可复现测试过程）
2. **复用现有浏览器状态**时，E2E 能力该叠加在 `jev-ultrafast` 上还是 `page-agent` 上？
3. **要产品化**这个工具，核心功能与产品形态是什么？多个 Skills 能支撑吗？
4. 给定一份**外部 PRD（IDWTH V1.2）**，按评审标准逐节核验与收敛。
5. 给定一份**外部详细设计（IDWTH DD V1.0）**，按可实施性标准优化为可直接开发的基线。

## 交付物

| 文件 | 说明 |
|---|---|
| [`final/report.md`](final/report.md) | **调研报告**：架构拆解 · 五要素映射 · 四条一票否决判据 · 横向决策表 · 风险边界 |
| [`final/implementation-plan.md`](final/implementation-plan.md) | **具体实现方案**：执行臂决策 · 三层分离 · Adapter 契约 · 报告实现 · P0–P5 实施计划 |
| [`final/product-definition.md`](final/product-definition.md) | **产品定义与 Skills 支撑方案**：六个功能面 · 形态 A/B/C（**B/C 未采纳**：2026-10-10 裁定 V1 = 纯 CLI，见摘要 23）· 可衡量指标 · 14 项 skill 判定表 · 六个 skill 设计 · 三条硬约束 |
| [`final/PRD.md`](final/PRD.md) | ★ **IDWTH 产品需求文档 V1.2（正式版）**（V1.2 变更：**FR-9 改为「六重绑定」**（补 `judge_impl_hash` / `engine_provider_version`）· 验收计数修正为 **12 条** + 编号约定 · 里程碑与 A7a/A7b·A10/A11 对齐 + **「引擎缓存」入交付物** · **视觉通道移入 §十二 Backlog** · 待关闭项补 D07 · **§八.3 重构为「SUT 适配注记」两栏表（立「产品要求 vs SUT 适配项」判据）· FR-11 隔离单元改为 SUT 中立的「run 级作用域 + runId/contractId 双标识」· **产品形态裁定：V1 = 纯 CLI（不做常驻服务 / 控制台、无前后端分离）· Report Viewer 定形为单文件静态 HTML**。V1.1 变更：A7 拆 a/b · 新增 A10/A11 · NFR 增「可替换」「可离线」）：产品定位与三句边界 · 4 类用户 5 个场景 · 3 个问题与 3 条主张 · **12 条功能需求（FR-1~FR-12，逐条带验收口径）** · **7 个 Skills 规格** · 非功能指标 · **12 条对抗性验收（A1–A11，A7 拆 a/b）** · 技术选型与许可红线 · 目标系统约束 · 风险 · 里程碑 · **§十二 待关闭项 + Backlog** | **本文是"产品要什么"，实现见 `detailed-design.md`** |
| [`final/prd-review.md`](final/prd-review.md) | **IDWTH V1.2 PRD 评审意见**：1 处架构级互斥 · 2 处隔离保证不硬 · 13 项具体问题 · 验收从 1 条扩到 9 条 · 5 个开放问题的建议答案。**其 5 项阻塞决议已于 2026-09-23 全部通过，结论已被 `PRD.md` 吸收为已定稿前提** |
| [`final/jevharness-review.md`](final/jevharness-review.md) | **JevHarness 源码级评审**（`TianyuCodings/JevHarness`，`auto-jev`）：不在竞品赛道，而是「L3 + 学习飞轮」的参考实现。核心可借鉴＝**五重绑定 + 把真实校验器源码注入 prompt + 「截断/超预算 ≠ 通过」显式抛错 + blocked/cancelled 双状态**；`license: null`，只取设计不取代码 |
| [`final/e2e-tester-army-review.md`](final/e2e-tester-army-review.md) | ★ **`tester-army/e2e` 源码级评审**（7.5k★ · Apache-2.0 · TS · npm `e2e` v0.18.0）：**目前与 IDWTH 主干最同构的外部实现**。Goal/Assertion/Locator 三步骤骨架 · **回放缓存**（独立验证后才固化 + 起点/终点核对 + `REPLAY_STALE`）· **决策模型只输出候选序号**（`@e2e-dev/decision`，规则注明改编自 `jev-ultrafast`）· 三态判定 + 错误码分类 → 退出码 1/2/3/4/130 · 五要素报告落点齐全（`report.json`/`junit.xml`/`summary.md`/`trace.md`+截图）。**两处与铁律冲突**：① `ASSERTION_INCONCLUSIVE` 归 `failed` 类（exit 1）→ 假 FAIL 通道 ② 默认是 heal，`--strict-cache` 才是 verify。含 §8「可直接用 / 必须自建」两列对照 |
| [`final/e2e-architecture-adjustment.md`](final/e2e-architecture-adjustment.md) | ★ **以 `tester-army/e2e` 为基线的 IDWTH 架构调整方案**（**✅ 2026-10-08 已决策并全部回写 → `detailed-design.md` V1.2**）：判定＝**可以，但限定为「换执行与证据引擎」，不动判定内核**。含 **FR-1~FR-12 逐条映射**（12 条里 2 条完全自研不动 · 5 条换底层 · 3 条包一层）· **架构三层→四层**（新增 `EngineProvider` 接口层，与既有 `BackendAdapter`/`JevDecisionProvider` 同手法）· **七处必须显式改写的口径**（防被上游默认值带走）· **反向互补三例**（origin 白名单 / 文本级遮罩 / 判定器哈希）· **新增 A10/A11 验收 + A7 拆为 A7a/A7b**（**新发现：离线部署须交付「引擎缓存」组件**）· 里程碑 M1–M4 逐条调整 · **明确不建议 fork** · 回写 `detailed-design.md` 的 9 处清单（待确认） |
| [`final/detailed-design.md`](final/detailed-design.md) | **IDWTH 详细设计 V1.2（优化版，替换 V1.0 / V1.1）**：V1.1 的 29 项修订（9 项架构级）+ **V1.2 的 E 级 7 项（DD-30~DD-36 · 执行引擎层）+ F 级 10 项（DD-37~DD-46 · PRD V1.2 同步 + SUT 中立化）+ G 级 2 项（DD-47/DD-48 · 产品形态：纯 CLI + Report Viewer 定形）**。核心内容：Contract 定位绑定 · 断言语义精确表 · Action/ActionResult · 六重绑定（含 `engine_provider_version`）· Trace 权威源与 evidence 分级 · ★ **§4.8 七个 `SKILL.md` 完整规格** · ★ **§5.0 Engine Provider 层（V1.2 新增的第四层）** · ★ **§5.5 Playwright 脚本层**（降级实现）· **§2.1 四层架构图** · **12 条对抗性验收（含 A7a/A7b · A10/A11）** |
| [`final/visual-dom-matrix.md`](final/visual-dom-matrix.md) | ⚠️ **已转 Backlog（2026-10-10）· 条件触发 · 非 V1 范围**（启动条件：外部明确提供多模态大模型能力并主动要求启用视觉；原 P4.5 时点已撤销）。内容：视觉 + DOM 双通道**素材**：核心判定＝**主从而非并列**（DOM 证明唯一，视觉看见渲染）· 角色三分（观察/定位/取证 + 各自能否产生 FAIL）· 候选集约束 · 噪声下界标定 `ε_base` 与 `visual_unstable` 拒绝机制 · `replayable: false` 显式建模 · 截图升级为「模型输入」的新增泄漏面。铁律 11/12/13、验收 **`VB-01…VB-05`**、Skills 7→9、必须落代码 3 模块、Runtime 独占 4→5 |
| [`final/verification-checklist.md`](final/verification-checklist.md) | **待验证清单（58 项，逐条评审用）**：A 阻塞决议 5 · B 非阻塞决议 5 · C 真开放问题 2 · D 未实测假设 21 · E 需真实被测系统 7 · F 合规与时效红线 5 · G 范围与顺序 3 · H 视觉通道 5 · **I 执行引擎层 5（2026-10-08 新增）**。含逐条判定协议与决议记录表。**A01–A05 已于 2026-09-23 全部通过（P0 验收标准自此可书写）；已闭 14 项（A01–A05 · B01–B05 · E01 · E02 · G03 · D20）** |
| [`final/e01-openfuyao-recon.md`](final/e01-openfuyao-recon.md) | **E01 目标系统侦察报告**：`https://openfuyao-staging.internal.example.com:31616` = openFuyao 管理平台。登录机理（OAuth2+CSRF）· 13 个一级菜单（i18n 权威清单）· 106 路由 · 14 个 K8s API 组代理 · **六条影响 IDWTH 设计的发现**（i18n 外置 / 集群态在 sessionStorage / 登录不可冻结回放 / iframe 非必需 / K8s 代理可作后端断言 / React+AntD） |
| [`final/e02-namespace-isolation.md`](final/e02-namespace-isolation.md) | **E02 数据隔离实测报告**：`ns-idwth-<runId>` 作为隔离单元 **20/20 通过** · 三重安全守卫 · 基线 diff 三项全空 · **1 条证伪**（`created_at > run_start` 不可用）+ **2 条新假结论通道**（系统自动注入致假 FAIL / cleanup 异步需等终态） |
| [`scripts/of-ns-lifecycle.py`](scripts/of-ns-lifecycle.py) | **命名空间生命周期实测（可复跑，带三重硬守卫）**：只删本进程创建的名字 · `--delay N` 可复现时间戳精度对照实验 · `--keep` 仅调试。凭据只走环境变量 |
| [`scripts/of-clock-skew.py`](scripts/of-clock-skew.py) | **时钟偏移测量（只读）**：判定「跨系统时间戳能否作判据」的前置排查 |
| [`scripts/of-recon.py`](scripts/of-recon.py) | **目标侦察脚本（可复跑，只读）**：登录 → 拉 bundle → 提取路由/API/i18n/前端指纹/集群态 → 可选只读 API 探测。凭据只走环境变量 |

## 实测证据（可复跑）

| 脚本 | 验证内容 | 结果 |
|---|---|---|
| [`scripts/p0-gate-verified.mjs`](scripts/p0-gate-verified.mjs) | `connectOverCDP` 接管现有 Chrome 的能力矩阵 | **14/14 通过** |
| [`scripts/close-semantics-verified.mjs`](scripts/close-semantics-verified.mjs) | `browser.close()` 的破坏性语义 | **3/3 轮一致：不会关闭用户浏览器** |

```sh
cd /Users/freecisco_yan/.workbuddy/binaries/node/workspace
cp <此目录>/scripts/*.mjs .
/Users/freecisco_yan/.workbuddy/binaries/node/versions/22.22.2-3/bin/node p0-gate-verified.mjs
```

> 脚本使用**临时 user-data-dir**，不会触碰真实浏览器 profile。
> 沙箱/容器环境下需保留脚本内的 `--no-sandbox --disable-dev-shm-usage --disable-gpu-sandbox`。

## 核心结论摘要

1. **四仓库分三层**：`jev-e2e` 是唯一端到端成品（MIT，**可照抄骨架**）；`JevTest` 机制最先进但**无许可证，仅可借鉴设计**；`jev-ultrafast` 与 `page-agent` 都是**执行/定位引擎**，不产出报告。
2. **成败取决于三个设计决策**：强制显式断言、三态判定（PASS/FAIL/**BLOCKED**）、控件指纹持久化实现零模型回放。
3. **两者判定都是模型自述**（`jev-ultrafast` 的 `DONE`、`page-agent` 的 `done(success)`）→ **判定层必须自建**，且只有确定性断言能产生 FAIL。
4. **执行臂选 CDP**：真实输入（`isTrusted=true`）+ 每 case 隔离 + 导航可控 + 凭据不入模型。`page-agent` 走 JS 合成事件，明确不支持 Monaco/CodeMirror/Draft.js，仅在 **MFA / 免安装** 场景作为降级臂。
5. **最佳成绩来自真实站点而非 demo**：eBay 上每模型 3 次仅 1~2 次 PASS，成本差 60 倍。受控 demo 的 200/200 不可外推。
6. **四仓库都没解决**：后端数据库隔离、测试数据重置归属、真实站点期望值管理——这三件必须自建。
7. **产品形态不是"一个 CLI"**：形态是 **daemon + CLI + 本地控制台**三件套（类比 Docker 而非 Playwright）——"复用现有浏览器状态"天然需要长连接、tab 池与会话账本。MVP 用纯 CLI 形态 A，团队化再上形态 B。　**⚠️ 2026-10-10 裁定：形态 B/C 未采纳 —— V1 = 纯 CLI（单进程），不做常驻服务、不做本地控制台、无前后端分离（见摘要 23）。**
8. **Skills 能支撑体验层（约 60–70%），不能支撑可信度（0%）**：用例创作、跑与分诊、报告解读、定位自愈、flake 诊断、框架审计这六个可 skill 化；**执行、断言、判定、取证、写盘、回放必须落代码**。顺序不可颠倒——先做 skills 会得到能演示、不能上生产的"聪明 demo"。
9. **最被低估的资产是「学习飞轮」**：L3 模型定位成功后把控件指纹写回 plan，下次同一条路走零成本的 L2 → **模型成本随跑次数单调递减到零**。agent 每次都重新犯错，runner 只错一次。
10. **IDWTH PRD 的架构级互斥**：§0「可被 Agent 加载的 Skills」与 §12/§13「确定性路径禁止调用模型 / Semantic Invocation Rate ≈ 0」互相否定 —— 模型编排本身每 case ≥ 1 次调用。**解法：拆 Agent Runtime（开发用，不适用预算）与 CI Runtime（确定性编排，P0 验收唯一对象）**。
11. **判定权的正确表述**（对第 8 条的重要修正）：*"做成 skill" 与 "确定性" 不是对立属性 —— Skill 是封装形式，确定性是实现属性。真正判据是「调用权与写入权在谁手里」*。→ **Judge 可封装为 skill，但调用权与 verdict 写入权必须独占归 Runtime，且 verdict 必须是 `f(evidence, assertions)` 纯函数（可用归档证据离线重算）**。
12. **⛔ 单 case 稳定性指标不组合**：`suite 绿灯率 ≈ p^n`。p=0.95 时，50 case 的 suite 只有 **7.7%** 的绿灯率（门禁 92% 时间在红）。要让 50 case 有 95% 绿灯率，单 case 必须达 **99.9%**。→ 稳定性应写成**「无 flaky case」二值硬门禁**，suite 绿灯率只作观测。
13. **对抗性验收是本领域最有效的验收形态**：IDWTH 那一条「JEV 认为完成但 HTTP=500 → 必须 FAIL」含金量最高，已扩为 **12 条**（A1–A11，A7 拆 a/b）（无证据→BLOCKED / 歧义→BLOCKED / 不得改 Assertion / mutation 不重试 / replay 漂移即终止 / 断 JEV 端点仍可跑 / 归档证据离线重算 verdict 一致 / recovery 错目标需步级后置条件捕获）。
14. **⛔ 详细设计 V1.0 的致命缺陷：Contract 里没有任何定位声明。** `steps: string[]` 只有自然语言，`assertions.dom[].selector` 标注"仅确定性路径使用"——于是 `has_stable_locator(step)` **恒返回 false**，所有步骤都被判为"无稳定 Locator"而走语义路径。**「Deterministic First」与「Semantic Invocation Rate ≈ 0」在数据模型层就不成立。** 修法：Contract 声明**语义 target**（禁止 selector），用运行期的「三级定位解析」取代静态判据——**判据是解析结果，不是 Contract 属性**。
15. **⛔ 「歧义」被当成「未命中」是最危险的假 PASS 通道。** V1.0 伪代码 `if has_stable_locator ... else semantic` 会把"多条匹配"往下交给模型猜一个。正确做法：**匹配数 > 1 立即 `BLOCKED(ambiguity)`，不降级、不取第一个、不交给模型**。同理 **`irreversible` 动作失败禁止触发 recovery**——任何"恢复"都是一次新的 mutation，对着"提交失败"再点一次提交在 CMDB/K8s 上是**真实损害**。
16. **Skill 的物理形态必须定义，否则 skill-first 无法工程化。** Skill = **可校验的契约声明，不是可执行的程序**，分三层：声明层（SKILL.md）/ 实现层（确定性代码）/ 调用层（Runtime 独占）。由此 7 个 skill 分为**知识型**（`web-test-contract`，仅 Authoring 阶段运行、CI Runtime 不调用）与**契约型**（其余 6 个，由确定性代码实现）——**这正是双 Runtime 的具体落法**。
17. **可复核性的物理下限是 evidence 分级**：必须按「**是否参与判定**」分级，而不是按体积分级。判定必需集（`judgement_set`）永不截断，可归档集（截图/完整 DOM）可外移。若按体积裁掉判定必需集，「用归档 evidence 离线重算 verdict」这条验收即不成立（配套动作：`idwth judge recompute <run_id>` + `verdict_hash` 完整性校验）。
18. **⭐ 绑定必须同时保护「执行」与「判定」两侧。** JevHarness 的 `task_contract` 把「**评估器源码哈希**」列为绑定项之一 —— 这条移植到测试语境，就是 frozen strategy 的**六重绑定**必须含 **`judge_impl_hash`**：`contract_hash` / `strategy_hash` / `judge_impl_hash` / `runner_version` / `env_fingerprint` / **`engine_provider_version`（V1.2 新增 —— 上游引擎升级即 re-key 全部缓存，不绑就是一条静默错配通道）**，并进入 `verdict_hash`。
    **为什么这条最容易漏**：前面四条都在保护执行（Contract、指纹、环境），唯独漏了判定器本身。若 Judge 实现改了（修了断言口径、加了 `text_contains`），则① 新旧的 verdict **不可比**（趋势图会显示"质量突变"，实际是判定器变了）② A8 的离线重算会失败——而**这是预期行为不是缺陷**，没有 `judge_impl_hash` 就区分不出"判定器变了"与"证据坏了"。
19. **⭐「学习飞轮」的优化动作必须离线，且它永不产出 verdict。** 边界：L3 成功 → 写回候选 → **人确认** → 新版本 strategy → 进 CI。因此「模型成本随跑次数单调递减到零」与「判定权 Runtime 独占」**不冲突，可同时成立**。这条让产品定义里最被低估的资产与最硬的隔离约束第一次对齐。
20. **`CANCELLED` 必须独立于 `BLOCKED`**：取消意味着"本次不构成一次测试"（看谁都没用），`BLOCKED` 意味着"无法取得可靠证据"（去看系统或工具）。混用会让 `BLOCKED 占比 < 15%` 因人为取消而虚高，并让报告写着"无法判定"而真实原因是有人按了 Ctrl-C。**取消是运行状态，不该进 verdict 聚合。**
21. **⭐ 执行引擎可替换是 V1.2 新增的唯一架构层（第四层）。** `tester-army/e2e`（Apache-2.0 · TS，**与 IDWTH 同栈 → 可作真实依赖而非借鉴**）定为默认 `EngineProvider` 实现，自研 Playwright 为降级实现。判据：**判定内核（Judge / runId 隔离 / 论域收窄 / cleanup 终态 / 绑定校验）全部落在自研边界之上、一行不动；边界之下可整体替换** —— 12 条 FR 里含判定语义的一条都没被替换。配套两个同源小改动：**六重绑定加 `engine_provider_version`**（上游升级即 re-key 全部缓存，不绑就是一条静默错配通道）、**A7 拆 a/b**（把"回放态能离线"与"首次态必须断网降级"分开）→ 据此**「引擎缓存」列入交付物**（否则内网离线场景产品跑不起来）。**不建议 fork**（pre-1.0 改 API + 判定层正确落点本就是我们 Runtime）。
22. **⭐ 产品面向任意 B/S 系统，openFuyao 只是首个 SUT。**（2026-10-10）判据一句话：**「离开 openFuyao，这条还成立吗？」** 成立 → 产品要求；不成立 → SUT 适配项。据此把三处被 K8s 事实写死的要求改回中立表述：① **隔离单元**（`ns-idwth-<runId>` → 「run 级作用域，形式由 SUT 决定」；对象名内嵌 `runId + contractId` **两级** —— 同时堵住「上次残留」与**新发现的「批次内跨用例串扰」**两条假 PASS 通道）；② **环境指纹第 ④ 项**（「集群名」→「环境/部署标识」）；③ **core 层的「集群上下文键」硬要求**（降为「SPA 上下文需在 context 创建时引导，**键名由 SUT 适配提供**」）。**判定内核与隔离机制一行未改，改的是要求层措辞与隔离单元抽象。** 配套：`--keep-on-failure` 作 P1 显式开关（默认仍无条件清理）、"测试计划 = 一次批量执行 = 一个 `run_id`"（**不引入 `suite_id`**）。
23. **⭐ 产品形态定为「纯 CLI」，不要控制面。**（2026-10-10）裁定：**V1 = 形态 A（纯 CLI 单进程）** —— **不做常驻服务（daemon）、不做本地 Web 控制台、无前后端分离**。`product-definition.md` 的**形态 B**（`jev-harness` 常驻 + CLI + 本地控制台，HTTP+JSON 契约）/ **形态 C**（平台化）**未采纳**，该文 §3.2 与本节第 7 条均已加状态注留痕。M3 的 **`Report Viewer` 定形为单文件静态 HTML**（五要素与截图内联，零服务端、可离线双击打开）—— 避免被实现成一个本地 Web 服务。落点：`PRD.md` §1.3 / FR-8 / FR-10 / §十 · `detailed-design.md` §0.2 G 级（DD-47/DD-48）/ §1.2 / §3.7 / §十 / §十一 / §十三。

## 调研方式

四仓库全量浅克隆（共 384 文件）后逐行阅读源码，非文档转述。仓库元数据经已认证的 `gh` 取得
（匿名 API 从本机 IP 会 403 限流）。性能与验证数据来自各仓库自带文档，属**作者自测**，非独立复现；
P0 能力矩阵为本机独立实测。

调研日期：2026-09-22 ｜ 仓库数据为当日快照，四个仓库迭代极快，引用前请复核。
