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
const QUOTED_PATTERN = /[“”‘’]([^“”‘’]+)[“”‘’]/;

/** 提取步骤文本中首个引号片段作为值；无引号返回 null。 */
function extractQuoted(text: string): string | null {
  const match = QUOTED_PATTERN.exec(text);
  return match ? match[1]! : null;
}

/** 目标文本转 R7 合法的语义目标：剥离选择器特征（引号包裹的局部不算）。 */
export function sanitizeTarget(text: string): string {
  return text.replace(/[#/]|\/\/|>>|\(\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 步骤映射
// ---------------------------------------------------------------------------

export interface StepMapping {
  step: ContractStep;
  /** 若为 Then 断言步骤，同时产出对应的顶层 dom 断言。 */
  assertion?: Record<string, unknown>;
}

/** 不可逆关键词：提交/确认/删除/支付等一次发生即难以回滚的动作。 */
const IRREVERSIBLE_PATTERN =
  /submit|confirm|delete|remove|pay|purchase|place\s+order|提交|确认|删除|移除|支付|下单|创建|新建|保存/;
const CLICK_PATTERN = /^(?:i\s+)?click(?:\s+on)?\b|^(?:点击|点按|按下)/i;
const FILL_PATTERN = /^(?:i\s+)?(?:enter|type|input|fill(?:\s+in)?)\b|^(?:输入|填入|填写)/i;
const SELECT_PATTERN = /^(?:i\s+)?select\b|^选择/i;
const NAVIGATE_PATTERN = /^(?:i\s+)?(?:navigate(?:\s+to)?|go(?:\s+to)?|open)\b|^(?:打开|访问|进入)/i;
const SCROLL_PATTERN = /^(?:i\s+)?scroll\b|^滚动/i;
const WAIT_PATTERN = /^(?:i\s+)?wait\b|^等待/i;

const URL_PATTERN = /https?:\/\/[^\s“”]+/;

/**
 * 把单个步骤映射为 Contract 步骤；无法安全映射返回 null。
 */
export function mapStep(raw: ParsedStep): StepMapping | null {
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
    const target = sanitizeTarget(text.replace(NAVIGATE_PATTERN, '').trim());
    if (target.length > 0) {
      return {
        step: { intent: text, action: 'click', target, risk: 'reversible' },
      };
    }
    return null;
  }

  // --- fill / type ---
  if (FILL_PATTERN.test(text)) {
    const value = extractQuoted(text);
    // 目标：去掉动词与引号值后的剩余语义片段。
    const target = sanitizeTarget(
      text.replace(FILL_PATTERN, '').replace(QUOTED_PATTERN, '').replace(/\b(?:in|into|on)\b/g, ' '),
    );
    if (value === null || target.length === 0) return null;
    return {
      step: { intent: text, action: 'fill', target, value, risk: 'reversible' },
    };
  }

  // --- select ---
  if (SELECT_PATTERN.test(text)) {
    const value = extractQuoted(text);
    const target = sanitizeTarget(text.replace(SELECT_PATTERN, '').replace(QUOTED_PATTERN, ''));
    if (value === null || target.length === 0) return null;
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
    if (target.length === 0) return null;
    const risk: RiskLevel = IRREVERSIBLE_PATTERN.test(target) ? 'irreversible' : 'reversible';
    return { step: { intent: text, action: 'click', target, risk } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Then 断言映射
// ---------------------------------------------------------------------------

const SHOULD_SEE_PATTERN = /^(?:I\s+)?(?:should\s+see|see|can\s+see)\b|^(?:应该看到|应当看到|能看到|看到)/i;
const SHOULD_NOT_SEE_PATTERN =
  /^(?:I\s+)?should\s+not\s+see\b|^(?:不应该看到|不应看到|看不到)/i;
const COUNT_PATTERN = /(\d+)\s*(?:times?|个|条)?/;

/** 把 Then 步骤映射为 (assert_only 步骤, dom 断言)；无法映射返回 null。 */
export function mapThenStep(raw: ParsedStep): StepMapping | null {
  const text = raw.text.trim();

  // should not see ...
  if (SHOULD_NOT_SEE_PATTERN.test(text)) {
    const target = sanitizeTarget(text.replace(SHOULD_NOT_SEE_PATTERN, '').trim());
    if (target.length === 0) return null;
    const assertion = { kind: 'absent', target };
    return {
      step: { intent: text, action: 'assert_only', risk: 'reversible' },
      assertion,
    };
  }

  // should see [N] <target>
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
    if (mapped === null) {
      unmapped.push({
        keyword: raw.keyword,
        text: raw.text,
        reason: raw.keyword === 'Given' ? 'unmapped-precondition' : 'unmapped-action',
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
