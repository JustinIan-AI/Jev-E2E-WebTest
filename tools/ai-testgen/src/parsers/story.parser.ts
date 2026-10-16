import { ParsedInput, ParsedScenario } from '../core/types';

export class StoryParser {
  parse(content: string): ParsedInput {
    const scenarios = this.extractScenarios(content);
    const title = scenarios[0]?.title || 'User Stories';

    return {
      type: 'story',
      title,
      scenarios,
      rawContent: content,
    };
  }

  canParse(content: string): boolean {
    const hasAsA = /\bAs an?\s+.+?,\s*I want\b/i.test(content);
    const hasStructuredGWT =
      /\bGiven\b/i.test(content) &&
      /\bWhen\b/i.test(content) &&
      /\bThen\b/i.test(content) &&
      /\bScenario[:\s]/i.test(content);
    return hasAsA || hasStructuredGWT;
  }

  private extractScenarios(content: string): ParsedScenario[] {
    const scenarios: ParsedScenario[] = [];

    // Extract "As a..." user stories
    const asARegex = /As a (.+?),?\s+I want (.+?),?\s+so that (.+?)(?:\n|$)/gi;
    let match;

    while ((match = asARegex.exec(content)) !== null) {
      scenarios.push({
        title: `As a ${match[1].trim()}`,
        description: `As a ${match[1].trim()}, I want ${match[2].trim()}, so that ${match[3].trim()}`,
        steps: [match[2].trim()],
        preconditions: [`User is a ${match[1].trim()}`],
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

    if (scenarios.length === 0) {
      scenarios.push({
        title: 'User Story',
        description: content.substring(0, 500),
      });
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
