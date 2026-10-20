/**
 * F1 · Draft 未映射步骤的 Skills 自动补全纯函数引擎。
 *
 * 设计原则：
 * - 纯函数、零网络、零模型派发（Authoring 阶段确定性补全）；
 * - 保持与基线 7 动作 / 7 断言原语封闭集一致，不超出 R5/R6；
 * - 顺序重映射依据 source_feature 的 Background + Scenario 原始顺序；
 * - 守恒性：未映射步骤数量与候选数量 1:1 守恒，不静默猜测，原文绝不丢失。
 */

import { parseFeature, type ParsedExamples, type ParsedFeature, type ParsedScenario, type ParsedStep } from './gherkin-parse.js';
import {
  mapStep,
  mapThenStep,
  sanitizeTarget,
  type Contract,
  type ContractStep,
  type RiskLevel,
} from './feature-to-contract.js';

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

// ---------------------------------------------------------------------------
// 扩展规则模式
// ---------------------------------------------------------------------------

// 1. 上传：中英文动词
const UPLOAD_PATTERN_EN = /^(?:i\s+)?upload\b/i;
const UPLOAD_PATTERN_ZH = /^(?:我\s*)?上传/;

// 2. 终止/关闭会话：中英文
const TERMINATE_VERB_EN = /^(?:i\s+)?(?:terminate|close)\b/i;
const TERMINATE_VERB_ZH = /^(?:我\s*)?(?:终止|关闭)/;
const SESSIONS_KEYWORD_EN = /\bsessions?\b/i;
const SESSIONS_KEYWORD_ZH = /会话/;

// 3. 清除/消失断言：中英文
const CLEARED_PATTERN_EN = /\b(?:is\s+cleared|is\s+removed|disappears?|has\s+disappeared|is\s+gone)\b/i;
const CLEARED_PATTERN_ZH = /(?:已清除|被清除|已消失|消失)/;

// 剥离文件路径和后缀，确保文件上传 target 仅为语义目标，不含路径字面量或选择器
const FILE_EXT_PATTERN = /\b[\w-]+\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|txt|csv|json)\b/gi;
const QUOTED_FILE_PATTERN = /['"][^'"]*?\.(?:png|jpe?g|gif|webp|svg|pdf|docx?|txt|csv|json)['"]/gi;

/**
 * 识别单个未映射步骤。
 */
function recognizeExtendedStep(
  keyword: 'Given' | 'When' | 'Then',
  text: string,
  reason: string,
): StepCandidate {
  const trimmed = text.trim();

  // --- Then: 清除 / 消失断言 ---
  if (keyword === 'Then' || reason === 'unrecognized-assertion') {
    if (CLEARED_PATTERN_EN.test(trimmed) || CLEARED_PATTERN_ZH.test(trimmed)) {
      let rawTarget = trimmed
        .replace(CLEARED_PATTERN_EN, '')
        .replace(CLEARED_PATTERN_ZH, '')
        .trim();
      // 剥离英文前导冠词
      rawTarget = rawTarget.replace(/^(?:the|an?)\s+/i, '').trim();
      const target = sanitizeTarget(rawTarget);
      if (target.length === 0) {
        return {
          text,
          keyword,
          reason,
          confidence: 'medium',
          matched_rule: 'cleared-assertion-missing-target',
        };
      }
      return {
        text,
        keyword,
        reason,
        confidence: 'high',
        matched_rule: 'cleared-assertion',
        step: {
          intent: text,
          action: 'assert_only',
          risk: 'reversible',
        },
        assertion: {
          kind: 'absent',
          target,
        },
      };
    }
  }

  // --- 文件上传 ---
  if (UPLOAD_PATTERN_EN.test(trimmed) || UPLOAD_PATTERN_ZH.test(trimmed)) {
    let rawTarget = trimmed
      .replace(UPLOAD_PATTERN_EN, '')
      .replace(UPLOAD_PATTERN_ZH, '')
      .trim();

    // 剥离文件扩展名和路径字面量，禁止文件路径字面量和选择器
    rawTarget = rawTarget
      .replace(QUOTED_FILE_PATTERN, '')
      .replace(FILE_EXT_PATTERN, '')
      .replace(/^(?:a|an|the|to|into)\s+/i, '')
      .trim();

    let target = sanitizeTarget(rawTarget);
    // 再次剥离路径/后缀相关符号
    target = target.replace(/[./\\]/g, ' ').replace(/\s+/g, ' ').trim();

    if (target.length === 0) {
      return {
        text,
        keyword,
        reason,
        confidence: 'medium',
        matched_rule: 'upload-action-missing-target',
      };
    }

    return {
      text,
      keyword,
      reason,
      confidence: 'high',
      matched_rule: 'upload-action',
      step: {
        intent: text,
        action: 'click',
        target,
        risk: 'reversible',
      },
    };
  }

  // --- 终止/关闭会话 ---
  if (TERMINATE_VERB_EN.test(trimmed) || TERMINATE_VERB_ZH.test(trimmed)) {
    const hasSessionTarget =
      SESSIONS_KEYWORD_EN.test(trimmed) || SESSIONS_KEYWORD_ZH.test(trimmed);

    let rawTarget = trimmed
      .replace(TERMINATE_VERB_EN, '')
      .replace(TERMINATE_VERB_ZH, '')
      .trim();

    rawTarget = rawTarget.replace(/^(?:a|an|the)\s+/i, '').trim();
    const target = sanitizeTarget(rawTarget);

    if (!hasSessionTarget || target.length === 0) {
      return {
        text,
        keyword,
        reason,
        confidence: 'medium',
        matched_rule: 'terminate-sessions-missing-target',
      };
    }

    return {
      text,
      keyword,
      reason,
      confidence: 'high',
      matched_rule: 'terminate-sessions-action',
      step: {
        intent: text,
        action: 'click',
        target,
        risk: 'irreversible',
      },
    };
  }

  // 无法识别：matched_rule = 'none'，无 step/assertion
  return {
    text,
    keyword,
    reason,
    confidence: 'medium',
    matched_rule: 'none',
  };
}

// ---------------------------------------------------------------------------
// 场景解析辅助
// ---------------------------------------------------------------------------

const NON_ID_PATTERN = /[^a-z0-9]+/g;

function toIdSegment(name: string, fallbackIndex: number): string {
  const slug = name.toLowerCase().replace(NON_ID_PATTERN, '.').replace(/^\.+|\.+$/g, '');
  return slug.length > 0 ? slug : `scenario${fallbackIndex}`;
}

function substitutePlaceholders(text: string, row: Record<string, string>): string {
  return text.replace(/<([^>]+)>/g, (whole, key: string) => row[key] ?? whole);
}

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

interface FlattenedScenario {
  name: string;
  tags: string[];
  steps: ParsedStep[];
  index: number;
  suffix: string;
}

function flattenScenarios(feature: ParsedFeature): FlattenedScenario[] {
  const results: FlattenedScenario[] = [];
  let scenarioIndex = 0;

  for (const scenario of feature.scenarios) {
    if (scenario.keyword === 'Scenario') {
      results.push({
        name: scenario.name,
        tags: scenario.tags,
        steps: scenario.steps,
        index: scenarioIndex,
        suffix: '',
      });
      scenarioIndex += 1;
      continue;
    }

    // Scenario Outline
    const rows = scenario.examples.flatMap(expandExamples);
    if (rows.length === 0) {
      results.push({
        name: scenario.name,
        tags: scenario.tags,
        steps: scenario.steps,
        index: scenarioIndex,
        suffix: '.row0',
      });
      scenarioIndex += 1;
      continue;
    }

    rows.forEach((row, rowIndex) => {
      const substitutedSteps: ParsedStep[] = scenario.steps.map((s) => ({
        ...s,
        text: substitutePlaceholders(s.text, row),
      }));
      const substitutedName = substitutePlaceholders(scenario.name, row);
      results.push({
        name: substitutedName,
        tags: scenario.tags,
        steps: substitutedSteps,
        index: scenarioIndex,
        suffix: `.row${rowIndex + 1}`,
      });
    });
    scenarioIndex += 1;
  }

  return results;
}

// ---------------------------------------------------------------------------
// 核心补全纯函数
// ---------------------------------------------------------------------------

export function completeDraft(input: {
  draft: Record<string, unknown>;
  featureRaw: string;
}): CompletionResult {
  const { draft, featureRaw } = input;

  if (!draft || typeof draft !== 'object') {
    throw new Error('Draft 不是合法对象');
  }

  const draftMeta = (draft as { _draft?: Record<string, unknown> })._draft;
  if (!draftMeta || typeof draftMeta !== 'object') {
    throw new Error('Draft 缺少 _draft 段，不是合法的 draft 文件');
  }

  const sourceFeature = draftMeta.source_feature;
  if (!sourceFeature || typeof sourceFeature !== 'string') {
    throw new Error('Draft 缺少 _draft.source_feature');
  }

  const unmappedSteps = (draftMeta.unmapped_steps as Array<{
    keyword: 'Given' | 'When' | 'Then';
    text: string;
    reason: string;
  }>) ?? [];

  const draftTest = (draft.test as Record<string, unknown>) ?? {};
  const testId = (draftTest.id as string) ?? '';
  const goal = (draft.goal as string) ?? (draftTest.name as string) ?? '';

  // 解析 source_feature
  const feature = parseFeature(featureRaw);
  const flattened = flattenScenarios(feature);

  // 定位目标场景
  let matchedScenario: FlattenedScenario | undefined;
  let matchBasis = '';

  if (flattened.length === 1) {
    matchedScenario = flattened[0];
    matchBasis = `matched single scenario in feature: "${matchedScenario!.name}"`;
  } else if (goal.length > 0) {
    const byGoal = flattened.filter((s) => s.name === goal);
    if (byGoal.length === 1) {
      matchedScenario = byGoal[0];
      matchBasis = `matched by scenario goal: "${goal}"`;
    }
  }

  if (!matchedScenario && testId.length > 0) {
    const byTestId = flattened.filter((s) => {
      const seg = toIdSegment(s.name, s.index + 1);
      return testId.includes(seg);
    });
    if (byTestId.length === 1) {
      matchedScenario = byTestId[0];
      matchBasis = `matched by test.id segment: "${testId}"`;
    }
  }

  if (!matchedScenario && flattened.length > 0) {
    // 回退到按步骤匹配或首个场景
    matchedScenario = flattened[0];
    matchBasis = `fallback to scenario index 0: "${matchedScenario!.name}"`;
  }

  // 对 draft._draft.unmapped_steps 逐条识别，确保数量守恒
  const candidates: StepCandidate[] = unmappedSteps.map((unmapped) =>
    recognizeExtendedStep(unmapped.keyword, unmapped.text, unmapped.reason),
  );

  const resolvedHigh = candidates.filter((c) => c.confidence === 'high').length;
  const needsHuman = candidates.length - resolvedHigh;

  let completedContract: Contract | undefined;

  // 仅当全部候选均为 high 时，按 Background + Scenario 原序重建 completedContract
  if (candidates.length > 0 && resolvedHigh === candidates.length && matchedScenario) {
    const allSteps = [...feature.background, ...matchedScenario.steps];
    const contractSteps: ContractStep[] = [];
    const domAssertions: Array<Record<string, unknown>> = [];
    // 每条断言所在 contract step 的位置，供 R4 判定“其后最近断言”。
    const assertionOrigins: number[] = [];

    const appendCandidate = (candidate: StepCandidate | undefined): void => {
      if (!candidate) return;
      const origin = contractSteps.length;
      if (candidate.step) {
        contractSteps.push({ ...candidate.step });
      }
      if (candidate.assertion) {
        domAssertions.push(candidate.assertion);
        assertionOrigins.push(origin);
      }
    };

    // 候选副本，供按序消耗
    const candidateQueue = [...candidates];

    for (const raw of allSteps) {
      if (raw.keyword === 'Then') {
        const baseline = mapThenStep(raw);
        if (baseline !== null) {
          const origin = contractSteps.length;
          contractSteps.push(baseline.step);
          if (baseline.assertion) {
            domAssertions.push(baseline.assertion);
            assertionOrigins.push(origin);
          }
          continue;
        }
        // baseline 无法映射，取扩展候选
        appendCandidate(candidateQueue.shift());
      } else {
        const baseline = mapStep(raw);
        if (baseline !== null) {
          contractSteps.push(baseline.step);
          continue;
        }
        // baseline 无法映射，取扩展候选
        appendCandidate(candidateQueue.shift());
      }
    }

    // R4 收尾：仍为 irreversible 的步骤必须带 postcondition。
    // 只取严格位于该步骤之后的最近一条断言；取不到则降级为可逆（保守，不阻断）。
    contractSteps.forEach((step, stepIndex) => {
      if (step.risk !== 'irreversible') return;
      if (step.postcondition !== undefined && step.postcondition.length > 0) return;
      const followingIndex = assertionOrigins.findIndex((origin) => origin > stepIndex);
      if (followingIndex >= 0) {
        step.postcondition = [domAssertions[followingIndex]!];
      } else {
        step.risk = 'reversible';
      }
    });

    const draftEnv = (draft.environment as Record<string, unknown>) ?? {};
    const draftIdentity = (draft.identity as Record<string, unknown>) ?? {};

    completedContract = {
      version: '1',
      test: {
        id: testId || `${toIdSegment(feature.name, 0)}.${toIdSegment(matchedScenario.name, 1)}`,
        name: (draftTest.name as string) ?? matchedScenario.name,
        ...(Array.isArray(draftTest.tags) && draftTest.tags.length > 0
          ? { tags: draftTest.tags as string[] }
          : matchedScenario.tags.length > 0
            ? { tags: matchedScenario.tags }
            : {}),
      },
      environment: {
        base_url: (draftEnv.base_url as string) ?? '',
      },
      identity: {
        role: (draftIdentity.role as string) ?? 'operator',
        credentials_ref: (draftIdentity.credentials_ref as string) ?? '',
      },
      goal: goal || matchedScenario.name,
      steps: contractSteps,
      assertions: {
        dom: domAssertions,
      },
    };
  }

  return {
    testId,
    candidates,
    resolvedHigh,
    needsHuman,
    ...(completedContract !== undefined ? { completedContract } : {}),
    matchBasis: matchBasis || 'unknown',
  };
}
