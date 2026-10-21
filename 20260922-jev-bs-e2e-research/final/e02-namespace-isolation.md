# E02 · K8s Namespace 作为 runId 数据隔离单元 —— 实测报告

| 项目 | 内容 |
|---|---|
| 日期 | 2026-09-23 |
| 目标系统 | openFuyao 管理平台 `https://openfuyao-staging.internal.example.com:31616` · 单集群 `host` |
| 授权范围 | **用户明确：仅允许创建和删除测试命名空间，不允许操作任何已有配置/资源** |
| 实测方式 | K8s 原生 API 经控制台代理 `/clusters/host/api/kubernetes/api/v1/...`（不经 UI） |
| 结果 | **20/20 通过**（其中 1 项为「判据可用性」的**证伪性失败**，见 §4.2） |
| 复跑 | `scripts/of-ns-lifecycle.py` · `scripts/of-clock-skew.py` |
| 证据 | `scripts/e02-ns-lifecycle-natural.json` · `scripts/e02-ns-lifecycle-delay3s.json` · `scripts/e02-clock-skew.json` |

---

## 1. 结论速览

| 问题 | 结论 |
|---|---|
| **E02** 后端数据隔离方案 | ✅ **通过**。`ns-idwth-<runId>` 作为隔离单元完全可行，创建 201、归属可回读、内部可读、删除干净 |
| **E03** 测试数据重置 | ✅ **技术上已闭**：删除幂等（重复删 = 404 不报错）+ `labelSelector` 可按 runId 扫孤儿。**仅剩「谁负责清理」的组织问题** |
| 对既有设计的修正 | ⚠️ **1 条证伪 + 2 条新增约束**（§4） |

---

## 2. 授权范围与安全守卫

本次是**受控写操作**。脚本以此为前提设计三重守卫，确保**即使脚本被误用也无法触达已有资源**：

| 守卫 | 机制 | 作用 |
|---|---|---|
| **1 · 名前缀** | 写操作目标必须匹配 `^idwth-\d{8}-[0-9a-f]{6}$` | 任何不以 `idwth-` 开头的名字直接被拒 |
| **2 · 本进程白名单** | 删除只允许作用于**本进程刚刚创建成功**的名字（内存集合） | 即便外界传入 `default` / `kube-system` 也无法删除 |
| **3 · 标签核验** | 删除前再 GET 一次，核验 `idwth.io/run-id` 标签 == 本次 runId | 防"删到别的 run 的残留" |

**写操作审计流水**（全部 5 次，无第 6 次）：

```
create-namespace        → 201
create-namespace(dup)   → 409   (故意的，验证可判定性)
get-namespace           → 200   (只读)
delete-namespace        → 200
delete-namespace(2nd)   → 404   (故意的，验证幂等性)
```

**基线比对（证明未触碰已有资源）**：

```
基线命名空间 10 个：default · ingress-nginx · kube-node-lease · kube-public ·
                    kube-system · monitoring · oauth-code-token ·
                    openfuyao-system · openfuyao-system-controller · session-secret
终态命名空间 10 个：同上
diff → added=[]  removed=[]  changed=[]        ← 三项全空
```

---

## 3. 实测矩阵（20 项）

| # | 检查项 | 期望 | 实际 | 判定 |
|---|---|---|---|---|
| P0-1 | 基线可读 | 200 | 200, 10 个 ns | ✅ |
| P0-2 | 基线无 `idwth-*` 残留 | 0 | 0 | ✅ |
| P1-1 | 创建 `idwth-<date>-<hex>` | 201 | **201** | ✅ |
| P2-1 | 同名再创建 | 409 AlreadyExists | **409** | ✅ |
| P3-1 | GET 命名空间 | 200 | 200 | ✅ |
| P3-2 | 归属标签回读一致 | 标签 == runId | 完全一致 | ✅ |
| **P3-3** | **`created_at > run_start` 判据可用性** | 可区分 | 自然节奏下 **−0.019s** | ❌ **见 §4.2** |
| P4-1 | ns 内列 pods | 200 | 200, items=0 | ✅ |
| P4-2 | ns 内列 configmaps | 200 | **200, items=1 `kube-root-ca.crt`** | ✅（但见 §4.3） |
| P4-3 | ns 内列 services | 200 | 200, items=0 | ✅ |
| P4b-1 | `labelSelector=run-id=<本次>` | 200, 命中 1 | 200, **命中 1** | ✅ |
| P4b-2 | `labelSelector=run-id=<不存在>` | 200, 命中 0 | 200, **命中 0** | ✅ |
| P4b-3 | `labelSelector=managed-by=lifecycle-probe` | 200 | 200, 命中 1 | ✅ |
| P5-1 | DELETE 命名空间 | 200/202 | **200** | ✅ |
| P6-1 | 命名空间最终消失 | 404 | 404, **6.2s** | ✅ |
| P6-2 | 释放耗时可接受 | <30s | 6.2s | ✅ |
| P7-1 | 重复删除 | 404（幂等） | **404** | ✅ |
| P8-1 | 无新增残留 | 0 | 0 | ✅ |
| P8-2 | 无删除已有 | 0 | 0 | ✅ |
| P8-3 | 无修改已有 | 0 | 0 | ✅ |

### 3.1 释放过程（决定 cleanup 是否需要等待终态）

```
t=0.0s  GET → 200  phase=Terminating
t=2.1s  GET → 200  phase=Terminating
t=4.1s  GET → 200  phase=Terminating
t=6.2s  GET → 404  ← 释放完成
```

**删除是异步的**。`DELETE` 返回 200 只代表"已受理"，不代表"已释放"。这一条直接约束 cleanup 的实现方式（§4.4）。

---

## 4. 对既有设计的修正

### 4.1 ✅ E02 通过 —— namespace 作为 runId 单元成立

`ns-idwth-20260923-7b340f` 形态是合法 DNS-1123 label，平台与 K8s 均接受。归属标签可写入、可回读、可被 `labelSelector` 检索。→ **A04（fixtures runId 命名空间）可以按原设计落地。**

### 4.2 ❌ 证伪：`created_at > run_start` 不可作为 runId 作用域判据

**这条推翻的是我自己在 PRD 评审 D1 里给出的备选修法**（当时写：「或追加 `created_at > run_start`」）。

**根因不是时钟偏移**——先排除了它：

| 测量点 | server − local 偏移 |
|---|---|
| K8s API `/namespaces` | −0.47s |
| K8s API `/version` | −0.53s |
| 控制台 REST | −0.58s |

偏移仅 ~0.5s（且 HTTP `Date` 头本身只有秒级精度），**两端基本同步**。

**真正的原因是 K8s 时间戳只到秒**。做了一次对照实验：

| 对照 | 创建前等待 | `created_at − run_start` | 严格 `>` 判定 |
|---|---|---|---|
| **A · 自然节奏**（= 真实 CI 里的常态） | 0s | **−0.019s** | ❌ 假阴性 |
| **B · 人为延迟** | 3s | **+2.293s** | ✅ 通过 |

对照 A 的 −0.019s 是关键：从 run 起始到创建命名空间只隔了一次 HTTP 请求（<1s），而时间戳被截断到秒 → `created_at` 落在 run_start 的**同一秒甚至前一秒**。

**结论**：这是个**边界脆弱判据** —— 当创建发生在 run 起始的同一秒内（完全正常，且在 CI 里最常见），严格 `>` 就翻转。

| | 写法 | 后果 |
|---|---|---|
| 现在 | `created_at > run_start` | 同秒内创建 → **判为"不是本次创建"** → 若用于 `exists` 过滤，会把本次刚建好的资源排除掉 → **假 FAIL / 或反向使用时假 PASS** |
| 正确 | **名字 / 标签内嵌 runId**（`ns-idwth-<runId>`、`idwth.io/run-id=<runId>`） | 与时钟、精度、时区完全无关，**读取即判定** |

> **泛化原则**（值得写进规范）：**凡跨系统的时间戳比较，都不能作为"这是本次产生的"判据。** 时区、精度、时钟偏移三者任一不齐就会翻转，而报告里看不出异常。要判断归属，用**身份标识**（名字/标签），不用**时间先后**。

**对 detailed-design 的影响**：§3.1 `fixtures` 实例化规则的「断言」一行原文写 `text_contains: "idwth-"`（前缀），这已经是正确形态；但需**显式禁止**再引入 `created_at > run_start` 作为替代或补充。

### 4.3 🆕 新建命名空间**不是空的** —— `count == 0` 类断言会假 FAIL

P4-2 实测：**刚创建、什么都没放的命名空间里，`configmaps` 已经有 1 个** —— `kube-root-ca.crt`，由 K8s 控制面自动注入。`pods` / `services` 为 0，但这只是这两个 kind 的巧合。

**影响**：`backend: {key: configmap.count, equals: 0}` 这类断言会在**全新的干净命名空间上直接失败**，而这些失败**不是应用缺陷**。

且这是**与 DD-04 镜像对称的第二个假结论通道**：

| 通道 | 成因 | 症状 |
|---|---|---|
| DD-04 假 PASS | 上次运行的**残留**让 `exists` 恒真 | 测试永远绿 |
| **本节 假 FAIL** | 系统的**自动注入**让 `count == 0` 恒假 | 测试永远红，且归因指向应用 |

**修正**：`backend` 断言的计数语义不能是"绝对计数"，必须是**「相对 run 起点的差分」**或**「限定到本次 run 创建的对象集」**。建议在 `EvidenceProvider` 契约里把 `scope: run` 明确为：

```
scope: run  →  provider 必须返回「本次 run 作用域内、由本 run 创建」的对象集
             过滤依据 = 名字/标签含 runId（不是时间戳，见 §4.2）
             对系统自动注入对象（kube-root-ca.crt、default ServiceAccount 等）
             必须显式排除，且在证据里标注 excluded_system_objects[]
```

### 4.4 🆕 cleanup 必须等待终态，不能"发完就算"

实测：`DELETE` → 200 后仍处于 `Terminating` **6.2 秒**才真正 404。

**影响**：
- 若 cleanup 只检查"DELETE 有没有返回 2xx"，会**在资源仍在释放时就把 run 标为已清理** → 下一次运行的基线比对会看到"残留" → 误判。
- CI 里 cleanup 是阻塞项：单次 6.2s，若 suite 有 N 个 case 且串行清理，**总耗时会被 cleanup 主导**。

**修正**：cleanup 语义应是「**发起删除 → 轮询至终态（404）→ 超时上限**」，而非「发起删除即完成」。配套两个参数需定值：轮询间隔（本次 2s 够用）、超时上限（建议 60s，超时 → `BLOCKED(cleanup)` 而非静默放过）。

> 注意与「已派发 mutation 不得自动重试」的关系：**轮询 GET 不是重试删除**。DELETE 只发一次，之后只做只读轮询。这条区分必须写进实现，否则会被误读成"违反不重试原则"。

---

## 5. E03 的答案

| 子问题 | 结论 |
|---|---|
| 删除是否幂等可重入 | ✅ **是**。重复 DELETE 返回 404 而非报错 → cleanup 可安全重跑 |
| 能否发现崩溃 run 留下的孤儿 | ✅ **能**。`labelSelector=idwth.io/managed-by=lifecycle-probe` 实测可扫；`run-id=<runId>` 可精确定位单个 run 的残留（命中 1 / 对不存在的 runId 命中 0，不会误伤） |
| 删除耗时是否阻塞 | ⚠️ **6.2s**，必须异步等待（§4.4） |
| **谁负责清理** | ❓ **仍是组织问题**。技术侧已提供「幂等删除 + 孤儿扫描」两个原语，但"谁在什么时机调用"需要系统负责人确认 |

**建议的清理责任划分**（供确认）：

| 时机 | 执行者 |
|---|---|
| 正常 case 结束 | Runtime 的 `finally`（§8.1 已设计） |
| 进程被 kill / CI 中断 | **下次 run 启动时的孤儿巡检**（按 `managed-by` 扫，超过 TTL 的删掉） |
| 长期堆积 | 平台侧 TTL 策略（`idwth.io/ttl: ephemeral` 注解已写入，**但平台当前未实现 TTL 自动回收** —— 需确认是否要提需求） |

---

## 6. 复跑方式

```bash
cd scripts
export OF_USER=... OF_PWD=...                      # 凭据只走环境变量，不落盘
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    -u ALL_PROXY -u all_proxy \
  python3 of-ns-lifecycle.py --out /tmp/e02.json    # 20 项生命周期实测
python3 of-clock-skew.py                            # 时钟偏移测量（只读）
```

- `--delay 3` 可复现 §4.2 的对照实验（B 组）。
- `--keep` 保留命名空间不删除（仅调试；**默认必删**）。
- 内网地址**必须绕过代理**，否则表现为"连不上"（本机 shell 注入了 `HTTP_PROXY`）。

---

## 7. 残留风险

| # | 风险 | 说明 |
|---|---|---|
| 1 | **授权是"命名空间级"的，不代表内容级也安全** | 本次未在命名空间内创建任何业务资源。若要验证"创建 Deployment 后断言"这条链路，需**再次授权**（会写业务对象） |
| 2 | 单集群 | 平台只有 `host` 一个集群。多集群下的 runId 隔离（是否需 `clusters/<c>/...` 维度）**未验证** |
| 3 | 并发未测 | 本次是串行单 run。**并发多 run 是否互相干扰**（配额、namespace 数量上限）未验证 |
| 4 | 平台无 TTL 回收 | `idwth.io/ttl` 注解当前**只是标记，无人消费**。孤儿清理依赖我们自己的巡检 |
| 5 | 权限面未穷举 | 只验证了 `admin` 账号。CI 若用受限账号，是否有 `create/delete namespace` 权限**需确认** |

---

## 附：本次新增的待验证条目

| ID | 条目 | 类别 |
|---|---|---|
| **D19** 🆕 | `backend` 断言的**基线差分语义**（系统自动注入对象污染绝对计数） | 决策 |
| **D20** 🆕 | `created_at > run_start` **已实测证伪** → 确认改用「名字/标签内嵌 runId」 | 决策（**建议直接关闭**） |
| **D21** 🆕 | cleanup 的**等待终态与超时参数**（轮询间隔 / 超时上限 / 超时后判定） | 决策 |
| **E06** 🆕 | 平台侧是否需要实现 `idwth.io/ttl` 自动回收 | 外部 |
| **E07** 🆕 | CI 账号是否具备 `create/delete namespace` 权限 | 外部 |

> 编号说明：`E04`/`E05` 在清单中已被「Eventually 断言耗时分布」「首期锁自有 staging」占用，故本次顺延为 `E06`/`E07`。
