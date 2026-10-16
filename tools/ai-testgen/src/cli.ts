#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { loadConfig, writeDefaultConfig } from './core/config';
import { Generator } from './core/generator';
import { validateTypeScript, validateGherkin, validateMarkdown } from './core/validator';
import { setLogLevel } from './utils/logger';
import { OutputFormat } from './core/types';
import { Progress } from './utils/progress';
import { Cache } from './utils/cache';

dotenv.config();

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

const VALID_FORMATS = ['playwright', 'api', 'gherkin', 'markdown'] as const;

function validateFormat(format: string): asserts format is OutputFormat {
  if (!(VALID_FORMATS as readonly string[]).includes(format)) {
    console.error(`Unknown format '${format}'. Supported: ${VALID_FORMATS.join(', ')}`);
    process.exit(1);
  }
}

const program = new Command();

program
  .name('ai-testgen')
  .description('AI-powered test case generator from PRDs, OpenAPI specs, and user stories')
  .version(pkg.version);

program
  .command('generate')
  .description('Generate test cases from input file')
  .argument('<file>', 'Input file (PRD, OpenAPI spec, or user stories)')
  .option('-f, --format <type>', 'Output format: playwright, api, gherkin, markdown', 'playwright')
  .option('-o, --output <dir>', 'Output directory', './generated-tests')
  .option('-c, --config <path>', 'Path to config file')
  .option('--style <type>', 'Test style: descriptive, concise, bdd', 'descriptive')
  .option('--no-negative', 'Skip negative test cases')
  .option('--no-boundary', 'Skip boundary test cases')
  .option('--no-stream', 'Disable streaming output')
  .option('--dry-run', 'Show parsed input and prompt without calling LLM')
  .option('--model <model>', 'Override LLM model')
  .option('--no-cache', 'Bypass response cache')
  .option('--clear-cache', 'Clear all cached responses and exit')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (file: string, options) => {
    if (options.verbose) setLogLevel('debug');
    validateFormat(options.format);

    const config = loadConfig(options.config);
    config.output.format = options.format as OutputFormat;
    config.output.dir = options.output;
    config.output.style = options.style;
    if (options.negative === false) config.options.includeNegative = false;
    if (options.boundary === false) config.options.includeBoundary = false;
    if (options.model) config.provider.model = options.model;

    if (options.clearCache) {
      const cacheDir = config.cache?.dir || '.ai-testgen/cache';
      if (fs.existsSync(cacheDir)) {
        const cache = new Cache({ dir: cacheDir, ttlSeconds: 0 });
        cache.clear();
      }
      console.log('Cache cleared.');
      return;
    }

    if (options.cache === false && config.cache) {
      config.cache.enabled = false;
    }

    const progress = new Progress();
    progress.start('Parsing input...');

    const generator = new Generator(config);

    if (options.dryRun) {
      const content = fs.readFileSync(file, 'utf-8');
      const input = generator.detectAndParse(content);
      progress.done('Parsed');
      console.log(`\nInput type: ${input.type}`);
      console.log(`Title: ${input.title}`);
      console.log(`Scenarios: ${input.scenarios.length}`);
      console.log(`\nDry run — no LLM call made.`);
      return;
    }

    const useStream = options.stream !== false && !!process.stderr.isTTY;
    const result = await generator.generate(
      file,
      options.format as OutputFormat,
      config.output.dir,
      {
        stream: useStream,
        progress,
      },
    );

    progress.done(`Generated ${result.summary.totalTests} tests in ${result.files.length} file(s)`);
    console.log(`Format: ${result.format}`);
    console.log(`Output: ${config.output.dir}`);
  });

program
  .command('from-spec')
  .description('Generate API tests from OpenAPI spec')
  .argument('<file>', 'OpenAPI spec file (YAML or JSON)')
  .option('-o, --output <dir>', 'Output directory', './generated-tests')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--no-stream', 'Disable streaming output')
  .action(async (file: string, options) => {
    if (options.verbose) setLogLevel('debug');

    const config = loadConfig(options.config);
    config.output.format = 'api';
    config.output.dir = options.output;

    const progress = new Progress();
    progress.start('Parsing OpenAPI spec...');

    const generator = new Generator(config);
    const useStream = options.stream !== false && !!process.stderr.isTTY;
    const result = await generator.generate(file, 'api', config.output.dir, {
      stream: useStream,
      progress,
    });

    progress.done(`Generated ${result.summary.totalTests} API tests from spec`);
  });

program
  .command('plan')
  .description('Generate test plan in Markdown')
  .argument('<file>', 'Input file')
  .option('-o, --output <dir>', 'Output directory', './generated-tests')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--no-stream', 'Disable streaming output')
  .action(async (file: string, options) => {
    if (options.verbose) setLogLevel('debug');

    const config = loadConfig(options.config);
    config.output.format = 'markdown';
    config.output.dir = options.output;

    const progress = new Progress();
    progress.start('Parsing input...');

    const generator = new Generator(config);
    const useStream = options.stream !== false && !!process.stderr.isTTY;
    const result = await generator.generate(file, 'markdown', config.output.dir, {
      stream: useStream,
      progress,
    });

    progress.done(`Generated test plan with ${result.summary.totalScenarios} scenarios`);
  });

program
  .command('validate')
  .description('Validate generated test files')
  .argument('<file>', 'File to validate')
  .option('-f, --format <type>', 'Format: playwright, gherkin, markdown')
  .action((file: string, options) => {
    const content = fs.readFileSync(file, 'utf-8');
    const format = options.format || detectFormat(file);

    let result;
    switch (format) {
      case 'playwright':
      case 'api':
        result = validateTypeScript(content);
        break;
      case 'gherkin':
        result = validateGherkin(content);
        break;
      case 'markdown':
        result = validateMarkdown(content);
        break;
      default:
        console.error(`Unknown format: ${format}`);
        process.exit(1);
    }

    if (result.valid) {
      console.log(`Validation passed for ${file}`);
    } else {
      console.error(`Validation failed for ${file}:`);
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize ai-testgen configuration')
  .option('--force', 'Overwrite existing config')
  .action((options) => {
    const configPath = 'ai-testgen.config.json';
    if (fs.existsSync(configPath) && !options.force) {
      console.error(`Config already exists: ${configPath}. Use --force to overwrite.`);
      process.exit(1);
    }
    writeDefaultConfig(configPath);
    console.log('Done! Edit ai-testgen.config.json, set your API key, and run:');
    console.log('  npx ai-testgen generate <input-file>');
  });

function detectFormat(filePath: string): string {
  if (filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) return 'playwright';
  if (filePath.endsWith('.feature')) return 'gherkin';
  if (filePath.endsWith('.md')) return 'markdown';
  return 'playwright';
}

program.addHelpText(
  'after',
  `
Examples:
  $ ai-testgen generate requirements.md --format playwright
  $ ai-testgen generate api-spec.yaml --format api --model gpt-4o
  $ ai-testgen generate stories.txt --format gherkin --style bdd
  $ ai-testgen generate spec.yaml --dry-run
  $ ai-testgen validate generated-tests/login.spec.ts
  $ ai-testgen init
`,
);

program.parseAsync().catch((err: Error) => {
  if (err.message.includes('API key')) {
    console.error(`\nConfiguration error: ${err.message}`);
    process.exit(1);
  } else if (err.message.includes('ENOENT')) {
    const match = err.message.match(/ENOENT.*?'(.+?)'/);
    console.error(`\nFile not found: ${match?.[1] || 'unknown file'}`);
    process.exit(1);
  } else {
    console.error(`\nError: ${err.message}`);
    process.exit(2);
  }
});
