import * as fs from 'fs';
import * as path from 'path';
import { GenConfig, DEFAULT_CONFIG } from './types';
import { logger } from '../utils/logger';

const CONFIG_FILES = ['ai-testgen.config.json', '.ai-testgen.json'];

export function loadConfig(configPath?: string): GenConfig {
  if (configPath) {
    return readConfigFile(configPath);
  }

  for (const filename of CONFIG_FILES) {
    const fullPath = path.resolve(process.cwd(), filename);
    if (fs.existsSync(fullPath)) {
      logger.debug(`Found config: ${fullPath}`);
      return readConfigFile(fullPath);
    }
  }

  return resolveEnvConfig({ ...DEFAULT_CONFIG });
}

function readConfigFile(filePath: string): GenConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const user: Partial<GenConfig> = JSON.parse(raw);

  return resolveEnvConfig({
    provider: { ...DEFAULT_CONFIG.provider, ...user.provider },
    output: { ...DEFAULT_CONFIG.output, ...user.output },
    options: { ...DEFAULT_CONFIG.options, ...user.options },
    cache: {
      dir: '.ai-testgen/cache',
      ttlSeconds: 86400,
      enabled: true,
      ...DEFAULT_CONFIG.cache,
      ...user.cache,
    },
  });
}

function resolveEnvConfig(config: GenConfig): GenConfig {
  if (!config.provider.apiKey || config.provider.apiKey.startsWith('$')) {
    const envVar = config.provider.type === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    config.provider.apiKey = process.env[envVar] || config.provider.apiKey || '';
  }
  return config;
}

export function writeDefaultConfig(outputPath: string): void {
  const config = {
    provider: { type: 'openai', apiKey: '$OPENAI_API_KEY', model: 'gpt-4o-mini' },
    output: DEFAULT_CONFIG.output,
    options: DEFAULT_CONFIG.options,
    cache: { dir: '.ai-testgen/cache', ttlSeconds: 86400, enabled: true },
  };

  const dir = path.dirname(outputPath);
  if (dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2), 'utf-8');
  logger.info(`Config written to ${outputPath}`);
}
