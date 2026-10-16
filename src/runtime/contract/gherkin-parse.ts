/**
 * ai-testgen → IDWTH 衔接：极简 Gherkin 解析器（零运行时依赖）。
 *
 * 仅覆盖衔接所需子集：Feature / Background / Scenario(+Outline) /
 * Given / When / Then / And / But / Examples / @tags / #注释 /
 * 步骤数据表与文档串（解析后保留，映射器按需使用）。
 *
 * And/But/* 在解析阶段即归一化到最近的 Given|When|Then，下游无需再处理。
 */

export type StepKeyword = 'Given' | 'When' | 'Then';

export interface ParsedStep {
  keyword: StepKeyword;
  text: string;
  /** 步骤下方的 `| a | b |` 数据表（不含外层管道，已 trim）。 */
  table: string[][];
  /** `"""..."""` 或 ` ```...``` ` 文档串原文。 */
  docString: string | null;
}

export interface ParsedExamples {
  tags: string[];
  /** 含表头行；单元格已 trim。 */
  table: string[][];
}

export interface ParsedScenario {
  keyword: 'Scenario' | 'Scenario Outline';
  name: string;
  tags: string[];
  steps: ParsedStep[];
  examples: ParsedExamples[];
}

export interface ParsedFeature {
  name: string;
  /** Feature 行之后、首个块之前的自由描述行。 */
  description: string[];
  tags: string[];
  background: ParsedStep[];
  scenarios: ParsedScenario[];
}

export class GherkinParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Gherkin 解析失败（第 ${line} 行）：${message}`);
    this.name = 'GherkinParseError';
    this.line = line;
  }
}

const STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'] as const;
const TAGS_PATTERN = /^@\S+/;

/** 拆分 `| a | b |` 行为单元格；无法识别返回 null。 */
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/** 已知块头关键字白名单：避免把含冒号的步骤行（如 URL `https://...`）误判为块头。 */
const BLOCK_HEADERS = new Set([
  'Feature',
  'Background',
  'Scenario',
  'Example',
  'Scenario Outline',
  'Scenario Template',
  'Examples',
  'Scenarios',
  'Rule',
]);

/** 解析一行块头，如 `Scenario: 登录`；返回 [关键字, 名称]。 */
function parseBlockHeader(line: string): [string, string] | null {
  const match = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line.trim());
  if (match === null) return null;
  const keyword = match[1]!.trim();
  if (!BLOCK_HEADERS.has(keyword)) return null;
  return [keyword, match[2]!.trim()];
}

/** 解析 `@a @b` 标签行为标签数组。 */
function parseTagsLine(line: string): string[] | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens.every((t) => TAGS_PATTERN.test(t))) return null;
  return tokens.map((t) => t.slice(1));
}

export function parseFeature(input: string): ParsedFeature {
  const lines = input.split(/\r?\n/);

  const feature: ParsedFeature = {
    name: '',
    description: [],
    tags: [],
    background: [],
    scenarios: [],
  };

  let pendingTags: string[] = [];
  let featureStarted = false;
  let currentScenario: ParsedScenario | null = null;
  /** 当前归属的步骤容器（Background 或当前 Scenario）。 */
  let stepContainer: ParsedStep[] | null = null;
  let currentExamples: ParsedExamples | null = null;
  let lastKeyword: StepKeyword | null = null;

  // 文档串状态：非 null 表示正在收集文档串，值为闭合标记。
  let docStringMarker: '"""' | '```' | null = null;
  let docStringLines: string[] = [];
  let docStringTarget: ParsedStep | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();

    // --- 文档串体内：原样收集直到闭合行 ---
    if (docStringMarker !== null) {
      if (line === docStringMarker) {
        if (docStringTarget === null) {
          throw new GherkinParseError('文档串未挂在任何步骤上', i + 1);
        }
        // 去除非空行的公共前导空格（与标准 Cucumber 的 dedent 行为一致）。
        const indents = docStringLines
          .filter((l) => l.trim() !== '')
          .map((l) => l.match(/^ */)![0].length);
        const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
        docStringTarget.docString = docStringLines
          .map((l) => (l.trim() === '' ? '' : l.slice(minIndent)))
          .join('\n');
        docStringMarker = null;
        docStringLines = [];
        docStringTarget = null;
      } else {
        docStringLines.push(rawLine);
      }
      continue;
    }

    // --- 空行 / 整行注释 ---
    if (line === '' || line.startsWith('#')) continue;

    // --- 标签行 ---
    if (line.startsWith('@')) {
      const tags = parseTagsLine(line);
      if (tags === null) {
        throw new GherkinParseError(`无法识别的标签行：${line}`, i + 1);
      }
      pendingTags.push(...tags);
      continue;
    }

    // --- 数据表行：挂到最近步骤或 Examples 表 ---
    if (line.startsWith('|')) {
      const row = parseTableRow(rawLine);
      if (row === null) {
        throw new GherkinParseError('数据表行必须以 | 开头并以 | 结尾', i + 1);
      }
      if (currentExamples !== null) {
        currentExamples.table.push(row);
        continue;
      }
      const lastStep = stepContainer?.[stepContainer.length - 1];
      if (lastStep === undefined) {
        throw new GherkinParseError('数据表行前必须有步骤或 Examples', i + 1);
      }
      lastStep.table.push(row);
      continue;
    }

    // --- 文档串开始 ---
    if (line === '"""' || line === '```') {
      const lastStep = stepContainer?.[stepContainer.length - 1];
      if (lastStep === undefined) {
        throw new GherkinParseError('文档串必须挂在某个步骤之下', i + 1);
      }
      docStringMarker = line;
      docStringTarget = lastStep;
      continue;
    }

    // --- 块头（Feature/Background/Scenario/Examples/...） ---
    const header = parseBlockHeader(line);
    if (header !== null) {
      const [keyword, name] = header;

      if (keyword === 'Feature') {
        featureStarted = true;
        feature.name = name;
        feature.tags = pendingTags;
        pendingTags = [];
        stepContainer = null;
        lastKeyword = null;
        continue;
      }

      if (!featureStarted) {
        throw new GherkinParseError(`'${keyword}' 之前必须先声明 Feature`, i + 1);
      }

      if (keyword === 'Rule') {
        // 极简子集不做 Rule 分组；规则名仅作为分隔，后续场景照常归属 Feature。
        pendingTags = [];
        continue;
      }

      if (keyword === 'Background') {
        currentScenario = null;
        currentExamples = null;
        stepContainer = feature.background;
        lastKeyword = null;
        continue;
      }

      if (keyword === 'Scenario' || keyword === 'Example') {
        currentScenario = {
          keyword: 'Scenario',
          name,
          tags: pendingTags,
          steps: [],
          examples: [],
        };
        feature.scenarios.push(currentScenario);
        pendingTags = [];
        stepContainer = currentScenario.steps;
        currentExamples = null;
        lastKeyword = null;
        continue;
      }

      if (keyword === 'Scenario Outline' || keyword === 'Scenario Template') {
        currentScenario = {
          keyword: 'Scenario Outline',
          name,
          tags: pendingTags,
          steps: [],
          examples: [],
        };
        feature.scenarios.push(currentScenario);
        pendingTags = [];
        stepContainer = currentScenario.steps;
        currentExamples = null;
        lastKeyword = null;
        continue;
      }

      if (keyword === 'Examples' || keyword === 'Scenarios') {
        if (currentScenario === null || currentScenario.keyword !== 'Scenario Outline') {
          throw new GherkinParseError('Examples 只能出现在 Scenario Outline 中', i + 1);
        }
        currentExamples = { tags: pendingTags, table: [] };
        currentScenario.examples.push(currentExamples);
        pendingTags = [];
        continue;
      }

      throw new GherkinParseError(`不支持的 Gherkin 关键字：${keyword}`, i + 1);
    }

    // --- 步骤行 ---
    const stepMatch = new RegExp(`^(${STEP_KEYWORDS.join('|')}|\\*)\\s+(.+)$`).exec(line);
    if (stepMatch !== null) {
      const rawKeyword = stepMatch[1];
      if (stepContainer === null) {
        throw new GherkinParseError('步骤必须位于 Background 或 Scenario 内', i + 1);
      }
      let keyword: StepKeyword;
      if (rawKeyword === 'And' || rawKeyword === 'But' || rawKeyword === '*') {
        if (lastKeyword === null) {
          throw new GherkinParseError(`'${rawKeyword}' 不能作为首个步骤`, i + 1);
        }
        keyword = lastKeyword;
      } else {
        keyword = rawKeyword as StepKeyword;
        lastKeyword = keyword;
      }
      stepContainer.push({
        keyword,
        text: stepMatch[2]!.trim(),
        table: [],
        docString: null,
      });
      currentExamples = null;
      continue;
    }

    // --- Feature 描述行（Feature 已声明、尚无任何块） ---
    if (featureStarted && stepContainer === null && currentScenario === null) {
      feature.description.push(line);
      continue;
    }

    throw new GherkinParseError(`无法识别的 Gherkin 行：${line}`, i + 1);
  }

  if (docStringMarker !== null) {
    throw new GherkinParseError('文档串缺少闭合标记', lines.length);
  }
  if (!featureStarted) {
    throw new GherkinParseError('缺少 Feature 声明', lines.length);
  }
  if (feature.scenarios.length === 0 && feature.background.length === 0) {
    throw new GherkinParseError('Feature 中至少需要一个 Scenario', lines.length);
  }

  return feature;
}
