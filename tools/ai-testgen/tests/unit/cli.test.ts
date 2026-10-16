import { describe, it, expect } from 'vitest';
import { OutputFormat } from '../../src/core/types';

const VALID_FORMATS: readonly string[] = ['playwright', 'api', 'gherkin', 'markdown'];

function isValidFormat(format: string): format is OutputFormat {
  return VALID_FORMATS.includes(format);
}

describe('CLI format validation', () => {
  it('should accept valid formats', () => {
    expect(isValidFormat('playwright')).toBe(true);
    expect(isValidFormat('api')).toBe(true);
    expect(isValidFormat('gherkin')).toBe(true);
    expect(isValidFormat('markdown')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(isValidFormat('excel')).toBe(false);
    expect(isValidFormat('json')).toBe(false);
    expect(isValidFormat('')).toBe(false);
  });
});
