import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PlaywrightOutput } from '../../src/outputs/playwright.output';
import { GherkinOutput } from '../../src/outputs/gherkin.output';
import { MarkdownOutput } from '../../src/outputs/markdown.output';

describe('PlaywrightOutput', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-output-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create file with .spec.ts extension', () => {
    const output = new PlaywrightOutput();
    const file = output.createFile('login-tests', 'test("should login", () => {});');
    expect(file.path).toBe('login-tests.spec.ts');
    expect(file.content).toContain('test("should login"');
  });

  it('should write files to output directory', () => {
    const output = new PlaywrightOutput();
    const files = [{ path: 'test.spec.ts', content: 'test code here' }];
    output.write(files, tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'test.spec.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'test.spec.ts'), 'utf-8')).toBe('test code here');
  });

  it('should create nested directories if needed', () => {
    const output = new PlaywrightOutput();
    const nestedDir = path.join(tmpDir, 'deep', 'nested');
    const files = [{ path: 'test.spec.ts', content: 'code' }];
    output.write(files, nestedDir);
    expect(fs.existsSync(path.join(nestedDir, 'test.spec.ts'))).toBe(true);
  });

  it('should not overwrite an existing file and append -2 on conflict', () => {
    const output = new PlaywrightOutput();
    const files = [{ path: 'login.spec.ts', content: 'new code' }];

    const first = output.write([{ path: 'login.spec.ts', content: 'original code' }], tmpDir);
    expect(first[0].writtenPath).toBe('login.spec.ts');

    const second = output.write(files, tmpDir);
    expect(second[0].writtenPath).toBe('login-2.spec.ts');
    expect(fs.existsSync(path.join(tmpDir, 'login.spec.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'login-2.spec.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'login.spec.ts'), 'utf-8')).toBe('original code');
    expect(fs.readFileSync(path.join(tmpDir, 'login-2.spec.ts'), 'utf-8')).toBe('new code');
  });

  it('should keep incrementing until a free name is found', () => {
    const output = new PlaywrightOutput();
    output.write([{ path: 'login.spec.ts', content: 'v1' }], tmpDir);
    output.write([{ path: 'login.spec.ts', content: 'v2' }], tmpDir);
    const third = output.write([{ path: 'login.spec.ts', content: 'v3' }], tmpDir);
    expect(third[0].writtenPath).toBe('login-3.spec.ts');
  });
});

describe('GherkinOutput', () => {
  it('should create file with .feature extension', () => {
    const output = new GherkinOutput();
    const file = output.createFile('login', 'Feature: Login');
    expect(file.path).toBe('login.feature');
  });
});

describe('MarkdownOutput', () => {
  it('should create file with .md extension', () => {
    const output = new MarkdownOutput();
    const file = output.createFile('test-plan', '# Test Plan');
    expect(file.path).toBe('test-plan.md');
  });
});
