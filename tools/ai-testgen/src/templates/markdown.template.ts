import { BaseTemplate, TemplatePrompt } from './base.template';
import { ParsedInput, GenConfig } from '../core/types';

export class MarkdownTemplate extends BaseTemplate {
  format = 'markdown';

  buildPrompt(input: ParsedInput, config: GenConfig): TemplatePrompt {
    const includeNeg = config.options.includeNegative;
    const includeBound = config.options.includeBoundary;

    const systemPrompt = `You are an expert QA test planner.
Generate comprehensive test plans in Markdown format.

Requirements:
- Use structured Markdown with headers, tables, and checklists
- Include: test ID, priority (P0-P3), test name, steps, expected result, status
- Organize by feature/module
${includeNeg ? '- Include negative test cases' : ''}
${includeBound ? '- Include boundary/edge case tests' : ''}
- Add a summary section with test counts and coverage areas
- Use tables for test matrices
- Output ONLY valid Markdown`;

    const scenarios = input.scenarios.map((s) => `- ${s.title}: ${s.description}`).join('\n');

    const userPrompt = `Generate test plan for: "${input.title}"

Features/Scenarios:
${scenarios}

Generate a complete test plan document in Markdown.`;

    return { systemPrompt, userPrompt };
  }
}
