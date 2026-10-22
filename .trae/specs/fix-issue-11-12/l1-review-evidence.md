# L1 独立 Code Review 证据（issue #11 + #12 返工补正）

> 审查者：Trae（控制器，非实现者本人）
> 分支：`feature/fix-issue-11-12`
> 基线（merge-base / main）：`6b4c1531ec7d740b867b64e7328a4db9b880e88d3`
> PR HEAD（审查时已提交部分）：`257ad9384fef7d6892e45e05816a60bac2da504c`
> PR：https://github.com/JustinIan-AI/Jev-E2E-WebTest/pull/15
> 审查依据：loopx-workflow 管线 B 第 5 步（L1 独立审查，先红证据 + AC 对账 + 红线核对）

## 1. 先红 → 后绿证据（Failing Repro 先行）

- 规范化复现测试：`tests/unit/issues/issue-11.test.ts`（7 用例，覆盖 AC2–AC5 + R7）。
- **先红**：在修复前基线 `6b4c153` 的临时 worktree（`/tmp/idwth-red-11`，symlink node_modules）上执行该测试文件：
  **6 failed | 1 passed (7)** —— 与缺陷预期一致（仅 sanitizeTarget 的 R7 既有用例通过）。
- **后绿**：当前 HEAD + 本次未提交修复上执行同一文件：**7/7 passed**。
- 全量回归（修复后）：**Test Files 55 passed (55) / Tests 630 passed (630)**；
  基线为 54 文件 / 623 用例 → +1 文件 +7 用例，**测试数只增不减**。

## 2. AC 逐条对账（spec.md §3）

| AC | 结论 | 证据 |
|---|---|---|
| AC1 生成端 systemPrompt 含封闭动词、引号 target-before-value、禁主语前缀、删 Background setup、禁「已登录」句式 | ✅ | `tools/ai-testgen/src/templates/gherkin.template.ts` diff 已逐行审查；`tools/ai-testgen/tests/unit/templates.test.ts` 锁定上述全部要求 |
| AC2 fill 类 target/value 不颠倒 | ✅ | `parseTargetValue` 以 parts[0] 为 target、末片段为 value；issue-11.test.ts 用例 1（中文「在“用户名”输入框中填写“zhangsan”） |
| AC3 click 取引号内容并剥离引号 | ✅ | `mapStep` → `sanitizeTarget(extractQuotedAll(...)[0])`；issue-11.test.ts 用例 2（`点击“确定”按钮` → `确定按钮`） |
| AC4 多引号歧义保持 draft，reason=`ambiguous-target` | ✅（措辞另修） | `parseTargetValueOrReason`：引号片段 **≥3** → ambiguous-target；恰好 2 个为 target+value。issue-11.test.ts 用例 3（3 引号）。spec AC4 原文「≥2 且目标不唯一」表述不精确，Phase 5 修正为 ≥3 |
| AC5 Then 显示句取引号内容；无引号 → unrecognized-assertion | ✅ | DISPLAY_PATTERN 仅恰好 1 引号 → visible；issue-11.test.ts 用例 4/5/6（显示句取引号、无引号返回 null、should-see 剥引号） |
| AC6 fixtures 字面量凭据报 R3，cred:// / @fixture 引用不误报 | ✅ | findCredentialLiterals 递归全树天然覆盖 fixtures；`tests/unit/contract-validator.test.ts` 新增 fixtures 子树用例 |
| AC7 instantiateFixtures 带 @internal；help/docs 诚实化 | ✅ | `src/runtime/scope.ts` +5 行 JSDoc；`src/cli/index.ts` help 增加 fixtures declaration-only 说明 |
| AC8 单测 + 集成用例 | ✅ | 单测：feature-to-contract.test.ts +134 行、init-from.test.ts +85 行等；集成：`tests/integration/issue-11-repro.test.ts`（113 行，in-process CLI 跑复现 feature）；另按管线 B 规范新增 `tests/unit/issues/issue-11.test.ts` |
| AC9 四门禁全绿、测试只增不减 | ✅ | 见 §3 |

## 3. 四大门禁结果（修复后复跑）

命令链：`npm run typecheck && npm run lint && npm run build && npm run test`

| 门禁 | 结果 |
|---|---|
| typecheck（tsc --noEmit） | ✅ exit 0 |
| lint（tsc --noEmit） | ✅ exit 0 |
| build（tsc -p tsconfig.build.json） | ✅ exit 0 |
| test（vitest run） | ✅ 55 files / 630 tests，0 失败 |

## 4. 红线核对（spec §4 + AGENTS §5.5）

1. **封闭集合未突破**：未新增 action；DOM 断言仍为 7 原语。L1 中发现 `init-from.ts`
   的可操作指引只列了 6 个原语、漏 `number`，**已修复**（指引与
   `validate.ts` DOM_PRIMITIVES 严格一致）。
2. **时间顺序**：未改动 R4 逻辑；`feature-to-contract.ts` 收尾取不到后置断言仍保守降级
   reversible（L392–401）。
3. **数量守恒 / 不静默猜测**：≥3 引号 → ambiguous-target 保持 draft，绝不取第一个猜测；
   无法落定的步骤全部保留在 unmapped_steps。
4. **原文不丢**：draft 文档保留原始步骤文本，guidance 仅附加可操作指引。
5. **零新增第三方依赖**：PR diff 仅触及源码/测试/模板，package.json 与 lockfile 无变更。
6. **零网络零模型**：authoring 确定性映射不派发模型/JEV；`tools/ai-testgen` 仅为生成期模板。
7. **中期 preconditions 未半接线**：`instantiateFixtures` 仅加 @internal 标注，生产路径仍无调用方。

## 5. L1 发现并已修复的问题

| # | 问题 | 修复 |
|---|---|---|
| 1 | `src/runtime/contract/init-from.ts` 的 `unrecognized-assertion` 指引漏列封闭原语 `number`（与 7 原语不一致） | 指引追加「数量为（number）」 |
| 2 | 新建 `tests/unit/issues/issue-11.test.ts` 的 step() 辅助函数缺 `table` / `docString`，typecheck 报 TS2739 | 辅助函数返回 `{ keyword, text, table: [], docString: null }` |

两处修复后门禁链复跑全绿（§3）。

## 6. 审查范围与残留事项

- 已独立审查 PR 全部 16 文件 diff（+719/−59），重点逐行阅读 5 个生产文件 + gherkin 模板。
- 残留（非阻塞，列入后续 Phase）：
  - Phase 5：spec 两处措辞修正（sanitizeTarget 冻结契约注释称剥离 `.`，实现不剥离；AC4 阈值 ≥3）。
  - Phase 5：PR #15 body 补 loopx-meta 与门禁 checkbox。
  - Phase 6/7：CI 核对与最终 HEAD 上的 L2 `loopx pr-review`。

**L1 结论：通过（PASS）**，可进入 PR 元数据补正与 L2 审查阶段。
