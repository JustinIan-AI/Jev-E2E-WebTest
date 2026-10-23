/**
 * ai-testgen → IDWTH 衔接：Gherkin Feature → IDWTH Contract 纯函数映射器。
 *
 * 设计原则（用户决策 3）：
 * - 能用确定性关键词表映射的步骤 → 合法 Contract 步骤/断言；
 * - 无法安全映射的步骤 → 不丢弃、不猜测，整体降级为 .draft.yaml，
 *   未映射步骤原样列入 `_draft.unmapped_steps`，由人工补全；
 *   后续按 _draft 中沉淀的场景类别用 Skills 自动补全，人只审核报告。
 */
import type {
  ParsedExamples,
  ParsedFeature,
  ParsedScenario,
  ParsedStep,
} from './gherkin-parse.js';

export interface MapFeatureOptions {
  baseUrl: string;
  /** 形如 cred://staging-operator。 */
  credentialsRef: string;
  /** 身份角色，默认 operator。 */
  role?: string;
  /** test.id 前缀（点分段），默认按 Feature 名推导。 */
  idPrefix?: string;
}

export type RiskLevel = 'reversible' | 'irreversible';

export interface ContractStep {
  intent: string;
  action: 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'navigate' | 'assert_only';
  risk: RiskLevel;
  target?: string;
  value?: string;
  deltaY?: number;
  ms?: number;
  url?: string;
  postcondition?: Array<Record<string, unknown>>;
}

export interface Contract {
  version: '1';
  test: { id: string; name: string; tags?: string[] };
  environment: { base_url: string };
  identity: { role: string; credentials_ref: string };
  goal: string;
  steps: ContractStep[];
  assertions: { dom: Array<Record<string, unknown>> };
}

export interface UnmappedStepRecord {
  keyword: ParsedStep['keyword'];
  text: string;
  /** 无法映射的原因分类，供后续 Skills 自动补全做问题归类。 */
  reason: string;
}

export interface MappedContract {
  /** ready = 全部步骤可映射，产物可直接 validate/run；draft = 需人工补全。 */
  status: 'ready' | 'draft';
  testId: string;
  contract: Contract;
  unmappedSteps: UnmappedStepRecord[];
}

// --- 英文 / 中文引号统一取值（解析器只识别英文关键字，步骤文本可中文） ---
const QUOTED_PATTERN = /[“"‘']([^”"‘']+)[”"‘']/g;

/** 提取步骤文本中【全部】引号片段，按出现顺序返回；片段不含引号字符本身。 */
export function extractQuotedAll(text: string): string[] {
  return Array.from(text.matchAll(QUOTED_PATTERN), (m) => m[1]!);
}

/** 提取【最后一个】引号片段作为值；无引号返回 null。 */
export function extractLastQuoted(text: string): string | null {
  const all = extractQuotedAll(text);
  return all.length > 0 ? all[all.length - 1]! : null;
}

/** 目标文本转 R7 合法的语义目标：剥离所有引号字符与选择器特征。 */
export function sanitizeTarget(text: string): string {
  return text
    .replace(/[“”"‘’]/g, '')
    .replace(/[#/]|\/\/|>>|\(\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** fill/select 类「目标 + 值」结构化解析结果。 */
export interface TargetValueParse {
  target: string;
  value: string;
}

/**
 * 解析「在"<目标>"…填写"<值>"」结构：
 * - 恰好 2 个引号片段 → target=第一片段、value=末片段；
 * - 0/1 片段（缺目标或缺值）或 ≥3 片段（目标不唯一）→ null，绝不猜测。
 */
export function parseTargetValue(text: string, verb: RegExp): TargetValueParse | null {
  if (!verb.test(text)) return null;
  const parts = extractQuotedAll(text);
  if (parts.length !== 2) return null;
  return { target: parts[0]!, value: parts[1]! };
}

// ---------------------------------------------------------------------------
// 步骤映射
// ---------------------------------------------------------------------------

export interface StepMapping {
  step: ContractStep;
  /** 若为 Then 断言步骤，同时产出对应的顶层 dom 断言。 */
  assertion?: Record<string, unknown>;
}

/** fill/select/navigate 无法结构化时的失败原因。 */
export type TargetValueFailure = 'unmapped-action' | 'ambiguous-target' | 'unmapped-navigation';

/**
 * 尝试解析「目标 + 值」；失败时返回原因：
 * - 引号片段 ≥3（目标不唯一）→ ambiguous-target（绝不猜第一个）；
 * - 0/1 片段或非该动词 → unmapped-action。
 */
function parseTargetValueOrReason(
  text: string,
  verb: RegExp,
): { ok: true; value: TargetValueParse } | { ok: false; reason: TargetValueFailure } {
  if (!verb.test(text)) return { ok: false, reason: 'unmapped-action' };
  const count = extractQuotedAll(text).length;
  if (count >= 3) return { ok: false, reason: 'ambiguous-target' };
  const parsed = parseTargetValue(text, verb);
  return parsed === null
    ? { ok: false, reason: 'unmapped-action' }
    : { ok: true, value: parsed };
}

/** 不可逆关键词：提交/确认/删除/支付等一次发生即难以回滚的动作。 */
const IRREVERSIBLE_PATTERN =
  /submit|confirm|delete|remove|pay|purchase|place\s+order|提交|确认|删除|移除|支付|下单|创建|新建|保存/;
const CLICK_PATTERN = /^(?:i\s+)?click(?:\s+on)?\b|^(?:点击|点按|按下)/i;
// 中文 fill 动词不锚定句首，以覆盖「在"目标"中填写"值"」句式。
const FILL_PATTERN = /^(?:i\s+)?(?:enter|type|input|fill(?:\s+in)?)\b|(?:输入|填入|填写)/i;
const SELECT_PATTERN = /^(?:i\s+)?select\b|^选择/i;
const NAVIGATE_PATTERN = /^(?:i\s+)?(?:navigate(?:\s+to)?|go(?:\s+to)?|open)\b|^(?:打开|访问|进入)/i;
const SCROLL_PATTERN = /^(?:i\s+)?scroll\b|^滚动/i;
const WAIT_PATTERN = /^(?:i\s+)?wait\b|^等待/i;

const URL_PATTERN = /https?:\/\/[^\s"”]+/;

/** mapStep 失败时携带的原因。 */
export interface MapStepFailure {
  reason: TargetValueFailure;
}

export type MapStepResult = StepMapping | MapStepFailure;

function isStepMapping(result: MapStepResult): result is StepMapping {
  return 'step' in result;
}

/**
 * 把单个步骤映射为 Contract 步骤；无法安全映射时返回失败原因。
 */
export function mapStep(raw: ParsedStep): MapStepResult {
  const text = raw.text.trim();

  // --- navigate ---
  if (NAVIGATE_PATTERN.test(text)) {
    const urlMatch = URL_PATTERN.exec(text);
    if (urlMatch) {
      const url = urlMatch[0]!;
      return {
        step: { intent: text, action: 'navigate', url, risk: 'reversible' },
      };
    }
    // Issue #17: navigate 缺 URL 严禁静默降级为 click，返回明确的 unmapped-navigation
    return { reason: 'unmapped-navigation' };
  }

  // --- fill / type：目标引号 + 值引号结构化 ---
  if (FILL_PATTERN.test(text)) {
    const result = parseTargetValueOrReason(text, FILL_PATTERN);
    if (!result.ok) return { reason: result.reason };
    const { target, value } = result.value;
    return {
      step: { intent: text, action: 'fill', target, value, risk: 'reversible' },
    };
  }

  // --- select：目标引号 + 值引号结构化 ---
  if (SELECT_PATTERN.test(text)) {
    const result = parseTargetValueOrReason(text, SELECT_PATTERN);
    if (!result.ok) return { reason: result.reason };
    const { target, value } = result.value;
    return {
      step: { intent: text, action: 'select', target, value, risk: 'reversible' },
    };
  }

  // --- scroll ---
  if (SCROLL_PATTERN.test(text)) {
    const up = /up|向上/.test(text);
    const amountMatch = /(\d+)\s*(?:pixels?|px|像素)?/.exec(text);
    const amount = amountMatch ? Number(amountMatch[1]) : 600;
    return {
      step: {
        intent: text,
        action: 'scroll',
        deltaY: up ? -amount : amount,
        risk: 'reversible',
      },
    };
  }

  // --- wait ---
  if (WAIT_PATTERN.test(text)) {
    const secondsMatch = /(\d+)\s*(?:seconds?|sec|秒)/.exec(text);
    const msMatch = /(\d+)\s*(?:milliseconds?|ms|毫秒)/.exec(text);
    const ms = msMatch ? Number(msMatch[1]) : secondsMatch ? Number(secondsMatch[1]) * 1000 : 1000;
    return { step: { intent: text, action: 'wait', ms, risk: 'reversible' } };
  }

  // --- click ---
  if (CLICK_PATTERN.test(text)) {
    const target = sanitizeTarget(text.replace(CLICK_PATTERN, '').trim());
    if (target.length === 0) return { reason: 'unmapped-action' };
    const risk: RiskLevel = IRREVERSIBLE_PATTERN.test(target) ? 'irreversible' : 'reversible';
    return { step: { intent: text, action: 'click', target, risk } };
  }

  return { reason: 'unmapped-action' };
}

// ---------------------------------------------------------------------------
// Then 断言映射
// ---------------------------------------------------------------------------

const ASSERT_ONLY_PREFIX = /^(?:assert\s+only\b|断言(?:仅|只)?)/i;
const URL_ASSERT_PATTERN =
  /^(?:current\s+url\s+is|url\s+is|当前(?:页面)?(?:地址|url|网址)[是为])/i;
const NUMBER_EXTRACT_PATTERN = /(?:number\s+is|数值[为是]|数字[为是])\s*(\d+)/i;

const SHOULD_SEE_PATTERN =
  /^(?:I\s+)?(?:should\s+see|see|can\s+see)\b|(?:应该看到|应当看到|能看到|看到|显示|展示)/i;
const SHOULD_NOT_SEE_PATTERN =
  /^(?:I\s+)?should\s+not\s+see\b|^(?:不应该看到|不应看到|看不到)/i;
const COUNT_PATTERN = /(\d+)\s*(?:times?|个|条)?/;
/** 中文「显示/展示」句：仅在带引号时才取引号内容作断言目标。 */
const DISPLAY_PATTERN = /显示|展示/;

/** 把 Then 步骤映射为 (assert_only 步骤, dom 断言)；无法映射返回 null。 */
export function mapThenStep(raw: ParsedStep): StepMapping | null {
  const text = raw.text.trim();

  // 1. URL 断言 (如 current url is "..." / 当前地址是 "...")
  if (URL_ASSERT_PATTERN.test(text) || (ASSERT_ONLY_PREFIX.test(text) && /\burl\b|地址|网址/i.test(text))) {
    const quoted = extractQuotedAll(text);
    const expected = quoted[0] ?? URL_PATTERN.exec(text)?.[0];
    if (expected && expected.length > 0) {
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion: { kind: 'url', expected },
      };
    }
    return null;
  }

  // 2. 动作式断言 (assert only "X" is [not ]visible / is checked / is "val" / number is N)
  if (ASSERT_ONLY_PREFIX.test(text)) {
    const quoted = extractQuotedAll(text);
    // 2.1 assert only "target" is "value" 或 assert only "target" value is "value"
    if (quoted.length === 2) {
      const target = sanitizeTarget(quoted[0]!);
      const expected = quoted[1]!;
      if (target.length === 0) return null;
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion: { kind: 'value', target, expected },
      };
    }

    if (quoted.length === 1) {
      const target = sanitizeTarget(quoted[0]!);
      if (target.length === 0) return null;

      // 2.2 checked 断言
      if (/\bchecked\b|勾选/i.test(text)) {
        const isNot = /\bnot\b|未/i.test(text);
        return {
          step: { intent: text, action: 'assert_only', risk: 'reversible' },
          assertion: { kind: 'checked', target, expected: !isNot },
        };
      }

      // 2.3 number 断言
      const numMatch = NUMBER_EXTRACT_PATTERN.exec(text);
      if (numMatch) {
        const expected = Number(numMatch[1]);
        return {
          step: { intent: text, action: 'assert_only', risk: 'reversible' },
          assertion: { kind: 'number', target, expected },
        };
      }

      // 2.4 absent 断言 (is not visible / is absent / 不可见)
      if (/\b(?:not\s+visible|absent)\b|不可见/i.test(text)) {
        return {
          step: { intent: text, action: 'assert_only', risk: 'reversible' },
          assertion: { kind: 'absent', target },
        };
      }

      // 2.5 visible 断言 (is visible / 可见)
      if (/\bvisible\b|可见/i.test(text)) {
        return {
          step: { intent: text, action: 'assert_only', risk: 'reversible' },
          assertion: { kind: 'visible', target },
        };
      }
    }
  }

  // 3. 结构化 value 断言 (如 "用户名输入框" 的值为 "admin")
  const quoted = extractQuotedAll(text);
  if (quoted.length === 2 && /(?:的值[是为]|value\s+is)/i.test(text)) {
    const target = sanitizeTarget(quoted[0]!);
    const expected = quoted[1]!;
    if (target.length > 0) {
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion: { kind: 'value', target, expected },
      };
    }
  }

  // 4. 结构化 checked 断言 (如 "记住密码" 已勾选 / 未勾选)
  if (quoted.length === 1 && /(?:已勾选|未勾选|\bis\s+checked\b|\bis\s+not\s+checked\b)/i.test(text)) {
    const target = sanitizeTarget(quoted[0]!);
    if (target.length > 0) {
      const isNot = /(?:未勾选|\bnot\b)/i.test(text);
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion: { kind: 'checked', target, expected: !isNot },
      };
    }
  }

  // 5. 结构化 number 断言 (如 "商品库存" 的数值为 99)
  if (quoted.length === 1 && NUMBER_EXTRACT_PATTERN.test(text)) {
    const target = sanitizeTarget(quoted[0]!);
    const numMatch = NUMBER_EXTRACT_PATTERN.exec(text);
    if (target.length > 0 && numMatch) {
      const expected = Number(numMatch[1]);
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion: { kind: 'number', target, expected },
      };
    }
  }

  // 6. 原有叙述句式：should not see ...
  if (SHOULD_NOT_SEE_PATTERN.test(text)) {
    const target = sanitizeTarget(text.replace(SHOULD_NOT_SEE_PATTERN, '').trim());
    if (target.length === 0) return null;
    const assertion = { kind: 'absent', target };
    return {
      step: { intent: text, action: 'assert_only', risk: 'reversible' },
      assertion,
    };
  }

  // 7. 原有叙述句式：中文「显示/展示」句：丢弃叙述框架，取引号内容
  if (DISPLAY_PATTERN.test(text)) {
    if (quoted.length !== 1) return null;
    const target = sanitizeTarget(quoted[0]!);
    if (target.length === 0) return null;
    return {
      step: { intent: text, action: 'assert_only', risk: 'reversible' },
      assertion: { kind: 'visible', target },
    };
  }

  // 8. 原有叙述句式：should see [N] <target>
  if (SHOULD_SEE_PATTERN.test(text)) {
    const rest = text.replace(SHOULD_SEE_PATTERN, '').trim();
    const countMatch = COUNT_PATTERN.exec(rest);
    // 仅当数字位于片段最前时才作为 count 断言。
    if (countMatch && countMatch.index === 0) {
      const expected = Number(countMatch[1]);
      const target = sanitizeTarget(rest.slice(countMatch[0]!.length).trim());
      if (target.length === 0) return null;
      const assertion = { kind: 'count', target, equals: expected, allow_multiple: true };
      return {
        step: { intent: text, action: 'assert_only', risk: 'reversible' },
        assertion,
      };
    }
    const target = sanitizeTarget(rest);
    if (target.length === 0) return null;
    const assertion = { kind: 'visible', target };
    return {
      step: { intent: text, action: 'assert_only', risk: 'reversible' },
      assertion,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// ID / Outline 工具
// ---------------------------------------------------------------------------

const NON_ID_PATTERN = /[^a-z0-9]+/g;

/** 名称 → id 分段（小写字母数字，点分隔）；纯非 ASCII 名回退到序号段。 */
function toIdSegment(name: string, fallbackIndex: number): string {
  const slug = name.toLowerCase().replace(NON_ID_PATTERN, '.').replace(/^\.+|\.+$/g, '');
  return slug.length > 0 ? slug : `scenario${fallbackIndex}`;
}

/** 替换步骤文本中的 `<占位符>`。 */
function substitutePlaceholders(text: string, row: Record<string, string>): string {
  return text.replace(/<([^>]+)>/g, (whole, key: string) => row[key] ?? whole);
}

/** 将 Examples 表展开为数据行（首行为表头）。 */
function expandExamples(examples: ParsedExamples): Record<string, string>[] {
  if (examples.table.length < 2) return [];
  const headers = examples.table[0]!;
  return examples.table.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = cells[i] ?? '';
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// 场景映射
// ---------------------------------------------------------------------------

interface RawScenarioInput {
  name: string;
  tags: string[];
  steps: ParsedStep[];
}

function mapOneScenario(
  feature: ParsedFeature,
  input: RawScenarioInput,
  options: MapFeatureOptions,
  idPrefix: string,
  idSuffix: string,
  index: number,
): MappedContract {
  const allSteps = [...feature.background, ...input.steps];
  const contractSteps: ContractStep[] = [];
  const domAssertions: Array<Record<string, unknown>> = [];
  const unmapped: UnmappedStepRecord[] = [];

  for (let i = 0; i < allSteps.length; i++) {
    const raw = allSteps[i]!;

    if (raw.keyword === 'Then') {
      const mapped = mapThenStep(raw);
      if (mapped === null) {
        unmapped.push({ keyword: raw.keyword, text: raw.text, reason: 'unrecognized-assertion' });
        continue;
      }
      contractSteps.push(mapped.step);
      if (mapped.assertion) domAssertions.push(mapped.assertion);
      continue;
    }

    const mapped = mapStep(raw);
    if (!isStepMapping(mapped)) {
      unmapped.push({
        keyword: raw.keyword,
        text: raw.text,
        reason:
          mapped.reason === 'ambiguous-target'
            ? 'ambiguous-target'
            : mapped.reason === 'unmapped-navigation'
              ? 'unmapped-navigation'
              : raw.keyword === 'Given'
                ? 'unmapped-precondition'
                : 'unmapped-action',
      });
      continue;
    }
    contractSteps.push(mapped.step);
  }

  // R4 收尾：仍为 irreversible 的步骤必须带 postcondition。
  // 取其后最近一条断言作为 postcondition；取不到则降级为可逆（保守，不阻断）。
  contractSteps.forEach((step, i) => {
    if (step.risk !== 'irreversible') return;
    if (step.postcondition !== undefined && step.postcondition.length > 0) return;
    const followingAssertion = domAssertions[0];
    if (followingAssertion) {
      step.postcondition = [followingAssertion];
    } else {
      step.risk = 'reversible';
    }
  });

  const segment = toIdSegment(input.name, index + 1);
  const testId = `${idPrefix}.${segment}${idSuffix}`;

  const contract: Contract = {
    version: '1',
    test: {
      id: testId,
      name: input.name,
      ...(input.tags.length > 0 ? { tags: input.tags } : {}),
    },
    environment: { base_url: options.baseUrl },
    identity: {
      role: options.role ?? 'operator',
      credentials_ref: options.credentialsRef,
    },
    goal: input.name,
    steps: contractSteps,
    assertions: { dom: domAssertions },
  };

  const ready =
    unmapped.length === 0 && contractSteps.length > 0 && domAssertions.length > 0;

  return {
    status: ready ? 'ready' : 'draft',
    testId,
    contract,
    unmappedSteps: unmapped,
  };
}

/**
 * 将整个 Feature 映射为若干 Contract：
 * - 普通 Scenario 一条；
 * - Scenario Outline 按每个 Examples 数据行展开一条（test.id 追加行号段）。
 */
export function mapFeatureToContracts(
  feature: ParsedFeature,
  options: MapFeatureOptions,
): MappedContract[] {
  const idPrefix = options.idPrefix ?? toIdSegment(feature.name || 'feature', 0);
  const results: MappedContract[] = [];
  let scenarioIndex = 0;

  for (const scenario of feature.scenarios) {
    if (scenario.keyword === 'Scenario') {
      results.push(
        mapOneScenario(
          feature,
          { name: scenario.name, tags: scenario.tags, steps: scenario.steps },
          options,
          idPrefix,
          '',
          scenarioIndex,
        ),
      );
      scenarioIndex += 1;
      continue;
    }

    // Scenario Outline：合并所有 Examples 表并展开。
    const rows: Record<string, string>[] = scenario.examples.flatMap(expandExamples);
    if (rows.length === 0) {
      results.push(
        mapOneScenario(
          feature,
          { name: scenario.name, tags: scenario.tags, steps: scenario.steps },
          options,
          idPrefix,
          '.row0',
          scenarioIndex,
        ),
      );
      scenarioIndex += 1;
      continue;
    }

    rows.forEach((row, rowIndex) => {
      const substitutedSteps: ParsedStep[] = scenario.steps.map((s) => ({
        ...s,
        text: substitutePlaceholders(s.text, row),
      }));
      const substitutedName = substitutePlaceholders(scenario.name, row);
      results.push(
        mapOneScenario(
          feature,
          { name: substitutedName, tags: scenario.tags, steps: substitutedSteps },
          options,
          idPrefix,
          `.row${rowIndex + 1}`,
          scenarioIndex,
        ),
      );
    });
    scenarioIndex += 1;
  }

  return results;
}
