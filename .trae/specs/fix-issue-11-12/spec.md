# Spec：修复 GitHub Issue #11 + #12（短期）

> 来源：
> - [#11 [bug] `init --from` 生成的契约系统性不可用：叙述式 Gherkin 与封闭动作集不匹配](https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/11)
> - [#12 [design] 前置状态机制悬空：fixtures / @fixture / credentials_ref「声明完整、零消费者」](https://github.com/JustinIan-AI/Jev-E2E-WebTest/issues/12)

## 1. 范围

**纳入本次：**
- #11-P0：`gherkin.template.ts` 注入封闭动词词汇表（生成端契约）。
- #11-P1：`feature-to-contract.ts` 映射改「结构」——值取最后引号、target 取动词后引号内容并剥离引号、歧义（≥2 引号且目标不唯一）保持 unmapped（reason=`ambiguous-target`）、Then 侧取引号内容丢弃叙述框架。
- #11-P2：`unmapped-precondition` 提示改为可操作指引（不引入 setup 执行）。
- #12 短期：`fixtures` 纳入与 identity 相同的敏感键校验（R3）；`instantiateFixtures` 标注 `@internal` 说明尚未接线；文档/help 诚实化（fixtures 不触发数据准备）。

**不纳入（另开里程碑）：**
- #12 中期 `preconditions` setup 执行通道（entity_exists / BLOCKED(precondition) / cleanup 接线）。仅保留接口与措辞空间，不实现执行。

## 2. 冻结接口契约块（实现前不得更改签名）

```ts
// src/runtime/contract/feature-to-contract.ts

/** 提取步骤文本中【全部】引号片段（中英文引号统一），按出现顺序返回。
 *  不变量：返回数组长度 === 文本中配对引号片段数；片段不含引号字符本身。 */
export function extractQuotedAll(text: string): string[];

/** 提取【最后一个】引号片段作为值；无引号返回 null。
 *  不变量：有引号时 === extractQuotedAll(text).at(-1)。 */
export function extractLastQuoted(text: string): string | null;

/** 目标文本 → R7 合法语义目标。
 *  不变量：
 *  - 剥离所有引号字符（“”"‘’）及选择器特征（# . // >> ()）；
 *  - 折叠空白且首尾无空白；
 *  - 输出为纯语义短语，可被 substring 匹配。 */
export function sanitizeTarget(text: string): string;

/** fill/select 类「目标 + 值」结构化解析结果。 */
export interface TargetValueParse {
  /** 语义目标（动词后、值之前的引号片段去引号后的短语）。 */
  target: string;
  /** 取最后一个引号片段的值。 */
  value: string;
}

/** 解析「在"<目标>"…填写"<值>"」结构。
 *  不变量：
 *  - 恰好 2 个引号片段 → target=第一个片段内容、value=最后片段内容（二者可同）；
 *  - 引号片段 ≥2 且无法唯一确定目标（动词后存在多个候选目标片段）→ null
 *    （调用方记 reason='ambiguous-target'，绝不取第一个猜测）；
 *  - 引号片段 0 或 1（缺值或缺目标）→ null（调用方记 reason='unmapped-action'）。 */
export function parseTargetValue(text: string, verb: RegExp): TargetValueParse | null;

// UnmappedStepRecord.reason 封闭取值扩展（不破坏既有）：
//   既有：unmapped-action | unmapped-precondition | unrecognized-assertion
//   新增：'ambiguous-target'
```

```ts
// src/runtime/contract/validate.ts（#12 短期）

/** R3 敏感键扫描是否覆盖 root.fixtures：
 *  不变量：fixtures.<敏感键> 的非引用字符串值（不以 cred:// / @fixture 开头）
 *  与 identity 子树同规则报 R3-credential-literal，path='fixtures.<key>'。 */
// 实现方式：findCredentialLiterals 已递归全树；补充测试锁定 fixtures 子树行为，
// 无需改签名（现有递归天然覆盖 fixtures，需用测试确认并防回归）。
```

```ts
// src/runtime/scope.ts（#12 短期，仅文档性标注，无签名变更）

/**
 * @internal 尚未接入 run 主回路：本函数只做 ${runId}/${contractId} 命名实例化，
 *           不触发任何数据准备/setup；生产路径当前无调用方。中期 preconditions
 *           通道落地后再行接线（见 issue #12）。
 */
export function instantiateFixtures(...): Record<string, string>;
```

## 3. 验收标准（AC）

1. `gherkin.template.ts` 的 systemPrompt：含封闭动词集合（打开/访问、点击、输入/填写、选择、滚动、等待、应该看到/不应该看到）；要求目标与值均加引号且目标在值之前；禁止主语前缀；不再出现 `Use Background for shared setup steps`；禁止把「已登录/已存在」写成步骤。
2. `在"用户名"输入框中填写"zhangsan"` → `target:'用户名'`、`value:'zhangsan'`（不得颠倒）。
3. `点击"确定"按钮` → target 为 `确定按钮`（不含引号），可被 substring 匹配。
4. 含歧义多引号（≥2 且目标不唯一）的步骤保持 draft，reason 为 `ambiguous-target`。
5. `用户列表中显示"zhangsan"` → Then 断言取 `zhangsan` 作 target、丢弃叙述框架；句中无引号 → `unrecognized-assertion`。
6. `fixtures` 中出现字面量凭据（敏感键 + 非引用值）→ `validate` 报 R3，与 identity 同规则；`cred://` / `@fixture` 引用值不报错。
7. `instantiateFixtures` 带 `@internal` 注释；help/docs 明确 fixtures 仅声明、不触发数据准备。
8. 单测覆盖以上，并新增一条集成用例（喂入 #11 复现 feature，断言映射/校验结果）。
9. 质量门禁全绿：`typecheck` / `lint` / `build` / `test`，测试数只增不减。

## 4. 红线

- 不突破封闭动作集（7 action）/ DOM 原语（7）。
- 不静默猜测：歧义即 unmapped，绝不取第一个引号。
- 时间顺序：postcondition 仍严格位于步骤之后（不改动 R4 逻辑）。
- 零新增运行时第三方依赖。
- 中期 preconditions 执行不在本次实现，禁止半接线导致假 PASS/假 FAIL。
