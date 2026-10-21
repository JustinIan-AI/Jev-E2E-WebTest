# 项目长期记忆：JEV-E2E-Test（BS 架构系统测试工具）

> **只放判据与决策**；推导、实测数据、源码行号在 `20260922-jev-bs-e2e-research/final/` 各文档。
> 超注入上限会被静默截断 → 加内容先并入既有小节。压缩前全文备份在 `memory/archive/`（最近：`MEMORY-project-20261010-precompact.md`）。

## 目标与定位
面向**任意企业级 B/S 系统**：**输入测试用例 → 输出完整测试报告**（五要素：用例 / 截图 / 是否通过 / 未通过原因 / 可复现过程）。

- 产品名 **IDWTH**（Intent-Driven Web Test Harness），Skill-First。`final/PRD.md` **V1.2**（要什么）→ `final/detailed-design.md` **V1.2**（怎么做）· `final/verification-checklist.md` **V1.2** · `visual-dom-matrix.md`（**Backlog 素材**）。
- 主链路：`Intent → Contract → 确定性执行（优先）/ JEV 语义决策与修复（按需）→ Evidence → 独立 Judge → Verdict`
- 三句边界：**Playwright 管"怎么稳定地做" / JEV 管"不确定时选什么动作" / Evidence+Judge 管"到底对不对"**。

## ★ 产品边界判据（2026-10-10 · SUT 中立化）
> **「离开 openFuyao，这条还成立吗？」** 成立 → **产品要求**；不成立 → **SUT 适配项**（留适配层，**不进 core**）。
> **openFuyao 只是首个可验证 SUT，不是产品边界。** 已据此剥离三处 K8s 写死：隔离单元 / 环境指纹第 ④ 项 / core 层的"集群上下文键"硬要求。

## 已冻结的技术决策
| 决策 | 内容 |
|---|---|
| 执行臂 | **CDP 主干**（`connectOverCDP` 接管现有 Chrome）；page-agent 仅 MFA/免安装**降级臂** |
| 浏览器复用 | 后台标签页不抢焦点（`createTarget(background:true)` + `setFocusEmulationEnabled`）；`newContext()` 每 case 强隔离（**引导键名由 SUT 适配提供**） |
|