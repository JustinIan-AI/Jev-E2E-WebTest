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

## Task 5: 实现 L1/L2 定位、指纹与 Freshness 校验【✅】
- **Status**: `completed【✅】`
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
- **TDD 证据**:
  - RED：`tests/unit/location.test.ts`（11 例）先行，模块缺失加载失败；真实 Chrome 集成 3 例（名称漂移 L2 命中、三件套任一不符即 miss、Freshness 作用域 + drift）。
  - GREEN：新增 `src/engine-provider/playwright/fingerprint.ts`（composeDomPath/hashDomPath/fingerprintsEqual，role/name 不参与相等性）、`src/runtime/resolve.ts`（resolveDeterministic：L1 miss 且带指纹才进 L2，ambiguous 不降级）、`src/runtime/freshness.ts`（ensureFresh：只重解析一次，仍失效即 drift）；Provider 补 enumerateFingerprints/resolveByFingerprint/captureFingerprint/verifyFreshness（容器祖先 legend/heading 锚、Freshness 读取 2s 短超时防分离节点 30s 等待）。
  - 验证：全量 86/86 通过（11 文件），`tsc --noEmit` 与 build 通过。

## Task 6: 实现执行状态机、Action 模型与 mutation 安全【✅ 已完成】
- **Status**: `completed`
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
- **TDD 证据**:
  - RED：[executor.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/executor.test.ts) 20 例（classifyFailure 唯一映射 7 + executeCase 13）先行失败；TR-6.2 两例真实 Chrome mutation 安全集成测试写入 [engine-provider.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/engine-provider.test.ts)。
  - GREEN：[types.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/types.ts) ActionResult 8 态（ok/not_found/ambiguous/disabled/covered/timeout/nav_blocked/error，均携带 dispatched）+ actionTimeoutMs；[provider.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/playwright/provider.ts) act() 8 态重写与 Playwright 异常分类（遮挡→covered/未派发，TimeoutError 保守 dispatched=true）；[executor.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/executor.ts) §8.1 状态机（歧义/失效单次重解析/失败分流/recovery 1 次每步、3 次每例/postcondition 闸门，inconclusive→BLOCKED(evidence)）。
  - 验证：全量 108/108 通过（12 文件，含 TR-6.2 真实副作用计数=1、covered 计数=0），`tsc --noEmit` 与 `npm run build` 通过。

## Task 7: 实现 run 级隔离、双标识论域收窄与 cleanup 终态【✅ 已完成】
- **Status**: `completed`
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
- **TDD 证据**:
  - RED：[scope.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/scope.test.ts) 9 例（createRunId/expandTemplate/instantiateFixtures/narrowRunCreatedSet）+ [cleanup.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/cleanup.test.ts) 6 例（§8.1 五规则 + 默认 2s/60s）+ [run-scope.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/run-scope.test.ts) TR-7.1 作用域集成 4 例（残留不假 PASS、注入不假 FAIL、批次内不串扰、cleanup 后可重跑）先行失败。
  - GREEN：[scope.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/scope.ts)（8 位 hex runId、`${runId}`+`${contractId}` 两级替换、名字/标签双标识论域收窄 + excluded_system_objects，禁止时间戳判据）；[types.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/tools/backend/types.ts) BackendAdapter/EvidenceProvider 契约 + MutableBackendAdapter（DD-44：cleanup 复用 adapter 不新增可替换边界）；[mock.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/tools/backend/mock.ts) V1 内存 mock（seed/query/delete/get + 调用审计）；[cleanup.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/cleanup.ts) DELETE 一次 + 只读 GET 轮询 404、404-on-delete 幂等、超时 BLOCKED(cleanup)、默认 2s/60s。
  - 验证：全量 127/127 通过（15 文件，新增 19 例），`tsc --noEmit` 与 `npm run build` 通过。

## Task 8: 实现 Evidence 分级、安全采集与截图/Trace 脱敏【✅ 已完成】
- **Status**: `completed`【✅】
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
- **TDD 证据**:
  - RED：[redaction.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/redaction.test.ts) 33 例（isCredentialKey 词段匹配、redactValue 嵌套 credential 键整值替换/数组递归、redactObservation 剔除 password/file/hidden、buildTextMaskScript TreeWalker 脚本、scanFilesForSecrets 二进制跳过）+ [evidence-store.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/evidence-store.test.ts) 12 例（分级分目录、0700、artifact URI、实时落盘 manifest、sha256 内容寻址去重、judgement_set 永不截断、archived 超限外移+指针、judgementDigest、安全采集）+ [evidence-redaction.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/evidence-redaction.test.ts) 真实 Chrome 5 例（AC-08 指定文件：MASK_INPUT_SELECTOR、第二层文本遮罩后 DOM grep 为空、先遮罩后截图、登录观测剔除、全链路产物扫描）先行失败。
  - GREEN：[redaction.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/redaction.ts)（credential 语义键脱敏 + 已知明文替换 + TreeWalker 第二层遮罩（命中明文替换为 [REDACTED] 黑底黑字 span）+ trace 序列化 + 产物递归扫描）；[evidence-store.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/evidence-store.ts)（`artifact://<runId>/<tier>/<name>`、blobs 内容寻址去重、judgement_set/archived 分目录、run 目录 0700、manifest 实时同步、judgement_set 永不截断、archived 默认 50MB 超限 rename 外移并写指针 JSON、judgementDigest 排序聚合 sha256、写入前强制脱敏）；[screenshot.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/playwright/screenshot.ts)（两层遮罩：先 page.evaluate 文本遮罩后 screenshot 原生 mask，显式 input[type=password/file/hidden]）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/index.ts) barrel 导出。
  - 验证：全量 177/177 通过（18 文件，新增 50 例），`tsc --noEmit` 与 `npm run build` 通过。

## Task 9: 实现 Judge 纯函数、断言原语与离线重算【✅ 已完成】
- **Status**: `completed【✅】`（2026-10-12：TDD——31 个新测试先行（RED：模块不存在全部加载失败）→ 实现 judge 三文件（GREEN）；七原语/HTTP/backend/state 精确口径、固定优先级、A1 FAIL vs A2 BLOCKED(evidence) 分流、verdict_hash canonical 组成与离线三分类完整性校验全部有测试；全量 20 文件 208 测试通过，typecheck/build 全绿）
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
- **TDD 证据**:
  - RED：[judge.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/judge.test.ts) 24 例（DOM 七原语精确表：visible/absent/count/value/checked/url/number；HTTP path_prefix/path_equals、within_run 时间窗、evidenceId 归一化、单条不符 FAIL 与多条全不符 BLOCKED(evidence)；backend 按 scope:run；固定优先级：A1 FAIL、A2 有候选无证据 BLOCKED(evidence)、FAIL+无法求值→BLOCKED、FAIL+歧义→BLOCKED、空断言保守 BLOCKED、纯函数同入参同结果；judge_result 形状与 verdict_hash 64hex、三组成任一变化 hash 变、字段重排不变）+ [judge-recompute.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/judge-recompute.test.ts) 7 例（在线写盘→离线重算 match、在线 FAIL（A1）重算一致、篡改 observation blob→EVIDENCE_CORRUPT/HASH_MISMATCH、改写 judge-result.json→HASH_MISMATCH、judge_impl_hash 漂移→BINDING_DRIFT、删 manifest→EVIDENCE_CORRUPT、manifest 名称排序与 sha256 形状）先行失败。
  - GREEN：[types.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/judge/types.ts)（Verdict/BlockedReason/七原语断言/证据/候选/judge_result 类型契约，模型 candidate 类型隔离）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/judge/index.ts)（七原语精确求值：visible count=0 无候选 FAIL/有候选 unevaluable(evidence)（A2），count/value 多匹配未声明 allow_multiple→ambiguous，value 双侧可解析数值按数值比，url 仅比 pathname，number 1e-9 容差；HTTP：单条状态不符=可观测事实 FAIL（A1）、多条全不匹配取最后一条 BLOCKED(evidence/ambiguous_response)、无匹配 BLOCKED(evidence)；固定优先级 unevaluable→ambiguity→FAIL→PASS；canonical JSON 递归按 key 排序；computeVerdictHash = sha256(canonical(judge_result)‖evidence_digest‖judge_impl_hash)）；[recompute.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/judge/recompute.ts)（writeOnlineJudgeArtifacts 三证据 observation/http/backend 实时落盘+judge-result.json 0600；recomputeJudge 按 manifest→blob sha256→impl 绑定→canonical 逐字段一致→hash 重算顺序校验，输出 match/EVIDENCE_CORRUPT/HASH_MISMATCH/BINDING_DRIFT）；[runtime/index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/index.ts) barrel 导出。
  - 验证：Task 9 专项 31/31 通过；全量 20 文件 208/208 通过，`npx tsc --noEmit` 与 `npm run build` 通过。

## Task 10: 实现 CLI 命令路由、参数解析与退出码
- **Status**: `completed`【✅】
- **Priority**: high
- **Depends On**: Task 9
- **Description**:
  - 实现 init、validate、run、replay、report、doctor、judge recompute 的命令路由和参数解析。
  - 将 PASS、FAIL、BLOCKED、配置错误、环境/Runtime 错误、用户取消映射到固定退出码。
  - 为尚未完整实现的 doctor 等能力保留明确、可测试的命令入口。
- **Acceptance Criteria Addressed**: AC-13
- **Test Requirements**:
  - `rule` TR-10.1: 命令矩阵中的所有成功、失败、阻塞、配置错误、环境错误和取消路径均返回 0/1/2/3/4/130；证据为 CLI 契约测试。
- **TDD 证据**:
  - RED：[cli.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/cli.test.ts) 52 例先行失败（43 failed | 9 passed）：9 个 describe 覆盖帮助/版本/未知命令（含 daemon/serve/start-server 明确拒绝→3）、validate 真实 loader+validator（合法 yaml/json→0、缺 goal/base_url/参数/文件不存在/损坏 YAML/错误后缀/--json 合法非法形状）、init（脚手架目录、示例契约、env-probe.json、示例契约自校验）、run（缺路径/不存在/未知 flag/--repeat 与 --provider 与 --max-cost 非法值→3、注入 handler 全选项与默认选项解析、handler 返回 1/2、CancelledError→130、普通 Error→4）、replay（缺 trace/--verify+--heal 互斥/未知 flag→3、默认 verify=true、--heal、返回 2、CancelledError→130）、report（缺 run_id/--serve 拒绝→3、--open --export 透传、Error→4）、doctor（注入透传 cwd→0、未注入默认入口→4、--fix-all→3）、judge recompute（缺 run_id/未知子命令/归档不存在→3、seed PASS→0、seed FAIL→1、篡改 judge-result→HASH_MISMATCH→4、impl hash 漂移 BINDING_DRIFT→4）、真实子进程（`node --import tsx src/cli/index.ts` --version→0、坏契约 validate→3）。
  - GREEN：[commands.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/commands.ts)（UsageError/CancelledError、封闭命令集 COMMANDS 与 isCommandName、通用 parseCommand 支持 `--flag`/`--k=v`/`--k v`、parseRunOptions：repeat≥1 整数/provider mock|jev/maxCost>0/freeze/json；parseReplayArgs verify|heal 互斥默认 verify；parseReportArgs open/export；parseDoctorArgs 零 flag；CliDeps 可选 handler 注入与 Run/Replay/Report/Doctor Context 类型）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/index.ts)（`main(argv,{cwd,deps})` 依赖注入入口；七命令路由；mapError：CancelledError→130、UsageError|ContractConfigError→3、其他→4；init 生成 `.idwth/contracts`+`runs`、可自校验的示例契约、静态 env-probe.json 四要素；validate 走真实 loadContractFile+validateContract 并支持 --json；run/replay/report/doctor 未注入时打印 Task 14/15/11/16 交付说明并返回 4；judge recompute 接真实 recomputeJudge，integrity_error 三分类→4，match PASS/FAIL/其他→0/1/2；USAGE 含六退出码与 no daemon/server 声明）。修复 init 示例契约 test.id 连字符违规（`example.workload-create`→`example.workload.create`）。
  - 验证：Task 10 专项 52/52 通过；全量 21 文件 260/260 通过，`npx tsc --noEmit`（noUncheckedIndexedAccess + exactOptionalPropertyTypes）与 `npm run build` 通过；既有 [cli-skeleton.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/cli-skeleton.test.ts) 4 例保持通过。

## Task 11: 实现报告导出与静态自包含 HTML 报告【✅ 已完成】
- **Status**: `completed【✅】`（2026-10-12：TDD——报告契约 12 例先行（RED：report 模块不存在，suite 加载失败）→ 实现 report 三文件 + cmdReport 真实路径（GREEN）；五要素/截图 sha256 索引/单文件零脚本离线 HTML/三态配色无绿色/export 目录包/--open 注入全部有测试；TR-11.2 基于真实报告走查评分 4/5（≥4 达标）；全量 22 文件 272 测试通过，typecheck/build 全绿）
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
- **TDD 证据**:
  - RED：[report.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/report.test.ts) 12 例先行失败（`src/runtime/report/index.js` 不存在，0 test collected，suite 加载失败）：①report.json 五要素 + 截图 sha256 索引/权限；②默认渲染 report.html → 0；③FAIL run 命令仍 →0；④离线打开校验（resourceRefs 仅允许 `data:`/`#`、恰好 1 个 `data:image/png;base64,`、无 `<script`/`fetch(`/XMLHttpRequest、有内联 `<style>`、五要素文本与步骤 target 可见）；⑤FAIL 原因可见；⑥BLOCKED 原因可见；⑦三态配色（PASS `#2563eb`/FAIL `#dc2626`/BLOCKED `#d97706`）且全报告无 `green` 关键字与 5 个绿色 hex；⑧--export 目录含 report.html/report.json/judge-result.json/evidence-manifest.json/export-manifest.json + judgement_set 三文件 + screenshots/final.png，manifest files 含 report.html 与 judgement_set/observation.json；⑨--open 经注入 openPath 调用一次且参数为 report.html 绝对路径；⑩run 目录不存在→3；⑪缺 report.json→3；⑫注入 deps.report 优先于默认路径。
  - GREEN：[types.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/report/types.ts)（REPORT_SCHEMA_VERSION='1.0'、ReportVerdict/Case/Step/AssertionResult/Reproduction/Screenshot/ReportData 数据契约，ReportSeed 与 ReportScreenshotInput）；[render.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/report/render.ts)（escapeHtml 五字符；单文件 HTML：单个内联 `<style>`、`:root{--accent}` 三态切换、用例元信息/步骤五列表/断言徽章与 evidence_ref/失败原因仅非 null 时输出/截图 base64 data URI + figcaption/复跑 provider+contract+rerun 命令；全文零 script、零 fetch、零外部 URL）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/report/index.ts)（writeReportArtifacts：run 目录 0700、screenshots/<name> 0600 + sha256 索引、report.json 0600；renderRunReport：读 report.json→截图 base64→渲染→写 report.html，ENOENT→ReportNotFoundError；exportRunPackage：`.idwth/exports/<runId>/` 纯目录递归 cp 六条目 + export-manifest.json files 排序列表，无 zip 依赖；ReportNotFoundError）；[commands.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/commands.ts)（CliDeps 新增 `openPath?: (target:string)=>void`）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/index.ts)（mapError 增 ReportNotFoundError→3；cmdReport 默认走 renderRunReport→可选 exportRunPackage→可选 openPath（默认 macOS `open`/Linux `xdg-open` detached spawn，注入 openPath 供测试），注入 deps.report 仍优先）。修复 exactOptionalPropertyTypes：caption 改条件展开。
  - 验证（TR-11.1）：Task 11 专项 12/12 通过；全量 22 文件 272/272 通过，`npx tsc --noEmit` 与 `npm run build` 通过。
  - 验证（TR-11.2，基于真实报告走查，2026-10-12）：用临时脚本在 mkdtemp 目录经 writeOnlineJudgeArtifacts + writeReportArtifacts + renderRunReport + exportRunPackage 产出真实 PASS run（`demo-pass-20261012`，report.html 4105 字节，export 8 个文件），程序化提取全部 src/href 引用仅 1 个且为 `data:image/png;base64,`（零 HTTP/零外部资源，断网 file:// 完整）。按 AC-19 anchors 逐项走查：用例（id/name/goal/base_url）→三步骤（意图/动作/目标/风险）→断言（state 徽章+kind+描述+artifact:// 证据引用）→内联截图（caption）→复现（provider/contract/完整 rerun 命令）链路完整、自上而下顺序呈现，PASS 蓝 `#2563eb` 不依赖红绿语义；非作者可仅凭该单页独立复核。**评分 4/5（达到 ≥4 门槛）**；扣分项（非阻塞，留待后续打磨）：时间戳为原始 ISO UTC 未做本地化展示、截图无缩略图/点击放大交互（本期刻意零脚本）。走查后临时脚本已删除（`.idwth/tmp/` 本就 gitignore）。
- **Notes / M1 出口验证记录（2026-10-12）**：
  - 已满足部分：Task 1~11 全部 completed【✅】，全量 272 例通过；报告链路（report.json 五要素 + 截图 sha256 索引 + judgement_set 证据 + 单文件零脚本 report.html + export 包）经真实写盘产物验证可离线 `file://` 打开、内容完整、三态配色合规、rerun 命令可见；确定性 judge（七原语纯函数）、证据六重绑定与 `judge recompute` 离线重算均已在 Task 9/10 以真实归档验证。
  - 如实保留项：M1 描述的「无模型跑通一条确定性用例」的**端到端 `idwth run` CLI 闭环**尚未经真实命令贯通——默认 run handler 按计划在 Task 14（e2e Provider 与六重绑定接线）才真实化，当前以手工 seed 的真实归档（同 writeOnlineJudgeArtifacts/writeReportArtifacts 生产代码路径）验证了从证据到报告的下游全链路。M1 出口的最终命令级闭环证据将在 Task 14 run handler 落地后补齐并回链此处。

## Task 12: 实现 JEV Adapter、Mock Provider 与 L3 语义动作
- **Status**: `completed【✅】`（2026-10-12：TDD 全程——RED 先行失败→GREEN 最小实现→全量 342/342 通过 + tsc/build 干净）
  - RED 证据（模块不存在时先失败）：`tests/unit/validate-choice.test.ts`（~30 例：AC-05 合法性优先于分级阈值 validate_choice 校验次序、越界/非法概率/注入/低置信度拒绝、预算 5 例）、`tests/integration/semantic-action.test.ts`（~32 例：L1/L2 miss→恰 1 次 decide、候选编号代码给定、usage/latency 审计、state 脱敏、零派发 BLOCKED(decision)、TR-12.2 未接线零隐式调用/断网 provider_error、预算发请求前预留）、`tests/unit/jev-http.test.ts`（8 例传输层）。
  - GREEN 证据：`src/adapters/jev/{types,validate,budget,mock,jev-http}.ts`（ConfidenceThresholds reversible 0.60 / irreversible 0.90，DD §7.2/§7.3）、`src/runtime/resolve-l3.ts`（L3 编排：候选来自 `provider.resolve(target,'L3')`、state 经 redactObservation、预算最坏情况预留、validateChoiceAnswer、未请求 question 应答忽略）、`src/runtime/executor.ts`（`options.decision` 显式注入，未注入=纯确定性路径零 Provider，TR-12.2）、`src/engine-provider/types.ts`（ResolveMode 增 L3，ResolveResult 增 confidence?）。
  - 验证：`npx vitest run` 25 文件 342/342 通过；`npx tsc --noEmit` exit=0；`npm run build` 通过。
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
- **Status**: `completed【✅】`（2026-10-12：TDD——12 个新测试先行（RED：recovery-audit 模块缺失收集失败、A4 篡改得逞假 PASS、上限审计缺失）→ GREEN 实现 RecoveryRecord 审计 + A4 固化；全量 354/354（27 文件）、typecheck/build 全绿）
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
- **TDD 证据**:
  - RED：[recovery-audit.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/recovery-audit.test.ts)（8 例：outcome 归一、快照脱敏/observe 失败容错、RecoveryRecord 形状 attempt/fixed/mode/before/after/latency、case 级 attempt 连续编号、beforeError/afterError 入档）+ [recovery.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/recovery.test.ts)（4 例：TR-13.1 A4/A9 + TR-13.2 上限）先行失败——recovery-audit 模块不存在收集失败；A4 场景篡改得逞（completed 假 PASS）；上限测试断言 recoveries 缺失。
  - GREEN：新增 [recovery-audit.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/recovery-audit.ts)（RecoveryOutcome/RecoveryRecord、captureRecoverySnapshot 现采 fresh 观测经 redactObservation 脱敏、normalizeRecoveryOutcome 兼容 boolean 旧钩子）；[executor.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/executor.ts) 接线——A4 派发前 structuredClone 固化本步 postcondition（恢复后校验固化副本，钩子运行期篡改不生效且零参调用拿不到句柄）、Recovery 循环记录 attempt（case 级 1 起）/mode/before-after/latency 入 CaseResult.recoveries、1/step 与 3/case 上限与 postcondition 闸门维持（DD §8.3）。
  - 验证：A4 集成测试确认篡改版本从未被求值（引擎只收到原始 visible 断言）→ BLOCKED(postcondition) + 审计入档；A9 L3 接受合理错误候选派发成功被步级断言捕获（零 recovery）；上限两例均 BLOCKED(recovery) 且第二次恢复从未执行。全量 354/354 通过（27 文件，新增 12 例），`tsc --noEmit` 与 `npm run build` 通过。

## Task 14: 集成 e2e EngineProvider、错误码吸附与恢复触发权控制
- **Status**: `completed【✅】`（2026-10-12：TDD——31 个新测试先行（RED：e2e 模块缺失收集失败 ×4、executor decision-inconclusive 断言失败）→ GREEN 实现 E2eProvider + 吸附器 + 版本隔离 + executor 接线；全量 385/385（31 文件）、typecheck/build 全绿）
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
- **TDD 证据**:
  - RED：[e2e-error-adapter.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/e2e-error-adapter.test.ts)（6 例吸附映射）+ [e2e-engine-cache.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/e2e-engine-cache.test.ts)（6 例版本隔离）+ [e2e-provider.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/e2e-provider.test.ts)（12 例 connect 硬约束/吸附/候选/dispose）+ [executor.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/executor.test.ts)（+1：inconclusive+decision → BLOCKED(decision)）+ [e2e-provider.test.ts（契约）](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/e2e-provider.test.ts)（6 例双腿套件/主结论不变/A10/恢复权/绑定）先行失败——e2e 模块不存在收集失败 ×4、executor 新例 'evidence' ≠ 'decision'。
  - GREEN：新增 [upstream.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/e2e/upstream.ts)（上游 @e2e-dev/web 契约形状，实例注入——上游包不可安装，接口即接缝）、[error-adapter.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/e2e/error-adapter.ts)（DD-32 吸附器：ASSERTION_INCONCLUSIVE → inconclusive/decision + upstreamErrorCode，普通 failed 通道保留）、[engine-cache.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/e2e/engine-cache.ts)（DD-35 版本目录隔离 + 不匹配不沿用，Task 15 消费）、[provider.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/e2e/provider.ts)（E2eProvider：connect 显式关闭 autoHeal/autoRetry 并回读校验 fail-closed（DD-36）、version 空值拒绝（六重绑定⑥）、候选集本层编号（registry 回译上游 id）、L2 因上游扁平元素表无法诚实比对一律 miss、observe/act/checkAssertion/screenshot/trace/dispose/verifyFreshness 全契约映射）；[types.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/types.ts) AssertionResult += upstreamErrorCode；[executor.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/executor.ts) postcondition inconclusive 尊重 blockedReason='decision' → BLOCKED(decision)（本层无法求值仍 BLOCKED(evidence)，§8.2 两行分明）；[index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/engine-provider/index.ts) 导出。
  - TR-14.1 证据：[engine-provider-suite.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/engine-provider-suite.ts) 共享契约套件（11 组断言：id/version、observe 形状、L1 resolved/miss/ambiguous、L3 候选、act 派发、三原语断言、allowlist、产物、dispose 幂等）——e2e（内存上游替身 [upstream-e2e-engine.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/helpers/upstream-e2e-engine.ts)，含拒绝让渡配置/自愈计数/A10 注入）与 Playwright（真实 Chrome）双腿同套通过；同一 ExecutorCase 切换 Provider 主结论不变（happy → completed、miss → blocked/decision 双腿相等）。
  - TR-14.2 证据：A10 —— 上游 `{status:'failed', errorCode:'ASSERTION_INCONCLUSIVE'}` → provider 层 inconclusive/decision/upstreamErrorCode、执行层 BLOCKED(decision)（非 FAIL）；恢复权 —— 陈旧失败（可解析但派发失败）经 Runtime recover 编排恰好 1 次 → BLOCKED(recovery)，engine.healCalls===0 且 config 回读 `{autoHeal:false, autoRetry:false}`；绑定接入 —— provider.version 进 engine_provider_version、版本漂移 → downgrade_l1_l3（driftedKeys 含第⑥项）、缓存目录按版本隔离且不匹配不沿用。
  - 验证：全量 385/385 通过（31 文件，新增 31 例），`tsc --noEmit` 与 `npm run build` 通过。

## Task 15: 实现 replay verify/heal、漂移检测与引擎缓存交付
- **Status**: `completed【✅】`（2026-10-12：TDD——34 个新测试先行（RED：replay 模块缺失收集失败 ×5）→ GREEN 实现 verify 四项比对 + heal 候选隔离 + 引擎缓存交付层；全量 419/419（36 文件）、typecheck/build 全绿）
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
- **TDD 证据**:
  - RED：[replay-trace.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/replay-trace.test.ts)（5 例 onStep 观测/trace 组装）+ [engine-cache-delivery.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/engine-cache-delivery.test.ts)（9 例写入/命中/缺失/失效/打包/离线往返）+ [replay-verify.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/replay-verify.test.ts)（9 例零模型/四项漂移/A11 陈旧缓存/步数守卫）+ [replay-heal.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/replay-heal.test.ts)（8 例 L3 候选/审计/守卫/CI 隔离/不回写）+ [offline-engine-cache.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/offline-engine-cache.test.ts)（4 例 A7a/A7b/版本不匹配）先行失败——replay 模块不存在收集失败 ×5。
  - GREEN：新增 [trace.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/replay/trace.ts)（TraceFile `idwth.trace/1`：caseId/engineProviderVersion/recordedAt/verdict/steps）、[verify.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/replay/verify.ts)（replayVerify：类型级零模型——不接收决策能力，仅 L1/L2 resolveDeterministic；四项逐步比对 resolve.matched/resolve.strategy/action_result.status/assertion_results，任一漂移即 DriftPoint + BLOCKED(drift) 立即终止（漂移步不派发）；A11 stale-cache 前置报错零执行；步数不一致报配置错误）、[heal.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/replay/heal.ts)（replayHeal：决策能力必填否则拒绝；定位级漂移→候选 CandidateStrategy status:'candidate' 待人确认、L1/L2 miss→resolveWithL3 唯一模型介入点、decisions 审计入档 + modelCalls 计数；动作/断言失败按 §3.5/§8.2 唯一映射分流；绝不回写 Trace）、[engine-cache.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/replay/engine-cache.ts)（writeEngineCache 按版本分目录 manifest 落盘、loadEngineCache hit/miss/stale 三态（schema/版本不匹配→失效告警且 entries 不外泄，消费 Task 14 engineCacheDir/checkCacheVersion）、packEngineCache 离线包描述版本校验拒错配）、[ci-gate.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/replay/ci-gate.ts)（isCiUsableReplayOutcome：verify 可入 CI、heal 一律 false）；[executor.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/executor.ts) 增 StepExecutionRecord + onStep 纯观测钩子（trace 录制原始输入，不改执行语义）并导出 buildAction/needsTarget；[runtime/index.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/index.ts) 导出 replay barrel。
  - TR-15.1 证据：A6 —— 页面改版（L1 不再命中）→ DriftPoint{field:'resolve.matched',recorded:'resolved',replayed:'miss'} + BLOCKED(drift) 终止（漂移步 actCalls 不增、stepsExecuted=1）；四项各有专项（strategy 换级不静默派发、action not_found、assertion failed）；A11 —— manifest 版本被篡改 → stale-cache 报错（stepsExecuted=0/actCalls=0/零模型，绝不静默 heal 后 PASS），缓存命中则正常回放；CI 隔离 —— isCiUsableReplayOutcome(heal)=false（含 healed 与 match），heal 全程不篡改录制 trace。
  - TR-15.2 证据：A7a —— 引擎缓存命中 + 断网 fake（resolve('L3') 抛错）→ 确定性路径全部可跑 outcome=match、modelCalls=0（SIR=0）；A7b —— 首次态空缓存（loadEngineCache=miss）+ 未注入决策 → L1/L2 步骤真实跑过（navigate 已派发）、需 L3 步骤 BLOCKED(decision)、L3 零触达；版本不匹配 —— 版本目录隔离 miss 不沿用、manifest 错包 → stale 且 entries 不外泄。
  - 验证：全量 419/419 通过（36 文件，新增 34 例），`tsc --noEmit` 与 `npm run build` 通过。

## Task 16: 实现 repeat 稳定性门禁、doctor 与运行指标
- **Status**: `completed【✅】`（2026-10-13：TDD——33 个新测试先行（RED：3 文件模块缺失）→ 实现 stability/metrics/doctor（GREEN）；TR-16.1 与 TR-16.2 证据齐备；全量 452/452（39 文件）通过，`tsc --noEmit` 与 build 全绿）
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
- **TDD 证据**:
  - RED：[stability-gate.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/stability-gate.test.ts)（11 例：FLAKY_MIN_REPEAT=10、N≥10 混合 verdict→flaky+blocksMerge、PASS/BLOCKED 混合同判、全 BLOCKED 一致→stable 不误报、N<10→insufficient-runs 绝不阻断、N>10 判定、verdictsSeen 去重、repeat=0 绿灯率 null、runWithRepeat 顺序编排/异常透传）+ [metrics.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/metrics.test.ts)（13 例：SIR 分母=step/DD-21、accepted 按 step 去重、rejected/provider_error 不计入、防除零、决策延迟中位（奇偶样本）/max/无样本 null、动作 dispatched/ok/failed/byStatus、recovery attempts/fixed、suite 绿灯率观测与空 suite null）+ [doctor.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/doctor.test.ts)（9 例：全绿+缓存 hit→exit 0、chrome/ports/jev fail→exit 4、缓存 stale→fail 且 entries 不外泄、probe 异常按 fail 不崩溃、缓存 miss→warn exit 0、显式 warn 不阻断、多 fail 全量收集不短路）先行失败（3 文件模块缺失）。
  - GREEN：[stability.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/stability.ts)（evaluateStability 纯判定：N≥10 verdict 不一致→flaky 硬门禁阻断合并；N<10 insufficient-runs 不下结论；suiteGreenRate 仅观测值）+ [metrics.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/metrics.ts)（computeCaseMetrics：SIR=accepted 决策 step 去重/总步数、决策延迟中位数来自 DecisionRecord.latencyMs、动作计数来自 StepExecutionRecord、recovery 计数；computeSuiteMetrics：绿灯率观测）+ [doctor.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/runtime/doctor.ts)（六项检查：五项注入 prober 不触真实环境 + 引擎缓存复用 loadEngineCache（hit→ok/miss→warn/stale→fail）；任一 fail→RUNTIME_ERROR(4)、全 ok/warn→PASS(0)；全量执行不短路、probe 异常按 fail 处理）；runtime/index.ts 导出三个新模块。
  - 验证：全量 452/452 通过（39 文件，新增 33 例），`tsc --noEmit` 0 错误，`npm run build` 通过。

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
