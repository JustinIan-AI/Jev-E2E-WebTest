import { describe, it, expect } from 'vitest';
import { validateGherkin, validateMarkdown } from '../../src/core/validator';

describe('validateGherkin', () => {
  it('should pass valid Gherkin', () => {
    const content = `Feature: Login
  Scenario: Successful login
    Given the user is on the login page
    When the user enters valid credentials
    Then the user is redirected to dashboard`;

    const result = validateGherkin(content);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail without Feature keyword', () => {
    const content = `Scenario: Test
    Given something
    When doing
    Then result`;

    const result = validateGherkin(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing Feature: keyword');
  });

  it('should fail without Scenario keyword', () => {
    const content = `Feature: Login
    Given something`;

    const result = validateGherkin(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing Scenario: keyword');
  });

  it('should fail without Given/When/Then', () => {
    const content = `Feature: Login
  Scenario: Test
    Some step`;

    const result = validateGherkin(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing Given/When/Then steps');
  });
});

describe('validateMarkdown', () => {
  it('should pass valid Markdown test plan', () => {
    const content = `# Test Plan
## Scope
This test plan covers the login feature with multiple scenarios and test cases for validation.
${' '.repeat(100)}`;

    const result = validateMarkdown(content);
    expect(result.valid).toBe(true);
  });

  it('should fail without headers', () => {
    const content =
      'Just plain text without any markdown formatting or structure at all whatsoever this is a long enough string.';
    const result = validateMarkdown(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing Markdown headers');
  });

  it('should fail if too short', () => {
    const content = '# Short\nToo short';
    const result = validateMarkdown(content);
    expect(result.valid).toBe(false);
  });
});
