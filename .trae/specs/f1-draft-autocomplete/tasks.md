# F1 · Draft 未映射步骤的 Skills 自动补全 — 任务清单

> 执行顺序自上而下；每个任务完成后核对“预期结果”，并将状态改为【✅】。
> TDD：先写失败测试（tests/ 下）→ 实现 → 全量回归。
> 编排：LoopX goal + codex runtime；Trae 负责计划 / review / 进度确认。

## 接口契约（实现前对齐）

```ts
// src/runtime/contract/complete.ts

export type Confidence = 'high' | 'medium';

export interface StepCandidate {
  /** 未映射步骤原文。 */
  text: string;
  keyword: 'Given' | 'When' | 'Then';
  reason: string;                 // 基线原因分类
  confidence: Confidence;
  matched_rule: string;           // 命中的扩展规则名；无法补全为 'none'
  /** high/medium 候选的步骤映射（Then 同时带 assertion）。 */
  step?: ContractStep;
  assertion?: Record<string, unknown>;
}

export interface CompletionResult {
  testId: string;
  /** 与未映射步骤一一对应、数量守恒。 */
  candidates: StepCandidate[];
  resolvedHigh: number;
  needsHuman: number;             // medium + 无法补全
  /** 全部 high 时重算出的 ready contract（否则为 undefined）。 */
  completedContract?: Contract;
  matchBasis: string;             // 场景定位依据（可解释）
}

export function completeDraft(input: {
  draft: Record<string, unknown>;
  featureRaw: string;
}): CompletionResult;
```

---

## F1-1 · 扩展动作/断言识别表（纯函数）

- [x] F1-1.1 先写单测 `tests/contract/complete.test.ts`：扩展识别 `upload/上传`（click +
  语义目标）、`terminate/close sessions/终止会话`（click，irreversible）、
  `cleared/已清除`（Then → dom absent）。
- [x] F1-1.2 实现 `complete.ts` 的扩展识别表（中英文），输出候选含
  confidence/matched_rule；file 上传仅产出语义 target，禁止路径字面量/选择器。
- [x] F1-1.3 单测：无法识别返回 matched_rule='none' 且不产出 step；不输出封闭集之外的
  action / 原语（R5/R6）。
- [x] F1-1.4 单测：medium 规则（命中动作动词但目标残缺，如裸 `I upload`）给 medium 候选。

预期：complete.test.ts 通过；扩展识别三类高频场景且中英文均命中。状态：【✅】

## F1-2 · 顺序重映射与数量守恒

- [x] F1-2.1 单测：解析 `source_feature`，按 Background+Scenario 原顺序合并候选；基线已
  映射步骤结果不变。
- [x] F1-2.2 实现场景定位（test.id/goal/source_feature；同名回退顺序匹配）与
  matchBasis 输出。
- [x] F1-2.3 单测：候选数量 == unmapped_steps 数量（多未映射 draft 逐条保留）。
- [x] F1-2.4 实现 completedContract：仅全 high 时按序重建 steps/assertions，并复用 R4
  收尾（irreversible 补 postcondition，否则降级 reversible）。

预期：顺序正确、基线步骤不变、数量守恒；全 high 才产出 completedContract。状态：【✅】

## F1-3 · `idwth complete` CLI

- [x] F1-3.1 CLI 测试：默认仅输出建议、退出 0、不写文件（文本 + `--json` 两形态）。
- [x] F1-3.2 CLI 测试：`--apply` 全 high → 写 `<id>.contract.yaml`，validate 通过，原
  draft 保留；`--out` 生效。
- [x] F1-3.3 CLI 测试：存在 medium/无法补全时 `--apply` 返回 3、不产出 contract、draft
  不被破坏。
- [x] F1-3.4 CLI 测试：draft 缺 `_draft`/source_feature 缺失 → 3；source_feature 文件不
  存在 → 4。
- [x] F1-3.5 接线：commands.ts 增加 complete（command 集合 + 参数解析）、index.ts 增加
  cmdComplete、USAGE 增补。

预期：complete 子命令四路径退出码正确；ready 产物可 validate/run。状态：【✅】

## F1-4 · 文档 / Skill 声明同步 & 全量回归

- [x] F1-4.1 更新 `web-test-contract` SKILL.md 或 docs，声明 Skills 补全为确定性
  Authoring 能力、零模型派发。
- [x] F1-4.2 新增专用夹具（如需）覆盖 upload/terminate/cleared；确认 sample.feature 回归
  不破坏。
- [x] F1-4.3 运行 `typecheck` / `test` / `lint` / `build` 全绿；测试数 ≥ 基线 568。
- [x] F1-4.4 产出 LoopX review packet（变更清单、证据、AC 对照），交 Trae code review。

预期：文档同步、四条 AC 全满足、全量回归绿。状态：【✅】

---

## 验收对照（出口）

| AC | 覆盖任务 | 证据 |
|---|---|---|
| 三类步骤给候选或明确无法补全，不静默 ready | F1-1.1/1.3, F1-3.3 | complete.test / cli 测试 |
| apply 产物过九规则可 validate | F1-2.4, F1-3.2 | validate + run 消费测试 |
| 模型调用为 0 约束不变 | F1-4.1, 全程无网络调用 | 纯函数 + Skill 声明 |
| 测试新增不回归、三构建绿 | F1-4.3 | 测试计数 + 命令输出 |
| 中英文准确、数量守恒、不丢原文 | F1-1, F1-2.3, F1-3.3 | 守恒断言测试 |
