# IDWTH V1 开发基线 - 验收检查清单

## 产品形态（2026-10-10 需求澄清）

- [ ] 无任何 Web 管理页面 / 管理控制台 UI
- [ ] 无常驻服务：不存在 daemon/serve/start-server 子命令，命令一次性执行后进程退出
- [ ] 命令执行期间/结束后均无监听端口、无后台驻留进程（报告打开除外，且为浏览器进程而非 IDWTH 服务）
- [ ] 无本地控制台/GUI 应用（不引入 Electron/Tauri 等）
- [ ] 无前后端分离：单体 TypeScript CLI 工程，无独立前端应用与后端服务拆分
- [ ] 报告为 CLI 生成的静态自包含文件（`report.html`/`report.json`），断网且无服务时可直接 `file://` 打开

## 仓库布局与合规

- [ ] 全部产品代码统一位于单体工程 `src/`，自动化测试统一位于 `tests/`；不存在 `backend/`、`frontend/` 分层目录
- [ ] 无无 LICENSE 仓库代码被复制引入（`CorieW/JevTest`、`TianyuCodings/JevHarness` 只借鉴设计）
- [ ] `tester-army/e2e` 作为 Apache-2.0 依赖引入时保留版权声明；pre-1.0 版本锁定，升级走独立 PR 并重录缓存
- [ ] `.idwth/` 运行产物目录规则、忽略规则和最小权限策略已配置

## Contract 与 Schema

- [ ] Contract 加载器实现九条校验规则，合法样例通过、九类违规被拒绝（exit 3）
- [ ] 目标字段只允许语义描述，禁止 selector / XPath / 坐标
- [ ] `irreversible` step 必须声明 `postcondition`
- [ ] 缺失 `base_url` / `goal` / `assertions` / `credentials_ref` 时必须澄清或报错，禁止猜测补全
- [ ] Contract / Action / Strategy / Trace 四类 Schema 版本兼容性测试通过

## Skill 声明

- [ ] 7 个 `SKILL.md` 全部通过 Schema Validator
- [ ] 每个 Skill 至少有 1 条行为性验收（给定输入 → 期望输出）
- [ ] 只有 `web-test-contract` 为 authoring/agent 类别，允许模型改写；其余 6 个为 Runtime 契约型
- [ ] `web-test-judge` 的调用权与写入权归 Runtime 独占

## 六重绑定与漂移检测

- [ ] 绑定项包含 6 项：`contract_hash` / `strategy_hash` / `judge_impl_hash` / `runner_version` / `env_fingerprint` / `engine_provider_version`
- [ ] 三个作用点（启动加载、固化前、replay 前）均有绑定校验
- [ ] 任一绑定项不匹配时按作用点分别告警、拒绝固化或 `BLOCKED(drift)`
- [ ] `env_fingerprint` 包含 locale、UI 文案资源哈希、SPA bundle 哈希、环境/部署标识

## 定位与执行

- [ ] L1 确定性定位（ARIA role/label/text）→ L2 指纹复用 → L3 JEV+LLM 兜底
- [ ] 匹配数 >1 时立即 `BLOCKED(ambiguity)`，禁止取第一个
- [ ] mutation 派发前必须通过 Freshness 校验；失效时只重解析一次，仍失效则 `BLOCKED(drift)`
- [ ] 已派发 mutation 超时/未知结果时不自动重试；不可逆步骤失败不 recovery
- [ ] ActionResult 含 `dispatched` 标识，终态唯一

## SUT 中立化与隔离

- [ ] 隔离单元为 **run 级作用域，形式由 SUT 决定**（K8s 下为 `ns-idwth-<runId>`）
- [ ] 对象名/标签内嵌 **`runId + contractId` 两级标识**（runId 防残留，contractId 防批次内串扰）
- [ ] SPA 上下文引导的具体键由 SUT 适配提供，core 不假定任何键名
- [ ] setup/teardown 复用 `BackendAdapter`，不新增接口
- [ ] 断言论域收窄至本 run 本 contract 创建对象集
- [ ] 系统自动注入对象显式排除并记 `excluded_system_objects[]`（如 K8s 的 `kube-root-ca.crt`）
- [ ] cleanup 幂等可重入，DELETE 只发一次，随后只读 GET 轮询至 404
- [ ] 连续两次运行同一 case，第二次不因上次残留 PASS

## L3 语义决策

- [ ] 模型只输出 `operation + target_index`，禁止 Selector / XPath / JS / 坐标
- [ ] `validate_choice` 五条校验：非法响应 → 零动作派发
- [ ] 置信度门限：reversible ≥ 0.60，irreversible ≥ 0.90
- [ ] 候选集由代码生成并编号，模型只输出候选集内 index；越界 → `BLOCKED(decision)`
- [ ] 候选集空 → 直接 BLOCKED 不调模型

## Recovery

- [ ] Recovery 不可修改 Goal / Assertion
- [ ] 每 step ≤1 次恢复、每 case ≤3 次
- [ ] 恢复后必须校验步级 postcondition
- [ ] 恢复失败 → `BLOCKED(recovery)`，不可配置为 FAIL

## Evidence 与安全

- [ ] `judgement_set` 实时落盘、不可截断；`archived` 可外移并写指针
- [ ] credential 只在 Runtime 内存解析，不进 Trace / Evidence / Snapshot / 日志
- [ ] 截图同时遮罩输入控件与页面渲染的已知密钥明文（文本级遮罩）
- [ ] 登录产物 grep 不含明文密码

## Judge

- [ ] Judge 为纯函数 `verdict = f(evidence.judgement_set, assertions)`，无隐藏状态/随机/时间依赖
- [ ] 判定优先级固定：无法求值 → 歧义 → FAIL → PASS
- [ ] 只有确定性断言能产生 FAIL；模型信号恒为 candidate
- [ ] BLOCKED 永不计入 bug 检出
- [ ] 归档 evidence 可离线重算，与在线结果一致（`judge recompute`）

## Replay

- [ ] `replay --verify` 为默认模式，零模型调用
- [ ] 漂移即 `BLOCKED(drift)` 报错终止，禁止静默适配
- [ ] `replay --heal` 必须显式开启，产物不得入 CI
- [ ] A7a 回放态断网确定性路径全部可跑，SIR=0
- [ ] A7b 首次态断网需 L3 的步骤 `BLOCKED(decision)`，不假装跑过
- [ ] A11 陈旧缓存用默认命令回放必须报错终止

## 报告

- [ ] 报告包含五要素：测试用例、测试截图、verdict、未通过原因、可复现过程
- [ ] 报告为静态自包含产物，无任何 IDWTH 进程/HTTP 服务运行时可离线打开
- [ ] 导出包包含 `judgement_set`，保证可离线重算
- [ ] PASS 中性/蓝、FAIL 红、BLOCKED 琥珀；不以红绿表达通过与否
- [ ] 报告可独立说明哪条用例、哪一步、哪条断言、为什么以及如何复现

## CLI 与退出码

- [ ] 提供 init、validate、run、replay、report、doctor、judge recompute 命令；全部一次性执行，无 daemon/serve 子命令、无监听端口
- [ ] 退出码：PASS=0 / FAIL=1 / BLOCKED=2 / CONFIG_ERROR=3 / RUNTIME_ERROR=4 / CANCELLED=130
- [ ] `--repeat N` 能输出 flaky 判定
- [ ] doctor 能识别不可用环境、错误端口、JEV 故障和陈旧引擎缓存

## EngineProvider

- [ ] Runtime 只依赖 EngineProvider 接口，不直接依赖具体引擎
- [ ] e2e 与 Playwright 两个实现通过同一套 Provider 契约测试
- [ ] 引擎自动 heal/retry 默认关闭
- [ ] `ASSERTION_INCONCLUSIVE` 吸附为 `BLOCKED(decision)`，上游错误码仅作附加诊断字段 `upstream_error_code`
- [ ] 切换 Provider 不修改 Judge、runId scope、cleanup 判定和报告主 verdict
- [ ] 引擎缓存按 `engine_provider_version` 分目录，版本不匹配不复用
- [ ] 离线交付包包含匹配版本的引擎缓存

## 稳定性门禁

- [ ] 同一 case 连跑 N≥10 次结论不一致 → 标记 flaky 缺陷，阻断合并
- [ ] suite 绿灯率仅作趋势观测，不设阈值

## 里程碑对齐

- [ ] M1（Task 1~11）：无模型跑通一条用例，A3 + A8 通过，静态报告五要素可离线打开
- [ ] M2（Task 12~14）：A1、A2、A4、A5、**A7b** 通过（**A7a 归 M4**）
- [ ] M3（Task 15~17）：A9、A10 通过，默认 Provider 决策有数据支撑
- [ ] M4（Task 18）：A6、A11、**A7a** 通过，CI/离线包/doctor/门禁/合规全部通过

## 视觉通道 Backlog（不进 V1）

- [ ] 视觉 / Canvas 渲染层断言不进 V1 范围、不做设计
- [ ] 验收编号 `VB-01~VB-05` 独立序列，不占 A 序列
- [ ] 启动条件：外部明确提供多模态大模型能力并主动要求启用
