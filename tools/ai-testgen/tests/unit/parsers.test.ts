import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PrdParser } from '../../src/parsers/prd.parser';
import { OpenApiParser } from '../../src/parsers/openapi.parser';
import { StoryParser } from '../../src/parsers/story.parser';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('PrdParser', () => {
  const parser = new PrdParser();

  it('should detect PRD format', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-prd.md'), 'utf-8');
    expect(parser.canParse(content)).toBe(true);
  });

  it('should not detect non-PRD content', () => {
    expect(parser.canParse('just some plain text')).toBe(false);
  });

  it('should parse PRD and extract scenarios', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-prd.md'), 'utf-8');
    const result = parser.parse(content);

    expect(result.type).toBe('prd');
    expect(result.title).toBe('User Authentication Feature');
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('should extract section titles as scenario titles', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-prd.md'), 'utf-8');
    const result = parser.parse(content);

    const titles = result.scenarios.map((s) => s.title);
    expect(titles).toContain('Login Feature');
    expect(titles).toContain('Registration Feature');
  });

  it('should extract steps from bullet points', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-prd.md'), 'utf-8');
    const result = parser.parse(content);

    const loginScenario = result.scenarios.find((s) => s.title === 'Login Feature');
    expect(loginScenario?.steps).toBeDefined();
    expect(loginScenario!.steps!.length).toBeGreaterThan(0);
  });
});

describe('OpenApiParser', () => {
  const parser = new OpenApiParser();

  it('should detect OpenAPI format', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
    expect(parser.canParse(content)).toBe(true);
  });

  it('should not detect non-OpenAPI content', () => {
    expect(parser.canParse('just some text')).toBe(false);
    expect(parser.canParse('{"foo": "bar"}')).toBe(false);
  });

  it('should parse OpenAPI spec and extract endpoints', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
    const result = parser.parse(content);

    expect(result.type).toBe('openapi');
    expect(result.title).toBe('User API');
    expect(result.endpoints).toBeDefined();
    expect(result.endpoints!.length).toBe(4);
  });

  it('should extract HTTP methods correctly', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
    const result = parser.parse(content);

    const methods = result.endpoints!.map((ep) => ep.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
  });

  it('should extract parameters', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
    const result = parser.parse(content);

    const getUsers = result.endpoints!.find((ep) => ep.method === 'GET' && ep.path === '/users');
    expect(getUsers?.parameters).toBeDefined();
    expect(getUsers?.parameters?.find((p) => p.name === 'page')).toBeDefined();
  });

  it('should create scenarios from endpoints', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
    const result = parser.parse(content);

    expect(result.scenarios.length).toBe(4);
  });
});

describe('StoryParser', () => {
  const parser = new StoryParser();

  it('should detect user story format', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');
    expect(parser.canParse(content)).toBe(true);
  });

  it('should not detect non-story content', () => {
    expect(parser.canParse('just some plain text')).toBe(false);
  });

  it('should parse user stories', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');
    const result = parser.parse(content);

    expect(result.type).toBe('story');
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('should extract Given/When/Then scenarios', () => {
    const content = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');
    const result = parser.parse(content);

    const loginScenario = result.scenarios.find((s) => s.title === 'Successful Login');
    expect(loginScenario).toBeDefined();
    expect(loginScenario?.preconditions).toBeDefined();
    expect(loginScenario?.steps).toBeDefined();
  });
});

describe('StoryParser - canParse', () => {
  it('should not match casual use of "Given" in a PRD', () => {
    const parser = new StoryParser();
    expect(parser.canParse('Given the complexity of the system, we need tests.')).toBe(false);
  });

  it('should match structured "As a" user story', () => {
    const parser = new StoryParser();
    expect(parser.canParse('As a user, I want to log in, so that I can access my dashboard.')).toBe(
      true,
    );
  });

  it('should match structured Given/When/Then with Scenario', () => {
    const parser = new StoryParser();
    const content =
      'Scenario: Login\nGiven a user exists\nWhen they enter credentials\nThen they see dashboard';
    expect(parser.canParse(content)).toBe(true);
  });
});
