export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTypeScript(content: string): ValidationResult {
  const errors: string[] = [];

  // Structural checks instead of tsc compilation
  if (!content.includes('import')) {
    errors.push('Missing import statements');
  }

  const hasTestBlocks = /\b(test|it|describe)\s*\(/.test(content);
  if (!hasTestBlocks) {
    errors.push('No test blocks found (test, it, or describe)');
  }

  // Check for obvious syntax issues
  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Mismatched braces: ${openBraces} opening, ${closeBraces} closing`);
  }

  const openParens = (content.match(/\(/g) || []).length;
  const closeParens = (content.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push(`Mismatched parentheses: ${openParens} opening, ${closeParens} closing`);
  }

  return { valid: errors.length === 0, errors };
}

export function validateGherkin(content: string): ValidationResult {
  const errors: string[] = [];

  if (!content.includes('Feature:')) {
    errors.push('Missing Feature: keyword');
  }

  if (!content.includes('Scenario:') && !content.includes('Scenario Outline:')) {
    errors.push('Missing Scenario: keyword');
  }

  const hasGWT = /\b(Given|When|Then)\b/.test(content);
  if (!hasGWT) {
    errors.push('Missing Given/When/Then steps');
  }

  return { valid: errors.length === 0, errors };
}

export function validateMarkdown(content: string): ValidationResult {
  const errors: string[] = [];

  if (!content.includes('#')) {
    errors.push('Missing Markdown headers');
  }

  if (content.trim().length < 100) {
    errors.push('Content seems too short for a test plan');
  }

  return { valid: errors.length === 0, errors };
}
