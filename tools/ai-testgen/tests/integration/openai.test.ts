import { describe, it, expect } from 'vitest';
import { Generator } from '../../src/core/generator';
import { GenConfig, DEFAULT_CONFIG } from '../../src/core/types';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const hasApiKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasApiKey)('OpenAI Integration', () => {
  const config: GenConfig = {
    ...DEFAULT_CONFIG,
    provider: {
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o-mini',
    },
    options: {
      ...DEFAULT_CONFIG.options,
      maxTokens: 1024,
    },
    cache: {
      ...DEFAULT_CONFIG.cache!,
      enabled: false, // Don't cache in integration tests
    },
  };

  it('should generate Playwright tests from a PRD', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-int-'));
    const inputFile = path.join(tmpDir, 'login.md');
    fs.writeFileSync(
      inputFile,
      `# Login Feature

## Requirements
- Users can log in with email and password
- Invalid credentials show an error message
- Successful login redirects to dashboard
`,
    );

    const generator = new Generator(config);
    const result = await generator.generate(inputFile, 'playwright', tmpDir);

    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files[0].content).toContain('test(');
    expect(result.summary.totalTests).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 30000);

  it('should generate API tests from OpenAPI spec', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-int-'));
    const inputFile = path.join(tmpDir, 'api.yaml');
    fs.writeFileSync(
      inputFile,
      `openapi: "3.0.0"
info:
  title: Pet Store
  version: "1.0.0"
paths:
  /pets:
    get:
      summary: List all pets
      responses:
        '200':
          description: A list of pets
    post:
      summary: Create a pet
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
      responses:
        '201':
          description: Pet created
`,
    );

    const generator = new Generator(config);
    const result = await generator.generate(inputFile, 'api', tmpDir);

    expect(result.files.length).toBeGreaterThan(0);
    expect(result.summary.totalTests).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 30000);
});
