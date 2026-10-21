import { describe, it, expect } from 'vitest';
import { PlaywrightTemplate } from '../../src/templates/playwright.template';
import { ApiTemplate } from '../../src/templates/api.template';
import { GherkinTemplate } from '../../src/templates/gherkin.template';
import { MarkdownTemplate } from '../../src/templates/markdown.template';
import { ParsedInput, DEFAULT_CONFIG } from '../../src/core/types';

function makeParsedInput(): ParsedInput {
  return {
    type: 'prd',
    title: 'Login Feature',
    scenarios: [
      {
        title: 'Valid Login',
        description: 'User logs in with correct credentials',
        steps: ['Enter email', 'Enter password', 'Click submit'],
      },
      { title: 'Invalid Login', description: 'User sees error with wrong password' },
    ],
    rawContent: 'Login feature content',
  };
}

function makeApiInput(): ParsedInput {
  return {
    type: 'openapi',
    title: 'User API',
    scenarios: [{ title: 'GET /users', description: 'List all users' }],
    endpoints: [
      {
        method: 'GET',
        path: '/users',
        summary: 'List users',
        parameters: [{ name: 'page', in: 'query', required: false, type: 'integer' }],
        responses: { '200': { description: 'OK' } },
      },
      {
        method: 'POST',
        path: '/users',
        summary: 'List users',
        requestBody: { contentType: 'application/json' },
        responses: { '201': { description: 'Created' } },
      },
    ],
    rawContent: 'openapi content',
  };
}

describe('PlaywrightTemplate', () => {
  it('should build prompt with scenarios', () => {
    const template = new PlaywrightTemplate();
    const { systemPrompt, userPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);

    expect(systemPrompt).toContain('Playwright');
    expect(userPrompt).toContain('Login Feature');
    expect(userPrompt).toContain('Valid Login');
  });

  it('should include negative/boundary flags', () => {
    const template = new PlaywrightTemplate();
    const config = {
      ...DEFAULT_CONFIG,
      options: { ...DEFAULT_CONFIG.options, includeNegative: true, includeBoundary: true },
    };
    const { systemPrompt } = template.buildPrompt(makeParsedInput(), config);

    expect(systemPrompt).toContain('negative');
    expect(systemPrompt).toContain('boundary');
  });
});

describe('ApiTemplate', () => {
  it('should build prompt with endpoints', () => {
    const template = new ApiTemplate();
    const { systemPrompt, userPrompt } = template.buildPrompt(makeApiInput(), DEFAULT_CONFIG);

    expect(systemPrompt).toContain('API');
    expect(userPrompt).toContain('GET /users');
    expect(userPrompt).toContain('POST /users');
  });
});

describe('GherkinTemplate', () => {
  it('should build prompt for Gherkin format', () => {
    const template = new GherkinTemplate();
    const { systemPrompt, userPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);

    expect(systemPrompt).toContain('Gherkin');
    expect(systemPrompt).toContain('Given');
    expect(userPrompt).toContain('Login Feature');
  });

  it('should constrain steps to the closed action vocabulary', () => {
    const template = new GherkinTemplate();
    const { systemPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);

    // Closed action set enforced by the downstream mapper (see AGENTS.md)
    for (const verb of ['click', 'fill', 'select', 'scroll', 'wait', 'navigate', 'assert only']) {
      expect(systemPrompt.toLowerCase()).toContain(verb);
    }
  });

  it('should require quoted target-first phrasing and forbid subject prefixes', () => {
    const template = new GherkinTemplate();
    const { systemPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);
    const lower = systemPrompt.toLowerCase();

    // Target before value, both wrapped in double quotes, on the fill example
    expect(lower).toContain('target');
    expect(systemPrompt).toMatch(/fill[^"\n]*"[^"]+"[^"\n]*"[^"]+"/i);
    expect(systemPrompt).toMatch(/target comes before the value/i);
    // No narrative subject prefixes such as "I click" / "用户点击"
    expect(lower).not.toMatch(/\bI\s+(click|enter|type|fill|select)\b/i);
    expect(systemPrompt).not.toContain('用户点击');
    expect(systemPrompt).not.toContain('我点击');
  });

  it('should not instruct Background setup or already-logged-in preconditions', () => {
    const template = new GherkinTemplate();
    const { systemPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);
    const lower = systemPrompt.toLowerCase();

    // The old setup directive must be gone and replaced by an explicit ban
    expect(lower).not.toContain('use background for shared setup');
    expect(lower).toMatch(/do not use background/);
    expect(lower).not.toMatch(/am already logged in|is already logged in/);
    expect(systemPrompt).not.toContain('已登录');
    expect(systemPrompt).not.toContain('已存在');
  });
});

describe('MarkdownTemplate', () => {
  it('should build prompt for Markdown test plan', () => {
    const template = new MarkdownTemplate();
    const { systemPrompt, userPrompt } = template.buildPrompt(makeParsedInput(), DEFAULT_CONFIG);

    expect(systemPrompt).toContain('test plan');
    expect(systemPrompt).toContain('Markdown');
    expect(userPrompt).toContain('Login Feature');
  });
});
