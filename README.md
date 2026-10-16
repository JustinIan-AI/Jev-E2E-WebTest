# IDWTH

**I**ntent-**D**riven **W**eb **T**est **H**arness — 意图驱动的 Web 系统测试工具。

一个 Node.js / TypeScript 的**单体 CLI 工程**：接收声明式测试契约（Test Contract），以确定性执行为优先路径完成浏览器操作，由独立的纯函数 Judge 基于证据产出权威结论，并生成可离线阅读、可归档复现的静态报告。

用于解决 AI 浏览器测试中的三类问题：假 PASS、过程不可复现、模型成本不收敛。

## 核心特性

- **确定性优先**：L1 确定性定位 → L2 指纹复用 → L3 语义兜底，模型只在必要步骤被调用；CI / 回放路径模型调用为 **0**（SIR=0）。
- **独立 Judge**：无隐藏状态、无随机、无时间依赖的纯函数，判定顺序固定（无法求值 → 歧义 → 断言失败 → 全部通过）；模型信号永远只是 candidate，**只有确定性断言能产生 FAIL**。
- **Mutation 安全**：目标多匹配立即 BLOCKED（不取第一个）；mutation 前强制 Freshness 校验；已派发的副作用不自动重试。
- **漂移检测与回放**：默认 `replay --verify` 零模型，逐步比对历史轨迹，任一漂移即 BLOCKED(drift)；`--heal` 必须显式开启且产物不入 CI。
- **离线可运行**：引擎缓存按 `engine_provider_version` 隔离，回放态完全离线；支持构建内网离线发布包。
- **静态自包含报告**：`report.html` + `report.json` 断网可用浏览器直接打开，包含用例、截图、结论、未通过原因、复现命令五要素。
- **固定六值退出码**，适合作为 CI / 发版门禁；无 daemon、无常驻服务、无监听端口。
- **零运行时依赖**：业务逻辑无外部 npm 运行时依赖；依赖许可证仅 MIT / ISC / Apache-2.0。

## 工作原理

```
Test Contract (YAML, frozen)
        │
        ▼
Runtime 状态机
  L1 确定性定位（role/name/text 唯一匹配）
  L2 指纹复用（历史命中指纹）
  L3 语义决策（仅 L1/L2 未命中时调用 JEV/LLM，受白名单与置信度门限约束）
        │  mutation 前 Freshness 校验；歧义 / 非法响应 → BLOCKED，零动作派发
        ▼
Evidence（DOM / HTTP / backend / 截图 / 模型原文 / recovery 审计，分级落盘）
        │
        ▼
Judge 纯函数 ──► PASS / FAIL / BLOCKED + verdict_hash
        │
        ▼
.idwth/runs/<runId>/（report.json、judgement_set、归档证据）
        │
        ▼
idwth report <runId> ──► 静态 report.html（可导出 / 归档 / 离线重算）
```

执行引擎通过 `EngineProvider` 接口隔离，当前提供两个实现：

- **Playwright Provider**：基于 CDP 接管用户已登录的 Chrome（主执行臂，只断连、不关闭用户浏览器）。
- **e2e Provider**：外购 Apache-2.0 引擎适配实现，通过同一套 Provider 契约测试；切换引擎不改变 Judge 语义。

## 环境要求

- Node.js **>= 22**
- Google Chrome（以远程调试模式启动，供 CDP 接管）：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```

## 快速开始

```bash
# 1. 安装锁定依赖
npm ci

# 2. 构建
npm run build

# 3. 在当前目录生成 .idwth/ 脚手架与示例契约
node bin/idwth.js init

# 4. 校验契约
node bin/idwth.js validate .idwth/contracts/example.contract.yaml

# 5. 执行（Chrome 已以 --remote-debugging-port=9222 启动）
node bin/idwth.js run .idwth/contracts/example.contract.yaml

# 6. 渲染报告
node bin/idwth.js report <run_id> --open
```

开发期也可不构建，直接用 tsx 运行：`npm run idwth -- <command> [options]`。

## 命令

| 命令 | 说明 |
| --- | --- |
| `idwth init` | 生成 `.idwth/` 脚手架、示例 Contract 与环境探测框架 |
| `idwth init --from <feature>` | 从 Gherkin `.feature` 导入并生成 Contract（见[下节](#与-ai-testgen-衔接)） |
| `idwth validate <contract> [--json]` | Schema + 九条可执行性规则校验；不合法返回 3 |
| `idwth run <contract> [options]` | 一次性执行契约，输出 verdict 与六值退出码 |
| `idwth replay <trace> --verify\|--heal` | 回放历史轨迹（默认 verify，零模型） |
| `idwth report <run_id> [--open] [--export]` | 渲染 / 打开 / 导出静态自包含报告 |
| `idwth doctor` | 环境诊断（CDP、origins、JEV、权限、端口污染、引擎缓存） |
| `idwth judge recompute <run_id>` | 基于归档证据离线重算 verdict，校验 verdict_hash |

`run` 选项：

- `--repeat <N>`：重复执行次数（稳定性门禁，N≥10 生效）
- `--provider mock|jev`：语义决策提供者
- `--max-cost <X>`：模型成本上限
- `--freeze`：固化冻结产物
- `--json`：结构化输出

> **v0.1.0 装配说明**：`init` / `validate` / `run`（CDP 确定性路径）/ `report` / `judge recompute` 已具备默认真实路径。`replay`、`doctor` 的能力以库形式交付并由测试套件完整覆盖，默认 CLI 装配未接入时返回 RUNTIME_ERROR(4)；`run` 的 CLI 默认路径为纯确定性路径（L1/L2 未命中即 BLOCKED(decision)），`--repeat > 1` 暂不支持。

## 退出码

| 码值 | 含义 |
| --- | --- |
| 0 | PASS |
| 1 | FAIL（确定性断言未满足） |
| 2 | BLOCKED（环境 / 歧义 / 证据 / 决策 / 恢复 / 漂移） |
| 3 | CONFIG_ERROR（契约非法 / 配置错误 / 缺必填字段） |
| 4 | RUNTIME_ERROR（内部错误 / verdict_hash 不一致） |
| 130 | CANCELLED（SIGINT / 超总预算） |

CI 中遵循 bash `-e` 语义：非零即失败，禁止 `|| true` 等吞码写法。

## 测试契约（Test Contract）

契约为 YAML 格式，描述 `goal`、`steps` 与 `assertions`；步骤 target 只允许人可读的语义短语（禁止写 selector），不可逆步骤必须声明 `postcondition`。运行 `idwth init` 会生成示例契约 `.idwth/contracts/example.contract.yaml`，JSON Schema 位于 [src/schema/](src/schema/)。

契约缺失 `base_url` / `goal` / `assertions` / `credentials_ref` 时一律拒绝，禁止猜测补全；凭据通过 `cred://` 引用，仅在 Runtime 内存解析。

## 与 ai-testgen 衔接

仓库内置上游用例生成工具 [ai-testgen](tools/ai-testgen/)（MIT，独立 Node 工程，不纳入 IDWTH 运行时依赖）。典型链路：

```
需求/接口文档 ──ai-testgen generate──► .feature（Gherkin）
                                              │
                              idwth init --from
                                              ▼
                     .contract.yaml（ready，可直接执行）
                     .draft.yaml（draft，需人工补全）
```

Gherkin 是两者之间的接缝：IDWTH 自带零依赖的解析器，将步骤映射到封闭动作集（`navigate/fill/select/scroll/wait/click/assert_only`）与 7 个 DOM 断言原语，支持中英文。**全部步骤可映射 → ready；任一步骤无法映射 → draft**（绝不猜测丢弃）。

### 准备 ai-testgen

```bash
cd tools/ai-testgen
npm ci
npm run build
export OPENAI_API_KEY=sk-...        # 或 ANTHROPIC_API_KEY（见其 .env.example）
```

### 场景一：需求文档 → 用例 → 全量导入执行（全部 ready）

```bash
# 1. 由 PRD 生成 Gherkin（-f gherkin 是衔接 IDWTH 的关键）
cd tools/ai-testgen
node dist/cli.js generate docs/prd.md -f gherkin -o ../../generated
#   产物：generated/prd.feature

# 2. 回到主工程，导入为 IDWTH Contract
cd ../..
node bin/idwth.js init --from generated/prd.feature \
  --base-url https://staging.example.com \
  --credentials cred://staging-operator
#   产物：.idwth/contracts/<id>.contract.yaml

# 3. 校验并执行
node bin/idwth.js validate .idwth/contracts/*.contract.yaml
node bin/idwth.js run .idwth/contracts/<id>.contract.yaml
```

### 场景二：OpenAPI 规格生成 + 自定义输出目录

```bash
# from-spec 从 OpenAPI 规格直接派生场景
cd tools/ai-testgen
node dist/cli.js from-spec openapi.yaml -o ../../generated

# 指定 --out 落到目标 contracts 目录，并附角色 / id 前缀
cd ../..
node bin/idwth.js init --from generated/openapi.feature \
  --base-url https://staging.example.com \
  --credentials cred://staging-operator \
  --out contracts --role auditor --id-prefix acme
```

### 场景三：导入含未映射步骤 —— draft 人工补全

当 Gherkin 出现封闭动作集之外的操作（如 `When I upload a profile picture`）或无法识别的断言，对应 Scenario **不会**生成 `.contract.yaml`，而是生成 `.draft.yaml`：

```bash
node bin/idwth.js init --from generated/prd.feature \
  --base-url https://staging.example.com \
  --credentials cred://staging-operator
# stdout:
#   已生成 Contract（ready）: .idwth/contracts/operator.logs.in.contract.yaml
#   已生成草稿（1 个未映射步骤）: .idwth/contracts/operator.uploads.avatar.draft.yaml
```

草稿中 `_draft.unmapped_steps` 逐条给出原因分类：

| reason | 含义 |
| --- | --- |
| `unmapped-precondition` | Given 前置条件无法映射 |
| `unmapped-action` | When 动作不在封闭动作集 |
| `unrecognized-assertion` | Then 断言无法识别为 7 个 DOM 原语 |

补全流程：打开 `.draft.yaml` → 手工补全 `steps` / `assertions` → 删除文件头注释与 `_draft` 段 → 重命名为 `.contract.yaml` → `idwth validate` 通过后方可执行。未映射步骤的分类数据为后续以 Skills 自动补全、人只审核报告预留。

### 场景四：Scenario Outline 自动展开

含 `Examples` 参数表的 Scenario Outline 会按数据行展开为独立 Contract（id 追加 `.row1` / `.row2` …），占位符 `<name>` 被逐行替换：

```bash
node bin/idwth.js init --from generated/search.feature \
  --base-url https://staging.example.com \
  --credentials cred://staging-operator
#   产物：search.products.row1.contract.yaml、search.products.row2.contract.yaml
```

### `init --from` 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--from <feature>` | 是 | Gherkin `.feature` 文件路径 |
| `--base-url <url>` | 是 | 被测站点根地址（须为合法 http(s) URL） |
| `--credentials <ref>` | 是 | 凭据引用，必须为 `cred://` 前缀 |
| `--out <dir>` | 否 | 输出目录，默认 `.idwth/contracts` |
| `--role <role>` | 否 | 身份角色，写入 contract `identity.role` |
| `--id-prefix <prefix>` | 否 | 测试 id 前缀 |

参数缺失或非法返回 `CONFIG_ERROR(3)`；`.feature` 不存在返回 `RUNTIME_ERROR(4)`，语法错误带行号返回 `CONFIG_ERROR(3)`。

## 回放与离线

```bash
# 默认 verify：零模型，比对 resolve、action result、assertion results
idwth replay <trace>

# 显式 heal：允许语义恢复，产物不得进入 CI
idwth replay <trace> --heal
```

引擎缓存位于 `.idwth/engine-cache/<engine_provider_version>/`，存在 hit / miss / stale 三态：缓存命中时断网亦可完整回放；版本不匹配不得沿用。

构建内网离线发布包（版本隔离的引擎缓存 + 可运行入口 + 打包清单）：

```bash
npm run pack:offline -- --version <engine_provider_version>
```

## 稳定性门禁

同一 case 连跑 N≥10 次，verdict 出现不一致即二值判定为 **flaky 缺陷**并阻断合并；suite 绿灯率仅作趋势观测，不作为通过阈值。判定逻辑见 [src/runtime/stability.ts](src/runtime/stability.ts)，证据见 `tests/integration/stability-gate.test.ts`。

## 工程结构

```
├── bin/idwth.js              # CLI 入口（加载 dist/cli/index.js）
├── tools/
│   └── ai-testgen/           # 上游用例生成工具（MIT，独立工程，产出 .feature）
├── scripts/                  # 离线包构建等脚本
├── src/
│   ├── cli/                  # 命令路由、参数解析、退出码、run handler、报告模板
│   ├── runtime/              # 执行器、三级解析、Judge、replay、证据、报告、清理、稳定性
│   ├── engine-provider/      # EngineProvider 接口与 playwright / e2e 两实现
│   ├── schema/               # Contract / Strategy / Action / Trace JSON Schema
│   ├── skills/               # 7 个可校验 SKILL.md 声明
│   ├── adapters/jev/         # JEV HTTP 适配、预算与响应校验、mock
│   ├── tools/                # BackendAdapter / HTTP 工具接口
│   └── examples/             # K8s BackendAdapter 示例
└── tests/
    ├── unit/                 # 纯函数 / 原语单测
    ├── integration/          # 状态机、回放、离线缓存、稳定性、真实 CDP
    ├── contract/             # CLI、Schema、Provider、报告、合规等契约测试
    └── helpers/              # CDP Chrome 拉起与上游引擎测试替身
```

## 开发与测试

| 命令 | 说明 |
| --- | --- |
| `npm run typecheck` | TypeScript 严格模式类型检查（`tsc --noEmit`） |
| `npm test` | 全量测试（Vitest，一次性运行） |
| `npm run test:watch` | 测试监听模式 |
| `npm run build` | 编译到 `dist/` |
| `npm run pack:offline` | 构建离线发布包 |

所有自动化测试统一位于 `tests/`。当前共 **568 个测试（49 个测试文件）全部通过**。开发遵循 TDD：RED（测试先行失败）→ GREEN（最小实现）→ 全量验证。

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) 在 push / pull_request 时触发（Ubuntu + Node 22），依次执行：依赖安装 → Chromium 安装 → 类型检查 → 全量测试 → replay/offline 专项 → 稳定性门禁 → 构建 → CLI 冒烟（init + validate）→ 离线包契约测试。流水线不注入任何模型凭据。

## 安全与合规

- 凭据仅在 Runtime 内存解析，Trace / Evidence / Snapshot / 报告不含明文密钥；截图遮罩输入控件与页面渲染的已知密钥明文。
- 无任何遥测（telemetry / analytics）上报。
- 禁止复制无 LICENSE 仓库代码；全部直接依赖具有可商用许可证（MIT / ISC / Apache-2.0）。
- `.idwth/runs/`、`.idwth/engine-cache/`、`.idwth/tmp/` 已通过 `.gitignore` 忽略。
