# Feature Specification: Issue #17 - navigate 缺 URL 严禁静默降级为 click

## 1. 缺陷背景与问题陈述
- **Issue 来源**: #17
- **问题根因**: 
  在 `src/runtime/contract/feature-to-contract.ts:168-184`：
  ```typescript
  // --- navigate ---
  if (NAVIGATE_PATTERN.test(text)) {
    const urlMatch = URL_PATTERN.exec(text);
    if (urlMatch) {
      const url = urlMatch[0]!;
      return {
        step: { intent: text, action: 'navigate', url, risk: 'reversible' },
      };
    }
    const target = sanitizeTarget(text.replace(NAVIGATE_PATTERN, '').trim());
    if (target.length > 0) {
      return {
        step: { intent: text, action: 'click', target, risk: 'reversible' },
      };
    }
    return { reason: 'unmapped-action' };
  }
  ```
  当步骤写作形如 `When navigate "创建用户页面"` 或 `打开 "系统设置"` 时：
  因为未包含 `http(s)://`，函数提取出 target，并将其**静默降级为 `action: 'click'`**！
- **危害**:
  1. 产出的 Contract 结构合法，契约状态被标记为 `ready`；
  2. 但实际执行时却去页面点击名为「创建用户页面」的元素，造成 L1 miss 报 `BLOCKED(decision)`，或者误点同名卡片导致假 PASS；
  3. 违反「不确定即 draft」、「语义严格对应、零猜测」的架构基线。

## 2. 修复目标与验收准则 (Acceptance Criteria)
- **AC1: 消除 navigate 缺 URL 时的静默 click 降级**
  - 当命中了 `NAVIGATE_PATTERN` 但未提供合法 URL 时（如 `navigate "创建用户页面"`），**严禁产生 `action: 'click'`**。
  - 应将其识别为未映射导航步骤（`reason: 'unmapped-navigation'`），使场景安全降级为 `.draft.yaml`，并列入 `_draft.unmapped_steps`。
- **AC2: 保证合法 URL 的导航映射不受影响**
  - 含有完整 HTTP/HTTPS URL 的步骤（如 `navigate to "https://example.com/login"`）依然严格映射为 `action: 'navigate', url: '...'`。
- **AC3: 零破坏与后向兼容**
  - 所有原本合法的导航步骤及其他 click、fill、select、scroll 等步骤映射 100% 保持兼容。
- **AC4: 质量门禁全绿**
  - 四大门禁（typecheck / lint / build / test）全绿，用例数只增不减。

## 3. 边界与防御原则
- **不确定即 draft**：对于语义不明确的页面名称导航，不擅自揣测为「点链接」，交由人工补全或专门的导航路由规则处理。
- **零外部依赖**：纯函数、零网络、零模型确定性映射。
