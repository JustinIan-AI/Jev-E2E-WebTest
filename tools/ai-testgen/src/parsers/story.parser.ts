import { ParsedInput, ParsedScenario } from '../core/types';
import { logger } from '../utils/logger';

export interface StoryParseWarning {
  code: 'STORY_FALLBACK_WHOLE_TEXT';
  message: string;
}

export class StoryParser {
  parse(content: string): ParsedInput & { warnings?: StoryParseWarning[] } {
    const scenarios = this.extractScenarios(content);

    if (scenarios.length === 0) {
      const message =
        '未能按用户故事语法（As a/an … I want …）解析内容，已按整段文本处理（1 个 scenario）。';
      logger.warn(message);
      return {
        type: 'story',
        title: 'User Story',
        scenarios: [{ title: 'User Story', description: content.substring(0, 500) }],
        rawContent: content,
        warnings: [{ code: 'STORY_FALLBACK_WHOLE_TEXT', message }],
      };
    }

    return {
      type: 'story',
      title: scenarios[0].title,
      scenarios,
      rawContent: content,
    };
  }

  canParse(content: string): boolean {
    return this.extractScenarios(content).length >= 1;
  }

  /**
   * 宽松的用户故事意图判定：存在以 As a/an 开头的行。
   * 与严格提取分离，供 detectAndParse 在 canParse=false 时识别
   * “意图是故事但不符合严格语法”的内容，使其走 story fallback 并显式 warn，
   * 而不是静默落入 PRD parser。
   */
  looksLikeStory(content: string): boolean {
    return /^[ \t>]*As an?\s+\w/im.test(content);
  }

  private extractScenarios(content: string): ParsedScenario[] {
    const scenarios: ParsedScenario[] = [];

    // Extract "As a/an ... I want ..." user stories (benefit clause optional)
    const storyRegex =
      /As (an? \w[\w\s-]*?),\s*I want (.+?)(?:,\s*(?:so that|in order to) (.+?))?(?=\s*(?:\n\s*As an?\b|\n\s*Scenario[:\s]|$))/gis;
    let match;

    while ((match = storyRegex.exec(content)) !== null) {
      const role = match[1].trim();
      const want = match[2].trim().replace(/[.,]$/, '');
      const benefit = match[3]?.trim().replace(/[.,]$/, '');
      const description = benefit
        ? `As ${role}, I want ${want}, so that ${benefit}`
        : `As ${role}, I want ${want}`;

      scenarios.push({
        title: `As ${role}`,
        description,
        steps: [want],
        preconditions: [`User is a ${role}`],
      });
    }

    // Extract Given/When/Then scenarios
    const gwtBlocks = content.split(/(?=\bScenario[:\s])/i);
    for (const block of gwtBlocks) {
      const scenarioMatch = block.match(/Scenario[:\s]+(.+?)(?:\n|$)/i);
      if (!scenarioMatch) continue;

      const givens = this.extractGWT(block, 'Given');
      const whens = this.extractGWT(block, 'When');
      const thens = this.extractGWT(block, 'Then');

      if (givens.length > 0 || whens.length > 0 || thens.length > 0) {
        scenarios.push({
          title: scenarioMatch[1].trim(),
          description: block.trim().substring(0, 200),
          steps: [...whens, ...thens],
          preconditions: givens,
        });
      }
    }

    return scenarios;
  }

  private extractGWT(text: string, keyword: string): string[] {
    const results: string[] = [];
    const regex = new RegExp(`\\b${keyword}\\s+(.+?)(?:\\n|$)`, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      results.push(match[1].trim());
    }

    return results;
  }
}
