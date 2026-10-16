import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, writeDefaultConfig } from '../../src/core/config';
import { DEFAULT_CONFIG } from '../../src/core/types';

const TMP_DIR = path.join(__dirname, '.tmp-config');

describe('config', () => {
  afterEach(() => {
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true });
    }
  });

  it('should return default config when no file found', () => {
    const config = loadConfig();
    expect(config.provider.type).toBe(DEFAULT_CONFIG.provider.type);
    expect(config.output.format).toBe(DEFAULT_CONFIG.output.format);
  });

  it('should load config from JSON file', () => {
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    const configPath = path.join(TMP_DIR, 'test-config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: { type: 'anthropic', model: 'claude-sonnet-4-6' },
        output: { format: 'gherkin' },
      }),
      'utf-8',
    );

    const config = loadConfig(configPath);
    expect(config.provider.type).toBe('anthropic');
    expect(config.output.format).toBe('gherkin');
  });

  it('should write default config', () => {
    const configPath = path.join(TMP_DIR, 'default.json');
    writeDefaultConfig(configPath);
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('should throw on nonexistent explicit config path', () => {
    expect(() => loadConfig('/nonexistent/config.json')).toThrow();
  });

  it('should resolve ANTHROPIC_API_KEY for anthropic provider', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-cfg-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ provider: { type: 'anthropic' } }));

    const origEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const config = loadConfig(configPath);
    expect(config.provider.apiKey).toBe('test-anthropic-key');
    process.env.ANTHROPIC_API_KEY = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle $-prefixed apiKey by resolving env', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-cfg-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ provider: { type: 'openai', apiKey: '$OPENAI_API_KEY' } }),
    );

    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const config = loadConfig(configPath);
    expect(config.provider.apiKey).toBe('test-openai-key');
    process.env.OPENAI_API_KEY = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
