# IDWTH V1 开发基线 - 产品规格说明

## Overview
- **Summary**: 构建 IDWTH（Intent-Driven Web Test Harness，意图驱动的 Web 系统测试工具集）。系统接收测试契约并输出完整测试报告，以确定性执行为优先路径，在 L1/L2 无法唯一命中时按需调用 JEV/LLM，并由 Runtime 独占调用的独立 Judge 产出权威结论。
- **Purpose**: 解决 AI 浏览器测试中的假 PASS、过程不可复现和模型成本不收敛问题，使测试结果可作为开发回归、发版门禁和审计归档的依据。
- **Target Users**: 测试工程师、开发工程师、CI/发布负责人、云管/K8s/CMDB 系统负责人。

## Goals
- 交付 PRD V1.2 与详细设计 V1.2 中的 P0 范围：FR-1~FR-12、A1~A11（A7 拆 a/b，共 12 条）、退出码契约和报告五要素。
- 建立 Authoring Stage 与 Runtime Stage 的硬边界；CI Runtime 为 P0 指标和验收的唯一对象。
- 实现 L1 确定性定位、L2 指纹复用、L3 语义兜底的三级解析模型；模型只在必要步骤被调用。
- 实现纯函数 Judge、证据分级、离线重算、runId 隔离、cleanup 终态判定和漂移检测。
- 通过 EngineProvider 隔离可替换执行引擎，默认实现不在 M1 锁死，M3 依据对照数据确定。
- 交付可独立阅读、导出、归档和复现的测试报告。
- 产品形态为**单一 TypeScript CLI 工程**：命令一次性执行（run-and-exit），报告为 CLI 生成的**静态自包含文件**（HTML/JSON），无需服务即可阅读。

## Non-Goals
- 不实现新的浏览器内核，不替代 Playwright。
- 不实现完整测试管理平台。
- **不做任何 Web 管理页面/管理控制台 UI**（2026-10-10 需求澄清）。
- **不做常驻服务（daemon/server）**：所有命令一次性执行后退出，不监听端口、不驻留后台进程。
- **不做本地控制台应用**（Electron/Tauri 等 GUI 一律不做）。
- **不做前后端分离架构**：不拆分独立前端应用与后端服务；单体 CLI 工程内生成静态报告文件即报告的唯一交付形态。
- 不做 Canvas 图表内容的直接断言；相关监控数据优先通过 backend/HTTP 断言。
- 不做文件上传/下载完整能力、Web 终端页、移动端测试和跨浏览器矩阵。
- **视觉 / Canvas 渲染层断言属 Backlog**：不进 V1、不做设计；仅当外部明确提供多模态大模型能力并主动要求启用时立项（验收编号 `VB-01~VB-05`，不占 A 序列）。
- 不在 V1 引入自动 GEPA 进化；反思产物只能作为经人确认的新版 Frozen Strategy。
- 不将 iframe / Shadow DOM、完整 Eventually 语义、`--heal` 审计增强和 `--keep-on-failure`（FAIL 时保留现场，P1 显式开关）列入 P0 交付。

## Background & Context
- 既有基线包括 [PRD.md](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/20260922-jev-bs-e2e-research/final/PRD.md) V1.2 与 [detailed-design.md](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/20260922-jev-bs-e2e-research/final/detailed-design.md) V1.2。
- **产品边界（2026-10-10 SUT 中立化）**：本产品面向**任意 B/S 系统**；**openFuyao 只是首个可验证的待测系统（SUT）**，其专属事实属**适配项，不进产品要求**。判据一句话：**「离开 openFuyao，这条还成立吗？」**成立 → 产品要求；不成立 → SUT 适配项。
- 首批验证对象为 openFuyao 管理平台（K8s 容器管理平台，单集群 `host`，React + AntD + ECharts，UI 文案完全外置）。**这些是 K8s 适配实例，换 SUT 时需重跑验证（checklist J 组）**。
- 实测确认 K8s 下 `ns-idwth-<runId>` 可作为数据隔离单元；DELETE 受理后资源仍可能处于 Terminating，必须轮询至 404。**隔离单元已抽象为「run 级作用域，形式由 SUT 决定」**，非 K8s 系统用租户/资源名前缀 + 标签集。
- 已确认双 Runtime：Authoring 阶段允许模型辅助生成契约；CI Runtime 与回放阶段由确定性代码编排，LLM 不进入主回路。
- **「测试计划 = 一次批量执行 = 一个 `run_id`」**；**不引入 `suite_id` 层级**；用例维度由 `contract_id` 区分。
- 详细设计 V1.2 在自研判定内核与具体浏览器引擎之间新增 EngineProvider；外购 Apache-2.0 引擎可用于执行与证据能力，但 Judge、runId 隔离、论域收窄和 cleanup 终态判定必须自研。
- **产品形态澄清（2026-10-10）**：当前版本**不做常驻服务、不做本地控制台、不做前后端分离、无管理页面**。交付物是一个 Node.js/TypeScript 单体 CLI（含 Runtime、判定内核、Provider、adapters、Skill 声明与静态报告生成器），报告为运行产物目录中的静态文件，用浏览器直接打开即可阅读。

## Functional Requirements
- **FR-1 契约编写**: 将需求材料、手工用例或自然语言描述转换为合法 Test Contract；缺失 `base_url`、`goal`、`assertions`、`credentials_ref` 时必须澄清或报错，禁止猜测。
- **FR-2 确定性执行**: 加载 Frozen Contract 与 Frozen Strategy，按状态机执行；mutation 前必须做 Freshness 校验，目标多匹配立即 BLOCKED。
- **FR-3 语义决策**: 仅在 L1/L2 未命中时调用 JEV；模型只输出 `operation + target_index`，非法响应或置信度不足时零动作派发。
- **FR-4 语义恢复**: 仅可逆步骤允许恢复；恢复不可修改 Goal/Assertion，且必须校验步级后置条件。
- **FR-5 证据采集**: 采集 DOM、HTTP、backend 查询、截图、JEV 原文和 recovery 审计，并按判定必需集与归档集分级。
- **FR-6 判定**: Judge 基于证据和断言输出 PASS / FAIL / BLOCKED；只有确定性断言能产生 FAIL。
- **FR-7 回放**: 默认 `replay --verify` 且零模型，漂移即终止；`replay --heal` 必须显式开启，产物不得入 CI。
- **FR-8 报告**: 输出测试用例、截图、是否通过、未通过原因、可复现过程五要素，并支持导出。报告由 CLI 生成**静态自包含产物**（`report.html` + `report.json` + 截图/索引，可离线 `file://` 打开），不依赖任何运行中的服务；`idwth report <run_id>` 仅从本地产物重新生成/打开，不启动常驻进程。
- **FR-9 冻结产物与漂移检测**: 校验契约、策略、判定器、Runtime、环境和执行引擎版本等绑定项，不匹配时按阶段拒绝复用或终止。
- **FR-10 CLI 与退出码**: 提供 init、validate、run、replay、report、doctor、judge recompute 等命令及固定退出码。所有命令均为一次性执行，完成后进程退出，**不提供 daemon/serve/start-server 类子命令，不监听本地端口**。
- **FR-11 数据隔离与清理**: 隔离单元为 **run 级作用域，形式由 SUT 决定**（K8s 下实例化为 `ns-idwth-<runId>`；非 K8s 用租户/资源名前缀 + 标签集）。对象名/标签内嵌 **`runId + contractId` 两级** —— runId 防「上次残留」，contractId 防「批次内跨用例串扰」。断言论域收窄至本 run 创建对象集；系统自动注入对象显式排除（`excluded_system_objects[]`）；cleanup 绑 runId、幂等可重入，DELETE 只发一次，随后只读轮询至 404 终态。setup/teardown 复用 `BackendAdapter`，不新增接口。
- **FR-12 稳定性门禁**: 同一 case 连跑 N≥10 次结论不一致即判定为 flaky 缺陷；suite 绿灯率仅作观测。
- **Skill 契约**: 交付 7 个可校验的 `SKILL.md` 声明；每个声明除 Schema 校验外，还必须具备至少一条行为性验收。

## Non-Functional Requirements
- **成本**: CI Runtime 中确定性/回放路径模型调用必须为 0；稳定期 SIR ≤ 0.15，并随指纹固化趋向 0。
- **延迟**: L3/JEV 决策延迟中位数 ≤ 2s，不含页面加载和断言等待；动作超时与断言 deadline 必须分开定义。
- **稳定性**: 通过 `--repeat N` 对单 case 做二值 flaky 判定，不以 suite 平均绿灯率作为合并门禁。
- **可信度**: Judge 为纯函数，归档证据可离线重算，在线与离线结论一致。
- **安全**: 凭据只在 Runtime 内存解析；Trace、Evidence、Snapshot 和报告不得含明文密钥；截图须遮罩输入控件和页面渲染的已知密钥明文。
- **合规**: 禁止复制无 LICENSE 仓库代码；新增依赖必须有可商用许可证。
- **可移植**: Skill 声明可被不同 Agent Harness 与 CI Runtime 复用。
- **可替换**: 业务实现只依赖 EngineProvider 接口；切换执行引擎不得修改 Judge 语义。
- **可离线**: 回放态完全离线可跑；首次态缺少 L3 能力时必须 BLOCKED，不得假装执行；离线包应随版本交付匹配版本的引擎缓存。

## Constraints
- **Technical**:
  - 使用 Node.js + TypeScript 构建**单一 CLI 工程**（含 CLI、Runtime、Schema、判定内核、EngineProvider、tools、adapters、Skill 声明与静态报告生成器）；**不拆分前后端，不设独立 `frontend/` 应用**。源码统一位于 `src/`（或等价单体源码目录），静态报告模板/资源作为包内静态资源随 CLI 构建，不引入独立前端构建与部署。
  - 所有自动化测试统一位于根目录 `tests/`，不得散落在 `src/` 或产物目录。
  - CDP 为主执行臂；自研 Playwright Provider 为保底实现，外购 e2e Provider 在 M2 并行验证、M3 后按数据决定默认值。
  - `browser.close()`/dispose 在 CDP 接管场景只能断连，不得关闭用户浏览器。
- **Business / Compliance**:
  - `CorieW/JevTest` 与 `TianyuCodings/JevHarness` 无 LICENSE，只能借鉴设计，禁止复制代码或引入依赖。
  - `tester-army/e2e` 为 Apache-2.0，可作为真实依赖；上游 pre-1.0 版本升级必须通过独立变更和缓存重录验证。
  - 代码提交优先使用 GitHub MCP；本规格审批前不进行实现或提交。
- **Dependencies**:
  - 首个 SUT（openFuyao）目标环境、Chrome/CDP 端点、JEV/LLM 端点、测试账号和凭据注入机制。**SUT 适配项不进 core，通过 `BackendAdapter` 注入**。
  - BackendAdapter / EvidenceProvider 的 REST、K8s、mock 实现。
  - 静态报告生成所需的 report.json、截图和 trace/artifact 索引（仅本地文件读写，无服务端数据接口）。

## Assumptions
- 首个 SUT（openFuyao）测试环境及单集群 `host` 可用于受控验证；登录作为 case precondition，不进入冻结执行轨迹。**换 SUT 时需重跑验证（checklist J 组）**。
- 凭据通过环境变量或 `cred://` 引用注入，Runtime 启动时在内存解析，运行结束即清除。
- 新浏览器上下文通过 `addInitScript` 注入 SPA 上下文（如 `sessionStorage.cluster=host`）；**具体键由 SUT 适配提供，core 不假定任何键名**。若实测不成立，需要在 M2 前调整隔离方案。
- 测试只在授权的 run 级隔离空间和测试资源范围内执行。
- 归档上限 50MB 为初始参数，后续以真实 P95 数据标定；判定必需集始终不做丢失式截断。`judgement_set` 体积措辞为**估计（待实测，checklist D07）**，非已实测值。

## Acceptance Criteria

### AC-01: Contract 编写与九条校验
- **Type**: `rule`
- **Given**: 一份手工用例、需求材料或已编写的 Contract YAML。
- **When**: 使用 `web-test-contract` 生成契约，或人工编写后运行 `idwth validate`。
- **Then**: 合法契约通过校验；目标字段只允许语义描述；不可逆步骤必须声明 postcondition；缺少必需字段时必须澄清或拒绝，禁止猜测补全。
- **Pass Condition**: 合法样例通过；九类负向样例全部被确定性拒绝，其中配置/契约错误对应 exit 3。
- **Evidence**: `tests/contract/` 与 `tests/unit/` 中 Contract Schema、Validator 测试及命令输出。

### AC-02: 七个 Skill 声明完整且可行为验收
- **Type**: `rule`
- **Given**: 7 个 IDWTH Skill 的声明目录。
- **When**: 对 Skill frontmatter、输入输出、约束、降级路径和行为验收进行校验。
- **Then**: 所有 `SKILL.md` 均符合统一骨架；只有 `web-test-contract` 为 authoring/agent 且允许模型改写；每个 Skill 至少有一条给定输入到期望输出的行为性验收。
- **Pass Condition**: 7 个 Skill 全部通过声明校验，且各自行为验收可在测试中复现。
- **Evidence**: `tests/contract/skill-declarations.test.*`。

### AC-03: 冻结产物多重绑定与阶段化处置
- **Type**: `rule`
- **Given**: Frozen Contract、Frozen Strategy、Trace 及当前 Runtime/环境/引擎信息。
- **When**: Runtime 加载产物、执行固化或开始 replay。
- **Then**: 绑定至少包含 contract hash、strategy hash、judge implementation hash、runner version、environment fingerprint、engine provider version；不匹配时按启动、固化、回放三个作用点分别告警、拒绝固化或 BLOCKED(drift)。
- **Pass Condition**: 修改任一绑定项均触发规定动作，不得静默复用旧指纹。
- **Evidence**: `tests/unit/bindings.test.*`、`tests/integration/frozen-artifacts.test.*`。

### AC-04: 确定性定位、歧义短路与 Freshness
- **Type**: `rule`
- **Given**: 一个包含可观测控件的目标页面。
- **When**: Runtime 对 step target 进行 L1 → L2 → L3 解析并准备派发 mutation。
- **Then**: 仅唯一匹配可进入动作派发；匹配数 >1 立即 BLOCKED(ambiguity)，禁止取第一个；mutation 前必须通过 Freshness 校验，失效时只允许重解析一次，仍失效则 BLOCKED(drift)。
- **Pass Condition**: 两个同名“创建”按钮场景零动作派发并返回 ambiguity；陈旧 observation 场景按规则终止。
- **Evidence**: `tests/unit/locator*.test.*`、`tests/integration/ambiguity-freshness.test.*`。

### AC-05: L3 语义决策安全
- **Type**: `rule`
- **Given**: L1/L2 均未命中且代码已生成候选控件集合。
- **When**: Runtime 调用 JEV/LLM 并接收决策响应。
- **Then**: 模型只能输出白名单 operation 和候选范围内 target_index；非法 operation、越界 index、非法概率结构、目标注入或低置信度均零动作派发；置信度门限为 reversible ≥ 0.60、irreversible ≥ 0.90。
- **Pass Condition**: 非法/越界/低置信度响应均不触达浏览器动作，并记录拒绝原因和 BLOCKED(decision)。
- **Evidence**: `tests/unit/validate-choice.test.*`、`tests/integration/semantic-action.test.*`。

### AC-06: 已派发 mutation 不自动重试
- **Type**: `rule`
- **Given**: 一个可能产生副作用的 mutation action。
- **When**: action 已派发后出现超时、未知结果、网络错误，或不可逆步骤执行失败。
- **Then**: Runtime 不得自动重试，不得触发 recovery；ActionResult 必须通过 `dispatched` 标识副作用状态，终态为 BLOCKED(decision)。
- **Pass Condition**: A5 场景中只发生一次提交，重复创建路径被测试拦截。
- **Evidence**: `tests/unit/action-result.test.*`、`tests/integration/mutation-safety.test.*`。

### AC-07: Recovery 受风险、上限和后置条件约束
- **Type**: `rule`
- **Given**: 一个 reversible step 的可恢复失败。
- **When**: Runtime 触发语义恢复。
- **Then**: Recovery 不得修改 Goal/Assertion；每 step 最多 1 次、每 case 最多 3 次；必须记录 fresh snapshot、before/after 证据和审计；恢复后必须验证步级 postcondition，恢复失败为 BLOCKED(recovery)。
- **Pass Condition**: A4 拒绝修改断言并终止；A9 能通过步级后置条件捕获错误目标；超限时不再恢复。
- **Evidence**: `tests/integration/recovery.test.*`。

### AC-08: Evidence 完整采集且密钥不泄漏
- **Type**: `rule`
- **Given**: 一次包含登录、导航、网络、DOM 和 backend 查询的运行。
- **When**: Runtime 全程采集证据并生成截图、Trace 和归档产物。
- **Then**: judgement_set 实时落盘、不可截断；credential 不进入 Observation、Evidence、Trace、日志和截图；截图同时遮罩输入控件与页面渲染的已知密钥明文；archived 超限只允许外移并写指针。
- **Pass Condition**: 登录产物 grep 不包含明文密码；渲染的 kubeconfig/Bearer 片段在截图中被遮罩。
- **Evidence**: `tests/integration/evidence-redaction.test.*`、产物扫描结果。

### AC-09: Judge 独立判定且优先级固定
- **Type**: `rule`
- **Given**: judgement_set、Contract assertions、执行 issue 和模型候选信号。
- **When**: Runtime 独占调用 Judge。
- **Then**: Judge 是无隐藏状态、无随机、无时间依赖的纯函数；判定顺序为无法求值 → 歧义 → 断言失败 → 全部通过；模型信号恒为 candidate，不得产生 FAIL。
- **Pass Condition**: A1 中模型自述完成但 HTTP 500 时为 FAIL；A2 中无证据时为 BLOCKED；FAIL + 无法求值并存时为 BLOCKED(evidence)。
- **Evidence**: `tests/unit/judge.test.*`。

### AC-10: 归档证据离线重算一致
- **Type**: `rule`
- **Given**: 已导出的归档 evidence、assertions 和绑定信息。
- **When**: 执行 `idwth judge recompute <run_id>`。
- **Then**: 重算 verdict、judge_result 和 verdict_hash 必须与在线结果一致；证据损坏或判定器绑定不一致时应明确报完整性错误，不得伪造一致。
- **Pass Condition**: A8 的重算结果与在线结果逐字段一致；不一致场景对应 exit 4 或明确的绑定漂移。
- **Evidence**: `tests/contract/judge-recompute.test.*`。

### AC-11: Replay 默认 verify，禁止静默 heal
- **Type**: `rule`
- **Given**: 一份历史 Trace/Frozen Artifacts。
- **When**: 执行默认 `idwth replay <trace>` 或显式 `--verify` / `--heal`。
- **Then**: verify 模式零模型调用，比对 resolve strategy、matched、action result、assertion results；任一漂移即 BLOCKED(drift)；heal 必须显式开启，其候选策略不得被 CI 使用。
- **Pass Condition**: A6 页面改版时终止；A11 陈旧缓存使用默认命令即报错，不会静默 heal 后 PASS。
- **Evidence**: `tests/integration/replay*.test.*`。

### AC-12: 报告五要素、导出与配色合规
- **Type**: `rule`
- **Given**: 一次完成或终止的测试运行。
- **When**: 生成/打开/导出报告。
- **Then**: 报告必须包含测试用例、测试截图、verdict、未通过原因、可复现过程；报告为**静态自包含文件**，断网、无任何服务运行时可用浏览器直接打开；导出包包含 judgement_set；PASS 使用中性/蓝，FAIL 使用红，BLOCKED 使用琥珀，不以红绿表达通过与否。
- **Pass Condition**: 报告可独立说明哪条用例、哪一步、哪条断言、为什么以及如何复现；关闭全部 IDWTH 进程后静态报告仍可正常阅读。
- **Evidence**: `tests/contract/report.test.*`（校验静态 HTML/JSON 产物内容与可打开性）。

### AC-13: CLI 命令与退出码硬契约
- **Type**: `rule`
- **Given**: 本地或 CI 中的 IDWTH CLI。
- **When**: 调用 init、validate、run、replay、report、doctor、judge recompute。
- **Then**: 命令和参数符合设计；退出码固定为 PASS=0、FAIL=1、BLOCKED=2、配置/契约错误=3、环境/Runtime 错误=4、用户取消=130；**不存在 daemon/serve 类子命令，命令结束后无残留进程、无监听端口**。
- **Pass Condition**: 命令矩阵中所有成功、失败、阻塞、配置错误、环境错误和取消路径均返回规定退出码。
- **Evidence**: `tests/contract/cli.test.*`。

### AC-14: run 级隔离、双标识论域收窄与 cleanup 终态
- **Type**: `rule`
- **Given**: 一次新测试运行及由其创建的资源；隔离形式由 SUT 决定（K8s 下为 namespace）。
- **When**: 生成 fixtures、执行 backend/DOM 断言并在 finally 清理。
- **Then**: 资源名和标签必须内嵌 **`runId + contractId` 两级标识**；断言论域仅包含本 run 本 contract 创建对象集；系统自动注入对象须显式排除并记 `excluded_system_objects[]`；cleanup 绑定 runId、幂等可重入，DELETE 只发一次，随后只读轮询至 404；setup/teardown 复用 `BackendAdapter`。
- **Pass Condition**: 连续两次运行同一 case，第二次不因上次残留 PASS；新隔离空间中的系统注入对象不造成假 FAIL（如 K8s 的 `kube-root-ca.crt`）；cleanup 以 404 为完成判据。
- **Evidence**: `tests/integration/run-scope-cleanup.test.*`。

### AC-15: 稳定性 flaky 二值门禁
- **Type**: `rule`
- **Given**: 同一 case 以 `--repeat N` 执行且 N≥10。
- **When**: 重复运行的 verdict 出现不一致。
- **Then**: 该 case 必须标记为 flaky 缺陷并阻断合并；suite 绿灯率只作为趋势观测，不作为通过阈值。
- **Pass Condition**: 不稳定样例被二值判定为 flaky；稳定样例不误报。
- **Evidence**: `tests/integration/stability-gate.test.*`。

### AC-16: 离线运行与引擎缓存
- **Type**: `rule`
- **Given**: 回放态/首次态、JEV 端点状态和 EngineProvider 缓存。
- **When**: 断开 JEV 端点并执行 replay 或首次 run。
- **Then**: A7a 回放缓存命中时确定性路径全部可跑且 SIR=0；A7b 首次态清空缓存时 L1/L2 步骤可跑，需要 L3 的步骤必须 BLOCKED(decision)；离线交付包包含按 engine_provider_version 隔离的引擎缓存，版本不匹配不得沿用。
- **Pass Condition**: 两类离线场景均得到规定 verdict，不假装执行、不静默调用模型。
- **Evidence**: `tests/integration/offline-engine-cache.test.*`、离线包内容审计。

### AC-17: EngineProvider 可替换且不改变判定内核
- **Type**: `rule`
- **Given**: e2e 与 Playwright 两个 EngineProvider 实现。
- **When**: 通过配置切换 Provider，或处理上游失败/缓存陈旧/不可判定错误。
- **Then**: Runtime 只依赖 EngineProvider 接口；两个实现通过同一套 Provider 契约测试；引擎自动 heal/retry 默认关闭；`ASSERTION_INCONCLUSIVE` 必须吸附为 BLOCKED(decision)，上游错误码仅作为附加诊断字段。
- **Pass Condition**: 切换 Provider 不修改 Judge、runId scope、cleanup 判定和报告主 verdict。
- **Evidence**: `tests/contract/engine-provider.test.*`。

### AC-18: 仓库布局、任务流转与许可合规
- **Type**: `rule`
- **Given**: 所有开发变更、测试和任务记录。
- **When**: 实现、验证、提交和审查。
- **Then**: 全部产品代码位于单体工程源码目录 `src/`（无独立前后端应用、无 `frontend/`/`backend/` 分层），自动化测试只位于 `tests/`；任务按 `tasks.md` 顺序执行，完成并验证后更新状态；不得复制无许可证代码。
- **Pass Condition**: 文件布局审计、许可证审计和任务状态检查均通过。
- **Evidence**: 文件树审计、依赖/许可证扫描、`tasks.md` 状态记录。

### AC-19: 端到端报告可理解性
- **Type**: `rubric`
- **Dimension**: 从用例、步骤、断言、证据到复现命令的叙事完整性和可操作性。
- **Scale**: 1-5
- **Anchors**: 1 = 无法判断测试对象、结果或复现方式；3 = 基础结论可见，但需要人工翻日志拼接原因和过程；5 = 用例—步骤—断言—证据—截图—重跑命令形成清晰链路，状态配色和脱敏正确，非作者也能独立复核。
- **Pass Threshold**: >= 4
- **Evidence**: 独立评审者基于真实生成报告和 Trace 的走查记录。

## Open Questions
- [ ] OQ-1: `--repeat 10` 放在每个 PR 还是 nightly；M4 前必须关闭，不阻塞 M1/M2 开发。
- [ ] OQ-2: archived 50MB 初始上限及去重参数需在 M3 使用真实数据标定；judgement_set 始终不得丢失式截断。
- [ ] OQ-3: CI 账号的 RBAC 权限、凭据注入和网络访问策略需在 CI 集成前确认。
- [ ] OQ-4: 默认 EngineProvider 必须在 M3 根据定位命中率、误命中率、成本、flaky 率的对照数据决定。
- [ ] OQ-5: 首个 SUT（openFuyao）中 Reference Suite 可授权操作的业务资源范围需在真实端到端验收前确认。
- [ ] OQ-6: `judgement_set` 体积上限需在 M3 补一次实测或措辞改为"估计"（checklist D07，P0）。
