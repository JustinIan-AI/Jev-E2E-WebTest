import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Generator } from '../../src/core/generator';
import { DEFAULT_CONFIG } from '../../src/core/types';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('Generator', () => {
  describe('detectAndParse', () => {
    const generator = new Generator(DEFAULT_CONFIG);

    it('should detect PRD input', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample-prd.md'), 'utf-8');
      const result = generator.detectAndParse(content);
      expect(result.type).toBe('prd');
    });

    it('should detect OpenAPI input', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample-openapi.yaml'), 'utf-8');
      const result = generator.detectAndParse(content);
      expect(result.type).toBe('openapi');
    });

    it('should detect user story input', () => {
      const content = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');
      const result = generator.detectAndParse(content);
      expect(result.type).toBe('story');
    });

    it('should fall back to PRD for unknown input', () => {
      const result = generator.detectAndParse(
        '# Some Document\n## Section\nSome requirement content here',
      );
      expect(result.type).toBe('prd');
    });

    it('should not classify PRD with "Given the requirements" as user story', () => {
      const content = `# Login Feature PRD\n\n## Requirements\nGiven the requirements above, the system should authenticate users.\n\n## Acceptance Criteria\n- User can log in with email and password\n`;
      const result = generator.detectAndParse(content);
      expect(result.type).toBe('prd');
    });
  });
});
