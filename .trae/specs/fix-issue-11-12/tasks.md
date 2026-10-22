# Tasks：修复 Issue #11 + #12（短期）

> 执行顺序自上而下；每项完成后勾选 `[x]`、预期结果标【✅】，并与 LoopX todo 双对账。
> TDD：先在 `tests/` 写失败用例 → 实现 → 全量回归。

## T1 计划
- [x] T1.1 研读接缝代码（feature-to-contract / gherkin.template / scope / validate / schema / run-handler / init-from） 【✅】
- [x] T1.2 产出 spec.md（冻结接口契约）+ tasks.md 【✅】

## T2 LoopX 注册
- [x] T2.1 `loopx start-goal` 注册 goal（goal_id=`fix-issue-11-12`，bootstrap connected-read-only） 【✅】
- [x] T2.2 `register-agent` 注册执行 agent（`trae-issue-fixer`，--require-new --execute） 【✅】
- [x] T2.3 `loopx todo add` 拆入 7 个子任务（P0×2 / P1×4 / P2×1） 【✅】
  - 预期结果：LoopX goal active，todo 与本文件子任务一一对应。【✅】

## T3 #11-P0 生成端词汇表
- [x] T3.1 在 `tools/ai-testgen/tests/unit/templates.test.ts` 增加 systemPrompt 断言：含封闭动词、目标在值前、禁主语前缀、移除 Background setup、禁「已登录/已存在」（先失败） 【✅】
- [x] T3.2 改 `tools/ai-testgen/src/templates/gherkin.template.ts` 注入封闭词汇表 【✅】
  - 预期结果：新断言通过；既有 GherkinTemplate 测试不回归。【✅】（8/8 通过）

## T4 #11-P1 映射结构化
- [x] T4.1 在 `tests/unit/feature-to-contract.test.ts` 增加失败用例：
  - 中文「在"用户名"输入框中填写"zhangsan"」→ target 用户名 / value zhangsan；
  - 「点击"确定"按钮」→ target 确定按钮（无引号）；
  - 歧义多引号 → draft + reason `ambiguous-target`；
  - Then「用户列表中显示"zhangsan"」→ visible target zhangsan；无引号 → unrecognized-assertion。 【✅】
- [x] T4.2 实现 `extractQuotedAll` / `extractLastQuoted` / `parseTargetValue`，强化 `sanitizeTarget` 剥引号，重写 fill/select 与 Then 映射 【✅】
  - 预期结果：新用例通过；夹具/complete 旧断言按新结构同步修正（目标在值前、target 剥引号），全量 615/615 通过，typecheck/lint/build 全绿。【✅】

## T5 #11-P2 前置提示可操作化
- [x] T5.1 将 Given 未映射提示/草稿 note 改为可操作指引（前置状态请由 identity/fixtures 表达，勿写成动作）；不引入 setup 执行 【✅】
  - 预期结果：draft note 含可操作指引；不产生 ready 假落定。【✅】（init-from 19/19；新增 3 用例，全量 618/618；typecheck/lint/build 全绿）

## T6 #12 短期
- [x] T6.1 在 `tests/unit/`（validate 相关）加失败用例：fixtures 敏感键字面量报 R3、cred:// / @fixture 引用不报 【✅】
- [x] T6.2 确认/补强 R3 递归覆盖 fixtures；给 `instantiateFixtures` 加 `@internal` 注释；help/文档说明 fixtures 不触发数据准备 【✅】
  - 预期结果：fixtures 与 identity 同规则；help 文案诚实。【✅】（contract-validator 18/18 新增 3 fixtures R3 用例；cli-skeleton 新增 help 诚实化用例；scope.ts 加 @internal；cli help 加声明性说明；全量 622/622 53 文件；typecheck/lint/build 全绿）

## T7 集成与门禁
- [x] T7.1 新增集成用例：喂入 #11 复现 feature，断言映射/校验终态 【✅】（tests/integration/issue-11-repro.test.ts 1/1；fill 不颠倒、click/visible 剥引号、2 条 unmapped 带指引、无 ready 假落定）
- [x] T7.2 `npm run typecheck && npm run lint && npm run build && npm run test` 全绿（记录测试文件/用例数） 【✅】（typecheck/lint/build exit 0；vitest 54 文件 / 623 用例全通过，相对基线 53/622 只增不减）
- [x] T7.3 按 loopx-workflow 管线 B 规范化 Failing Repro：新增 `tests/unit/issues/issue-11.test.ts`（7 用例，AC2–AC5 + R7） 【✅】（在修复前基线 `6b4c153` 临时 worktree 上 6/7 失败取得先红证据；当前 HEAD 7/7 通过；全量 55 文件 / 630 用例全绿，测试数只增不减；集成守护 T7.1 保留）
- [x] T7.4 管线 B 第 5 步 L1 独立审查闭环：AC1–AC9 逐条对账 + 红线核对，证据落盘 `l1-review-evidence.md` 【✅】（L1 发现并修复 2 处问题：init-from 指引补 `number` 原语、issue-11.test.ts 补 table/docString；修复后四大门禁复跑全绿 55/630；L1 结论 PASS）

## T8 评审 / 提交 / 收尾
- [x] T8.1 T7 `loopx review-packet` 收集证据并独立评审 AC + 红线 【✅】（独立 code review：#11 五条 AC 全覆盖——封闭词汇表注入模板、fill target/value 不颠倒、click/visible 剥引号、≥3 引号片段 ambiguous-target 落 draft、623 全量含集成守护；红线：封闭动作集/DOM kind 未新增、R4 postcondition 顺序不变、零网络零模型、fixtures R3 递归覆盖、.codex/.loopx 已在 .gitignore）
- [x] T8.2 GitHub MCP 在 `feature/fix-issue-11-12` 分支提交并创建 PR（不直推 main） 【✅】（16 个文件分 10 次提交推送；本地/远端逐文件 SHA256 账实一致；PR #15：https://github.com/JustinIan-AI/Jev-E2E-WebTest/pull/15 ；MCP token 缺 PR/评论写 scope，PR 与 issue 评论按预案用本机 `gh` 兜底，代码提交全程以 MCP 为主）
- [x] T8.3 在 #11/#12 回链 PR；`loopx goal-lifecycle stop` 收尾 【✅】（#11 回链 issuecomment-6321025197、#12 回链 issuecomment-6321025901，均 `gh` 兜底；T8 todo 经 deliverable-complete→refresh-state（validated_progress/semantic_closeout）→spend-slot→terminal no-follow-up closeout 四步结算，receipt=tcw_16035392；goal active→stopped，readback verified；lease 已 release；无残余风险）
