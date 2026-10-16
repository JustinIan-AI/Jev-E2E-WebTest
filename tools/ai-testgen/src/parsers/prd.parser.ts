import { ParsedInput, ParsedScenario } from '../core/types';

export class PrdParser {
  parse(content: string): ParsedInput {
    const title = this.extractTitle(content);
    const scenarios = this.extractScenarios(content);

    return {
      type: 'prd',
      title,
      scenarios,
      rawContent: content,
    };
  }

  canParse(content: string): boolean {
    const hasHeaders = /^#{1,3}\s+/m.test(content);
    const hasRequirements = /(?:requirement|feature|user story|acceptance criteria|scenario)/i.test(
      content,
    );
    return hasHeaders && hasRequirements;
  }

  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : 'Untitled PRD';
  }

  private extractScenarios(content: string): ParsedScenario[] {
    const scenarios: ParsedScenario[] = [];

    // Extract from ## or ### sections
    const sectionRegex = /^#{2,3}\s+(.+)$/gm;
    const sections: Array<{ title: string; start: number }> = [];
    let match;

    while ((match = sectionRegex.exec(content)) !== null) {
      sections.push({ title: match[1].trim(), start: match.index + match[0].length });
    }

    for (let i = 0; i < sections.length; i++) {
      const end = i < sections.length - 1 ? sections[i + 1].start : content.length;
      const body = content.substring(sections[i].start, end).trim();

      if (body.length < 10) continue;

      const steps = this.extractSteps(body);
      const preconditions = this.extractPreconditions(body);

      scenarios.push({
        title: sections[i].title,
        description: body.substring(0, 200),
        steps: steps.length > 0 ? steps : undefined,
        preconditions: preconditions.length > 0 ? preconditions : undefined,
      });
    }

    // If no sections found, create a single scenario from the whole document
    if (scenarios.length === 0) {
      scenarios.push({
        title: this.extractTitle(content),
        description: content.substring(0, 500),
      });
    }

    return scenarios;
  }

  private extractSteps(text: string): string[] {
    const steps: string[] = [];
    const stepRegex = /^[-*]\s+(.+)$/gm;
    let match;

    while ((match = stepRegex.exec(text)) !== null) {
      steps.push(match[1].trim());
    }

    return steps;
  }

  private extractPreconditions(text: string): string[] {
    const preconditions: string[] = [];
    const preRegex = /(?:precondition|prerequisite|given|setup)[:]\s*(.+)/gi;
    let match;

    while ((match = preRegex.exec(text)) !== null) {
      preconditions.push(match[1].trim());
    }

    return preconditions;
  }
}
