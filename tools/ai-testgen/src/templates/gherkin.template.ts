import { BaseTemplate, TemplatePrompt } from './base.template';
import { ParsedInput, GenConfig } from '../core/types';

export class GherkinTemplate extends BaseTemplate {
  format = 'gherkin';

  buildPrompt(input: ParsedInput, config: GenConfig): TemplatePrompt {
    const includeNeg = config.options.includeNegative;
    const includeBound = config.options.includeBoundary;

    const systemPrompt = `You are an expert BDD test engineer specializing in Gherkin feature files.
Generate complete .feature files following Gherkin syntax.

Requirements:
- Use Feature, Scenario, Given, When, Then, And keywords
- Use Scenario Outline with Examples for data-driven tests
- Write clear, business-readable steps
${includeNeg ? '- Include negative scenarios (error paths, invalid data)' : ''}
${includeBound ? '- Include boundary scenarios (limits, edge cases)' : ''}
- Use Background for shared setup steps
- Add @tags for categorization
- Output ONLY valid Gherkin syntax`;

    const scenarios = input.scenarios
      .map((s) => {
        let desc = `## ${s.title}\n${s.description}`;
        if (s.steps) desc += `\nSteps: ${s.steps.join(', ')}`;
        if (s.preconditions) desc += `\nPreconditions: ${s.preconditions.join(', ')}`;
        return desc;
      })
      .join('\n\n');

    const userPrompt = `Generate Gherkin feature file for: "${input.title}"

Scenarios:
${scenarios}

Generate a complete .feature file.`;

    return { systemPrompt, userPrompt };
  }
}
