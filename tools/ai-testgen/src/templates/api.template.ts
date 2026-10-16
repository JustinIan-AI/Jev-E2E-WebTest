import { BaseTemplate, TemplatePrompt } from './base.template';
import { ParsedInput, GenConfig } from '../core/types';

export class ApiTemplate extends BaseTemplate {
  format = 'api';

  buildPrompt(input: ParsedInput, config: GenConfig): TemplatePrompt {
    const includeNeg = config.options.includeNegative;

    const systemPrompt = `You are an expert API test automation engineer.
Generate complete, runnable Playwright API test files in TypeScript.

Requirements:
- Use Playwright Test syntax (import { test, expect } from '@playwright/test')
- Use request.newContext() for API calls
- Test all HTTP methods and status codes
- Validate response bodies and headers
${includeNeg ? '- Include negative cases (401, 403, 404, 422, 500)' : ''}
- Include request/response type checking
- Output ONLY valid TypeScript code in a single code block`;

    const endpoints = (input.endpoints || [])
      .map((ep) => {
        let desc = `${ep.method} ${ep.path}`;
        if (ep.summary) desc += ` - ${ep.summary}`;
        if (ep.parameters?.length)
          desc += `\n  Parameters: ${ep.parameters.map((p) => `${p.name} (${p.in}, ${p.required ? 'required' : 'optional'})`).join(', ')}`;
        if (ep.requestBody) desc += `\n  Body: ${ep.requestBody.contentType}`;
        if (ep.responses)
          desc += `\n  Responses: ${Object.entries(ep.responses)
            .map(([c, r]) => `${c}: ${r.description}`)
            .join(', ')}`;
        return desc;
      })
      .join('\n\n');

    const userPrompt = `Generate API test file for: "${input.title}"

Endpoints:
${endpoints || input.scenarios.map((s) => `- ${s.title}: ${s.description}`).join('\n')}

Generate a complete .spec.ts file with all API test cases.`;

    return { systemPrompt, userPrompt };
  }
}
