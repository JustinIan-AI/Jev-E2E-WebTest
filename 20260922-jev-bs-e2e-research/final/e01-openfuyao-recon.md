# E01 目标系统侦察报告：openFuyao 管理平台

| 项目 | 内容 |
|---|---|
| 目标 | `https://openfuyao-staging.internal.example.com:31616` |
| 产品 | **openFuyao 管理平台**（云原生容器管理平台） |
| 侦察时间 | 2026-09-23 |
| 侦察方式 | **只读**：连通性探测 + 登录页静态分析 + SPA bundle 静态提取 + **只读 GET API 探测** |
| 是否造资源 | **否**。未创建、未修改、未删除任何业务资源 |
| 结论 | ✅ **E01 通过**——可直接作为首批（M3）验证对象 |
| 复跑 | `scripts/of-recon.py`（`--api` 附只读 API 探测）；输出样本见 `scripts/of-recon-output.json` |

---

## 一、目标画像

| 维度 | 事实 | 证据 |
|---|---|---|
| 部署形态 | **K8s 集群 + nginx ingress**，NodePort `31616` | 证书 CN=`ingress-nginx-controller.ingress-nginx.svc.cluster.local`，issuer=内部 `MyRootCA`（自签） |
| 产品标识 | `openFuyao管理平台` / 应用名 `openFuyao`，slogan `云原生容器管理平台` | 登录页 `<title>`；`/locales/zh-CN/common.json` → `app.name/slogan` |
| 集群拓扑 | **单集群，名为 `host`** | `GET /rest/multicluster/v1beta1/resources/clusters` → `{"info":{"host":{"clustername":"host"}}}` |
| 登录账号 | `admin`，平台角色 **`platform-admin`**（内置默认平台管理员） | `GET /rest/user/v1/users`；`GET /rest/auth/user` → `data:"admin"` |
| 前端栈 | **React 1209 / antd 104 / ECharts 12 / Vue 0 / Monaco 0 / 微前端框架 0** | bundle 词边界计数（`react-dom\|createRoot\|useState(` 等） |
| SPA 体积 | 单 bundle `index-e55628ee.js` **5,332,116 字符**，无按路由分割 | 登录后 HTML 只有一个 `<script type="module">` |
| 可达性 | 88 ms，HTTP/2 | `curl -k --noproxy '*'` |
| ⚠️ 网络前置 | **必须绕过本机代理**。`HTTP_PROXY=127.0.0.1:60707` 注入会让内网地址假性不可达 | 本次全程 `env -u HTTP_PROXY ...` / `--noproxy '*'` |

**测试面规模**：106 条前端路由，14 个 K8s API 组经控制台代理，13 个一级菜单。

---

## 二、登录机理（含两处对设计有阻断性影响的细节）

### 2.1 登录链

```
GET  /                                     → 303  Location: /rest/auth/login
GET  /rest/auth/login                      → 302  Location: /oauth2/oauth/authorize
                                                    ?client_id=console
                                                    &identity_provider=fuyaoPasswordProvider
                                                    &redirect_uri=%2Frest%2Fauth%2Fcallback
                                                    &response_type=code
                                                    &state=<随机8位hex>
GET  /oauth2/auth/login/fuyaoPasswordProvider  → 200  返回独立登录页（非 SPA）
POST /oauth2/auth/login/fuyaoPasswordProvider  → 200  置 sessionID + wsID → 跳回 /
```

### 2.2 登录页不是一个 SPA，而是一个自包含 HTML 表单

**这是好消息**——它就是「确定性优先」最适合的形态：

| 元素 | 事实 |
|---|---|
| 标题 | `<h3>欢迎登录openFuyao</h3>` |
| 用户名 | `<label for="username">用户名</label>` + `<input id="username" name="username" required>` |
| 密码 | `<label for="password">密码</label>` + `<input id="password" name="password" type="password" oncopy="return false">` |
| 提交 | `<button type="submit" id="login-btn" class="btn-primary login-btn"><span>登录</span><span id="spinner_login"></span></button>` |
| 隐藏域 | `<input type="hidden" name="gorilla.csrf.Token" value="...">`（**每次请求都不同**） |
| 隐藏域 | `<input id="then" name="then" hidden value="/oauth2/oauth/authorize?...&state=<随机>">` |

**对定位策略的意义**：`for=` 关联齐全 → `getByLabel('用户名')` / `getByLabel('密码')` / `getByRole('button', {name:'登录'})` **全部可用**。登录步骤可 100% 走 L1 确定性路径，**零模型调用**。

### 2.3 ⚠️ 发现 F3：登录不可冻结回放（新条目）

提交逻辑源码（登录页内联脚本）：

```js
fetch('/oauth2/auth/login/fuyaoPasswordProvider', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfCode },
  body: JSON.stringify({
    username: loginForm.username.value,
    password: Array.from(passwordEncode),      // ★ TextEncoder → 字节数组
    then: loginForm.then.value,                // ★ 含 per-request state
  }),
  credentials: 'include',
});
```

两处硬后果：

1. **`password` 以字节数组提交，不是字符串。** 任何「断言输入框值 == 密码」的 DOM 断言都必须在 Tool 层做同样编码；而 `fill()` 写入的是字符串——**两者不等价**。这条直接落到 §3.2 断言语义表：`value` 原语在密码框上不可用，密码字段应走 `masked` 或干脆排除（与 jev-e2e 的 `safe()` 一致）。
2. **`gorilla.csrf.Token` 与 `state` 都是 per-request 的** → 登录请求**无法从冻结产物重放**。这意味着：
   - `replay --verify` 的冻结产物里**不能包含登录动作**，否则每次都 `BLOCKED(drift)`；
   - 正确做法二选一：**(a) 登录步骤排除出 replay 范围**，回放前用会话复用（见 F2）；**(b) 登录作为 case 的 `precondition` 而非 step**。
   - 这同时把「复用现有浏览器状态」从"便利性"提升为"**可回放性的必要条件**"——比我们原来的论证更强。

---

## 三、测试面权威清单（来自 i18n 资源，非猜测）

platform / nav 文案取自 `/locales/zh-CN/nav.json`（10 个顶层键），这是**菜单的权威来源**：

### 3.1 平台级导航

| key | 文案 |
|---|---|
| containerPlatform | 容器平台 |
| applicationMarket | 应用市场 |
| userManagement | 用户管理 |
| multiCluster | 多集群管理 |
| **aiCopilot** | **AI助手** |

### 3.2 容器平台一级菜单

`总览 / 工作负载 / 服务 / 路由 / 配置 / 保密字典 / 存储 / 节点管理 / 事件 / 日志 / 告警 / 监控 / 终端 / 扩展`

### 3.3 工具与全局控件

| 分组 | 文案 |
|---|---|
| tools | CLI 工具 · 一键部署 · **YAML 一键部署**（`使用 YAML 文件一键部署 Kubernetes 资源`） |
| 集群选择 | 集群 · 选择集群 · 集群管理 |
| 命名空间选择 | 命名空间 · 选择命名空间 · **全部命名空间** |
| 用户菜单 | 用户设置 · 退出登录 · 帮助文档 · 浅色模式 / 深色模式 |

### 3.4 通用动作词与列名（`/locales/zh-CN/common.json`）

- **动作**：确定 · 取消 · 保存 · 删除 · 编辑 · **创建** · 开启 · 刷新 · 搜索 · 筛选 · 更多 · 关闭 · 返回 · 下一步 · 上一步 · 提交 · 重置
- **列名**：总数 · 数量 · 名称 · 状态 · 类型 · 描述 · 创建时间 · 更新时间 · 操作 · 详情 · 命名空间

> ★ **这份清单可以直接用来构造 `.cases` 的 `target` 语义字段**，而且是**可校验的**——文案变了，`nav.json` 就变了。这比人工点页面枚举可靠得多。

### 3.5 106 条路由中的高价值簇

| 簇 | 路由样例 |
|---|---|
| 工作负载 | `/container_platform/workload/{deployment,pod,statefulSet,daemonSet,job,cronJob}` |
| 命名空间 | `/container_platform/namespace/{namespaceManage,limitRange,resourceQuota}` |
| 网络 | `/container_platform/network/{service,ingress}` |
| 配置 | `/container_platform/configuration/{configMap,secret}` |
| 存储 | `/container_platform/storage/{pv,pvc,sc}` |
| 用户权限 | `/container_platform/userManage/{role,roleBinding,serviceAccount}` |
| 告警日志监控 | `/container_platform/alarm/*` · `logging/{logSearch,logSet}` · `monitor/*` · `monitoring-dashboard/dashboard` |
| 调度 | `/container_platform/scheduling/{AffinityPolicyConfiguration,NumaOverview,monitor}` |
| 共池 | `/container_platform/colocation/*`（4 条） |
| 其他 | `customResourceDefinition` · `event` · `nodeManage` · `ray` · `extendManage` · `appMarket/*` |

---

## 四、数据通路（后端断言的可实施落点）

bundle 里有一张 **URL 模板表**（`Ze()` 函数，key 取自 `sessionStorage.getItem("cluster")`），暴露了控制台的完整数据通路：

```js
podUrl:          /clusters/${c}/api/kubernetes/api/v1
workloadUrl:     /clusters/${c}/api/kubernetes/apis/apps/v1
jobUrl:          /clusters/${c}/api/kubernetes/apis/batch/v1
crdUrl:          /clusters/${c}/api/kubernetes/apis/apiextensions.k8s.io/v1
ingressUrl:      /clusters/${c}/api/kubernetes/apis/networking.k8s.io/v1
resourceStorageUrl: /clusters/${c}/api/kubernetes/apis/storage.k8s.io/v1
authorUrl/manager/roleUrl: /clusters/${c}/api/kubernetes/apis/rbac.authorization.k8s.io/v1
workloadEventsUrl: /clusters/${c}/api/kubernetes/apis/events.k8s.io/v1
kubevirtUrl:     /clusters/${c}/api/kubernetes/apis/kubevirt.io/v1
priorityClassesUrl: /clusters/${c}/rest/scheduling/apis/scheduling.k8s.io/v1
helmUrl:         /clusters/${c}/rest/application-management/v1beta1/helm-releases
consolePluginUrl: /clusters/${c}/rest/plugin-management/v1beta1/consoleplugins
consolePluginProxyUrl: /clusters/${c}/proxy
overviewUrl:     /clusters/${c}/rest/monitoring/v1
```

**实测确认可用（只读 GET）**：

| 探测 | 结果 |
|---|---|
| `GET /clusters/host/api/kubernetes/api/v1/namespaces` | **200，items=10**（含 `default` / Active） |
| `GET /clusters/host/api/kubernetes/api/v1/namespaces/default/pods` | 200，items=0 |
| `GET /clusters/host/api/kubernetes/apis/apps/v1/namespaces/default/deployments` | 200，items=0 |
| `GET /clusters/host/rest/plugin-management/v1beta1/consoleplugins` | 200，`data: []`（本集群未装扩展插件） |
| `GET /rest/user/v1/users` | 200，admin / platform-admin |
| `GET /rest/multicluster/v1beta1/resources/clusters` | 200，`{host}` |

> ★ **这就是 PRD 里 `backend: - key: deployment.exists / equals: true` 的具体实现通道**——直接命中 K8s 原生 API，**不经 UI**。原先抽象的后端断言，现在有了确定的 URL 形态与一个已验证的样本。

---

## 五、★ 六条对 IDWTH 设计有直接影响的发现

| # | 发现 | 证据 | 对设计的影响 |
|---|---|---|---|
| **F1** | **UI 文案完全外置**：`i18next-http-backend`，`loadPath: /locales/{{lng}}/{{ns}}.json` | bundle 里 28 处 `useTranslation`、98 处 `ns:"..."`；业务中文词在主 bundle **0 命中** | **`env_fingerprint` 必须绑 ①`locale` ②文案资源内容哈希**。因为文案是 L1 定位（`getByRole(name)`）的主键——**翻译改了，DOM 结构没变，可访问名却变了**。这正是"稳定 Locator 突然失效"的一类真实成因，且**static 层面看不出来** → 解答 D14 |
| **F2** | **集群态只存 `sessionStorage`，且路由不含 cluster 段** | `sessionStorage.getItem("cluster")` 取 key；切换集群 = `setItem + window.location.reload()`；`path:"/clusters/"` **无匹配** | ⚠️ **`browser.newContext()` 强隔离会让平台不知道当前集群**，且选集群逻辑**只在登录时跑一次**。强隔离方案必须补「上下文引导」：迁移 cookies + `addInitScript` 注入 `sessionStorage.cluster`（默认 `"host"`）。**这是新的待验证项 D17** |
| **F3** | **登录含 per-request CSRF + state** | 见 §2.3 | 登录**不可进冻结产物**；replay 必须排除登录步或将其降为 precondition。**新条目 D18** |
| **F4** | **iframe 不是本平台的必需项**；真正的硬约束是 **Canvas（ECharts）** | 全 bundle `createElement("iframe")` 仅 **1** 处，且属 ECharts「另存为图片」内部实现；iframe 其余 7 处命中是 sanitize-html 标签白名单与 SymPy 关键字表 | ⚠️ **修正 G01 的前提**：我此前「云管平台必然含 iframe」的推断**对本平台不成立**。但结论方向不变且更强：**监控/图表类页面的断言不能走 DOM，必须走 backend/HTTP 断言**（ECharts 画在 Canvas 上，DOM 里没有数据） |
| **F5** | **K8s 代理 API 完全可用** | §四 实测 | **E02/E03 有解**：用 **K8s Namespace 作 runId 隔离单元**（`ns-<runId>`），cleanup 走 K8s API 删除 namespace → 天然幂等、天然可重入。这是「后端数据隔离」在 K8s 目标上最干净的落法 |
| **F6** | **前端是 React + Ant Design（受控组件）** | react 1209 / antd 104 | 强化既有结论：**page-agent 的合成事件（`dispatchEvent`）在 AntD 受控输入上风险高**（它自己列的不支持清单里就有这类）→ 更坚定「CDP 主干、page-agent 仅降级臂」。同时 `fill()` 后必须校验 `inputValue()`（受控组件可能回滚值） |

### 5.1 附带发现

- **「终端」菜单存在**（`menu.terminal: 终端`）+ `/rest/webterminal/v1` 路由前缀 → 平台内置 **Web 终端（K8s exec）**。终端 UI 通常是 Canvas/xterm 渲染 → **不可 DOM 断言**，只能断言"会话建立/命令输出文本"这类可读部分，或改走 backend 断言。建议 V1 **排除终端页**（与排除 Canvas 同源）。
- **「AI助手」(aiCopilot)** 是平台自带模块 → 它自身也是被测对象（V1 可先排除，避免"用 AI 测 AI"的循环）。
- 平台自带**官方用户手册**（bundle 中引用 `user_guide/*.html`，如 `multi_cluster_management.html`、`rbac_management.html`、`user_management.html`）→ **写 `.cases` 时可直接引用官方手册作为预期行为来源**，比自行猜测权威。

---

## 六、仍未验证 / 需要授权的事项

| 事项 | 为什么没做 | 需要什么 |
|---|---|---|
| **D01 L1 命中率实测** | 需要真实浏览器渲染（静态分析只能列举文案，测不出"实际有多少控件能被 ARIA 无歧义命中"） | 授权启动一次浏览器探测（**临时 profile，不碰你的日常 Chrome**） |
| **D02/D03 指纹与 Freshness** | 同上，且需要页面实际交互 | 同上 |
| **D17 上下文引导**（newContext 后补 cluster） | 需浏览器实测 `addInitScript` 是否足够 | 同上 |
| **E02 数据隔离落地** | 需要**创建**测试命名空间 → 属写操作 | **明确授权是否允许创建 `ns-idwth-<runId>` 这类资源** |
| **E03 数据重置归属** | 组织问题 | 你或系统负责人确认：谁负责清理 |
| 监控页断言策略 | 需要看真实监控页 DOM | 浏览器探测 |

> **我没有做任何写操作**，上面两项（造 namespace）等你明确授权。

---

## 七、可复跑与证据

```bash
cd 20260922-jev-bs-e2e-research/scripts
export OF_USER=... OF_PWD=...          # 凭据只走环境变量，不落盘
export OF_BASE=https://openfuyao-staging.internal.example.com:31616
python3 of-recon.py --api              # 全量侦察 + 只读 API 探测
```

| 文件 | 内容 |
|---|---|
| `scripts/of-recon.py` | 侦察脚本（登录 → bundle → 路由/API/i18n/指纹/集群态 → 可选 API 探测） |
| `scripts/of-recon-output.json` | 本次输出样本（106 路由 / API 全量 / i18n 原文 / URL 模板表）**已确认不含凭据** |

**三条侦察踩坑（会重复遇到）**：

1. **内网地址必须绕过注入代理**（`env -u HTTP_PROXY` 或 `curl --noproxy '*'`），否则表现为"连不上"。
2. **子串匹配会造假数字**：我首轮把 `maxTerm`/`tokenizers` 里的 `xterm` 当成 xterm.js，得出"243 命中 = 内置终端库"的**错误结论**。改用词边界正则后真值 ≈ 0。**凡"某库存在"的判断，必须用词边界模式复核。**
3. **业务文案不在 JS 里**：若某平台的 bundle 里查不到业务菜单词，不要下"没有该功能"的结论——**先找 i18n 资源**（本例是 `/locales/{{lng}}/{{ns}}.json`）。
