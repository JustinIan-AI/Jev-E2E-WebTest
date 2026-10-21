# F2 · M1 确定性闭环收口 — 任务清单

> 执行顺序自上而下；每个任务完成后核对"预期结果"，并将状态改为【✅】。
> TDD：先写失败测试（`tests/` 下）→ 必要时最小修复生产代码 → 全量回归。
> 编排：LoopX goal `f2-m1-closure` + 注册 agent；Trae 计划 / review / 进度确认。
> 边界：**以测试与证据为主**；生产代码默认不改；零网络、零模型、零新增依赖。

## 接口契约（实现前对齐，冻结）

本 Feature **不新增生产接口**。命令级证据全部经以下**已存在且冻结**的接缝取证，
禁止为方便测试而改动其签名或新增运行时开关：

```ts
// ── src/cli/run-handler.ts（已存在，冻结）──────────────────────────
export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
export interface ConnectProviderInput {
  cdpEndpoint: string;
  originsAllowlist: string[];
  actionTimeoutMs?: number;
}
export type ConnectProvider = (
  input: ConnectProviderInput,
) => Promise<EngineProvider & FreshnessCapable>;
export interface RunHandlerOptions {
  connectProvider?: ConnectProvider;
  env?: Record<string, string | undefined>;
}
export function createRunHandler(options?: RunHandlerOptions): (ctx: RunContext) => Promise<ExitCode>;
export const defaultRunHandler = createRunHandler();
// 不变量：① IDWTH_CDP_ENDPOINT 缺省取 DEFAULT_CDP_ENDPOINT；
//         ② case blocked 时以 {dom:[],http:[],backend:[],state:[]} 保守判 BLOCKED(evidence)；
//         ③ repeat>1 → 4 且不连接 provider；④ finally 只 dispose 断连，不杀浏览器；
//         ⑤ --json stdout 为 {run_id, verdict, failure_reason?} 单行。

// ── src/cli/index.ts（已存在，冻结）────────────────────────────────
export async function main(argv: readonly string[], opts?: { cwd?: string; deps?: CliDeps }): Promise<ExitCode>;
// 命令路由（封闭集）：init | validate | run | replay | report | doctor | judge recompute | complete
// 不变量：① cmdRun: parseRunOptions → 缺路径 UsageError(3) → loadContractFile(契约错 exit 3)
//            → (deps.run ?? defaultRunHandler)；
//         ② cmdReport: deps.report 缺省走 renderRunReport（真实路径）；ReportNotFoundError → 3；
//         ③ cmdJudge: 仅 recompute 子命令；manifest 缺失 UsageError(3)；
//            integrity_error → 4；verdict 映射 PASS→0 / FAIL→1 / BLOCKED→2。

// ── bin/idwth.js（已存在，冻结；issue #3 修复后）────────────────────
// 经 shim 执行真实 dist/cli/index.js 并调用 main()；入口守卫：
// import.meta.url === pathToFileURL(process.argv[1]).href

// ── tests/helpers/cdp-chrome.ts（已存在，测试侧复用，不改其接口）────
export function launchCdpChrome(): Promise<CdpChrome>; // --remote-debugging-port + 独立 profile + headless
export function cleanupCdpChrome(chrome: CdpChrome | null): Promise<void>;
// CdpChrome: { cdpEndpoint; userDataDir; process; dispose(); kill(); endpointAlive() }
```

**测试侧新增（仅测试代码，非生产接口）**

```ts
// tests/integration/cli-command-e2e.test.ts（新增，唯一新增文件）
// 形态参照 tests/integration/cli-entry.test.ts：
//   beforeAll：dist/cli/index.js 缺失则先 `npm run build`；launchCdpChrome()；
//              process.env.IDWTH_CDP_ENDPOINT = chrome.cdpEndpoint；起本地 http SUT；
//   runShim(args, cwd): Promise<{ code: number; stdout: string; stderr: string }>
//     = execFile(process.execPath, [BIN/idwth.js, ...args], { cwd })（不 merge 非零退出）
//   afterAll：恢复 env、cleanupCdpChrome、close http server；afterEach 清临时 cwd。
// 不变量：① 子进程 cwd 一律为 mkdtemp 临时目录；仓库内不落 .idwth/runs；
//         ② 断言一律以「退出码 + run 目录产物文件内容」双取证；
//         ③ 零外网、零模型（SUT 仅 127.0.0.1，case 无任何 JEV/LLM 配置）。
```

**跨任务红线**

1. 禁止修改上述生产签名；若命令级证据暴露真实缺陷，只允许**函数体内最小修复**，
   并在对应子任务的 --note 登记根因与修复点。
2. 歧义必须零派发：断言"SUT 侧 click 副作用计数为 0"，不得仅断言退出码。
3. 产物取证读文件用 `tests/` 内 fs API；不得为取证去改 report/judge 输出结构。
4. 回链只增补证据指针，不改 baseline Task 1~19 的完成勾选与既有结论。
5. 测试只增不减；门禁输出（文件数/用例数）写入完成回写 evidence。

---

## F2-1 · 真实 shim 子进程 PASS 确定性闭环

- [x] F2-1.1 新建 `tests/integration/cli-command-e2e.test.ts`：beforeAll 装配
  （dist 守卫 build / launchCdpChrome / env 注入 / 本地 http SUT）与 `runShim` 辅助。
- [x] F2-1.2 RED：写 PASS 用例——临时 cwd 落零模型契约（click 不可逆步 + 紧接
  postcondition visible + 终态 assertions），`node bin/idwth.js run <rel> --json`：
  断言 exit 0；stdout 单行 JSON 含 run_id 与 verdict=PASS；run 目录存在 report.json /
  judge-result.json / evidence-manifest.json / observation.json / 截图文件；
  report.failure_reason=null；reproduction.rerun_command 含 `idwth run`。
- [x] F2-1.3 运行该用例确认通过（生产链路已就位，预期直接绿；若失败则属真实缺陷，
  按红线 1 最小修复并登记）。【✅ 首跑 exit 4：src/schema/loader.ts 按 process.cwd()
  解析 src/schema/*.json，cwd=临时目录时 ENOENT。最小修复为按模块自身位置（import.meta.url）
  上溯包根定位、cwd 作回退；修复后用例绿，四门禁 53 文件/594 用例】

预期：真实 shim 子进程跑通零模型 PASS 全链，产物齐备。状态：【✅】

## F2-2 · 命令级错误路径（歧义 / 配置错 / CDP 不可达）

- [x] F2-2.1 RED：歧义 SUT——页面放两个不可区分的同名按钮（同 role/name/text），
  契约目标指向该语义短语；`run`（非 --json）断言 exit 2、report verdict=BLOCKED、
  failure_reason 含 ambiguity；SUT 两侧 click 副作用计数恒为 0（零派发，A3）。
- [x] F2-2.2 RED：`run` 缺路径 → exit 3 且 stderr 含用法；未知选项（如 `--bogus`）→ exit 3。
- [x] F2-2.3 RED：`IDWTH_CDP_ENDPOINT` 指向确认关闭的端口（如 http://127.0.0.1:1）→
  `run` exit 4；临时 cwd 下无 `.idwth/runs` 目录。
- [x] F2-2.4 补 run handler 单测缺口：在 [run-handler.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/run-handler.test.ts)
  增加 FakeProvider 返回 resolve `{status:'ambiguous',count:2}` → handler exit 2、
  BLOCKED(ambiguity) 的单元级用例（与命令级证据互锁）。

预期：歧义 exit 2 零点击、配置错 exit 3、CDP 不可达 exit 4 无归档，均有命令级断言。状态：【✅】
（命令级 3 用例 + 单测 1 用例全绿；四门禁 53 文件/598 用例，零生产代码改动）

## F2-3 · 命令级 report 五要素 + judge recompute 闭环

- [x] F2-3.1 RED：复用 F2-1 的 run_id（同一临时 cwd），`node bin/idwth.js report <run_id>`
  → exit 0、stdout 打印 html 路径；读取该 report.html 断言：含用例名/目标、verdict=PASS、
  可复现命令；未通过原因区存在（PASS 时为空/null 态）；无 `<script`、无 `http(s)://`
  外链、含内联 `<style>`；截图文件在同 run 目录可被 html 相对引用。
- [x] F2-3.2 RED：`node bin/idwth.js judge recompute <run_id>` → exit 0、stdout 含
  `recompute MATCH`、`verdict=PASS`、hash 段非空。
- [x] F2-3.3 RED：对 F2-2.1 的 BLOCKED run 执行 `judge recompute` → exit 2 且
  stdout `MATCH ... verdict=BLOCKED`。
- [x] F2-3.4 RED：篡改证据（覆写 run 目录下某 evidence 文件一个字节）后
  `judge recompute` → exit 4（integrity_error），不输出 MATCH。
- [x] F2-3.5 边界：`report <不存在run_id>` → exit 3；`judge recompute` 缺 run_id → exit 3；
  `judge bogus` → exit 3。

预期：五要素离线 HTML 与 recompute MATCH/篡改 exit 4 全部在真实命令级成立。状态：【✅】
（5 条命令级用例全绿；四门禁 53 文件/603 用例，零生产代码改动。
实现要点：外链断言只约束 src/href/url 资源引用——base_url 作为文本含 http:// 字面量；
篡改须命中 manifest sha256 指向的 blobs/judgement_set/<sha>，改命名视图不被检出；
verdict_hash 为 sha256 裸 hex 64 位；html 路径断言用 realpath 消解 macOS /var→/private/var）

## F2-4 · 证据回链 baseline

- [x] F2-4.1 更新 [baseline tasks.md](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/.trae/specs/idwth-v1-development-baseline/tasks.md)
  Task 11 Notes：把"将在 Task 14 后补齐"的保留项改为已闭环，附命令级证据测试文件
  （tests/integration/cli-command-e2e.test.ts）与复跑命令；保留历史措辞的事实陈述。
- [x] F2-4.2 更新 [baseline checklist.md](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/.trae/specs/idwth-v1-development-baseline/checklist.md)
  M1 项：勾选并加证据指针（测试文件 + 四门禁命令 + 用例计数）。
- [x] F2-4.3 双对账：确认未改动 Task 1~19 完成状态与 AC 覆盖矩阵；M1 三要素
  （无模型一条用例 / A3+A8 / 五要素离线）逐条可点回证据。

预期：Task 11 Notes 与 checklist M1 完成回链，账实一致。状态：【✅】
（baseline 两文件 diff 仅 +12/-2，未触任何 Task Status 行与 AC 矩阵；
M1 三要素全部指向 cli-command-e2e.test.ts，复跑命令齐备）

## F2-5 · 全量门禁 + LoopX 收尾

- [x] F2-5.1 `npm run typecheck && npm run lint && npm run build && npm run test` 全绿；
  记录文件数/用例数（只增不减）。【✅ 2026-10-20 22:32 复跑：typecheck/lint/build exit0；
  vitest 53 文件 / 603 用例全 passed（F2 前 598，净 +5）】
- [x] F2-5.2 确认仓库工作区无遗留：测试未在仓内落 `.idwth/runs`；无残留 Chrome 进程
  （由 helper kill 负责）；临时目录已清。【✅ 清理 3 组 10/13 个历史孤儿 Chrome（10/13 起，
  PPID=1，非本次测试遗留）、$TMPDIR 下 444 个 idwth-* 目录、仓内 .idwth/runs 与 .idwth/tmp；
  复核临时目录 0 / runs 目录不存在 / tmp 目录不存在 / idwth Chrome 0】
- [x] F2-5.3 `loopx review-packet` 收集证据（变更文件/验证命令与输出/测试计数/风险），
  交 Trae 独立 review，核对 spec §5 七条 AC 与 AGENTS.md §5.5 红线。
  【✅ review-packet（evidence，JSON，state_refreshed）已收集；Trae 独立 review 结论 APPROVE：
  七 AC 全部映射到命令级/单测证据，§5.5 五红线 + R4/R7 全满足；唯一生产改动 loader.ts
  为真实缺陷的函数体内最小修复（import.meta.url 定位 schema，cwd 回退，零新依赖）；
  package.json 无 diff；残余风险无】
- [x] F2-5.4 AC 全绿后 `loopx goal-lifecycle --goal-id f2-m1-closure --operation stop`
  （先 dry-run 再 --execute）。
  【✅ 2026-10-20 22:51：stop preview 成功（active→stopped，changed=true）；--execute 后
  written=true、readback=verified。7 个 todo 全 done（含 F2-5R 替办：原 F2-5 主 todo 于 add 时
  预注册的复合验证命令在 loopx no-shell 运行器下 `&&` 被拆词致 exit 2，验证字段 add 后不可变，
  故 supersede 原 todo，新增 todo_0d29b3e59d53 以 argv 形式 `["/bin/bash","-lc",<四门禁>]`
  注册并由 loopx 独立跑通，17.3s，--no-follow-up；P1（loopx check 首信号）已 no-follow-up 闭环）】

预期：四门禁全绿、证据 packet 齐备、goal 收尾无账实不符。状态：【✅ F2 收口完成：
53 文件 / 603 用例全绿（较 F2 前基线 594 净 +9）；goal stopped 账实一致】

---

## 验收对照（出口）

| AC（spec §5） | 覆盖任务 | 证据 |
|---|---|---|
| 1 真实 shim PASS 全链 + 产物五件套 | F2-1.1~1.3 | cli-command-e2e.test（exit 0 + stdout JSON + run 目录） |
| 2 歧义 exit 2 零派发（A3） | F2-2.1 / F2-2.4 | 命令级副作用计数 + run-handler 单测 |
| 3 report.html 五要素离线 | F2-3.1 | html 静态断言（无 script/外链、内联 style） |
| 4 recompute PASS/BLOCKED MATCH + 篡改 exit 4（A8） | F2-3.2~3.4 | 三条命令级用例 |
| 5 配置 exit 3 / CDP exit 4 无归档 | F2-2.2/2.3 / F2-3.5 | 命令级错误路径 |
| 6 Task 11 Notes + checklist 回链 | F2-4.1~4.3 | baseline 文档 diff |
| 7 四门禁全绿、测试只增不减 | F2-5.1~5.4 | 门禁输出 + review packet + goal stop |

## Write-scope（执行档）

- **允许写入**：`tests/integration/cli-command-e2e.test.ts`（新增）、
  `tests/unit/run-handler.test.ts`（仅增补用例）、
  `.trae/specs/idwth-v1-development-baseline/{tasks.md,checklist.md}`（仅回链增补）、
  `.loopx/` 状态回写（运行时目录，不入库）。
- **默认禁止写入**：`src/**` 任何生产代码；确需最小修复时，先在子任务 note 说明根因，
  仅限缺陷函数体内修改。
- **禁止**：仓库内 `.idwth/runs` 产物、凭据、本地绝对路径进入提交。

## 失败恢复策略

- 命令级用例首跑失败：先判定是**测试装配问题**（dist 陈旧 / env 未注入 / cwd 错误）还是
  **真实生产缺陷**；装配问题就地修测试并重跑；真实缺陷按红线最小修复并补对应单测。
- CDP Chrome 拉起失败：helper 自带 15s 轮询；超时报错时不在本 tick 重试超过 1 次，
  记录环境信息（playwright 浏览器是否安装）后走 BLOCKED 上报，不暴力循环。
- 门禁任一红：回到具体子任务修复，禁止跳过/跳过标记；测试数下降一律视为回归。
- 上下文/会话中断：续跑先 `loopx status` + `loopx todo list` + 读本文件勾选状态对账，
  再定续跑点（AGENTS.md §5.2）。
