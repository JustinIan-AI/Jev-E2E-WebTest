# F2 · M1 确定性闭环收口（命令级端到端证据 + 回链） — 产品规格

> 上位基线：`.trae/specs/idwth-v1-development-baseline/{spec.md,tasks.md}`
> 关联里程碑：M1 出口（baseline tasks.md §里程碑）
> 改动边界：**以测试与证据为主**；生产代码仅在命令级证据暴露真实缺陷时最小修复
> 状态：待实现

## 1. 背景与定位

baseline tasks.md 对 M1 出口的原文定义：

> **M1 确定性闭环**：Task 1~Task 11 完成；无模型跑通一条用例，A3 与 A8 具备通过证据，
> 静态报告五要素可离线打开查看。

Task 11 Notes 同时登记了唯一保留项（原文要点）：

> M1 描述的「无模型跑通一条确定性用例」的端到端 `idwth run` CLI 闭环尚未经真实命令贯通……
> M1 出口的最终命令级闭环证据将在 Task 14 run handler 落地后补齐并回链此处。

此后 run handler 已以「Task 16 前置装配」落地为生产真实路径（[run-handler.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/run-handler.ts)），
CLI `run` 默认接线（[index.ts cmdRun](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/src/cli/index.ts#L333-L344)）。
因此 F2 **不新增运行时功能**，而是补齐 M1 承诺但一直欠账的三件事：

1. **命令级端到端证据**：经真实 bin shim（`node bin/idwth.js`）子进程，而不是进程内
   `main([...])` / 注入 handler，跑通一条零模型确定性用例的完整 CLI 生命周期。
2. **A3 / A8 与五要素在命令级成立**：歧义 BLOCKED(ambiguity, exit 2)、归档离线重算 MATCH、
   静态 HTML 五要素离线可打开——全部以"真实命令 + 真实产物文件"取证。
3. **回链**：在 baseline tasks.md Task 11 Notes 与 checklist M1 项补证据指针，账实闭环。

## 2. 现状盘点（接缝调研结论）

| 层 | 既有覆盖 | 文件 | 缺口 |
|---|---|---|---|
| run handler 单测 | FakeProvider：PASS/FAIL/BLOCKED(decision→evidence)/连接失败 4/repeat 4/截图非致命/前台标签页臂/navigate 兜底/allowlist/CDP 端点/--json | [run-handler.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/unit/run-handler.test.ts) | 无 BLOCKED(**ambiguity**) 分支 |
| 真实 CDP 集成 | 进程内 `main(['run', rel, '--json'])`：PASS 全链 + recompute MATCH + html 可渲染 + Chrome 存活；越界导航 BLOCKED(env, 2) | [run-cdp.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/run-cdp.test.ts) | 非子进程；无歧义 SUT；未走 `report`/`judge recompute` CLI 命令 |
| 真实 shim 子进程 | 无参 USAGE(0) / --version(0) / 未知命令(3) | [cli-entry.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/cli-entry.test.ts) | 未覆盖 `run` / `report` / `judge recompute` |
| Judge 对抗验收 | A3 在 executeCase 层（K8s E2E 假引擎）→ BLOCKED(ambiguity)；A8 在归档 API 层 MATCH | [reference-suite.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/reference-suite.test.ts)、[judge-recompute.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/judge-recompute.test.ts) | 均非 CLI 命令级 |
| 报告契约 | report.json 五要素 + 自包含 HTML 离线 | [report.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/contract/report.test.ts) | seed 级，非真实 run 产物 |

结论：功能齐备，欠的是**一条穿过真实 shim 的命令级闭环证据链**与文档回链。

## 3. 范围与非目标

### In Scope

- **F2-1** 真实 shim 子进程 PASS 闭环：`node bin/idwth.js run <contract> --json`
  对本地静态 SUT（零模型 L1/L2 确定性）→ exit 0、stdout 单行 JSON 含 run_id/verdict=PASS；
  run 目录产物齐备（report.json、judge-result.json、evidence-manifest.json、截图、observation）。
- **F2-2** 命令级错误路径：
  - 歧义 SUT（同页两个不可区分的同名目标）→ `run` exit 2、report verdict=BLOCKED、
    failure_reason 含 ambiguity，**零点击派发**（不取第一个）。
  - `run` 缺路径 / 未知选项 → exit 3（CONFIG_ERROR）。
  - CDP 不可达（未启动 Chrome 且端点拒绝连接）→ exit 4（RUNTIME_ERROR），无 run 归档。
- **F2-3** 命令级报告与重算闭环：
  - `node bin/idwth.js report <run_id>`（在 F2-1 产出的 cwd 下）→ exit 0、打印 html 路径，
    生成的单文件 report.html 含五要素（用例 / 截图引用 / verdict / 未通过原因 / 可复现过程），
    无 `<script>`、无外链、内联样式，可 `file://` 离线打开。
  - `node bin/idwth.js judge recompute <run_id>` → exit 0、stdout 含 `recompute MATCH` 与
    `verdict=PASS`；对 BLOCKED run → exit 2 且 MATCH verdict=BLOCKED。
  - 篡改证据后 recompute → exit 4（integrity_error），不伪造一致。
- **F2-4** 回链：更新 baseline `tasks.md` Task 11 Notes 与 `checklist.md` M1 项，
  指向命令级证据测试与验证命令；不改变 Task 1~19 既有完成状态。
- **F2-5** 全量门禁 + review packet：四门禁全绿、测试只增不减。

### Non-Goals

- 不新增任何运行时功能、不新增 action/dom 封闭集合成员、不引入第三方依赖。
- 不接 JEV/LLM/网络模型（零网络、零模型是本 Feature 的前提而非待办）。
- 不补齐 `replay` / `doctor` 默认装配（其占位文案与 Task 15/16 的落差仅记录，不在 M1 范围）。
- 不改报告渲染器/Judge 算法本身；仅当命令级证据暴露真实缺陷时做最小修复，并在 tasks 登记。
- 不做批量 `--repeat >1`（handler 已显式返回 4，保持现状，仅在错误路径测试中断言）。

## 4. 约束与架构红线

- 测试全部落在 `tests/`（命令级 e2e 放 `tests/integration/`，沿用
  [cli-entry.test.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/integration/cli-entry.test.ts)
  的"产物缺失先 build、再 execFile 真实 shim"模式）；复用
  [cdp-chrome.ts](file:///Users/freecisco_yan/WorkBuddy/JEV-E2E-Test/tests/helpers/cdp-chrome.ts)
  以"用户自启 Chrome"方式拉起 headless Chromium 并经 `IDWTH_CDP_ENDPOINT` 注入。
- 静态 SUT 用 `node:http` 本地回环 server（参照 run-cdp.test.ts），不引用外网。
- 子进程 cwd 必须是临时目录，产物隔离；`afterEach` 清理；不得在仓库内留下 `.idwth/runs`。
- 退出码严格六值：0/1/2/3/4/130；命令级断言以**子进程退出码 + 产物文件内容**双取证。
- 生产代码默认不改；若证据暴露缺陷，修复必须满足：封闭集合不突破、postcondition 时序、
  数量守恒、零网络零模型（AGENTS.md §5.5）。
- 命令级测试依赖 `dist/`（真实 shim 动态 import dist）；beforeAll 发现缺失先 `npm run build`。

## 5. 验收标准

1. 存在一条经**真实 bin shim 子进程**的确定性 PASS 用例证据：exit 0、stdout JSON 合法、
   run 产物五件套齐备、verdict=PASS。
2. 同机制下歧义 SUT → exit 2 + BLOCKED(ambiguity)，且无任何 click 派发证据（A3 命令级成立）。
3. `report <run_id>` 子进程产出的 report.html 经静态检查含五要素、零 script/外链，
   可离线打开（五要素命令级成立）。
4. `judge recompute <run_id>` 对 PASS/BLOCKED run 分别 exit 0/2 且 MATCH；
   篡改证据 → exit 4（A8 命令级成立）。
5. `run` 配置类错误 exit 3、CDP 运行时错误 exit 4 且无归档，均有命令级断言。
6. baseline tasks.md Task 11 Notes + checklist M1 项完成回链（含测试文件与复跑命令）。
7. `npm run typecheck && npm run lint && npm run build && npm run test` 全绿，测试只增不减。

## 6. 验证命令

```bash
# 命令级闭环测试（真实 shim + 真实 CDP Chrome + 本地静态 SUT）
npx vitest run tests/integration/cli-command-e2e.test.ts

# 手工复跑（可选，需先 build；由测试自动完成同等步骤）
npm run build
# 终端 1：启动带 CDP 的 Chrome / 或复用测试 helper；终端 2：
node bin/idwth.js run <tmp>/demo.contract.yaml --json
node bin/idwth.js report <run_id>
node bin/idwth.js judge recompute <run_id>

# 全量门禁
npm run typecheck && npm run lint && npm run build && npm run test
```
