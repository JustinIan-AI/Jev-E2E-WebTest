# 项目长期记忆：JEV-E2E-Test（BS 架构系统测试工具）

> **只放判据与决策**；推导、实测数据、源码行号在 `20260922-jev-bs-e2e-research/final/` 各文档。
> 超注入上限会被静默截断 → 加内容先并入既有小节。压缩前全文备份在 `memory/archive/`（最近：`MEMORY-project-20261010-precompact.md`）。

## 目标与定位
面向**任意企业级 B/S 系统**：**输入测试用例 → 输出完整测试报告**（五要素：用例 / 截图 / 是否通过 / 未通过原因 / 可复现过程）。

- 产品名 **IDWTH**（Intent-Driven Web Test Harness），Skill-First。`final/PRD.md` **V1.2**（要什么）→ `final/detailed-design.md` **V1.2**（怎么做）· `final/verification-checklist.md` **V1.2** · `visual-dom-matrix.md`（**Backlog 素材**）。
- 主链路：`Intent → Contract → 确定性执行（优先）/ JEV 语义决策与修复（按需）→ Evidence → 独立 Judge → Verdict`
- 三句边界：**Playwright 管"怎么稳定地做" / JEV 管"不确定时选什么动作" / Evidence+Judge 管"到底对不对"**。

## ★ 产品边界判据（2026-10-10 · SUT 中立化）
> **「离开 openFuyao，这条还成立吗？」** 成立 → **产品要求**；不成立 → **SUT 适配项**（留适配层，**不进 core**）。
> **openFuyao 只是首个可验证 SUT，不是产品边界。** 已据此剥离三处 K8s 写死：隔离单元 / 环境指纹第 ④ 项 / core 层的"集群上下文键"硬要求。

## 已冻结的技术决策
| 决策 | 内容 |
|---|---|
| 执行臂 | **CDP 主干**（`connectOverCDP` 接管现有 Chrome）；page-agent 仅 MFA/免安装**降级臂** |
| 浏览器复用 | 后台标签页不抢焦点（`createTarget(background:true)` + `setFocusEmulationEnabled`）；`newContext()` 每 case 强隔离（**引导键名由 SUT 适配提供**） |
| 判定 | **三态 PASS/FAIL/BLOCKED**；只有确定性断言能产生 FAIL；模型信号恒为 candidate；BLOCKED 永不计入 bug 检出 |
| 定位 | 三级 L1 确定性（ARIA role/label）→ L2 指纹复用 → L3 模型兜底（唯一付费点） |
| 学习飞轮 | L3 成功后指纹写回 plan → 下次走零成本 L2 → 成本单调递减到零。**必须离线**（写回候选 → **人确认** → 新 strategy → 进 CI），且 `confirmed_runs >= 2` 且连续 2 次成功才入 strategy |
| 执行引擎 | **第四层 `EngineProvider`（可替换）**：默认 `@e2e-dev/web`+`-decision`（Apache-2.0，同栈）；降级自研 Playwright。**判定内核（Judge/论域收窄/隔离/cleanup 终态/绑定校验）在自研边界之上，不可替换** |
| **隔离单元**（10-10 中立化） | **run 级作用域，形式由 SUT 决定**（K8s 实例化为 `ns-idwth-<runId>`）。**对象名/标签内嵌 `runId + contractId` 两级** —— runId 防「上次残留」，contractId 防**「批次内跨用例串扰」**。**setup/teardown 复用 `BackendAdapter`，不新增接口** |
| **run 粒度** | **一次批量执行 = 一个 `run_id` = 一次「测试计划」**；**不引入 `suite_id`**；"suite 级"统一改称 **run 级** |
| FAIL 现场 | **默认无条件清理**（`finally`，FAIL/BLOCKED/abort 照做）；`--keep-on-failure` 作 **P1 显式开关** |
| 报告配色 | PASS 中性/蓝 · FAIL 红 · BLOCKED 琥珀。**不用红绿表达通过与否**（避免与 A 股涨跌冲突） |
| 许可红线 | `CorieW/JevTest`、`TianyuCodings/JevHarness` **无 LICENSE → 只可借鉴设计，禁复制代码**；`jev-e2e`/`jev-ultrafast`/`page-agent` MIT；**`tester-army/e2e` Apache-2.0 可作依赖** |
| 赛道区分 | **JevHarness 不是测试框架**（零断言层/零报告层），是「策略固化 + GEPA 离线演化」＝架构里的 **L3 + 学习飞轮**那一格。**别用「无报告层」判它淘汰。** |
| 冻结产物绑定 | **六重**：`contract_hash` · `strategy_hash` · **`judge_impl_hash`**（最易漏） · `runner_version` · `env_fingerprint` · **`engine_provider_version`** → 任一不符即 `BLOCKED(drift)`。JevHarness 稿的「观测契约哈希 / 模型传输通道 / 数据用例集哈希」**未采纳（留档不静默删）** |
| 视觉通道 | **Backlog · 条件触发 · 非 V1**。触发＝**外部明确提供多模态大模型能力且主动要求启用视觉**；需求不进 PRD、设计不做。**P4.5 时点撤销**；验收用 `VB-01…VB-05` |
| 编号约定 | **验收编号全局唯一**：A 序列**只追加**到最大号之后、**禁止按主题重排**。PRD §7.1 = **12 条**（A1–A11，A7 拆 a/b） |
| 文档同步铁律 | **DD 定稿必须回填 PRD**；**checklist 判定列必须随吸收同步回填**；**改完必须 grep 断言「新串在、旧串零」**。踩过的坑：DD §3.7 定稿两版后 PRD FR-9 仍带旧稿；B01–B05/G03 已被吸收而判定列全空；A7b 要了交付物而清单没有；两套验收同叫 A10/A11 撞号 |
| **产品形态**（10-10） | **V1 = 纯 CLI（单进程）**：**不做常驻服务（daemon）/ 本地控制台 · 无前后端分离**；`product-definition.md` 形态 B/C **未采纳**（留档加状态注，不删）。**`Report Viewer` = 单文件静态 HTML**（数据内联 `report.json`，零服务端、可离线双击）；`--freeze` 为唯一写回入口 |

## ★ 架构铁律（13 条，均已实测或源码验证）
1. **编排者必须是确定性代码**。编排者是 LLM 则"确定性路径零模型调用"不成立（编排即调用）→ 拆 **Agent Runtime**（开发用）与 **CI Runtime**（确定性编排，**P0 验收唯一对象**）。
2. **判定权三独占**：判定逻辑的**调用权**、verdict 的**写入权**归 Runtime；verdict 为纯函数 `f(evidence, assertions)`，**可用归档 evidence 离线重算**。判据不是"做成 skill 没有"，而是"**调用权与写入权在谁手里**"。
3. **回放拆两模式**：`replay --verify`（默认，零模型，漂移即**报错终止**）/ `--heal`（显式，产物不入 CI）。**禁止静默适配状态漂移。**
4. **fixtures 必须内嵌 `runId + contractId` 两级标识**（10-10 由"只 runId"升级），cleanup 绑之，`exists` 类断言限定到"本 run 本用例创建集"。否则①残留 ②同批次其他用例 —— 两条假 PASS 通道。
5. **已派发的 mutation 不得自动重试**（重复创建 = 真实损害）。
6. **目标歧义（匹配数 >1）即 BLOCKED**，禁止取第一个。
7. **稳定性不能取平均**：比例型通过率必须取幂（`suite 绿灯率 ≈ p^n`）或改**「无 flaky case」二值硬门禁**。p=0.95 时 50 case suite 仅 **7.7%** 绿灯。
8. **判断"本次产生的"只能用身份标识，不能用时间先后**（E02 证伪）：`created_at > run_start` 自然节奏差 **−0.019s** → 假阴性。**根因不是时钟偏移**（仅 −0.5s），而是**跨系统时间戳精度/时区不齐**。配套：`text_contains` 必须带**完整 `runId` + `contractId`**，裸前缀 `"idwth-"` 封不住。
9. **断言论域收窄到"本 run 创建集"**（E02）：干净 namespace 里 `configmaps` **已有 1 个**（K8s 注入 `kube-root-ca.crt`）→ `count == 0` 在全新环境直接失败且**非缺陷**。与铁律 4 **镜像对称**：残留 → 假 PASS；系统注入 → 假 FAIL。同解：收窄论域 + `excluded_system_objects[]`。
10. **清理的「完成」是终态不是响应码**：`DELETE` 200 只代表"已受理"，namespace 仍 `Terminating` **6.2s** → 必须**轮询至 404**；超时 `BLOCKED(cleanup)`。⚠️ `DELETE` 只发一次，之后仅**只读 GET 轮询**（不违反铁律 5，须写进实现注释否则被误读）。
11. **视觉不能证明唯一性**：DOM 的 `matched == 1` 是**可计算整数**；视觉只能给"最像的"，**无法表达「匹配数 > 1」** → 视觉**永不进 L1/L2**、**定位角色永不产生 FAIL**。视觉唯一能产生 FAIL 的角色是**观察者**（确定性像素/SSIM/结构比对），且须过噪声闸门。
12. **模型不能创造目标 —— 论域收窄的第三次应用**：候选集**由代码生成并编号**，模型**只输出候选集内 index**，永不输出坐标/selector/JS；越界 → `BLOCKED(decision)` + 审计；候选集空 → 直接 BLOCKED 不调模型。
    → 三次同构：**残留 → 假 PASS**（收窄到本 run 创建集）· **系统注入 → 假 FAIL**（收窄 + 排除项）· **模型自由输出 → 凭空造目标**（收窄到候选集）。**判据的论域必须由代码划定。**
13. **视觉断言阈值必须先标定噪声下界**：同环境同页面同断点**连拍 N≥10**（静止、动画关）取 p95 得 `ε_base`；阈值须 **`> k · ε_base`（k≥3）**，否则该区域标 `visual_unstable` → **拒绝生成断言**（不是降级为 candidate）。配套：**Runtime 独占 4 → 5**（新增噪声闸门校验权；⚠️ 视觉归 Backlog 后 V1 仍为 4）。纯 Canvas 目标**不可回放** → 标 `replayable: false`，`replay --verify` 遇之**报错终止**（跳过 = "少了断言还报绿灯"）。

## 关键决策指针（细节在对应文档）
- **视觉 + DOM 双通道**（⚠️ 10-10 起 **Backlog · 非 V1**，P4.5 撤销）→ `visual-dom-matrix.md`：**DOM 证明唯一，视觉看见渲染，只有前者有资格宣判 FAIL**。三角色：定位（DOM 主力／视觉仅 L3 兜底且永不 FAIL）· 取证（Canvas/渲染层）· 判定（DOM 断言是唯一 FAIL 源）。**别用视觉解决"selector 易碎"**（那是飞轮的活）；视觉**只看得到 viewport 内**。**Skills 7→9（V1 仍为 7）**：模态是每个 skill 内部参数。**必须落代码的 3 模块**：`VisualOracle` · `VisualStabilityCalibrator` · `SensitiveRegionMasker`（规律：**凡"结论必须可复现"或"不能靠提示词强制"的，一律代码**）。参照 **Midscene.js（字节，MIT）**：厂商自己文档要求「需确定性校验时应把 AI 查询与标准代码断言组合」—— 我们不应比厂商更激进。
- **`tester-army/e2e` 基线** → `e2e-tester-army-review.md` + `e2e-architecture-adjustment.md`。**Apache-2.0 · TS（同栈 → 可作真实依赖）**·7.5k★·pre-1.0。值得抄：三步骤骨架 Goal/Assertion/Locator · **回放缓存**（动作**只在后来的独立验证步骤通过后才固化**；回放须核对起点 + 逐控件找回（歧义即停）+ 终点）· `@e2e-dev/decision` **只输出候选序号** · **Bug bash**：只有以 `ASSERTION_FAILED` 失败才算 bug · **benchmark 度量漏检** · **Canvas 确定性第三条路**（`getImageData` 读像素）。
  **两处与铁律冲突**：① **`ASSERTION_INCONCLUSIVE` 归 `failed` 类、exit 1**（`packages/decision/src/executor.ts:382`）→ 假 FAIL 通道，**抄错误码但 class 改 BLOCKED**；② **默认 heal 不 verify** → **我们默认必须 `--verify`**。
  **结论**：**可作「执行与证据引擎」插在判定内核之下；不重画架构、不 fork**。FR 边界：12 条 FR 中 **FR-6 Judge / FR-11 隔离完全自研不动 · FR-1 自研 · FR-2/3/5/7/8 换底层 · FR-4/9/10 包一层** —— **含判定语义的一条都没被替换**。互补三例（它缺、我们有）：`origins_allowlist` · 文本级遮罩 · `judge_impl_hash`。
- **从 JevHarness 嫁接**（**只取设计不引代码**）→ `jevharness-review.md`：① 多重绑定 → **已被 DD §3.7 六重取代**（余留档未采纳）② 规则注入要同源（prompt 不得**复述**规则，须注入真实校验器源码）③ **约束必须在代码里**（*"a prompt instruction alone is not enforcement"*）④ **超上限 ≠ 通过**（*"reaching a step limit is not a draw"*）。
- **首个 SUT：openFuyao（E01/E02）** → `e01-openfuyao-recon.md` / `e02-namespace-isolation.md`：`https://192.168.36.152:31616`（`admin`/`platform-admin`，单集群 `host`）· React+AntD+ECharts · UI 文案**完全外置**（**"翻译改了、DOM 没变、可访问名却变了"**是 L1 失效真实成因，环境指纹须绑文案资源哈希）· **登录不可进冻结产物**（OAuth2+CSRF+per-request state，密码走字节数组）· **K8s API 经 `/clusters/<c>/api/kubernetes/...` 代理 → backend 断言可完全绕开 UI** · 集群态只存 `sessionStorage`（需 `addInitScript` 引导）· **硬约束是 Canvas（ECharts）**，iframe 非必需 · **`ns-idwth-<runId>` 隔离 20/20**（create 201｜同名再建 409｜DELETE 200 → Terminating **6.2s** → 404｜重复 DELETE 404）· 只授权创建/删除测试命名空间 · 复跑 `scripts/of-*.py`（凭据只走环境变量）。**⚠️ 均为 K8s 适配实例，换 SUT 需重跑（checklist J 组）。**

## 两个易漏的真实泄漏口（评审必查）
1. **Playwright 自身 trace 与网络日志可能落盘带凭据的请求体** —— 即使声明"credential 永不进 Trace"，也要**实测 grep** trace 文件。
2. **截图遮罩集 `input/textarea/[contenteditable]/[data-private]` 遮不住页面里渲染的凭据明文**（kubeconfig 片段、Bearer token 不是输入框）→ 需补**文本级**遮罩。

## 待验证清单的三分类法
按「**谁回答**」分：**决策**（已给建议，待通过/驳回/改）· **实测**（纸面成立没跑过）· **外部**（依赖被测系统/许可证/第三方数据）。四种判定：**通过 / 修改 / 驳回 / 延后**（延后必须登记 Mx 前关闭，不静默丢失）。checklist 现 **68 项**，**已闭 14 项**。

## 工作区约定与环境坑
- 项目目录 `20260922-jev-bs-e2e-research/`（`final/` 文档 · `scripts/` 可复跑脚本）。**文档不膨胀：新增问题优先并入既有文档。**
- **改文档一律「脚本精确替换 + 改完逐条 grep 断言」** —— 本项目有 markdown 格式化钩子，逐条 `Edit` 可能被吃掉（返回 success 但没落盘）。
- Node `/Users/freecisco_yan/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Playwright 装在 managed workspace。
- **BSD grep 不认 `\|`** → 静默 0 命中；查 `--` 开头的串要 `grep -F -e '--xxx'`（否则被当参数）。**本机 `HTTP_PROXY` 注入会让内网地址假性不可达** → `curl --noproxy '*'`。

## 版本记录（明细见 `memory/archive/` 与各 final 文档）
- **09-22**：四仓库源码级调研 → `report.md`；执行臂决策 + CDP 复用实测 **14/14** → `implementation-plan.md`；产品定义 → `product-definition.md`；`browser.close()` **3/3（不关用户浏览器）**。
- **09-23**：`prd-review.md`（5 项阻塞决议全通过）；`jevharness-review.md`；DD **V1.0 → V1.1**（核心教训 **静态属性做判据 ❌ → 运行期结果做判据 ✅**）；`verification-checklist.md`；**E01/E02 完成**；`visual-dom-matrix.md`（铁律 11/12/13）。
- **10-08**：`e2e-tester-army-review.md` + `e2e-architecture-adjustment.md` → 裁定「5 项待决全按建议」→ **DD V1.1 → V1.2**（E 级 7 项：四层架构 · 六重绑定 · 引擎缓存入交付物 · 错误码吸附 · A7 拆 a/b · A10/A11）· **PRD V1.0 → V1.1**。
- **10-10 上半**：PRD 待优化项 grill-me 5 支 → **PRD V1.1 → V1.2**（视觉移 Backlog + `VB-01…VB-05` 改号 · 计数 12 条 + 编号约定 · FR-9 按 DD 六重重写 · 里程碑对齐 + 引擎缓存入交付物 · 引用 48→58 项 + 补 D07）；checklist 回填 B01–B05/G03。
- **10-10 下半**：**按 PRD V1.2 调 DD + SUT 中立化** → **DD 保持 V1.2，新增 F 级 10 项（DD-37~DD-46）**：上游指针改 `PRD.md` V1.2 · **M2 去 A7a / M4 加 A7a** + 注解改 A7b 语义 · §12 统一 **12 条** + 编号约定 · §4.0 视觉段改写为 BACKLOG 声明 · §3.6/§14「实测 <2MB」→「**估计（待实测，D07）**」· **立 SUT 中立判据** + PRD §八.3 重构两栏表 · **隔离单元中立化 + `runId`/`contractId` 两级** · 隔离复用 `BackendAdapter` · `--keep-on-failure` P1 · 「测试计划 = 一次批量执行，不引入 `suite_id`」。**PRD 同批回写**（§一 边界 / §二 去行业枚举 / FR-9 ④ / FR-11 / §7.3 P1 / §八.3 / 术语表）；**checklist 新增 J 组 2 条**（SUT 中立化，换 SUT 必跑）。4 文件脚本替换 **51 处** + grep 断言全绿。　**同轮追加（G 级 2 项 · DD-47/DD-48）**：裁定 **产品形态 = 纯 CLI、不要控制面**（不做常驻服务 / 控制台、无前后端分离）+ **`Report Viewer` 定形为单文件静态 HTML**；落点 PRD §1.3/FR-8/FR-10/§十 · DD §0.2 G 级/§1.2/§3.7/§十/§十一/§十三/头部 · README 摘要 23 · `product-definition.md`（§一/§3.2/P6/结论表状态注）· `prd-review.md` §6.3 注。**6 文件 29 处替换 + grep 断言全绿**。
