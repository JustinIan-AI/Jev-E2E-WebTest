# 项目长期记忆：JEV-E2E-Test（BS 架构系统测试工具）

> **只放判据与决策**；推导过程、实测数据、源码行号在 `20260922-jev-bs-e2e-research/final/` 各文档。
> 超注入上限会被静默截断 → 加内容先并入既有小节。压缩前全文备份在 `memory/archive/`。

## 目标与定位
面向企业级 B/S 系统（云管 / K8s / DevOps / CMDB）的系统测试工具：**输入测试用例 → 输出完整测试报告**
（五要素：测试用例 / 测试截图 / 是否通过 / 未通过原因 / 可复现过程）。

- 产品名 **IDWTH**（Intent-Driven Web Test Harness），Skill-First。文档：`final/PRD.md` **V1.2**（要什么）→ `final/detailed-design.md` **V1.2**（怎么做）。
- 主链路：`Intent → Contract → 确定性执行（优先）/ JEV 语义决策与修复（按需）→ Evidence → 独立 Oracle → Verdict`
- 三句边界（不可妥协）：**Playwright 管"怎么稳定地做" / JEV 管"不确定时选什么动作" / Evidence+Oracle 管"到底对不对"**。

## 已冻结的技术决策
| 决策 | 内容 |
|---|---|
| 执行臂 | **CDP 主干**（`connectOverCDP` 接管现有 Chrome）；page-agent 仅 MFA/免安装**降级臂** |
| 浏览器复用 | 后台标签页（`Target.createTarget(background:true)` + `setFocusEmulationEnabled`）不抢焦点；`newContext()` 每 case 强隔离 |
| 判定 | **三态 PASS/FAIL/BLOCKED**；只有确定性断言能产生 FAIL；模型信号恒为 candidate；BLOCKED 永不计入 bug 检出 |
| 定位 | 三级 L1 确定性（ARIA role/label）→ L2 指纹复用 → L3 模型兜底（唯一付费点） |
| 核心资产 | **学习飞轮**：L3 成功后指纹写回 plan → 下次走零成本 L2 → 模型成本单调递减到零。飞轮**必须离线**（L3 成功 → 写回候选 → **人确认** → 新 strategy → 进 CI），且 `confirmed_runs >= 2` 且连续 2 次成功才可入 strategy |
| 执行引擎 | **新增第四层 `EngineProvider`（可替换）**：默认实现 `@e2e-dev/web`+`-decision`（Apache-2.0，与 IDWTH 同栈）；降级实现自研 Playwright。**判定内核（Judge / 论域收窄 / runId 隔离 / cleanup 终态 / 绑定校验）在自研边界之上，不可替换** |
| 报告配色 | PASS 中性/蓝 · FAIL 红 · BLOCKED 琥珀。**不用红绿表达通过与否**（避免与 A 股涨跌冲突） |
| 许可红线 | `CorieW/JevTest`、`TianyuCodings/JevHarness` **均无 LICENSE → 只可借鉴设计，禁止复制代码**；`jev-e2e`/`jev-ultrafast`/`page-agent` MIT；**`tester-army/e2e` Apache-2.0 可作依赖** |
| 赛道区分 | **JevHarness 不是测试框架**（零断言层、零报告层），是「策略固化 + GEPA 离线演化引擎」＝架构里的 **L3 + 学习飞轮**那一格。**不要用「无报告层」判它淘汰。** |
| 冻结产物绑定 | **六重**：`contract_hash` · `strategy_hash` · **`judge_impl_hash`**（最易漏） · `runner_version` · `env_fingerprint` · **`engine_provider_version`**（上游升级即 re-key 全缓存）→ 任一不符即 `BLOCKED(drift)`。JevHarness 稿的「观测契约哈希 / 模型传输通道 / 数据用例集哈希」**未采纳（留档，不静默删）** |
| 视觉通道 | **Backlog · 条件触发 · 非 V1**。触发条件＝**外部明确提供多模态大模型能力且主动要求启用视觉**；需求不进 PRD、设计不做（`visual-dom-matrix.md` 降为素材）。**原 P4.5 时点撤销**；其验收改用 `VB-01…VB-05` 序列 |
| 编号约定 | **验收编号全局唯一**：A 序列**只追加**到最大号之后、**禁止按主题重排**。PRD §7.1 = **12 条**（A1–A11，A7 拆 a/b） |
| 文档同步铁律 | **DD 定稿后必须回填 PRD**；**checklist 判定列必须随 PRD 吸收同步回填**。本轮踩坑：DD §3.7 六重绑定定稿两版后 PRD FR-9 仍带 09-23 提议稿；B01–B05/G03 早已被 PRD 吸收而判定列全空；一条验收（A7b）要求了交付物（引擎缓存）而交付物清单里没有 |

## ★ 架构铁律（13 条，每条都已实测或源码验证）
1. **编排者必须是确定性代码**。编排者若是 LLM，"确定性路径零模型调用"不可能成立（编排本身即模型调用）→ 拆 **Agent Runtime**（开发用，不适用预算）与 **CI Runtime**（确定性编排，**P0 验收唯一对象**）。
2. **判定权三独占**：判定逻辑的**调用权**、verdict 的**写入权**归 Runtime 独占；verdict 是纯函数 `f(evidence, assertions)`，**可用归档 evidence 离线重算**。判据不是"做成 skill 没有"，而是"**调用权与写入权在谁手里**"。
3. **回放拆两模式**：`replay --verify`（默认，零模型，漂移即**报错终止**）/ `replay --heal`（显式，产物不得入 CI）。**禁止静默适配状态漂移。**
4. **fixtures 必须带 runId 命名空间**，cleanup 绑 runId；`exists` 类断言限定 runId 作用域。否则残留资源造成假 PASS。
5. **已派发的 mutation 不得自动重试**（CMDB/K8s 重复创建 = 真实损害）。
6. **目标歧义（匹配数 >1）即 BLOCKED**，禁止取第一个。
7. **稳定性指标不能取平均**：比例型通过率必须取幂（`suite 绿灯率 ≈ p^n`）或改为**「无 flaky case」二值硬门禁**。p=0.95 时 50 case suite 只有 **7.7%** 绿灯率。
8. **判断"这是本次产生的"只能用身份标识，不能用时间先后**（E02 证伪）：`created_at > run_start` 在自然节奏下差 **−0.019s** → 严格 `>` 直接判假阴性。**根因不是时钟偏移**（实测仅 −0.5s），而是**跨系统时间戳精度/时区不齐**。配套：`text_contains` 必须带**完整 runId**，裸前缀 `"idwth-"` 封不住。
9. **断言的论域要收窄到"本 run 创建的对象集"**（E02 实测）：干净 namespace 里 `configmaps` **已有 1 个**（K8s 自动注入 `kube-root-ca.crt`）→ `count == 0` 在全新环境直接失败且**非应用缺陷**。与铁律 4 **镜像对称**：残留 → 假 **PASS**；系统自动注入 → 假 **FAIL**。同解：收窄论域 + `excluded_system_objects[]`。
10. **清理的「完成」是终态，不是响应码**：`DELETE` 200 只代表"已受理"，namespace 仍在 `Terminating` **6.2s** → 判据必须**轮询至 404**；超时 `BLOCKED(cleanup)` 不放过。⚠️ `DELETE` 只发一次，之后仅**只读 GET 轮询** —— 不违反铁律 5，但须写进实现注释否则被误读。
11. **视觉不能证明唯一性**：DOM 的 `matched == 1` 是**可计算的整数**；视觉只能给"最像的那个"，**无法表达「匹配数 > 1」** → 视觉**永不进入 L1/L2**、**定位角色永不产生 FAIL**。视觉唯一能产生 FAIL 的角色是**观察者**（确定性像素/SSIM/结构比对），且必须过噪声闸门。
12. **模型不能创造目标 —— 论域收窄的第三次应用**：候选集**由代码生成并编号**（DOM 可交互元素 + Canvas 分块 + 可访问性树），模型**只输出候选集内 index**，永不输出坐标/selector/JS；越界 → `BLOCKED(decision)` + 独立审计；候选集为空 → 直接 BLOCKED，不调模型。
    → 三次同构：**残留 → 假 PASS**（收窄到本 run 创建集）· **系统注入 → 假 FAIL**（收窄 + 排除项）· **模型自由输出 → 凭空造目标**（收窄到候选集）。**判据的论域必须由代码划定。**
13. **视觉断言的阈值必须先标定噪声下界**：同环境同页面同断点**连拍 N≥10**（静止、动画关闭）取 p95 得 `ε_base`；阈值必须 **`> k · ε_base`（k≥3）**，否则该区域标 `visual_unstable` → **拒绝生成视觉断言**（不是降级为 candidate，是明确报"此处不可测"）。配套：**Runtime 独占项 4 → 5**（新增**噪声闸门校验权**；⚠️ 视觉归 Backlog 后 V1 仍为 4），`env_fingerprint_hash` 不匹配即重新标定。纯 Canvas 目标**不可回放** → 必须标 `replayable: false`，`replay --verify` 遇之**报错终止**（不得静默跳过 —— 跳过等于"少了断言还报绿灯"）。

## 关键决策指针（细节在对应文档，此处只留判据）
- **视觉 + DOM 双通道**（⚠️ 2026-10-10 起 **Backlog · 条件触发 · 非 V1**，P4.5 撤销）→ `final/visual-dom-matrix.md`：**DOM 的价值是"能证明唯一"，视觉的价值是"能看见渲染"，但只有前者有资格宣判 FAIL**。分三角色：定位（DOM 主力／视觉仅 L3 兜底且永不 FAIL）· 取证（Canvas/渲染层/布局 —— 视觉唯一手段）· 判定（DOM 断言是唯一 FAIL 源／视觉需过噪声闸门）。**不要用视觉解决"selector 易碎"**（那是学习飞轮的活，且零成本可回放）；视觉**只看得到 viewport 内**。**Skills 7 → 9，不是 14**：模态是每个 skill 内部的参数，只新增两个**人机接口性质**的 `web-visual-baseline` / `web-visual-diff-triage`。**必须落代码的 3 模块**：`VisualOracle` · `VisualStabilityCalibrator` · `SensitiveRegionMasker`（规律：**凡"结论必须可复现"或"不能靠提示词强制"的，一律代码**）。时机 **P4.5**，默认关闭，仅 Contract 声明 `kind: visual` 时加载。外部参照 **Midscene.js（字节，MIT）**：**厂商自己文档要求**「需确定性校验时应把 AI 查询与标准代码断言组合」—— 我们不应比厂商更激进。
- **`tester-army/e2e` 基线** → `final/e2e-tester-army-review.md`（源码评审）+ `final/e2e-architecture-adjustment.md`（架构调整）。**Apache-2.0 · TypeScript（与 IDWTH 同栈 → 可作真实依赖）** · 7.5k★ · npm v0.18.0（pre-1.0）。值得抄：三步骤骨架 Goal/Assertion/Locator · **回放缓存**（动作**只在后来的独立验证步骤通过后才固化**，"用例自己过了"不算验证；回放须核对起点 + 逐控件找回（歧义即停）+ 终点，且**必须有变化发生在本次回放首次屏幕之后**）· `@e2e-dev/decision` **只输出候选序号**（上限 255，prompt 规则源码注明改编自 `jev-ultrafast`）· **Bug bash**：Agent 只负责"怀疑"，**只有以 `ASSERTION_FAILED` 失败才算 bug** · **benchmark 度量漏检**（`planted-bugs.e2e.ts` 断言"对植入 bug 做 `agent.assert` 应当失败"）· **Canvas 确定性第三条路**（`getImageData` 读像素，不走模型视觉）。
  **两处与铁律冲突**：① **`ASSERTION_INCONCLUSIVE` 归 `failed` 类、exit 1**（`packages/decision/src/executor.ts:382`）→ 假 FAIL 通道，**抄错误码但 class 改 BLOCKED**；② **默认 heal 不 verify** → **我们的 `replay` 默认必须 `--verify`**。
  **架构调整结论（2026-10-08）**：**可以用于优化设计方案，但限定为一个动作 —— 把它作为「执行与证据引擎」，插在判定内核之下；不重画架构，不 fork。** ✅ **已决策（5 项待决全按建议）并全部回写 → `detailed-design.md` V1.2（新增 E 级变更清单 DD-30~DD-36，7 项）+ `PRD.md` V1.1**。 唯一架构改动 = **新增一层 `EngineProvider` 接口**（三层 → 四层；与既有 `BackendAdapter`/`JevDecisionProvider` 同手法）。默认实现 `@e2e-dev/web`+`-decision`，降级实现自研 Playwright adapter（`attach.ts` CDP 接管 + `background-tab.ts` **必须自研 —— e2e 不提供**）。FR 安全边界：12 条 FR 中 **FR-6 Judge / FR-11 runId 隔离完全自研不动 · FR-1 保持自研（e2e 无"文档→用例"）· FR-2/3/5/7/8 换底层 · FR-4/9/10 包一层** —— **含判定语义的一条都没被替换**。绑定项定为**六重**（含 `judge_impl_hash` 与 `engine_provider_version`：上游**升级即 re-key 全部缓存**，等价于 `BLOCKED(drift)` 但它默认 heal 不报错）。**A7 拆两条**：A7a 回放态断网全可跑 / **A7b 首次态断网 → 需 L3 的 step 必须 `BLOCKED(decision)`** → **新交付物「已录制的引擎缓存」须随版本交付**（否则内网离线时 A7b 成常态）。**新增 A10/A11**（A10 断言区在视口外/加载中/Canvas → 必须 BLOCKED 不得 FAIL；A11 陈旧记录默认命令回放 → 必须报错终止不得静默 heal）。**不建议 fork**。互补三例（它缺、我们有）：`origins_allowlist` · 文本级遮罩 · `judge_impl_hash`。
- **从 JevHarness 嫁接四件** → `final/jevharness-review.md`：① ~~固化产物绑定扩为六重~~ → **已被 DD §3.7 取代**（2026-10-10 定为 contract/strategy/judge_impl/runner/env/engine_provider 六重；本条其余字段留档未采纳）。原文（`spec_hash` + 执行器源码哈希 + 观测契约哈希 + 模型传输通道 + **任务合约**（评估器源码哈希/规则文件/目录树摘要/`git(commit,clean)`/运行指纹）+ 数据用例集哈希），任一不符 → 拒绝执行 + `BLOCKED(drift)` ② 规则注入要同源（prompt 不得**复述**规则，须把真实校验器源码注入模型）③ **约束必须在代码里**（*"a prompt instruction alone is not enforcement"*）④ **超上限 ≠ 通过**（*"reaching a step limit is not a draw"*）。
- **openFuyao（E01/E02）** → `final/e01-openfuyao-recon.md` / `final/e02-namespace-isolation.md`：`https://192.168.36.152:31616`（`admin`/`platform-admin`，单集群 `host`）· React+AntD+ECharts · UI 文案**完全外置**（`/locales/{{lng}}/{{ns}}.json` → **"翻译改了、DOM 没变、可访问名却变了"**是 L1 失效真实成因，环境指纹须绑文案资源哈希）· **登录不可进冻结产物**（OAuth2 + CSRF + per-request state，密码走字节数组）· **K8s API 经 `/clusters/<c>/api/kubernetes/...` 代理 → backend 断言可完全绕开 UI** · 集群态只存 `sessionStorage`（`newContext()` 需 `addInitScript` 引导）· **硬约束是 Canvas（ECharts）**，iframe 非必需 · **`ns-idwth-<runId>` 隔离 20/20 通过**（create 201｜同名再建 409｜DELETE 200 → Terminating **6.2s** → 404｜重复 DELETE 404 幂等）· 只授权创建/删除测试命名空间，**未授权写业务对象** · 复跑 `scripts/of-*.py`（凭据只走环境变量）。

## 两个易漏的真实泄漏口（评审设计时必查）
1. **Playwright 自身的 trace 与网络日志可能落盘带凭据的请求体** —— 即使声明"credential 永不进 Trace"，也要**实测 grep** trace 文件。
2. **截图遮罩集 `input/textarea/[contenteditable]/[data-private]` 遮不住页面里渲染的凭据明文**（kubeconfig 片段、Bearer token 不是输入框）→ 需补**文本级**遮罩。（`tester-army/e2e` 的遮罩同样只到输入控件级且 fail-closed，印证此判断。）

## 待验证清单的三分类法（整理任何"设计待办"时套用）
按「**谁回答**」分：**决策**（已给建议，待通过/驳回/改）· **实测**（纸面成立但没跑过）· **外部**（依赖被测系统/许可证/第三方数据）。四种判定：**通过 / 修改 / 驳回 / 延后**（延后必须登记 Mx 前关闭，不静默丢失）。

## 工作区约定与环境坑
- 项目目录 `20260922-jev-bs-e2e-research/`（`final/` 交付文档 · `scripts/` 可复跑脚本）。**文档不膨胀：新增问题优先并入既有文档。**
- Node 运行时 `/Users/freecisco_yan/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Playwright 装在 managed workspace。
- **BSD grep 不认 `\|` → 静默 0 命中**（已因此差点误判"e2e 不支持 iframe"）；中文模式一律上 Grep 工具。**本机 `HTTP_PROXY` 注入会让内网地址假性不可达** → `curl --noproxy '*'` / `env -u HTTP_PROXY`。

## 版本记录（明细见 `memory/archive/` 与各 final 文档）
- **09-22**：四仓库源码级调研 → `final/report.md`；执行臂决策 + CDP 复用实测 **14/14** → `final/implementation-plan.md`；产品定义与 skill 边界 → `final/product-definition.md`；`browser.close()` 语义 **3/3 轮一致（不关用户浏览器）**。
- **09-23**：评审 IDWTH V1.2 PRD → `final/prd-review.md`（5 项阻塞决议全通过）；调研 JevHarness → `final/jevharness-review.md`；DD V1.0 → **V1.1**（核心教训 **静态属性做判据 ❌ → 运行期结果做判据 ✅**）；`final/verification-checklist.md`（48 项）；**E01/E02 完成**；`final/visual-dom-matrix.md`（新增铁律 11/12/13、Skills 7→9、Runtime 独占 4→5、P4.5）。
- **10-08**：`final/e2e-tester-army-review.md`（源码评审）；**`final/e2e-architecture-adjustment.md`**（架构调整方案：`EngineProvider` 层 + FR 级映射 + A10/A11 + A7 拆 a/b + 引擎缓存入交付物）；README 补回漏登记的 `visual-dom-matrix.md`。
  → 用户裁定「5 项待决全按建议走」→ **回写落地：`detailed-design.md` V1.1 → V1.2**（§0.2 新增 E 级 7 项 · §1.1 新增目标 6 · §2.1 四层架构图 · §3.7 六重绑定 + `engine_provider_version` · §5.0 新增 Engine Provider 层 · §6.1 新增 ⑥ 恢复触发权 · §6.2 引擎缓存入交付物 · §8.2 错误码吸附 · §11 目录加 `engine-provider/` 与 `runtime/scope.ts|error-adapter.ts|bindings.ts` · §12 A7 拆 a/b + A10/A11 · §13 里程碑三处 · §14 关闭 5 项）· **`PRD.md` V1.0 → V1.1**（A1–A11 · NFR 增「可替换」「可离线」）。

- **10-10**：PRD 待优化项评审（grill-me 5 支，逐支裁定）→ **`PRD.md` V1.1 → V1.2**：① 视觉通道移入 **§十二 Backlog**（不进 V1、设计不做、P4.5 撤销）② 验收 `A10–A14`（视觉那套）改号 **`VB-01…VB-05`**，PRD §7.1 计数 `11 条`→**12 条** + 编号只追加约定 ③ **FR-9 绑定项按 DD §3.7 六重重写**（补 `judge_impl_hash`/`engine_provider_version`，三项旧提案留档）④ 里程碑对齐（M2 A7→**A7b** + 判据改写 · M3 +**A10** · M4 +**A11·A7a**）+ **「已录制的引擎缓存」入交付物** ⑤ PRD 引用 `48 项`→**58 项** + 补登 **D07**；checklist 回填 **B01–B05/G03** 判定（**已闭 14 项**）· 版本行更新 · H 组转 Backlog。改动 5 文件，脚本精确替换 62 处 + grep 断言（避开逐条 Edit 被钩子吃掉的坑）。
