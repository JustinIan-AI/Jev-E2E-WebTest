# IDWTH V1 开发基线 - 实施计划

## 执行规则
- 按任务编号和依赖关系执行；当多个任务均满足依赖时，优先处理 Priority 为 high 的任务。
- 每个任务开始时将 Status 改为 `in_progress`；所有 Test Requirements 通过并补齐证据后，将 Status 改为 `completed【✅】`。
- 所有自动化测试必须位于根目录 `tests/`；产品代码为单体 CLI 工程，统一位于 `src/`。**本项目不做前后端分离、不设 `backend/`/`frontend/` 分层目录**（2026-10-10 需求澄清：无管理页面、无 daemon、无本地控制台）。
- 任务证据必须来自可复跑命令、生成产物或测试记录；不能以实现者主观判断替代验证。
- 本队列全部完成前不创建 `review.md`；独立审查阶段按 Spec Mode 规则另行生成。

## Task 1: 建立单体 CLI 工程骨架与基础验证命令
- **Status**: `completed【✅】`（2026-10-10：typecheck/test/build 全绿，文件树审计无 backend/frontend、无 server/GUI 依赖入口，bin shim --version 退出 0）
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 初始化**单一 Node.js/TypeScript CLI 工程**：`src/`（CLI、Runtime、Schema、判定内核、EngineProvider、tools、adapters、skills、静态报告模板）与 `tests/` 两层目录及包管理/TS 配置。**不创建 `backend/`、`frontend/`，不引入任何 Web 框架或前端独立构建链**。
  - 配置 CLI 入口（一次性执行、退出码可断言）、类型检查、lint、测试和构建命令；静态报告模板/资源作为包内静态资源由构建一并打包。
  - 配置 `.idwth/` 运行产物目录规则、忽略规则和最小权限策略。
- **Acceptance Criteria Addressed**: AC-18
- **Test Requirements**:
  - `rule` TR-1.1: `src/` 与 `tests/` 边界清晰，类型检查、测试和构建命令可成功执行；文件树审计确认无 `backend/`/`frontend/`、无 daemon/server 依赖入口；证据为命令输出与文件树审计。
- **Notes**: 不编写业务代码；工程骨架必须允许后续通过 npm scripts 或等价命令完成验证。

## Task 2: 定义七个 Skill 声明与四类核心 Schema
- **Status**: `completed【✅】`（2026-10-12：7 个 SKILL.md 统一 frontmatter 校验通过；Contract/Action/Strategy/Trace 四类 JSON Schema 合法样例通过、非法样例拒绝；23 个契约测试全绿）
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 在 `src/skills/` 下创建 7 个 `SKILL.md`，包含统一 frontmatter、输入输出、constraints、fallback、行为性验收和禁止事项。
  - 在 `src/` 定义 Contract、Action、Strategy、Trace 四类 Schema 及版本字段。
  - 建立 Skill frontmatter 与四类 Schema 的契约测试和版本兼容性测试。
- **Acceptance Criteria Addressed**: AC-01, AC-02
- **Test Requirements**:
  - `rule` TR-2.1: 7 个 Skill 均通过声明 Schema 校验，并能执行各自至少一条行为性验收；证据为 `tests/contract/` 测试结果。
  - `rule` TR-2.2: Contract/Action/Strategy/Trace 的合法样例通过校验，非法样例被拒绝，版本兼容性测试通过；证据为契约测试输出。

## Task 3: 实现 Contract 九条校验、哈希与冻结绑定
- **Status**: `completed【✅】`（2026-10-12：TDD——33 个新测试先行（RED）→ 实现 validate/loader/bindings（GREEN）；九条规则全部可拒绝并归类 config 错误（exit 3 路径），六重绑定 sha256/版本计算与 run 启动降级/固化拒绝/BLOCKED(drift) 三作用点均有测试；全套 8 文件 56 测试通过，typecheck/build 全绿）
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 实现 Contract 加载器和九条校验规则。
  - 实现 contract/strategy/judge/runner/environment/engine provider 绑定项的哈希与版本计算。
  - 实现启动加载、固化前、replay 前三个作用点的绑定处置策略。
- **Acceptance Criteria Addressed**: AC-01, AC-03
- **Test Requirements**:
  - `rule` TR-3.1: 合法 Contract 通过校验；九类 Contract 违规均被拒绝并返回配置错误路径；证据为单元/契约测试结果。
  - `rule` TR-3.2: 任一绑定项变化都会触发告警、拒绝固化或 BLOCKED(drift)；证据为绑定集成测试结果。

## Task 4: 实现 EngineProvider 接口、CDP 接管与浏览器隔离
- **Status**: `completed【✅】`（TDD 证据：`tests/unit/engine-provider-interface.test.ts` 5 用例验证接口形状/能力集/类型字面量；`tests/contract/engine-provider.test.ts` 11 个真实 Chromium over CDP 集成测试覆盖 TR-4.1（复用上下文、后台标签页不抢焦点、强隔离 cookie、SPA seed 键 cluster=host、allowlist）与 TR-4.2（dispose 后进程/CDP 端点存活且可重连）；实现 `src/engine-provider/{types.ts,index.ts,playwright/{attach,background-tab,isolation,provider}.ts}`；全量 72/72 测试通过，typecheck/build 通过）
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 定义 EngineProvider 接口及其 id/version、observe、resolve、act、checkAssertion、screenshot、trace、dispose 能力。
  - 实现 Playwright Provider 的 CDP attach/detach、后台标签页、强隔离 context 和 SPA 上下文引导（`addInitScript`）。
  - **SPA 上下文引导的具体键由 SUT 适配提供，core 不假定任何键名**（如 openFuyao 的 `sessionStorage.cluster=host`）。
  - 保证 dispose/close 只断开 CDP 连接，不关闭用户浏览器。
- **Acceptance Criteria Addressed**: AC-14, AC-17
- **Test Requirements**:
  - `rule` TR-4.1: CDP 可连接并复用上下文，后台标签页不抢焦点，隔离 context 可注入 SUT 适配提供的 SPA 上下文键（如 openFuyao 的 `cluster=host`）；证据为 Provider 集成测试。
  - `rule` TR-4.2: dispose 后用户 Chrome 与 CDP 端点仍存活；证据为连接前后进程/端点检查和测试记录。

## Task 5: 实现 L1/L2 定位、指纹与 Freshness 校验
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - 实现代码拥有 elementId 的 Observation 模型和候选元素枚举。
  - 实现 L1 role/label/text 解析、L2 fingerprint 解析及 `dom_path_hash + sibling_ordinal + anchor_text` 指纹。
  - 实现歧义短路和目标作用域内 Freshness 校验。
- **Acceptance Criteria Addressed**: AC-04
- **Test Requirements**:
  - `rule` TR-5.1: 匹配数为 0、1、>1 时分别进入下一级、resolved、ambiguous；同名多按钮场景零派发；证据为定位单元和集成测试。
  - `rule` TR-5.2: Freshness 失效时只重解析一次，仍失效则 BLOCKED(drift)，且动态校验行不会导致目标子树误判；证据为 Freshness 测试结果。

## Task 6: 实现执行状态机、Action 模型与 mutation 安全
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3, Task 5
- **Description**:
  - 实现 discriminated union Action 和包含 `dispatched` 的 ActionResult。
  - 实现逐步执行状态机、动作派发、步级 postcondition 检查和失败映射。
  - 确保已派发 mutation 超时或未知结果时不自动重试，不可逆步骤失败不 recovery。
- **Acceptance Criteria Addressed**: AC-04, AC-06
- **Test Requirements**:
  - `rule` TR-6.1: 各类 ActionResult 均有唯一终态和恢复策略映射；证据为状态机单元测试。
  - `rule` TR-6.2: dispatched mutation 超时/未知结果和 irreversible 失败均只 BLOCKED 一次，不发生第二次提交；证据为 mutation 安全集成测试。

## Task 7: 实现 run 级隔离、双标识论域收窄与 cleanup 终态
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**:
  - 实现 runId 生成、fixture 模板替换和资源名/标签绑定（**对象名/标签内嵌 `runId + contractId` 两级** —— runId 防残留，contractId 防批次内串扰）。
  - 隔离单元为 **run 级作用域，形式由 SUT 决定**（K8s 下为 `ns-idwth-<runId>`；非 K8s 另择）；**setup/teardown 复用 `BackendAdapter`，不新增接口**。
  - 实现 BackendAdapter/EvidenceProvider 契约、run-created set 计算和系统注入对象排除（`excluded_system_objects[]`）。
  - 实现幂等 cleanup：DELETE 只发一次，随后只读 GET 轮询至 404。
- **Acceptance Criteria Addressed**: AC-14
- **Test Requirements**:
  - `rule` TR-7.1: 第二次运行不会因上次残留 PASS，系统自动注入对象（如 K8s 的 `kube-root-ca.crt`）不会造成假 FAIL；证据为作用域集成测试。
  - `rule` TR-7.2: cleanup 以 404 为完成判据，DELETE 后只进行只读轮询，重复 cleanup 可安全重入；证据为 cleanup 测试结果。

## Task 8: 实现 Evidence 分级、安全采集与截图/Trace 脱敏
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 7
- **Description**:
  - 实现 judgement_set 与 archived 分级存储、实时落盘、artifact 引用和内容寻址去重。
  - 采集 DOM 精简快照、HTTP 请求响应、backend 查询、ActionResult、JEV 原文和 recovery 审计。
  - 实现截图输入控件遮罩、文本级已知密钥遮罩和 Playwright Trace 脱敏。
- **Acceptance Criteria Addressed**: AC-08
- **Test Requirements**:
  - `rule` TR-8.1: Trace/Evidence/Observation 中不包含明文密码和 credential 字段，登录产物扫描结果为空；证据为脱敏集成测试和产物扫描。
  - `rule` TR-8.2: 页面渲染的 kubeconfig/Bearer 等已知密钥明文在截图中被遮罩，archived 超限只外移并写指针；证据为截图与归档测试。

## Task 9: 实现 Judge 纯函数、断言原语与离线重算
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 8
- **Description**:
  - 实现 DOM 七原语以及 HTTP、backend、state 断言的精确求值口径。
  - 实现固定判定优先级、模型 candidate 隔离、三态 verdict 和 blocked 子类。
  - 实现 judge_result、verdict_hash 以及 `judge recompute`。
- **Acceptance Criteria Addressed**: AC-09, AC-10
- **Test Requirements**:
  - `rule` TR-9.1: A1、A2、FAIL+无法求值并存等场景均得到规定 verdict，模型自述不能直接产生 PASS/FAIL；证据为 Judge 单元测试。
  - `rule` TR-9.2: 归档 evidence 重算结果与在线 judge_result/hash 一致，损坏证据或绑定异常被明确识别；证据为重算契约测试。

## Task 10: 实现 CLI 命令路由、参数解析与退出码
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 9
- **Description**:
  - 实现 init、validate、run、replay、report、doctor、judge recompute 的命令路由和参数解析。
  - 将 PASS、FAIL、BLOCKED、配置错误、环境/Runtime 错误、用户取消映射到固定退出码。
  - 为尚未完整实现的 doctor 等能力保留明确、可测试的命令入口。
- **Acceptance Criteria Addressed**: AC-13
- **Test Requirements**:
  - `rule` TR-10.1: 命令矩阵中的所有成功、失败、阻塞、配置错误、环境错误和取消路径均返回 0/1/2/3/4/130；证据为 CLI 契约测试。

## Task 11: 实现报告导出与静态自包含 HTML 报告
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 10
- **Description**:
  - CLI 生成 report.json、截图索引、trace/artifact 引用和包含 judgement_set 的 export 包。
  - 实现**静态报告生成器**：由包内模板渲染出单个自包含 `report.html`（CSS/必要脚本内联或相对引用，截图走相对路径），展示用例、步骤、断言、证据、截图、verdict 和 rerun 命令；产物可在断网、无服务运行时直接用浏览器 `file://` 打开。**不实现前端应用、不启动 HTTP 服务**。
  - 实现 PASS 中性/蓝、FAIL 红、BLOCKED 琥珀的状态视觉规范。
- **Acceptance Criteria Addressed**: AC-12, AC-19
- **Test Requirements**:
  - `rule` TR-11.1: 报告和导出包包含五要素及 judgement_set，状态配色符合要求，复现命令可见；在无任何 IDWTH/HTTP 进程时静态 HTML 可离线打开且内容完整；证据为报告契约测试（产物内容断言 + 离线打开校验）。
  - `rubric` TR-11.2: 报告可理解性；scale 1-5；anchors 1/3/5 与 AC-19 一致；threshold >=4；证据为基于真实报告的评审走查。
- **Notes**: 至此 M1 应能无模型跑通一条确定性用例并产出静态报告；需补充 M1 出口验证记录。

## Task 12: 实现 JEV Adapter、Mock Provider 与 L3 语义动作
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6, Task 9
- **Description**:
  - 实现 JevDecisionProvider、Mock Provider、请求/响应 Schema、usage 和 latency 记录。
  - 仅在 L1/L2 未命中时构造候选问题集并调用 L3。
  - 实现 validate_choice、分级置信度门限、预算控制和零动作拒绝路径。
- **Acceptance Criteria Addressed**: AC-05, AC-16
- **Test Requirements**:
  - `rule` TR-12.1: 非法 operation、越界 index、非法概率、低置信度均零派发并 BLOCKED(decision)；合法响应只选择代码给定候选；证据为语义动作测试。
  - `rule` TR-12.2: 确定性执行路径不持有可调用 Provider，Mock/断网时不会发生隐式模型调用；证据为依赖/调用审计和集成测试。

## Task 13: 实现语义 Recovery、审计与步级后置条件
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 12
- **Description**:
  - 实现 reversible 风险分流、recovery mode、fresh snapshot、before/after 证据和审计记录。
  - 强制 recovery 不可修改 Goal/Assertion，并执行 1/step、3/case 上限。
  - 恢复后强制校验步级 postcondition；未声明或校验失败时终止。
- **Acceptance Criteria Addressed**: AC-07
- **Test Requirements**:
  - `rule` TR-13.1: A4 修改断言被拒绝并审计终止，A9 错误但看似合理的目标被步级 postcondition 捕获；证据为 Recovery 集成测试。
  - `rule` TR-13.2: 同一步第二次恢复和超过 case 上限时均 BLOCKED(recovery)；证据为上限测试。

## Task 14: 集成 e2e EngineProvider、错误码吸附与恢复触发权控制
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4, Task 12
- **Description**:
  - 实现基于 `@e2e-dev/web` 与 `@e2e-dev/decision` 的 e2e Provider 适配器。
  - 上报 engine provider version 并接入绑定校验和缓存版本隔离。
  - 显式关闭引擎自动 heal/retry；将 `ASSERTION_INCONCLUSIVE` 吸附为 BLOCKED(decision)，保留 upstream_error_code 附加诊断。
- **Acceptance Criteria Addressed**: AC-16, AC-17
- **Test Requirements**:
  - `rule` TR-14.1: e2e 与 Playwright Provider 通过同一套 EngineProvider 契约测试，切换后 Judge 主结论不变；证据为 Provider 契约测试。
  - `rule` TR-14.2: A10 场景不会被上游记为 FAIL，陈旧失败不会触发引擎自动 heal；证据为错误码吸附和恢复权集成测试。

## Task 15: 实现 replay verify/heal、漂移检测与引擎缓存交付
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 11, Task 14
- **Description**:
  - 实现默认 verify 模式、零模型回放、四项逐步比对和 drift point 输出。
  - 实现显式 heal 模式及其候选 Strategy 隔离，确保产物不得进入 CI。
  - 实现 `.idwth/engine-cache/` 的版本目录、离线包打包、缓存命中与版本不匹配处理。
- **Acceptance Criteria Addressed**: AC-11, AC-16
- **Test Requirements**:
  - `rule` TR-15.1: A6 页面漂移时报 BLOCKED(drift) 终止；A11 默认命令遇陈旧缓存报错，heal 产物不能被 CI 使用；证据为 Replay 集成测试。
  - `rule` TR-15.2: A7a 回放断网 SIR=0，A7b 首次空缓存需 L3 的步骤 BLOCKED(decision)，缓存版本不匹配不复用；证据为离线和缓存测试。

## Task 16: 实现 repeat 稳定性门禁、doctor 与运行指标
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 15
- **Description**:
  - 实现 `run --repeat N`、单 case verdict 一致性比较和 flaky 二值判定。
  - 实现 SIR、决策延迟、动作计数、recovery 计数、suite 绿灯率观测等指标。
  - 实现 doctor 对 Chrome/CDP、origins、JEV、权限、端口污染和引擎缓存新鲜度的检查。
- **Acceptance Criteria Addressed**: AC-13, AC-15
- **Test Requirements**:
  - `rule` TR-16.1: N≥10 时结论不一致的 case 被标记 flaky 并阻断合并，稳定 case 不误报，suite 绿灯率仅输出观测值；证据为稳定性测试。
  - `rule` TR-16.2: doctor 能识别不可用环境、错误端口、JEV 故障和陈旧引擎缓存，并返回规定退出码；证据为 doctor 契约测试。

## Task 17: 构建首个 SUT Reference Suite 并完成 12 条对抗性验收
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 13, Task 16
- **Description**:
  - 构建覆盖首个 SUT（openFuyao）核心路径的 Reference Suite，并在 `src/examples/` 提供 K8s reference adapter。**SUT 适配项不进 core**。
  - 在 e2e 与 Playwright 两个 Provider 上执行同一批用例，采集定位命中率、误命中率、成本、延迟和 flaky 率。
  - 全量执行 A1~A11（12 条，A7 拆 a/b），并依据对照数据提出默认 EngineProvider 选择结论。
- **Acceptance Criteria Addressed**: AC-01~AC-19
- **Test Requirements**:
  - `rule` TR-17.1: A1~A11 均有可复跑证据和期望 verdict/exit code，且所有失败均可归因到具体 AC；证据为对抗性验收报告和测试产物。
  - `rule` TR-17.2: 两个 Provider 的对照指标完整记录，默认 Provider 选择由数据支撑；证据为指标汇总。
  - `rubric` TR-17.3: 端到端报告可理解性；scale 1-5；anchors 1/3/5 与 AC-19 一致；threshold >=4；证据为独立走查评分。

## Task 18: 完成 CI 集成、离线发布包与最终合规审计
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 17
- **Description**:
  - 将 validate、deterministic run、replay --verify、repeat/flaky 检查和退出码接入 CI。
  - 构建包含匹配版本引擎缓存的离线/内网发布包，并验证断网行为。
  - 执行最终文件布局、依赖许可证、脱敏、遥测配置和构建产物审计。
- **Acceptance Criteria Addressed**: AC-16, AC-18, AC-19
- **Test Requirements**:
  - `rule` TR-18.1: CI 对 PASS/FAIL/BLOCKED/config/env 退出码处理正确，replay verify 不调用模型；证据为 CI 运行记录。
  - `rule` TR-18.2: 离线包包含按 engine_provider_version 隔离的缓存，断网验收通过；证据为离线包审计和测试记录。
  - `rule` TR-18.3: 无无许可证代码，单体 `src/` 与 `tests/` 目录符合要求（无 `backend/`/`frontend/`），产物不含明文凭据；证据为许可证和安全扫描。
  - `rubric` TR-18.4: 最终端到端交付可理解性；scale 1-5；anchors 1/3/5 与 AC-19 一致；threshold >=4；证据为最终走查记录。

## AC 覆盖矩阵

| AC | 覆盖任务 |
|---|---|
| AC-01 | Task 2, Task 3, Task 17 |
| AC-02 | Task 2, Task 17 |
| AC-03 | Task 3, Task 17 |
| AC-04 | Task 5, Task 6, Task 17 |
| AC-05 | Task 12, Task 17 |
| AC-06 | Task 6, Task 17 |
| AC-07 | Task 13, Task 17 |
| AC-08 | Task 8, Task 17 |
| AC-09 | Task 9, Task 17 |
| AC-10 | Task 9, Task 17 |
| AC-11 | Task 15, Task 17 |
| AC-12 | Task 11, Task 17 |
| AC-13 | Task 10, Task 16, Task 17, Task 18 |
| AC-14 | Task 4, Task 7, Task 17 |
| AC-15 | Task 16, Task 17 |
| AC-16 | Task 12, Task 14, Task 15, Task 17, Task 18 |
| AC-17 | Task 4, Task 14, Task 17 |
| AC-18 | Task 1, Task 17, Task 18 |
| AC-19 | Task 11, Task 17, Task 18 |

## 里程碑出口

- **M1 确定性闭环**: Task 1~Task 11 完成；无模型跑通一条用例，A3 与 A8 具备通过证据，静态报告五要素可离线打开查看。
- **M2 语义能力**: Task 12~Task 14 完成；A1、A2、A4、A5、**A7b** 具备通过证据（**A7a 归 M4**），e2e Provider 可并行运行但不预设为默认。
- **M3 价值验证**: Task 15~Task 17 的 Reference Suite 与对照数据完成；A9、A10 具备通过证据，并给出默认 Provider 决策。
- **M4 进 CI**: Task 18 完成；A6、A11、**A7a** 具备通过证据，CI、离线包、doctor、稳定性门禁和合规审计全部通过。
