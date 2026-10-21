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
import { safeSlug } from '../utils/slug';
import { logger } from '../utils/logger';
import { Progress } from '../utils/progress';
import { Cache } from '../utils/cache';

/**
 * 模型因 max_tokens 上限被截断（finish_reason='length'）。
 * 此时产出为残缺内容，Generator 不写正式文件，直接抛错交由 CLI 提示。
 */
export class ContentTruncatedError extends Error {
  constructor(public readonly detail: { outputTokens: number; maxTokens: number }) {
    super(
      `LLM 输出在 ${detail.outputTokens} tokens 处因 max_tokens=${detail.maxTokens} 上限被截断，` +
        `未写入残缺文件。可用 --max-tokens <更大的值> 提高上限，或拆分输入后重试。`,
    );
    this.name = 'ContentTruncatedError';
  }
}

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
    return this.generateFromContent(content, format, outputDir, { ...options, sourceFilePath: filePath });
  }

  async generateFromContent(
    content: string,
    format?: OutputFormat,
    outputDir?: string,
    options?: { stream?: boolean; progress?: Progress; sourceFilePath?: string },
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
        const slug = safeSlug(input.title, options?.sourceFilePath);
        const file = output.createFile(slug, generatedCode);
        const dir = outputDir || this.config.output.dir;
        if (dir) {
          const written = output.write([file], dir);
          return {
            format: outputFormat,
            files: written,
            summary: {
              totalTests: this.countTests(generatedCode, outputFormat),
              totalScenarios: input.scenarios.length,
              format: outputFormat,
            },
          };
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
    }

    progress?.update(`Calling ${this.config.provider.type}...`);

    let response;
    if (options?.stream) {
      progress?.stop(); // Stop spinner before streaming tokens
      response = await this.provider.stream(userPrompt, {
        systemPrompt,
        temperature: this.config.options.temperature,
        maxTokens: this.config.options.maxTokens,
        timeout: this.config.options.timeoutMs,
        onToken: (token) => progress?.stream(token),
      });
      process.stderr.write('\n'); // Newline after streamed output
    } else {
      response = await this.provider.call(userPrompt, {
        systemPrompt,
        temperature: this.config.options.temperature,
        maxTokens: this.config.options.maxTokens,
        timeout: this.config.options.timeoutMs,
      });
    }

    progress?.start('Writing files...');

    logger.info(
      `LLM response: ${response.tokens.output} tokens (max_tokens=${this.config.options.maxTokens}), ${response.latencyMs}ms`,
    );

    const generatedCode = extractFirstCodeBlock(response.text);

    // 截断判定必须在写盘与入 cache 之前：残缺内容不落正式文件，也不污染缓存。
    if (response.finishReason === 'length') {
      throw new ContentTruncatedError({
        outputTokens: response.tokens.output,
        maxTokens: this.config.options.maxTokens,
      });
    }

    // Save to cache after successful, non-truncated LLM call
    if (cache && cacheKey) {
      cache.set(cacheKey, response.text, { model: response.model, tokens: response.tokens });
    }

    const slug = safeSlug(input.title, options?.sourceFilePath);
    const file = output.createFile(slug, generatedCode);

    const dir = outputDir || this.config.output.dir;
    if (dir) {
      const written = output.write([file], dir);
      return {
        format: outputFormat,
        files: written,
        summary: {
          totalTests: this.countTests(generatedCode, outputFormat),
          totalScenarios: input.scenarios.length,
          format: outputFormat,
        },
      };
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
    // 意图是用户故事（As a/an 开头）但严格语法提取为 0：
    // 仍交给 StoryParser 走整段文本 fallback，其显式 warning 可在 dry-run 中可见。
    if (this.storyParser.looksLikeStory(content)) {
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
