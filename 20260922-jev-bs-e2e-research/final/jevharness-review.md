# JevHarness 源码级评审

> 评审对象：`TianyuCodings/JevHarness`（包名 `auto-jev`）
> 评审目的：判断它对「BS 架构系统测试工具（IDWTH）」的可借鉴度与不可借鉴边界
> 评审日期：2026-09-23 ｜ 方式：全量浅克隆（91 MB / 1331 文件）+ `auto_jev/` 全部 21 个模块逐行阅读
> 上游定位自述：*LLM-authored task-specific Jev harnesses with optional full-trajectory reward reflection and GEPA evolution*

---

## 一、结论先行

**这不是「第四个竞品」，它根本不在这条赛道上——它是你架构图里「L3 + 学习飞轮」那一格的参考实现。**

| 判断项 | 结论 |
|---|---|
| 能否当测试框架用 | ❌ **不能**。全仓库无 `report.*` / `verdict.*` / `assert.*` / `replay.*`，零断言层、零报告层 |
| 是否因此淘汰 | ❌ **不淘汰**。它从不声称自己是测试框架，用「无报告层」判它淘汰是错判赛道 |
| 真正的定位 | **策略固化 + 离线演化引擎**：把 LLM 的推理策略编译成可冻结的决策管线，再用全轨迹奖励离线优化它 |
| 可借鉴度 | ⭐⭐⭐⭐⭐（**思想与手法层**，尤其「约束必须在代码里」和「冻结绑定五重哈希」两处） |
| 可否引依赖 / 复制代码 | ❌ **禁止**。`license: null`，与 `CorieW/JevTest` 同级红线 |
| 对你的三条既有铁律 | **全部独立印证**，并补强了其中两条的实现手法 |

**一句话**：`jev-e2e` 给你「怎么产出可信报告」，JevHarness 给你「怎么把模型的不确定决策固化成可审计的确定性策略，以及固化产物被改动时怎么拒绝执行」。

---

## 二、仓库事实核验

| 维度 | 值 | 备注 |
|---|---|---|
| 仓库 | `TianyuCodings/JevHarness` | 包名 `auto-jev` / 导入名 `auto_jev` |
| 语言 / 运行时 | Python ≥ 3.11 | `pyproject.toml` |
| **许可证** | **`null`（无 LICENSE 文件）** | ⚠️ **硬红线，见第六节** |
| Star / Fork / Issues | 148 / 10 / 0 | 0 issue 说明**未经社区检验** |
| 创建 / 最后推送 | 2026-09-21T08:59Z / 2026-09-21T10:39Z | 评审时仓库仅 2 天大，单次快照 |
| 体积 / 文件数 | 43 MB（含 Pokemon 存档 blobs）/ 1331 | 绝大部分是存档与静态站点 |
| 核心代码量 | `auto_jev/` 21 个模块，**4872 行** | 无第三方面板代码，全部手写 |
| 测试 | **297 个 `test_*` 函数**，36 个测试文件 | 覆盖 spec/runtime/evolution/frozen/trace/沙箱 |
| 关键依赖 | `gepa==0.1.4`（**精确钉版**）、httpx、openai、anthropic、fastapi | |
| 是否产出测试报告 | ❌ 产出 `RunStore` 目录 + 只读决策存档网站 | 不是测试报告 |
| 领域示例 | Pokemon 对战（真实实验存档）+ 加密货币（crypto_episode 遗留默认） | 与 BS 测试无关 |

---

## 三、它到底在做什么（与前三仓库的层级差）

```
你既有调研                     JevHarness
──────────                     ──────────
jev-ultrafast  执行/决策协议
JevTest        机制蓝本         ┌─────────────────────────────┐
jev-e2e        端到端成品  ←    │  PipelineSpec（决策管线定义） │
                               │   ├ 特征计算（受限表达式/Python）│
                               │   ├ Jev 判断（choice/score/noul）│
                               │   └ 动作选择 + memory          │
                               └───────────┬─────────────────┘
                                           │ 在「任务适配器」边界内运行
                                           │（观测/合法动作/副作用/评分 全在外部可信代码）
                                           ▼
                     完整轨迹 + 奖励 ──→ GEPA 离线演化 ──→ 冻结
```

README 的主循环（`README.zh-CN.md:66-75`）：

```
任务约定与示例 → 构建 harness 的 LLM → Python 与表达式代码 + Jev 问题
     → 任务动作 → 可信环境与奖励 → 完整执行轨迹 ──(可选反思)──→ 回到 LLM
```

**关键设计动机**（`README.zh-CN.md:9-13`）：*"让 LLM 编写面向具体任务的 harness……Harness 固定后，执行依靠这些代码及其 Jev 调用，无需让构建它的 LLM 参与每次决策。"*
→ 即：**把「每次决策都让 LLM 重新推理」换成「LLM 一次性写好策略代码 + Jev 做轻量模糊判断」**。这与你的「planner 固化后关掉」是同一目标，但它把这件事做成了可优化的闭环。

### 三层职责边界（这是它最干净的部分）

| 层 | 归属 | 代码落点 |
|---|---|---|
| **任务边界**（观测什么 / 合法动作 / 副作用 / 评分） | 任务适配器（外部可信代码） | `examples/pokemon/adapter.py`、`auto_jev/crypto.py` |
| **策略层**（特征 / 问题 / 判定标准 / 决策逻辑 / 记忆） | 候选 harness（**可被演化**） | `auto_jev/spec.py` `PipelineSpec` |
| **执行层**（并行 DAG / 沙箱 / 轨迹） | Runtime（不可被候选改写） | `auto_jev/runtime.py`、`python_nodes.py` |

`skills/jev-harness/SKILL.md:37` 原文（**本报告最值钱的一句**）：

> *"It cannot rewrite reward, labels, hidden state, action permissions, or the evaluator to win the benchmark. If the task requires Jev in production, enforce that as a candidate constraint before evaluation and freezing; **a prompt instruction alone is not enforcement**."*

---

## 四、核心机制拆解

### 4.1 `PipelineSpec`：把策略写成受限代码（`spec.py:148-240`）

| 版本 | 能力 | 依赖声明 |
|---|---|---|
| v1 | 顺序节点 | 无 |
| v2 | 表达式 + Jev 依赖图，独立节点**并行**（默认 8 worker） | 由字面量 `nodes['id']` 引用**自动推断** |
| v3 | 增加 `python` 节点 + 动态问题（`questions_expression`） | Python 节点 **`depends_on` 强制显式** |

- **三值判定原语**：`choice`（选项→描述映射）/ `score`（2–10 级有序描述）/ `noul`（对明确命题给 0–1 概率）。
- **受限表达式语言**（`spec.py:50-67`）：白名单 AST + 白名单函数（`min/max/abs/sum/len/mean/std/last/clip/get/column`）。**无属性访问、无推导式、无幂运算、无字符串格式化**。这是「模型产出物不能变成任意代码」的第一道闸。
- **两道深度检查**：`_json` 限制总元素数与总文本字节；`validate_spec` 限制 64 节点 / 200 KB 管线，且 v2+ 编译 DAG 后**拒绝环与未知引用**。
- **`spec_hash`**（`spec.py:198`）= `sha256(validate → sort_keys → compact JSON)`。你的 `plan.json` 已经是这个思路。

**值得单独记一笔**：`memory_update` 表达式**在整张 DAG 全部成功后才提交一次**（`runtime.py:90-103`）。这是「记忆要么整体推进、要么完全不动」的原子语义，与你的「已派发的 mutation 不得自动重试」同源。

### 4.2 节点级四态 —— 比你的三态更细（`runtime.py:162-232`）

```python
record['status'] = 'ok' | 'error' | 'blocked' | 'cancelled'
```

| 状态 | 触发 |
|---|---|
| `ok` | 节点成功 |
| `error` | 节点自身抛错 |
| `blocked` | `"blocked: upstream node(s) failed: <ids>"` —— **下游因上游失败而从未运行** |
| `cancelled` | `"cancelled: run stopped after node(s) failed"` —— 已排队但被丢弃 |

**为什么这比你的三态更有用**：你在铁律里要求「BLOCKED 必须细分，否则报告诊断不了『为什么判不了』」。这里是同一诉求在**节点粒度**的实现——`blocked`（因果归因）与 `cancelled`（预算/中止归因）分开记账。

### 4.3 冻结与漂移拒绝 —— 你 P2 缺的那一环（`frozen.py`）

`validate_artifact`（`frozen.py:181-197`）在每次冻结执行前校验 **五重绑定**：

| 校验项 | 失败信息 | 对应你的诉求 |
|---|---|---|
| `artifact_hash` | Frozen artifact integrity check failed | 产物自校验 |
| `spec_hash` | Frozen specification hash mismatch | **plan.json 完整性**（你已有） |
| **`source_hash`** | *"Runtime source changed since freezing; review and freeze a new artifact"* | ⭐ **执行器源码变了就拒绝跑** |
| `observation_config` | Observation contract differs from the frozen artifact | ⭐ **观测契约是哈希的一部分** |
| `jev_metadata.transport` | Jev transport differs from the frozen artifact | ⭐ **传输通道变了也拒绝** |
| `task_contract` | 见下 | ⭐⭐ **评估器/规则/引擎全绑定** |

`task_contract`（`frozen.py:85-99`）是**你完全没有的、也是最该抄的一块**：

```python
build_task_contract(evaluator, files=(), trees=(), git=(), executables=())
```

绑定内容：
- **评估器身份**：`{module, qualname, path, sha256(源码文件)}` —— 评估器源码改一个字节即失效
- **文件**：每个规则/配置文件 → 绝对路径 + sha256
- **目录树**：`rglob('*')` 逐文件摘要（**拒绝符号链接**、拒绝非普通文件）
- **git**：`{commit, clean: True}`，**有未提交改动直接报错**
- **可执行文件**：命令名 → `{绝对路径, sha256}`（注释明确：不能重新解析符号链接目标，否则「替换后的链接即使字节相同也会被静默认可」）
- **Python 运行时身份**：`runtime_identity()` 含沙箱可执行文件与解释器指纹

`freeze_run`（`evolution.py:530-548`）还有两道门：**只有 completed 的 run 能冻结**；**候选必须通过全量 validation 每一集**（`set(latest) != expected or any(status != 'ok')` → raise）。

> **直接映射到你的产品**：你的 `plan.json` 现在只存 `sha256(plan)`。建议扩成 JevHarness 这套——**plan + 执行器源码哈希 + 观测契约哈希 + 断言集哈希 + 被测系统版本(git rev) + 浏览器/Node 运行时指纹**。任何一项变化 → **拒绝回放并报 BLOCKED(drift)**，而不是"接着跑"。这正是你铁律 3 要求的形态，它给出了可照搬的字段设计。

### 4.4 「截断 ≠ 通过」—— 它在示例里就做对了（`adapter.py:145-149`）

```python
if result['status'] != 'completed':
    if result['status'] != 'truncated' or message.get('reason') not in ('max_turns','max_requests'):
        raise PokemonInfrastructureError('Game terminal status is malformed')
    result['termination_reason'] = message.get('reason')
    raise ValueError('Battle did not reach an engine-confirmed terminal result')
```

`docs/task-authoring.md:106` 原文：*"in the Pokémon task, only an engine-confirmed win/loss/draw earns 1/0/0.5; **reaching a step limit is not a draw**."*

→ 超步数上限**不计半分、不计通过**，而是抛错作废。**这就是你「超预算 = BLOCKED，永不计入 bug 检出」的正确实现。**

### 4.5 动作被环境拒绝 → memory 回滚，且不重试（`adapter.py:128-137, 193-203`）

```python
if message['type'] == 'action_rejected':
    memory = copy.deepcopy(rejected['memory_before'])
    rejected['memory_rolled_back'] = True
```

且动作合法性**在任何执行前校验**：`if action_id not in actions: record.update(status='error'); raise ValueError('Policy returned an unavailable action ID')` —— **memory 只在合法性通过后才推进**（`adapter.py:197`）。

→ 与你的「模型输出永不成为选择器/坐标/Shell/JS」「副作用不重试」一致，但多给了你一个设计：**记忆回滚点**。

### 4.6 全轨迹反思 + 超限即拒（`reflection.py`）

- `full_feedback`：每个被选中的训练 episode **必须有一条完整轨迹**，`record['result']` + `record['score']` 原样并入，注释写明 *"no sampling, summarization or slicing"*。
- `archive_prompt`（`reflection.py:57-82`）：**先把完整输入落盘并记 sha256，再检查字节上限**；超限则 `raise ReflectionContextError`，**不截断、不调模型**，错误信息里给出完整输入路径。
- `coverage()` 区分 `complete=true`（**覆盖完整**）与是否成功派发 —— 明确 `complete=true` 指覆盖度，不代表派发成功。
- 事件账：`reflection_input` / `reflection_dispatch` / `reflection_complete` / `reflection_error` / `proposal` / `proposal_rejected` 全落 JSONL。

### 4.7 GEPA 演化：诚实的选择与接受规则（`evolution.py:484-527`）

| 项 | 设置 |
|---|---|
| 候选空间 | **可改 Python 源码 / 表达式 / 图拓扑 / 问题 instructions / criteria / 记忆规则** |
| 父代选择 | `frontier_type='instance'` + 自定义 `Selector`（**实例级前沿**，非单一均分） |
| 接受准则 | `acceptance_criterion='strict_improvement'`（父子在**同一训练批次**上严格改进） |
| 验证策略 | `val_evaluation_policy='full_eval'`（全量验证，逐集不通过即不合格） |
| 明确关闭 | `use_merge=False`、`cache_evaluation=False` |
| 硬约束 | **禁止改 `jev_model`**（`Cannot change the fixed Jev model`）；**禁止跨大版本演化**（`Version N graph evolution must remain version N`） |
| 最终选择 | `max(valid, key=val_aggregate_scores)` —— 只从**通过全部验证集**的候选里选 |
| 失败保留 | `proposal_rejected` 事件 + `rounds.skipped_batches` + `stop_reason` 枚举（`training_perfect` / `round_target` / `metric_budget` / `external_stop`） |
| 系统故障隔离 | 反思异常被 latch 住，**防止 GEPA 内部重试造成重复付费调用**（`evolution.py:457-463`） |

### 4.8 数据三分 + 重叠即报错（`experiment.py`）

```python
if any(train_range[a][1] > val_range[a][0] for a in assets): raise ValueError('Training overlaps validation')
if any(val_range[a][1] > test_range[a][0] for a in assets):   raise ValueError('Validation overlaps test')
if {ep['id'] for ep in test} & {ep['id'] for ep in train+validation}: raise ValueError('Test IDs overlap search data')
```

且 test 数据**在冻结之后才首次解析**（`experiment.py:156`：*"Test observations are first parsed here, after candidate selection and freeze."*），并校验 `_sha(cfg['test']) != hashes['test']` → *"Sealed test data changed during evolution"*。

`references/evaluation.md:17` 把口径写死：validation *"**is not an untouched final benchmark**"*。

### 4.9 零模型回放（模型层）：`cache_only`（`providers.py:91`）

```python
if self.cache_only: raise JevProviderError('No recorded response for this input; cache-only replay cannot call the API')
```

→ **缓存未命中就报错，绝不回落到真实调用**。这是你「回放必须零模型调用」在模型层的正确形态。
⚠️ 但仓库自己在 `frozen.py:544` 写明：*"Gateway alias does not guarantee a fixed underlying model version."* —— **缓存回放 ≠ 同一模型**，别把"录播"当"真实执行"。

### 4.10 ⭐ 把真实校验器源码注入 prompt（`examples/pokemon/execution_contract.py`）

```python
'source_validator': inspect.getsource(python_nodes.validate_python_source),
'source_evaluator': inspect.getsource(spec.evaluate_expression),
'forbidden_identifiers': sorted(python_nodes._FORBIDDEN),
'allowed_object_methods': sorted(python_nodes._METHODS),
'limits': {...SOURCE_BYTES, AST_NODES, WALL_SECONDS, CPU_SECONDS, MEMORY_BYTES...},
```

**它不写"你不能用 open()"这句话，它把 `_FORBIDDEN` 集合和校验函数源码本身给模型。**

→ 这直接解决你 L3 自愈/规划层最隐蔽的失效模式：**prompt 里复述的规则与执行器实际规则漂移**。改成从执行器 `inspect` 出来，物理上不可能漂移。**这一招建议原样搬到你的 planner / 自愈 skill。**

### 4.11 沙箱：确定性执行的强边界，但也是最大移植障碍（`python_nodes.py`）

- AST 白名单（`_AST`），禁用所有下划线开头的标识符（**含 `_`**）、禁用 `open/exec/eval/getattr/type/object/...`、禁止属性写入、禁止模块级非函数代码。
- 强制唯一入口 `run(obs, nodes, memory)`，**无默认参数、无注解**。
- 资源上限：源 64 KiB / AST 1 万节点 / 入 2 MiB / 出 1 MiB / **墙钟 5s / CPU 2s / RSS 512 MiB（~20 ms 采样）**。
- **`/usr/bin/sandbox-exec` 原生 macOS 沙箱；非 darwin 或隔离不可用 → 直接拒绝执行，"no host execution fallback"**（`python_nodes.py:104-105, 26`）。

---

## 五、与你的架构铁律逐条对照

| 你的铁律 | JevHarness 是否印证 | 证据 |
|---|---|---|
| ① **编排者必须是确定性代码** | ✅ 强印证 | 冻结产物的执行体是 `PipelineRuntime`（纯 Python 线程池 DAG），构建 LLM 不在执行路径上（`README.zh-CN.md:13`） |
| ② **判定权三独占** | ✅ 印证 + 给出更强表述 | 候选不得改写 reward/labels/hidden state/action permissions/evaluator；**「prompt 里写不算，必须在代码里成为约束」**（`SKILL.md:37`） |
| ③ **回放必须拆 verify / heal，禁止静默适配** | ✅✅ 强印证 | `source_hash` 变了 → 拒绝跑并让你重新冻结（`frozen.py:186`）；`cache_only` 未命中 → 报错不回落（`providers.py:91`） |
| ④ **fixtures 必须带 runId 命名空间** | ⚠️ 部分印证 | Jev 缓存按 `cache_namespace=uuid4` 隔离（`providers.py:32-35`）、tier 目录按 `run_id/cand_hash/episode_id` 分片（`storage.py:227`）；但**它无后端数据库，故无 DB 隔离方案** |
| ⑤ **已派发的 mutation 不得自动重试** | ✅ 印证 + 补强 | 动作被拒 → memory 回滚，不重试（`adapter.py:128-137`）；反思异常被 latch 防止 GEPA 重复付费调用（`evolution.py:457-463`） |
| ⑥ **目标歧义即 BLOCKED，禁止取第一个** | ❌ 未涉及 | 无「多命中」概念（它没有选择器层）。你的这条仍需自建 |
| ⑦ **稳定性指标不能取平均** | ❌ 未涉及 | 它的 score 是 episode 级标量；`val_aggregate_scores` 是**跨 episode 取均**（线性可比，尚可），但**无 flaky 计数概念**。你这条仍要自建 |
| BLOCKED 必须细分 | ✅ 印证 | 节点级 `blocked` vs `cancelled`（`runtime.py:216-232`） |
| 截图遮罩 / 导航守卫 / iframe | ❌ 不涉及 | 无浏览器层 |

**净结论**：你的七条铁律里，**① ② ③ ⑤ + BLOCKED 细分** 被这份实现独立印证（且 ③ 的实现手法可直接抄）；**⑥ ⑦** 它完全没碰，因为那是测试工具特有的问题。

---

## 六、口径校正与硬约束

### 6.1 效果声明的真实口径

| 声明 | 原文 | 能否外推 |
|---|---|---|
| Eval 胜率 25%(3/12) → 75%(9/12) | `README.md:15`，5 轮反思 | ❌ **作者自述**：*"an example result on the **selection** Eval set, **not an independent estimate** of performance on unseen games"*（`README.md:48`） |
| 最终保留第 3 轮候选 | `README.md:15` | 说明 5 轮里有 2 轮没跑赢，**"轮数多 = 效果好"不成立** |
| 决策延迟 568 ms 中位 / P95 657 ms | Pokemon，113 次决策 | ⚠️ 受控本地引擎 + 每次均标记为**未命中本地缓存**；作者自认 *"not a controlled speed comparison"* |
| 样本量 | 12 局 Eval | ❌ 极小。你的既有报告已识破同类问题（eBay 1/3~2/3），**这条同样不可外推** |
| crypto 配置（`btc_1000_50` / `scale_1000_50`） | 仓库内存在配置 | ❌ **未见任何公布结果**，属遗留默认，别当已验证能力 |

### 6.2 硬约束（必须写进你的决策记录）

| # | 约束 | 后果 |
|---|---|---|
| **1** | **无许可证**（`license: null`，无 LICENSE 文件） | **只能读设计，禁止复制代码、禁止引依赖、禁止商用**。与 `CorieW/JevTest` 同级红线 |
| **2** | **v3 Python 节点 macOS-only** | `/usr/bin/sandbox-exec` 缺失即拒绝执行，**无降级**。你的 CI Runtime 若跑 Linux → **v3 不可用**；退到 v2 则丧失 Python 能力（无属性/推导式/幂运算），特征工程能力大幅受限 |
| **3** | **冻结后仍会调用 Jev** | `frozen.py:59`：*"A frozen configuration does not eliminate Jev calls."* → 不满足「零模型调用」。`cache_only` 可做到零调用，但那是录播 |
| **4** | **GEPA 搜索面极大**（可改代码/图/问题/标准/记忆） | 过拟合风险高；且优化目标是**你的断言通过率**，若断言集本身偏弱，演化会朝"绕过弱断言"方向漂移 |
| **5** | 仓库 2 天新、0 issue、148 star | 未经生产检验；API 可能快速变动 |
| **6** | 无后端数据隔离方案 | 与前三仓库同一个坑（浏览器/引擎隔离 ≠ 数据库隔离），**你的 P1 仍必须自建** |

---

## 七、给你项目的具体建议

### 7.1 骨架不动，嫁接四件套

**继续以 `jev-e2e` 为产品骨架**（MIT 可商用、报告五要素齐、7 种封闭断言模板）。从 JevHarness 只取以下四件，**不取代码，只取设计与字段**：

| # | 抄什么 | 落到你的哪一环 | 优先级 |
|---|---|---|---|
| 1 | **`task_contract` 五重绑定**：评估器源码哈希 + 规则文件哈希 + 目录树摘要 + git(commit+clean) + 可执行文件哈希 + 运行时指纹 | 扩你的 `plan.json` 绑定段；回放前校验，任一不符 → **BLOCKED(drift)** 而非继续跑 | **P0** |
| 2 | **`authoring_contract()` 手法**：把执行器真实校验器**源码**注入模型，而不是在 prompt 里复述规则 | 你的 planner（`.cases` → steps）与 L3 自愈 skill；同时输出**断言模板白名单源码** | **P0** |
| 3 | **「截断/超预算 ≠ 通过」的显式抛错语义** | 你的判定聚合：超步数/超预算/超时 → BLOCKED，**永不计入 bug 检出** | P1 |
| 4 | **节点级 `blocked` vs `cancelled` 双状态 + memory 原子提交/回滚点** | 你 step 级的失败归因与 fixtures 清理归属 | P1 |

### 7.2 明确不要抄的

| 不要抄 | 原因 |
|---|---|
| GEPA 演化进 CI 路径 | 演化是**离线开发期**动作。CI 必须走 `replay --verify`（零模型）。演化产物入库、人工确认后才进 CI |
| PipelineSpec 作为用例格式 | `choice/score/noul` 是**决策原语**，不是**断言原语**。用例格式继续用 `.cases` 的 7 种封闭断言模板 |
| 领域假设（Pokemon 规则 / crypto 手续费 / 数据集分割比例） | `SKILL.md:33` 自己就警告：*"Do not silently inherit cryptocurrency objectives, fees, datasets, Pokémon rules..."* |
| macOS 沙箱方案 | 你是 B/S 测试工具，CI 大概率 Linux。若需要跑模型生成的代码，自建隔离（容器 / gVisor / 子进程 + rlimit），**不要**照抄 `sandbox-exec` |
| 无断言的 score-only 评估 | 它的 evaluator 是"给个分"，你要的是"断言逐条对照"。少这一层，报告五要素的 ④ 就没了 |

### 7.3 一条可直接写进产品定义的边界

JevHarness 给了你一条**极其干净的分工线**，建议固化下来：

> **JevHarness 式演化只优化「允许模型决定的那部分」（L3 选哪个控件 / 何时切换策略），其优化目标由你的确定性断言提供；它本身永不产出 verdict。**
> —— 即：**它优化策略，不参与判定。** 判定依然是 `verdict = f(evidence, assertions)` 的纯函数，由你的 Runtime 独占调用权与写入权。

这条边界成立的前提，正是它自己的设计：**候选不可改写 evaluator**。所以——只要你的断言层在候选之外，**模型成本随跑次数单调下降的「学习飞轮」与「判定权独占」并不冲突，可以同时成立**。这是这次评审最有价值的产出。

### 7.4 与你既有文档的衔接

| 你的文档 | 本次评审带来的修订 |
|---|---|
| `final/report.md` §5.2「必须自建的三件事」 | 补第 4 件：**固化产物的绑定与漂移拒绝**（JevHarness 给了字段设计） |
| `final/product-definition.md`「学习飞轮」 | 补：飞轮的**离线**属性——演化在 CI 之外，产物冻结后进 CI |
| `final/implementation-plan.md` P2「固化与提速」 | `plan.json` 绑定段扩为五重哈希；回放拆 `--verify`（默认，漂移即 BLOCKED）/ `--heal`（显式，产物不入 CI） |
| `final/prd-review.md` 铁律 2 | 引用 `SKILL.md:37` 作为外部佐证：*"a prompt instruction alone is not enforcement"* |

---

## 附录：核验方式与关键源码索引

```sh
git clone --depth 1 https://github.com/TianyuCodings/JevHarness.git   # 1331 文件 / 91 MB
gh api repos/TianyuCodings/JevHarness --jq '{stars,forks,lang,license,pushed,created}'
# → {"stars":148,"forks":10,"lang":"Python","license":null,"pushed":"2026-09-21T10:39:01Z","created":"2026-09-21T08:59:46Z"}
```

| 机制 | 文件:行 |
|---|---|
| `PipelineSpec` 校验 / `spec_hash` | `auto_jev/spec.py:148-199` |
| 受限表达式解释器（AST 白名单） | `auto_jev/spec.py:50-126` |
| 并行 DAG 执行器 / 节点四态 | `auto_jev/runtime.py:46-274` |
| 任务合约构建与校验 | `auto_jev/frozen.py:85-178` |
| 冻结产物五重校验 / 漂移拒绝 | `auto_jev/frozen.py:181-205` |
| `freeze_run`（必须全量验证通过） | `auto_jev/evolution.py:530-548` |
| GEPA 接线与接受准则 | `auto_jev/evolution.py:484-527` |
| 全轨迹反思 / 超限即拒 | `auto_jev/reflection.py:19-82` |
| 零模型回放（cache-only） | `auto_jev/providers.py:91` |
| 沙箱（macOS-only，无降级） | `auto_jev/python_nodes.py:58-127` |
| 真实校验器源码注入 prompt | `examples/pokemon/execution_contract.py:7-68` |
| 截断≠平局 / 动作拒绝回滚 | `examples/pokemon/adapter.py:128-203` |
| 数据三分与重叠检查 | `auto_jev/experiment.py:33-165` |
| 候选约束「prompt 不算数」 | `skills/jev-harness/SKILL.md:37` |
| 评估口径三分定义 | `skills/jev-harness/references/evaluation.md:13-19` |

> **数据来源**：全部来自浅克隆后的源码逐行阅读；star/fork/license 经 `gh`（已认证）取得，为 2026-09-23 快照。效果数字来自仓库自带 README 与 Pokemon 存档，属**作者自测**，非独立复现。
