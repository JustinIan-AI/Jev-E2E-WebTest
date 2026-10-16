import * as fs from 'fs';
import { GenConfig, ParsedInput, GeneratedOutput, OutputFormat } from './types';
import { PrdParser } from '../parsers/prd.parser';
import { OpenApiParser } from '../parsers/openapi.parser';
import { StoryParser } from '../parsers/story.parser';
import { BaseTemplate } from '../templates/base.template';
import { PlaywrightTemplate } from '../templates/playwright.template';
import { ApiTemplate } from '../templates/api.template';
import { GherkinTemplate } from '../templates/gherkin.template';
import { MarkdownTemplate } from '../templates/markdown.template';
import { BaseOutput } from '../outputs/base.output';
import { PlaywrightOutput } from '../outputs/playwright.output';
import { GherkinOutput } from '../outputs/gherkin.output';
import { MarkdownOutput } from '../outputs/markdown.output';
import { LLMProvider } from '../providers/base.provider';
import { OpenAIProvider } from '../providers/openai.provider';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { CustomProvider } from '../providers/custom.provider';
import { extractFirstCodeBlock } from '../utils/prompt';
import { logger } from '../utils/logger';
import { Progress } from '../utils/progress';
import { Cache } from '../utils/cache';

export class Generator {
  private config: GenConfig;
  private provider: LLMProvider;
  private prdParser = new PrdParser();
  private openApiParser = new OpenApiParser();
  private storyParser = new StoryParser();

  constructor(config: GenConfig) {
    this.config = config;
    this.provider = this.initProvider();
  }

  async generate(
    filePath: string,
    format?: OutputFormat,
    outputDir?: string,
    options?: { stream?: boolean; progress?: Progress },
  ): Promise<GeneratedOutput> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.generateFromContent(content, format, outputDir, options);
  }

  async generateFromContent(
    content: string,
    format?: OutputFormat,
    outputDir?: string,
    options?: { stream?: boolean; progress?: Progress },
  ): Promise<GeneratedOutput> {
    const input = this.detectAndParse(content);
    const outputFormat = format || this.config.output.format;
    const template = this.getTemplate(outputFormat);
    const output = this.getOutput(outputFormat);

    logger.info(`Detected input type: ${input.type} (${input.scenarios.length} scenarios)`);
    logger.info(`Generating ${outputFormat} tests...`);

    const { systemPrompt, userPrompt } = template.buildPrompt(input, this.config);

    const progress = options?.progress;
    progress?.update(`Detected: ${input.type} (${input.scenarios.length} scenarios)`);

    // Check cache before calling LLM
    const cacheConfig = this.config.cache;
    let cacheKey: string | null = null;
    let cache: Cache | null = null;

    if (cacheConfig?.enabled) {
      cache = new Cache({ dir: cacheConfig.dir, ttlSeconds: cacheConfig.ttlSeconds });
      cacheKey = Cache.buildKey(
        content,
        this.config.provider.model || 'default',
        outputFormat,
        this.config.output.style,
        this.config.options.temperature,
      );

      const cached = cache.get(cacheKey);
      if (cached) {
        const ageStr =
          cached.age < 3600000
            ? `${Math.round(cached.age / 60000)}m ago`
            : `${Math.round(cached.age / 3600000)}h ago`;
        progress?.done(`Using cached response (${ageStr})`);

        const generatedCode = extractFirstCodeBlock(cached.response);
        const slug = input.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .substring(0, 40);
        const file = output.createFile(slug, generatedCode);
        const dir = outputDir || this.config.output.dir;
        if (dir) output.write([file], dir);

        return {
          format: outputFormat,
          files: [file],
          summary: {
            totalTests: this.countTests(generatedCode, outputFormat),
            totalScenarios: input.scenarios.length,
            format: outputFormat,
          },
        };
      }
    }

    progress?.update(`Calling ${this.config.provider.type}...`);

    let response;
    if (options?.stream) {
      progress?.stop(); // Stop spinner before streaming tokens
      response = await this.provider.stream(userPrompt, {
        systemPrompt,
        temperature: this.config.options.temperature,
        maxTokens: this.config.options.maxTokens,
        onToken: (token) => progress?.stream(token),
      });
      process.stderr.write('\n'); // Newline after streamed output
    } else {
      response = await this.provider.call(userPrompt, {
        systemPrompt,
        temperature: this.config.options.temperature,
        maxTokens: this.config.options.maxTokens,
      });
    }

    progress?.start('Writing files...');

    logger.info(`LLM response: ${response.tokens.output} tokens, ${response.latencyMs}ms`);

    // Save to cache after successful LLM call
    if (cache && cacheKey) {
      cache.set(cacheKey, response.text, { model: response.model, tokens: response.tokens });
    }

    const generatedCode = extractFirstCodeBlock(response.text);
    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 40);
    const file = output.createFile(slug, generatedCode);

    const dir = outputDir || this.config.output.dir;
    if (dir) {
      output.write([file], dir);
    }

    return {
      format: outputFormat,
      files: [file],
      summary: {
        totalTests: this.countTests(generatedCode, outputFormat),
        totalScenarios: input.scenarios.length,
        format: outputFormat,
      },
    };
  }

  detectAndParse(content: string): ParsedInput {
    if (this.openApiParser.canParse(content)) {
      return this.openApiParser.parse(content);
    }
    if (this.storyParser.canParse(content)) {
      return this.storyParser.parse(content);
    }
    if (this.prdParser.canParse(content)) {
      return this.prdParser.parse(content);
    }

    // Fallback to PRD parser
    return this.prdParser.parse(content);
  }

  private getTemplate(format: OutputFormat): BaseTemplate {
    switch (format) {
      case 'playwright':
        return new PlaywrightTemplate();
      case 'api':
        return new ApiTemplate();
      case 'gherkin':
        return new GherkinTemplate();
      case 'markdown':
        return new MarkdownTemplate();
    }
  }

  private getOutput(format: OutputFormat): BaseOutput {
    switch (format) {
      case 'playwright':
      case 'api':
        return new PlaywrightOutput();
      case 'gherkin':
        return new GherkinOutput();
      case 'markdown':
        return new MarkdownOutput();
    }
  }

  private initProvider(): LLMProvider {
    const { type, apiKey, model, baseUrl } = this.config.provider;

    switch (type) {
      case 'anthropic':
        return new AnthropicProvider({ apiKey: apiKey || '', baseUrl, defaultModel: model });
      case 'custom':
        return new CustomProvider({
          endpoint: baseUrl || '',
          defaultModel: model,
          bodyTemplate: (prompt, opts) => ({
            model: opts?.model || model || 'default',
            messages: [
              ...(opts?.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
              { role: 'user', content: prompt },
            ],
            temperature: opts?.temperature ?? 0.2,
            max_tokens: opts?.maxTokens ?? 4096,
          }),
          parseResponse: (data: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = data as Record<string, any>;
            return {
              text: d?.choices?.[0]?.message?.content || d?.content?.[0]?.text || '',
              tokens: {
                input: d?.usage?.prompt_tokens || 0,
                output: d?.usage?.completion_tokens || 0,
              },
            };
          },
        });
      case 'openai':
      default:
        return new OpenAIProvider({ apiKey: apiKey || '', baseUrl, defaultModel: model });
    }
  }

  private countTests(code: string, format: OutputFormat): number {
    switch (format) {
      case 'playwright':
      case 'api': {
        const testMatches = code.match(/\btest\s*\(/g) || [];
        const itMatches = code.match(/\bit\s*\(/g) || [];
        return testMatches.length + itMatches.length;
      }
      case 'gherkin': {
        const matches = code.match(/\bScenario:/g) || [];
        return matches.length;
      }
      case 'markdown': {
        const matches = code.match(/\|.*\|/g) || [];
        return Math.max(matches.length - 1, 0); // Subtract header row
      }
    }
  }
}
