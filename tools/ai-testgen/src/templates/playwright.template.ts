import { BaseTemplate, TemplatePrompt } from './base.template';
import { ParsedInput, GenConfig } from '../core/types';

export class PlaywrightTemplate extends BaseTemplate {
  format = 'playwright';

  buildPrompt(input: ParsedInput, config: GenConfig): TemplatePrompt {
    const style = config.output.style;
    const includeNeg = config.options.includeNegative;
    const includeBound = config.options.includeBoundary;

    const systemPrompt = `You are an expert QA automation engineer specializing in Playwright test automation.
Generate complete, runnable Playwright test files in TypeScript.

Requirements:
- Use Playwright Test syntax (import { test, expect } from '@playwright/test')
- Group related tests with test.describe()
- Use ${style} test naming style
- Include proper assertions with expect()
- Add page.goto() and proper navigation
${includeNeg ? '- Include negative test cases (invalid inputs, error states)' : ''}
${includeBound ? '- Include boundary test cases (edge cases, limits)' : ''}
- Add JSDoc comments for test descriptions
- Use proper async/await patterns
- Output ONLY valid TypeScript code in a single code block`;

    const scenarios = input.scenarios
      .map((s) => {
        let desc = `## ${s.title}\n${s.description}`;
        if (s.steps) desc += `\nSteps:\n${s.steps.map((st) => `- ${st}`).join('\n')}`;
        if (s.preconditions)
          desc += `\nPreconditions:\n${s.preconditions.map((p) => `- ${p}`).join('\n')}`;
        return desc;
      })
      .join('\n\n');

    const userPrompt = `Generate Playwright test file for: "${input.title}"

Input type: ${input.type}

Scenarios:
${scenarios}

Generate a complete .spec.ts file with all test cases.`;

    return { systemPrompt, userPrompt };
  }
}
