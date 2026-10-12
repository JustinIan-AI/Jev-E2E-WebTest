# 项目长期记忆：JEV-E2E-Test（BS 架构系统测试工具）

## 项目目标
面向企业级 B/S 系统（云管 / K8s / DevOps / CMDB）的系统测试工具：**输入测试用例 → 输出完整测试报告**
（报告五要素：测试用例 / 测试截图 / 是否通过 / 未通过原因 / 可复现过程）。

## 产品名与定位（承接外部 PRD）
- 产品名：**IDWTH（Intent-Driven Web Test Harness）**，Skill-First 定位。
- 主链路：`Intent → Contract → 确定性执行（优先）/ JEV 语义决策与修复（按需）→ Evidence → 独立 Oracle → Verdict`
- 三句边界（不可妥协）：Playwright 管"怎么稳定地做" / JEV 管"不确定时选什么动作" / Evidence+Oracle 管"到底对不对"。

## 已冻结的技术决策
| 决策 | 内容 |
|---|---|
| 执行臂 | **CDP 为主干**（Playwright `connectOverCDP` 接管现有 Chrome），page-agent 仅作 MFA/免安装**降级臂** |
| 浏览器复用 | 后台标签页（`Target.createTarget(background:true)` + `setFocusEmulationEnabled`）**不抢焦点**；`browser.newContext()` 做每 case 强隔离 |
| 判定 | **三态** PASS/FAIL/**BLOCKED**；只有确定性断言能产生 FAIL；模型信号恒为 candidate；BLOCKED 永不计入 bug 检出 |
| 定位 | 三级：L1 确定性（ARIA role/label，目标命中 >80%）→ L2 指纹复用 → L3 模型兜底（唯一付费点） |
| 核心资产 | **学习飞轮**：L3 成功后指纹写回 plan → 下次走零成本 L2 → 模型成本随跑次数单调递减到零 |
| 报告配色 | 国内约定：PASS 中性/蓝、FAIL 红、BLOCKED 琥珀。**不用红绿表达通过与否**（避免与 A 股涨红跌绿冲突） |
| 许可红线 | `CorieW/JevTest` **无许可证 → 只能借鉴设计，禁止复制代码**；`TianyuCodings/JevHarness`（auto-jev）**同样无许可证**；`jev-e2e` / `jev-ultrafast` / `page-agent` 均 MIT |
| 赛道区分 | **JevHarness 不是测试框架**（零断言层、零报告层），它是「策略固化 + GEPA 离线演化引擎」，对应我们架构里的 **L3 + 学习飞轮**那一格。**不要用「无报告层」判它淘汰。** |

## ★ 架构铁律（评审 IDWTH PRD 时确立）
1. **编排者必须是确定性代码**。若编排者是 LLM，则"确定性路径零模型调用"不可能成立（编排本身即模型调用）。
   → 拆 **Agent Runtime**（开发用，不适用预算）与 **CI Runtime**（确定性编排，**P0 验收唯一对象**）。
2. **判定权三独占**：判定逻辑的**调用权**、verdict 的**写入权**归 Runtime 独占；verdict 必须是纯函数 `f(evidence, assertions)`，**可用归档 evidence 离线重算**。
   → 判据不是"做成 skill 没有"，而是"**调用权与写入权在谁手里**"。Skill 只是封装形式。
3. **回放必须拆两个模式**：`replay --verify`（默认，零模型，漂移即**报错终止**）/ `replay --heal`（显式，产物不得入 CI）。**禁止静默适配状态漂移。**
4. **fixtures 必须带 runId 命名空间**，cleanup 绑 runId；`exists` 类断言限定 runId 作用域。否则残留资源造成假 PASS。
5. **已派发的 mutation 不得自动重试**（CMDB/K8s 重复创建 = 真实损害）。
6. **目标歧义（匹配数 >1）即 BLOCKED**，禁止取第一个。
7. **稳定性指标不能取平均**：比例型通过率必须取幂（`suite 绿灯率 ≈ p^n`）或改为**「无 flaky case」二值硬门禁**。"单 case ≥95%" 在 50 case suite 里只有 7.7% 绿灯率。
8. **判断"这是本次产生的"只能用身份标识，不能用时间先后**（E02 实测证伪）：`created_at > run_start` 在自然节奏下差 **−0.019s**，严格 `>` 直接判假阴性。**根因不是时钟偏移**（实测仅 −0.5s），而是**跨系统时间戳精度/时区不齐**。
   → **凡跨系统的时间戳比较，都不能作为归属判据**。用名字/标签内嵌 runId。配套：`text_contains` 必须带**完整 runId**，裸前缀 `"idwth-"` 封不住。
9. **断言的论域要收窄到"本 run 创建的对象集"**（E02 实测发现）：干净命名空间里 `configmaps` **已有 1 个**（K8s 自动注入 `kube-root-ca.crt`）→ `count == 0` 在全新环境上直接失败，且**不是应用缺陷**。
   → 与规则 4 **镜像对称**：残留 → 假 **PASS**；系统自动注入 → 假 **FAIL**。同一条解法：收窄论域 + `excluded_system_objects[]`。
10. **清理的「完成」是终态，不是响应码**：`DELETE` 返 200 只代表"已受理"，namespace 仍在 `Terminating` **6.2s**。判据必须是**轮询至 404**；超时 → `BLOCKED(cleanup)` 不静默放过。
    ⚠️ 区分：`DELETE` 只发一次，之后只做**只读 GET 轮询** —— 这不违反规则 5「mutation 不得重试」，但必须写进实现注释否则会被误读。

11. **视觉不能证明唯一性**（视觉通道设计，2026-09-23 确立）：DOM 的 `matched == 1` 是**可计算的整数**，视觉只能给"最像的那个"—— **它无法表达「匹配数 > 1」这个状态**，因此视觉**永不进入 L1/L2**、**定位角色永不产生 FAIL**。视觉唯一能产生 FAIL 的角色是**观察者**（确定性像素/SSIM/结构比对），且必须过噪声闸门。
    → 推论：视觉的定位能力（L3 第二模态）永远只是兜底；**视觉的主战场是"看见 DOM 看不见的东西"（Canvas/渲染层），不是"更聪明地找元素"**。
12. **模型不能创造目标 —— 论域收窄的第三次应用**：候选集**由代码生成并编号**（DOM 可交互元素 + Canvas 分块 + 可访问性树），模型**只输出候选集内的 index**，永不输出坐标/selector/JS。越界 → `BLOCKED(decision)` + 独立审计事件。候选集为空 → 直接 `BLOCKED`，不调模型。
    → 与前两次同构：**残留 → 假 PASS**（收窄到本 run 创建集）· **系统自动注入 → 假 FAIL**（收窄 + 排除项）· **模型自由输出 → 凭空造目标**（收窄到候选集）。**判据的论域必须由代码划定，这是同一条原则的三次应用。**
13. **视觉断言的阈值必须先标定噪声下界**：同环境同页面同断点**连拍 N≥10 次**（静止、动画关闭）取 p95 得 `ε_base`；断言阈值必须 **`> k · ε_base`（k≥3）**，否则该区域标 `visual_unstable` → **拒绝生成视觉断言**（不是降级为 candidate，是明确报"此处不可测"）。
    → 这是铁律 7「稳定性不能取平均」的视觉版。配套：**Runtime 独占项 4 → 5**（新增**噪声闸门校验权**），`env_fingerprint_hash` 不匹配即要求重新标定（否则"在我机器上过了"成为新假 PASS 通道）。
    → 纯 Canvas 目标**不可回放**：必须标 `replayable: false`，`replay --verify` 遇之**报错终止**（不得静默跳过 —— 跳过等于"少了断言还报绿灯"）。

## ★ 视觉 + DOM 双通道的判定（2026-09-23 确立，详见 `final/visual-dom-matrix.md`）
> **DOM 的价值是"能证明唯一"，视觉的价值是"能看见渲染"。谁也不能替谁，但只有前者有资格宣判 FAIL。**

| 位置 | DOM | 视觉 |
|---|---|---|
| **操作 · 定位** | 主力（唯一性可证 · 零成本 · 毫秒级） | 仅 L3 兜底；产出坐标**不可回放**（须反查 DOM 锚点，否则 `replayable: false`）；**永不产生 FAIL** |
| **观察 · 取证** | 文本 / 结构 / 属性 / HTTP / backend | **Canvas · 渲染层 · 布局 —— 唯一手段** |
| **判定 · Oracle** | 断言是唯一 FAIL 源 | **需过噪声闸门**才能产生 FAIL |

- **唯一硬需求已实测**：E01 发现 openFuyao 的 ECharts **画在 Canvas 上，DOM 里没有数据** → V1 只能整块排除图表页；**视觉 Oracle 正是把它拿回来的路径**。但**监控数据仍应优先走 backend 断言**（零成本、确定性更高），视觉只补「**数据对但渲染错**」那一层（轴线错位/图例被遮/字号溢出）。
- **不要用视觉解决"selector 易碎"** —— 那是**学习飞轮**（L2 指纹）的活，且飞轮**零成本可回放**。视觉只用在 **DOM 根本做不到**的地方。第三条硬证据：**视觉只能看到 viewport 内**，DOM 可定位视口外元素。
- **Skills 形状：7 → 9，不是 14**。模态（DOM/视觉）是**每个 skill 内部的参数**，不是新 skill —— 按模态重切会得到 7×2 个横切重复的 skill。只新增 2 个**人机接口性质**的：`web-visual-baseline`（基线审批流）· `web-visual-diff-triage`（差异分诊）。
- **必须落代码的 3 个模块（不能做成 skill）**：`VisualOracle`（判定）· `VisualStabilityCalibrator`（前置闸门）· `SensitiveRegionMasker`（安全边界）。规律：**凡"结论必须可复现"或"不能靠提示词强制"的，一律代码**。
- **截图升级为"模型输入"是唯一新增泄漏面**：截图从"只进报告给人看"变成"同时进第三方模型上下文"。遮罩必须做**确定性敏感区域排除**（定位敏感节点 → 取 bbox → 涂抹 → 再截图），**不能靠提示词让模型别看**。
- **时机 P4.5，三个前置条件缺一不可**：① DOM 路径稳定性闸门已过（无 flaky case）② 噪声标定器已跑通 ③ 有真实 Canvas 断言需求。**加载条件**：仅当 Contract 声明 `kind: visual` / `modality: vision` 时才加载视觉通道，默认关闭。
- **视觉方案的外部参照（Midscene.js，字节跳动，MIT）**：其**官方文档自己要求**「为降低假阳/假阴，需要确定性校验时应把 AI 查询与标准代码断言组合使用」—— **厂商自己承认视觉断言不确定**，我们不应比厂商更激进。其公开局限：只看 viewport、动态渲染需显式等待、每步 500–2000 tokens。

## ★ 外部实现基线：`tester-army/e2e`（2026-10-08 源码级评审，详见 `final/e2e-tester-army-review.md`）
> **判定：同赛道，且是截至目前与 IDWTH 主干最同构的外部实现 —— 不是「可借鉴」，是「主干已经建好了」。** Apache-2.0（无红线）· TS · 7.5k★ · npm `e2e` v0.18.0（pre-1.0）。

**可直接抄规格的六件**：
1. **三步骤骨架**：Goal(`agent.act`) / Assertion(`agent.assert`·`waitFor`·`extract`) / Locator(`screen`·`expect`，零模型)。
2. **回放缓存**：动作**只在「后来的独立验证步骤」通过后才固化**（「用例自己过了」不算验证 → 掐死自证）；回放必须核对起点屏幕 + 逐个找回控件（**歧义即停**）+ 核对终点，且**必须有一个变化发生在本次回放的首次屏幕之后**（*"already on screen before the actions that should produce it proves nothing"*）；命名计数算效果、**裸数字不算**、导航后屏幕上的计数不算（防上轮残留）。
3. **`@e2e-dev/decision`**：模型**只输出候选元素序号**（`MAX_CHOICES=255`，视口优先，超出计 `omitted`），动作绑定在代码里；唯一候选不提问；**源码注明 prompt 规则改编自 `jev-ultrafast` 的 `NEXT_ACTION`/`TARGET`** → JEV 血统可见。
4. **Bug bash 的判定权归属**（★ 最值得抄）：编码 Agent 起 5–10 charter × 4 并发 `e2e explore` → 合并 → 剔除已知原因 → **为每条写复现测试** → **只有以 `ASSERTION_FAILED` 失败才算 bug**。Agent 只负责「怀疑」，确定性测试负责「定罪」。
5. **官方 benchmark 的度量方式**（★ 工程实践）：`apps/web-benchmark` 20+ 硬场景（嵌套 shadow root / 纯 Canvas / 嵌套 iframe / 原生对话框 / 第二标签页 / 拖放 / 每秒重挂载 DOM / 说谎的访问树）；`planted-bugs.e2e.ts` **断言「对植入 bug 的正确行为做 `agent.assert` 应当失败」→ 度量漏检而非通过率**；做不到的场景**声明并 skip 写清原因**。
6. **Canvas 的第三条路**：官方用 `browser.evaluate` + `canvas.getContext('2d').getImageData` 读像素/数色带做**确定性** canvas 断言 —— 不走模型视觉。比 `visual-dom-matrix.md` 原方案多一个选项。

**★ 两处与铁律冲突（必须回写判定层设计，否则实现时会被上游默认值带走）**：
- **① `ASSERTION_INCONCLUSIVE` 归 `failed` 类，exit 1** —— 即「模型判不出来」被记为**测试失败**。源码 `packages/decision/src/executor.ts:382`：`/** Insufficient evidence must never become an assertion pass. */ function inconclusive(...) { return { status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' } }`。它怕假 PASS（动机对），代价是**假 FAIL**。→ **抄这个独立错误码，但改 class 为 BLOCKED，不计入 bug 检出。**
- **② 默认 heal 不 verify**：`--strict-cache` 才让陈旧记录 `REPLAY_STALE` 报错终止（不调模型不重试 exit 2）；默认是悄悄交给 agent 兜底，文档自承 *"quiet by default … every CI run pays for the model calls until someone re-records"*。→ **IDWTH 的 `replay` 默认必须是 `--verify`。**

**我们的绑定面是它的超集**：它绑 instruction/params/agent/agentContext/app identity，**无「判定器实现源码哈希」**；`vision: true` 直接进模型判定，**无 `ε_base` 噪声标定、无 `visual_unstable` 拒绝**。
**它的空白＝我们的领域知识**：无 runId 命名空间、无断言论域收窄/系统对象排除、无 cleanup 终态判据、无跨系统时间戳归属判据 —— 全部要自建（即 E01/E02 踩出来的那些）。

## ★ 从 JevHarness 嫁接的四件（评审 2026-09-23 确立，只抄设计与字段，不引代码）
1. **固化产物绑定扩为六重**：`spec_hash` + **执行器源码哈希** + **观测契约哈希** + 模型传输通道 + **任务合约**（评估器源码哈希 / 规则文件 / 目录树摘要 / `git(commit, clean)` / 可执行文件哈希 / 运行时指纹）+ 数据用例集哈希。任一不符 → **拒绝执行并报 BLOCKED(drift)**。（我们现只存 `sha256(plan)`，太窄）
2. **规则注入要同源**：planner / L3 自愈的 prompt 不得**复述**校验规则，必须把执行器**真实校验器源码与白名单集合**注入模型（`inspect.getsource`）。
3. **约束必须在代码里**：*"a prompt instruction alone is not enforcement"* —— 候选不得改写奖励/断言/标签/评估器/动作权限，必须是代码校验而非 prompt 一句话。
4. **超上限 ≠ 通过**：*"reaching a step limit is not a draw"* —— 步数/预算/时长触顶必须抛错作废，不得记半分或跳过。

## ★ 产品定义边界（评审 2026-09-23 确立）
> **演化只优化「允许模型决定的那部分」（L3 选哪个控件），优化目标由确定性断言提供；它优化策略，不参与判定。**
> 前提：「候选不可改写 evaluator」。**所以「学习飞轮」与「判定权独占」不冲突，可同时成立。**

## ★ 首批验证对象：openFuyao 管理平台（E01 已侦察，2026-09-23）
- 地址 `https://192.168.36.152:31616`，账号 `admin` / `platform-admin`。**单集群 `host`**。K8s + nginx ingress（内部自签 CA）。
- 前端：**React + Ant Design + ECharts**；单 bundle 5.33MB；**UI 文案完全外置**（`i18next-http-backend`，`/locales/{{lng}}/{{ns}}.json`，ns 仅 nav/common/alert/dns）。
- 测试面：**106 路由 / 13 个一级菜单 / 14 个 K8s API 组**。菜单权威清单在 `/locales/zh-CN/nav.json`。
- **登录机理**：OAuth2 授权码 + `gorilla.csrf.Token` + per-request `state`；密码以 `Array.from(TextEncoder.encode(pwd))` **字节数组**提交。→ **登录不可进冻结产物**。
- **数据通路**：平台把 K8s 原生 API 经 **`/clusters/<c>/api/kubernetes/...`** 代理出来（只读实测 200）。→ `backend:` 断言**不经 UI** 直接命中 K8s API；**数据隔离用 K8s Namespace 作 runId 单元**。
- **集群态只存 `sessionStorage`**（`sessionStorage.getItem("cluster")`），路由不含 cluster 段，选集群只在登录时跑一次 → `newContext()` 强隔离需补 `addInitScript` 引导。
- **iframe 非必需**（全 bundle 仅 1 处，属 ECharts 内部）；真硬约束是 **Canvas（ECharts）** → 图表/监控断言必须走后端。
- 复跑：`scripts/of-recon.py --api`（凭据走 `OF_USER`/`OF_PWD` 环境变量，**不落盘**）。

### E02 实测：数据隔离（2026-09-23）
- **授权边界**：用户只授权「**创建/删除测试命名空间**」，**未授权写业务对象**。要验证"创建 Deployment 后断言"链路需**再次授权**。写操作一律**三重守卫**：名字前缀 + 本进程白名单 + 标签核验。
- **结论**：`ns-idwth-<runId>` 隔离单元 **20/20 通过**。create 201 ｜ 同名再建 **409**（可判定）｜ DELETE 200 → Terminating **6.2s** → 404 ｜ 重复 DELETE **404**（幂等，cleanup 可安全重跑）｜ 基线 diff 三项全空。
- **`labelSelector=idwth.io/run-id=<runId>` 可用**：命中 1 / 对不存在 runId 命中 0 不误伤 → **孤儿巡检入口**。平台侧**未实现 TTL 回收**（`idwth.io/ttl` 注解无人消费）。
- 复跑：`scripts/of-ns-lifecycle.py`（`--delay N` 复现时间戳精度对照实验）· `scripts/of-clock-skew.py`（只读测时钟偏移）。

## 工作区约定
- 项目目录：`20260922-jev-bs-e2e-research/`（`final/` 放交付文档、`scripts/` 放可复跑实测脚本）
- 文档不膨胀：新增问题优先并入既有文档，不为每轮对话新建文件。
- Node 运行时：`/Users/freecisco_yan/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`；Playwright 装在 managed workspace。

## 版本记录
- 2026-09-22：四仓库源码级调研 → `final/report.md`；执行臂决策 + CDP 复用实测 14/14 → `final/implementation-plan.md`；产品定义与 skill 边界 → `final/product-definition.md`
- 2026-09-23：评审 IDWTH V1.2 PRD → `final/prd-review.md`
- 2026-09-23（下午）：源码级调研 `TianyuCodings/JevHarness` → `final/jevharness-review.md`（赛道判定 + 四件可嫁接物 + 产品定义边界；同步修补 `ai-e2e-test-framework-audit` skill 的「第零步 赛道判定」）
- 2026-09-23（下午）：优化 IDWTH 详细设计 V1.0 → V1.1（**替换版**）`final/detailed-design.md`（26 项修订 / 9 项架构级；核心教训：**静态属性做判据 ❌ → 运行期结果做判据 ✅**）
- 2026-09-23（下午）：输出 `final/verification-checklist.md`（**43 项待验证清单**，供逐条评审）：A 阻塞决议 5 · B 非阻塞 5 · C 开放问题 2 · D 未实测假设 18 · E 需真实系统 5 · F 合规时效 5 · G 范围顺序 3
- 2026-09-23（下午）：**E01 完成** → `final/e01-openfuyao-recon.md` + `scripts/of-recon.py`。目标 = openFuyao 管理平台。六条影响设计的发现（i18n 外置 / 集群态 sessionStorage / 登录不可冻结回放 / iframe 非必需 / K8s 代理可作后端断言 / React+AntD）。清单新增 D17/D18，E01 ✅ 通过
- 2026-09-23（下午）：新增环境坑 —— 本机 `HTTP_PROXY` 注入会让**内网地址假性不可达**，必须 `env -u HTTP_PROXY` / `curl --noproxy '*'`
- 2026-09-23（下午）：**E02 完成** → `final/e02-namespace-isolation.md` + `scripts/of-ns-lifecycle.py` + `scripts/of-clock-skew.py`。命名空间生命周期 **20/20 通过**，写操作 5 次零残留，基线 diff 全空。**证伪 `created_at > run_start`**（→ 架构铁律 8）；发现**系统自动注入致假 FAIL**（→ 铁律 9）与 **cleanup 异步需等终态**（→ 铁律 10）。E03 技术侧已闭。清单新增 D19/D21 + E06/E07 → **48 项**；回写 `detailed-design.md` §3.1/§3.2/§8.1
- 2026-09-23（晚）：输出 `final/visual-dom-matrix.md`（**视觉 + DOM 双通道设计**）。核心判定：**主从而非并列**。新增**铁律 11/12/13**、**验收 A10–A14**、**Skills 7 → 9**、**必须落代码 3 模块**、**Runtime 独占 4 → 5**、**路线图位置 P4.5**。清单新增 **H 组 5 条 → 53 项**，回写 `detailed-design.md` §4.0/§6.1 与 `verification-checklist.md` 头部/总览/决议表。**触发点**：用户问「是否可以结合 JEV 完成基于视觉+DOM 的测试 Skills 矩阵」—— 答案是能，但视觉必须被限定在 DOM 结构性无能处（Canvas/渲染层）

- 2026-10-08：**源码级调研 `tester-army/e2e`** → `final/e2e-tester-army-review.md`（新建）。判定：**同赛道，且是截至目前与 IDWTH 主干最同构的外部实现**。Apache-2.0（无红线）· 7.5k★ · npm `e2e` v0.18.0。产出「可直接用 6 件 / 必须自建 10 件」两列对照 + **两处与铁律冲突**（`ASSERTION_INCONCLUSIVE` 归 `failed` 类 = 假 FAIL 通道；默认 heal 不 verify）。同时 README 交付物表补回此前漏登记的 `visual-dom-matrix.md`。**方法论教训：BSD grep 不认 `\|` → `grep -rn "frameLocator\|iframe"` 静默 0 命中，差点误判「不支持 iframe」；改用 `-rE` 后命中 8 处。中文模式一律上 Grep 工具。**

## 待验证清单的三分类法（整理任何"设计待办"时直接套用）
按「**谁回答**」分：**决策**（已给建议，待通过/驳回/改）· **实测**（纸面成立但没跑过，先跑出数据再看结论）· **外部**（依赖被测系统 / 许可证 / 第三方数据）。
四种判定：**通过 / 修改 / 驳回 / 延后**（延后必须登记 Mx 前关闭，不静默丢失）。

## 两个易漏的真实泄漏口（评审设计时必查）
1. **Playwright 自身的 trace 与网络日志可能落盘带凭据的请求体** —— 即使设计声明"credential 只在内存解析、永不进 Trace/Evidence/Snapshot"，也要实测 grep trace 文件。
2. **截图遮罩集 `input/textarea/[contenteditable]/[data-private]` 遮不住页面里渲染的凭据明文**（如 kubeconfig 片段、Bearer token —— 它们不是输入框），需补文本级遮罩。
