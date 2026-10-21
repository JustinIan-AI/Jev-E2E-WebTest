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
- Add @tags for categorization
- Output ONLY valid Gherkin syntax

Step vocabulary (closed set, do not invent other actions):
- Every interactive step MUST start with one of these verbs: click, fill, select, scroll, wait, navigate, assert only
- Put the semantic target phrase in double quotes, then the action value (if any) in another pair of double quotes.
  Target comes BEFORE the value.
  Good: fill in "username input field" with "zhangsan"; select "country dropdown" with "China"; click "confirm button"; navigate "login page"; scroll "order list"; wait "submit button"; assert only "welcome banner" is visible
  Bad patterns (never produce them): subject-prefixed sentences (first-person or actor-prefixed), or value-first ordering.
- Do not use subject prefixes. Start directly with the verb, never with a first-person pronoun or an actor noun.
- Targets are semantic phrases only: no CSS selectors, XPath, coordinates, or JavaScript.
- Do not use Background for setup. Do not phrase preconditions as already-performed action steps
  (avoid logged-in or already-created-state written as prior actions, in either English or Chinese).
  Express pre-existing state through identity/setup declarations instead of action steps.`;

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
