# 以 `tester-army/e2e` 为基线的 IDWTH 架构调整方案

| 项目 | 内容 |
|---|---|
| 上游依据 | [`e2e-tester-army-review.md`](e2e-tester-army-review.md)（源码级评审）· `PRD.md` V1.0 · `detailed-design.md` V1.1 |
| 本文回答 | **能否用 `tester-army/e2e` 优化 PRD 配套的详细设计？架构该怎么调？** |
| 产出性质 | **调整方案**。§10 的 9 处回写与 §11 的 5 项待决，**已于 2026-10-08 全部按建议执行** —— 执行结果见 §10 / §11 新增列，落地位置见 `detailed-design.md` V1.2 |
| 版本 | V1.0 · 2026-10-08 ｜ **状态：已决策、已回写** |

---

## 结论

**可以。但「优化」必须限定为一个动作：把它作为 IDWTH 的「执行与证据引擎」，插在判定内核之下。**

不是重画架构，也不是 fork 它的代码。

> 一句话：**用它的手上功夫，保住我们的判决权。**

三条边界在调整后**一条都不动**：

| # | 边界 | 上游默认值 | 我们必须做的 |
|---|---|---|---|
| 1 | `verdict` 只有 Judge 能写 | `ASSERTION_INCONCLUSIVE` → `failed`（exit 1） | **吸附**成 `BLOCKED(decision)`，不计入 bug 检出 |
| 2 | `replay` 默认 verify | 默认 heal，`--strict-cache` 才严格 | **反转默认值** |
| 3 | 数据论域由代码划定 | 全程无 runId / 无系统对象排除 / 无 cleanup 终态 | **完全自建**，不指望上游 |

---

## 一、为什么是「可以」——三条硬依据

| # | 依据 | 证据 |
|---|---|---|
| 1 | **同技术栈，可作真实依赖而非借鉴** | IDWTH `detailed-design.md` §11 目录结构全为 `.ts`（`runtime/executor.ts`、`resolve.ts`、`judge.ts`、`tools/browser/*.ts`、`adapters/jev/*`）；e2e 是 TypeScript + npm 包（`e2e` / `@e2e-dev/web` / `@e2e-dev/decision`）。**Apache-2.0，可写进 `package.json`** —— 这是「能否优化」的物理前提，四仓库里只有它满足 |
| 2 | **它成熟的那一段 = IDWTH 里「工程量大但不含领域知识」的那一段** | §5.1 `BrowserTool` 七方法 + §5.5 十一个脚本 + §3.3 三级定位 + §9.4 遮罩 + §3.6 Trace —— e2e 的 `@e2e-dev/web` 已实现，且经 20+ 硬场景（嵌套 shadow root / 纯 Canvas / 嵌套 iframe / 原生对话框 / 第二标签页 / 拖放 / 每秒重挂载 DOM / 说谎的访问树）回归 |
| 3 | **它空白的那一段 = IDWTH 的核心资产** | runId 命名空间 · 断言论域收窄 · 系统对象排除 · cleanup 终态判据 · `judge_impl_hash` · 判定可离线重算 —— e2e 明确没有，且**不在它的产品范围内**。换掉它 = 把产品价值让出去 |

**推论**：调整的性质是**「换供应商」而不是「改设计」**。判定内核、Contract、9 条对抗性验收、7 个 Skill 的形状、CLI 退出码契约**全部保留**；被替换的只是「实现层最下面那一只手」。

---

## 二、FR 级映射：逐条回答「PRD 的方案要不要改」

| FR | IDWTH 要求 | e2e 覆盖 | 处置 |
|---|---|---|---|
| **FR-1** | 契约编写（PRD / 手工用例 → Contract） | ❌ **无「文档 → 用例」**。有 `explore`（给目标自主探）与 5 份迁移对照表（cypress/playwright/detox/maestro/selenium） | **保持自研**（Authoring 层不动）。可选增益：用 `e2e explore` 探出的路径作为人写 Contract 的输入材料 |
| **FR-2** | 确定性执行（L1/L2/L3 + 歧义短路） | ✅ `screen` / `locator` 零模型；`agent.act` 走决策模型；**回放时「歧义即停」是它的显式规则** | **替换实现**（成为 EngineProvider 的默认实现）；**歧义短路语义必须对齐**到我们的 `BLOCKED(ambiguity)` |
| **FR-3** | 语义决策（只输出 `operation + target_index`） | ✅ `@e2e-dev/decision`：候选元素表 + 序号 + `MAX_CHOICES=255` + 视口优先 + `omitted` 计数。**源码注明规则改编自 `jev-ultrafast`** | **替换 transport，保留校验**。§7.3 的 `validate_choice` 五条校验（`choice ∈ keys` / `Σp = 1` / `p[choice] = max(p)` / 未选中头无副作用）仍在**我们代码里**，不进 prompt |
| **FR-4** | 语义恢复（`reversible` 可恢复；`irreversible` 直接 BLOCKED） | ⚠️ 有 agent 兜底，但**它默认自动 heal** —— 正是我们要禁止的行为 | **包装**：恢复与否由 Runtime 决定，不由 Engine 决定。Engine 的失败**不直接触发**它的自动重试 |
| **FR-5** | 证据采集（**判定必需集 / 归档集**两级） | ⚠️ 有截图 / trace / 录像 / 日志，但**单级、无「判定必需集」概念**；遮罩只到输入控件级 | **替换采集器 + 上移分级**：分级落盘由 IDWTH Runtime 做；补文本级遮罩（渲染出的 kubeconfig / Bearer token 不在它的遮罩集里） |
| **FR-6** | 判定（三态 · 纯函数 · 可离线重算） | ❌ **无独立 Judge**。判定散在 assertion 与缓存校验里，且「模型判不出来」记为 `failed` | **完全自研，不动**。且必须**包住**上游错误码（§3.1） |
| **FR-7** | 回放（`--verify` 默认 / `--heal` 显式） | ⚠️ 缓存回放机制成熟（独立验证后才固化 + 起点/终点核对 + `REPLAY_STALE`），**但默认 heal** | **替换机制 + 反转默认值** |
| **FR-8** | 报告（五要素 + 配色约定） | ✅ `report.json` / `junit.xml` / `summary.md` / `trace.md` + 截图；**但产物是工程语言**（exit code / error code / step diff），配色是它自己的 | **复用渲染骨架，重写权威 schema 与配色**：IDWTH 侧定义五要素 `report.json` 为准，它的 reporter 作为可选渲染 |
| **FR-9** | 冻结产物与漂移检测（多绑定） | ⚠️ 绑 `instruction / params / agent / agentContext / app identity`；**无 `judge_impl_hash`** | **扩展**：补 `judge_impl_hash` + **新增 `engine_provider_version`**（见 §3.7） |
| **FR-10** | CLI 与退出码（0/1/2/3/4/130） | ✅ 自带 CLI + 明确的退出码契约 | **并存**：IDWTH CLI 在前，内部可透传；**语义对齐**（我们的 `2 = BLOCKED` 不得被它压成 `1 = FAIL`） |
| **FR-11** | 数据隔离与清理（runId 命名空间） | ❌ 无 | **完全自研** |
| **FR-12** | 稳定性门禁（「无 flaky case」二值） | ⚠️ 需实测其 repeat 能力 | **判据自研**（二值硬门禁不变）；执行层若它有 repeat 能力则可复用 |

**读法**：12 条 FR 里 **2 条完全自研并保持不动（FR-6 / FR-11）· 1 条保持自研（FR-1）· 5 条替换底层实现（FR-2/3/5/7/8）· 3 条在它之上包装（FR-4/9/10）· 1 条判据自研（FR-12）**。
**被替换的都不含判定语义；含判定语义的一条都没被替换。** 这是本次调整的安全边界。

---

## 三、架构调整：三层 → 四层（新增 Engine Provider 层）

### 3.1 现状与调整后

现状（`detailed-design.md` §2.1）：

```
Skill Layer（7 个 SKILL.md）
    ↓
实现层（resolveTarget L1/L2/L3 · AssertionEvaluator · Judge）
    ↓
Minimal Runtime + Tool Layer（Browser(Playwright) / HTTP / BackendAdapter）
```

调整后：

```
① Authoring Stage —— Agent Runtime（不变）
        ↓  冻结产物（★ 唯一跨阶段通道，不变）
② CI Runtime
   ├─ Skill Layer（7 个 SKILL.md，不变）
   ├─ ★ IDWTH 判定内核（自研边界，不可替换）
   │    Judge（纯函数）· 论域收窄器 · runId 隔离器 · cleanup 终态判据
   │    绑定校验器（judge_impl_hash + engine_provider_version）
   ├─ ★ Engine Provider 层（本次唯一新增的架构层）
   │    interface EngineProvider { observe / resolve / act / assert / screenshot / trace }
   │      ├─ 默认实现：@e2e-dev/web + @e2e-dev/decision（Apache-2.0 依赖）
   │      └─ 降级实现：自研 Playwright adapter（CDP 接管臂 · page-agent 臂）
   └─ Tool Layer（HTTP / Backend / Credential —— 保持自研，不变）
```

### 3.2 为什么只需要加「一个接口层」

`EngineProvider` 与 IDWTH 已有的 `BackendAdapter`（§5.3）、`JevDecisionProvider`（§7.1）**是同一手法** —— 可替换性是它既有的设计语言，不是新引入的复杂度。收益是双向的：

| 收益 | 说明 |
|---|---|
| 省工程量 | `@e2e-dev/web` 直接充当默认实现，§5.5 的十一个脚本从「要写」变成「要适配」 |
| 防锁死 | 上游 pre-1.0 或将来许可变更 → 换回自研实现，**我们的契约与判定内核零改动** |
| 保验收 | A7「模型不是硬依赖」仍然可测：把 Provider 换成 Mock 即可，与今天的设计一致 |

### 3.3 实现层的三个具体改动

| 模块 | 现状 | 调整 |
|---|---|---|
| `tools/browser/` | 自研 Playwright 脚本（11 个） | 改为 **`EngineProvider` 的实现之一**；保留 `attach.ts`（CDP 接管）与 `background-tab.ts`（后台标签不抢焦点）—— **这两件是 e2e 不提供的**，是 E01/P0 实测出来的领域知识 |
| `runtime/resolve.ts` | 自研三级定位 | L1/L2 可委托给 Engine；**L3 的候选集生成与编号仍由我们掌控**（铁律 12：模型只输出候选集内 index） |
| `runtime/judge.ts` | 自研纯函数 | **不动**。新增「上游错误码吸附器」：`ASSERTION_INCONCLUSIVE → BLOCKED(decision)` |

---

## 四、七处必须显式改写的口径（否则实现时会被上游默认值带走）

| # | 上游默认行为 | 上游证据 | IDWTH 必须改成 |
|---|---|---|---|
| 1 | 「模型判不出来」记为**测试失败**，exit 1 | `packages/decision/src/executor.ts:382`：`/** Insufficient evidence must never become an assertion pass. */ function inconclusive(...) { return { status: 'failed', errorCode: 'ASSERTION_INCONCLUSIVE' } }` | **独立错误码保留，class 改 BLOCKED**，不计入 bug 检出（对应铁律：BLOCKED 永不计入 bug 检出） |
| 2 | 回放默认 **heal**，陈旧记录悄悄交给 agent 兜底 | `--strict-cache` 才报 `REPLAY_STALE`；文档自承 *"quiet by default … every CI run pays for the model calls until someone re-records"* | `replay` **默认 `--verify`**，漂移即报错终止（对应 PRD FR-7、A6） |
| 3 | 无 runId 命名空间 | 有 `use` 前后钩子，但无「fixture 名内嵌 runId」 | fixtures 实例化绑 runId（对应 DD-04、铁律 4） |
| 4 | 无断言论域收窄 / 系统对象排除 | — | `exists` / `count` 断言限定 run 作用域 + `excluded_system_objects[]`（对应铁律 9） |
| 5 | 无 cleanup 终态判据 | — | 轮询至 404 才算完成；超时 `BLOCKED(cleanup)`（对应铁律 10） |
| 6 | 报告是工程语言，无业务叙事层 | `report.json` / `summary.md` 面向工程师 | 权威 `report.json` 按**五要素**重定义；配色重写（PASS 中性/蓝 · FAIL 红 · BLOCKED 琥珀，**不用红绿**） |
| 7 | 绑定面**缺判定器** | 绑 `instruction / params / agent / agentContext / app identity` | 六重绑定补 `judge_impl_hash`，**并新增 `engine_provider_version`** |

> **第 7 项是本次调整新发现的绑定面**：上游**升级会整体 re-key 全部缓存条目**（`docs/cache.mdx` 原文），效果等价于我们的 `BLOCKED(drift)`，但它默认 heal 所以不报错。把 `engine_provider_version` 并入绑定项，漂移检测才能覆盖到上游引擎本身，否则「引擎换了但指纹还在复用」会成为新的静默错配通道。

---

## 五、反向：IDWTH 补它的三个洞（互补性证据）

| 它的缺口 | IDWTH 已有的对策 | 位置 |
|---|---|---|
| 导航与密钥填充**无 origin 白名单**（agent 可带着本步声明的密钥跟到别的站点） | `environment.origins_allowlist`，「越界即 `nav_blocked`」 | `detailed-design.md` §3.1 |
| 遮罩只到**输入控件级**（`mask` locator + maskColor）；页面上渲染出的 kubeconfig 片段 / Bearer token 是 `<div>`/`<pre>`，**不在遮罩集里** | 两层遮罩：输入控件 **+ 文本级已知密钥明文** | §5.5 `screenshot.ts`、§9.4 |
| 无判定器实现哈希 → 判定口径改了，新旧 verdict 不可比 | `judge_impl_hash` 参与 `verdict_hash` | §3.7、§3.6 |

**这三点证明两者是互补而非替代**：它的强项是我们的工程量，我们的强项是它不打算做的判定与合规。

---

## 六、验收标准的两条新增 + 一条精确化

### 6.1 新增 A10 / A11（守住 §4 的两处冲突）

| # | 构造场景 | 期望 | 测的边界 |
|---|---|---|---|
| **A10** | 断言区在**视口外** / 页面**加载中** / 纯 Canvas 页面上做断言 → 模型给不出结论 | **`BLOCKED(decision)`**，**不得报 FAIL** | 上游默认值不得渗透进我们的 verdict |
| **A11** | 缓存记录陈旧（对应上游 `REPLAY_STALE`）时以**默认命令**回放 | **报错终止（exit ≠ 0）**，**不得静默 heal 后报通过** | `--verify` 是真的默认，不是文档话术 |

### 6.2 A7「离线可跑」必须精确化（新发现）

A7 原文：「断开 JEV 端点（离线）→ 确定性路径全部可跑，SIR = 0」。
在 e2e 路径下这条**只在回放态成立**，必须拆成两条：

| 子条 | 状态 | 判据 |
|---|---|---|
| **A7a** | **回放态**（缓存命中）断网 | ✅ 全部可跑，零模型，符合原 A7 |
| **A7b** | **首次态**（缓存未命中）断网 | ⚠️ 走 L1/L2 的 step 可跑；**需要 L3 / `agent.act` 的 step → `BLOCKED(decision)`**，不得假装跑过 |

**由此产生一项交付物清单变更**：内网/离线部署时，**「已录制的引擎缓存」成为必须随版本交付的组件**（先在联网环境录一轮，缓存产物随包带入内网）。这是 IDWTH 原有交付物清单里没有的一项。

---

## 七、里程碑的调整（不推翻 M1–M4）

| 阶段 | 原交付物 | 调整 |
|---|---|---|
| **M1** 确定性闭环 | Contract Schema + L1 定位 + executor 状态机 + Playwright Adapter + judge + Trace + CLI | **实体不变**。`tools/browser/` 的实现改为「EngineProvider 适配器」，默认指向 e2e；`attach.ts` / `background-tab.ts` 仍自研 |
| **M2** 语义能力 | JEV Adapter + `validate_choice` + Semantic-Action + Recovery + 分级阈值 | Decision 的 transport 用 `@e2e-dev/decision`；`validate_choice` 五条校验**仍在我们代码里**；Recovery 的**触发权**在 Runtime（禁用它自动 heal） |
| **M3** 价值验证 | Reference Suite + 指标采集 + Report Viewer + `examples/k8s-adapter` | **新增一项前置**：把 `apps/web-benchmark` 的 20+ 硬场景纳入我们的回归基准（现成靶场）；报告权威 schema 按五要素重写 |
| **M4** 进 CI | `replay --verify` + `--repeat N` 二值门禁 + `doctor` | 加 **A10 / A11** 两条验收；`doctor` 增加「引擎缓存新鲜度」自检 |

---

## 八、风险与前置条件

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| 1 | **pre-1.0，升 minor 即 re-key 全部缓存** → 升级即重录，CI 成本与证据连续性双断 | 🔴 高 | **锁版本**；升级走独立 PR 并重录；`engine_provider_version` 入绑定项让漂移可见 |
| 2 | **Telemetry 默认开启**（CLI 每次调用发 `eu.i.posthog.com`） | 🟡 中 | 内网/合规环境 `npx e2e telemetry disable` **且 CI job env 也设** `E2E_TELEMETRY_DISABLED=1` |
| 3 | **模型 provider 出网**（未缓存动作 + 所有 `agent.assert`） | 🟡 中 | 内网必须接私有/本地模型（支持 OpenAI 兼容端点）；**并接受 A7b 的 BLOCKED 语义** |
| 4 | `command.log` 不脱敏 / 视频不遮罩（标 `redaction: "incomplete"`） | 🟡 中 | FR-5 的遮罩要求要**按上游实际遮罩集核对**；生产环境不录或只 `retain-on-failure` + 访问控制 |
| 5 | Windows 必须 WSL | 🟢 低 | 记入 `idwth doctor` 的环境检查项 |
| 6 | 判定层改动若落在**它的** executor 里 → 下次升级被你自己的补丁挡住 | 🟠 中高 | **不要 fork**（见 §9） |

---

## 九、明确建议「不做」的事

**不要 fork `tester-army/e2e`。**

理由三条：
1. **pre-1.0**：上游每周改 API，fork 后每次都要手动 merge —— 成本高于收益
2. **判定层的正确落点本来就不是它**：`ASSERTION_INCONCLUSIVE → BLOCKED` 是我们 Runtime 的职责，不是它的 executor 的职责。改在它里面 = 把我们的领域知识藏进一个会被升级覆盖的地方
3. **Apache-2.0 允许依赖，不需要 fork**：包装（wrap）比复制（fork）在许可与工程上都更省

---

## 十、回写 `detailed-design.md` 的清单（✅ 2026-10-08 全部执行 · 落地为 `detailed-design.md` **V1.2**）

| 位置 | 改动 | 性质 | 执行结果 |
|---|---|---|---|
| §1.1 设计目标 | 新增第 6 条：**执行引擎可替换**（EngineProvider） | 新增 | ✅ 已加第 6 条 + 理由段 |
| §2.1 逻辑架构 | 三层 → **四层**（插入 Engine Provider）；标注「判定内核 = 自研边界，不可替换」 | **架构级** | ✅ 已重绘为缩进层级图 + 4 条结构性标注（新增第 4 条） |
| §3.7 绑定 | 由五重 → **六重**：新增 `engine_provider_version` | 扩展 | ✅ 标题/JSON/作用点/新增「为什么必须有 ⑥」小节 |
| §5.1 / §5.5 | 标注「实现之一；保留 `attach.ts` / `background-tab.ts` 自研」 | 修订 | ✅ §5.0 新增整节 · §5.1/§5.5 加归属说明 |
| §6.1 独占项 | ①→⑤ 不变；**新增 ⑥ 恢复触发权** | 修订 | ✅ 已加 ⑥ 并改标题为「四个独占 + 两项条件性」 |
| §8.2 错误分类 | 新增映射：`ASSERTION_INCONCLUSIVE → BLOCKED(decision)` | 新增 | ✅ 已加表行 + 「为什么必须做错误码吸附」段 |
| §12 测试策略 | 新增 **A10 / A11**；A7 拆为 **A7a / A7b** | **验收级** | ✅ 已加 4 行 + 两段理由 |
| §11 目录结构 | 新增 `engine-provider/`；`tools/browser/` 降级移入 | 新增 | ✅ 整块重写，含 `runtime/scope.ts` / `error-adapter.ts` / `bindings.ts` |
| 交付物清单 | 离线部署需交付**「引擎缓存」**组件 | **新增** | ✅ §6.2 新增小节 + PRD NFR 增行 |

**额外交付（不在原 9 处内，一并落地）**：§9.4 可替换接口 双 → **三** · §13 里程碑三处调整 · §14 新增「V1.2 关闭执行引擎 5 项决议」 · 附录新增 V1.2 一句话总结 · §0.2 新增 **E 级变更清单（DD-30~DD-36，7 项）** · 文档版本 V1.1 → **V1.2**。

---

## 十一、待决问题（✅ 2026-10-08 · **全部按建议决策**）

| # | 问题 | 建议 | 决议 | 落点 |
|---|---|---|---|---|
| 1 | 默认实现走 `@e2e-dev/web`，还是先自研再逐步替换？ | **先自研骨架 + 并行跑通 e2e 适配器做对照**，两条都留着；等 M3 用实测数据决定默认值 | ✅ **采纳** | DD §5.0「决策记录」· §13 M1/M2/M3 |
| 2 | 是否把 `apps/web-benchmark` 的硬场景集纳入回归基准？ | **纳入**。它带 `planted-bugs.e2e.ts`（**度量漏检而非通过率**），比自建便宜得多 | ✅ **采纳** | DD §13 M3 |
| 3 | 「引擎缓存」进不进版本交付物？ | **进**。否则内网离线场景下 A7b 的 BLOCKED 会变成常态 | ✅ **采纳** | DD §6.2 · §12 A7b |
| 4 | 是否采用它的 `trace.md` 作为证据呈现？ | **作为可选渲染，不作权威产物** | ✅ **采纳** | DD §4.5 · §9.4 |
| 5 | 上游错误码要不要在报告里露出？ | **露出但降级为附加字段** `upstream_error_code` | ✅ **采纳** | DD §8.2 · §12 A10 |

> **五项决议的共性**：没有一项是"选哪个更好"，全都是**"不要把两件事绑在一起"** —— 不把"能不能跑通"和"用谁的实现"绑（Q1）、不把"证据呈现"和"报告契约"绑（Q4）、不把"上游诊断信息"和"我们的 verdict"绑（Q5）。**绑定越少，将来可换的空间越大。**

---

## 附：本文所有判断的来源

| 类别 | 来源 |
|---|---|
| IDWTH 现状（**回写后即 V1.2 / PRD V1.1**） | `final/PRD.md` V1.1（FR-1~FR-12 · **A1–A11**）· `final/detailed-design.md` **V1.2**（§2.1 **四层架构** · §3.7 **六重绑定** · **§5.0 Engine Provider 层** · §5.1/§5.5 Tool Layer · §6.1 四独占 **+ 两项条件性** · §11 目录结构 · §13 里程碑） |
| e2e 能力与默认值 | `final/e2e-tester-army-review.md`（源码行号均已标注）；`packages/decision/src/executor.ts:382` 为直接读到 |
| 领域判据 | 铁律 4 / 9 / 10 / 12（E02 实测得出）· 铁律 13（视觉噪声标定） |
| 未做 | **未本地安装运行 e2e**；引擎缓存 re-key 的实际影响、`--repeat` 能力、内网模型连通性均未实测 —— 对应「待决问题 1」的处置建议 |
