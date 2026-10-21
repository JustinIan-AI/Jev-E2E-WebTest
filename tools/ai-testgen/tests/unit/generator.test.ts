import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Generator, ContentTruncatedError } from '../../src/core/generator';
import { DEFAULT_CONFIG, GenConfig } from '../../src/core/types';
import { LLMProvider, LLMResponse, CallOptions, StreamOptions } from '../../src/providers/base.provider';
import { logger } from '../../src/utils/logger';

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

    it('should fall back to story parser with visible warning for malformed user story (issue #6)', () => {
      const content = 'As a registered user the system shows a dashboard after login.';
      const result = generator.detectAndParse(content) as ReturnType<
        typeof generator.detectAndParse
      > & { warnings?: { code: string; message: string }[] };
      expect(result.type).toBe('story');
      expect(result.scenarios).toHaveLength(1);
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0].code).toBe('STORY_FALLBACK_WHOLE_TEXT');
    });
  });

  describe('timeout passthrough (F3-3)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function buildGenerator(timeoutMs: number): {
      generator: Generator;
      fakeProvider: LLMProvider;
    } {
      const config: GenConfig = {
        ...DEFAULT_CONFIG,
        output: { ...DEFAULT_CONFIG.output, dir: '' },
        cache: { ...DEFAULT_CONFIG.cache!, enabled: false },
        options: { ...DEFAULT_CONFIG.options, timeoutMs },
      };
      const generator = new Generator(config);
      const fakeProvider = {
        name: 'fake',
        call: vi.fn().mockResolvedValue({
          text: '```ts\ntest("x", () => {});\n```',
          model: 'fake-model',
          tokens: { input: 1, output: 1 },
          latencyMs: 1,
        } satisfies LLMResponse),
        stream: vi.fn().mockResolvedValue({
          text: '```ts\ntest("x", () => {});\n```',
          model: 'fake-model',
          tokens: { input: 1, output: 1 },
          latencyMs: 1,
        } satisfies LLMResponse),
      };
      (generator as unknown as { provider: LLMProvider }).provider = fakeProvider;
      return { generator, fakeProvider };
    }

    const storyContent = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');

    it('passes config.options.timeoutMs to provider.call', async () => {
      const { generator, fakeProvider } = buildGenerator(45678);

      await generator.generateFromContent(storyContent, 'playwright', undefined, {
        stream: false,
      });

      const callMock = fakeProvider.call as ReturnType<typeof vi.fn>;
      expect(callMock).toHaveBeenCalledTimes(1);
      const options = callMock.mock.calls[0][1] as CallOptions;
      expect(options.timeout).toBe(45678);
    });

    it('passes config.options.timeoutMs to provider.stream', async () => {
      const { generator, fakeProvider } = buildGenerator(12321);

      await generator.generateFromContent(storyContent, 'playwright', undefined, {
        stream: true,
      });

      const streamMock = fakeProvider.stream as ReturnType<typeof vi.fn>;
      expect(streamMock).toHaveBeenCalledTimes(1);
      const options = streamMock.mock.calls[0][1] as StreamOptions;
      expect(options.timeout).toBe(12321);
    });
  });

  describe('content truncation (F3-4)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const codeText = '```ts\ntest("x", () => {});\n```';
    const storyContent = fs.readFileSync(path.join(FIXTURES, 'sample-stories.txt'), 'utf-8');

    function buildGenerator(
      maxTokens: number,
      response: Partial<LLMResponse> & Pick<LLMResponse, 'finishReason'>,
    ): { generator: Generator; dir: string; fakeProvider: LLMProvider } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-f3-4-'));
      const config: GenConfig = {
        ...DEFAULT_CONFIG,
        output: { ...DEFAULT_CONFIG.output, dir },
        cache: { ...DEFAULT_CONFIG.cache!, enabled: false },
        options: { ...DEFAULT_CONFIG.options, maxTokens },
      };
      const generator = new Generator(config);
      const fullResponse: LLMResponse = {
        text: codeText,
        model: 'fake-model',
        tokens: { input: 1, output: maxTokens },
        latencyMs: 1,
        ...response,
      };
      const fakeProvider = {
        name: 'fake',
        call: vi.fn().mockResolvedValue(fullResponse),
        stream: vi.fn().mockResolvedValue(fullResponse),
      };
      (generator as unknown as { provider: LLMProvider }).provider = fakeProvider;
      return { generator, dir, fakeProvider };
    }

    it('call with finish_reason=length throws ContentTruncatedError and writes no file', async () => {
      const { generator, dir } = buildGenerator(8192, { finishReason: 'length' });

      await expect(
        generator.generateFromContent(storyContent, 'playwright', undefined, { stream: false }),
      ).rejects.toBeInstanceOf(ContentTruncatedError);

      try {
        expect(fs.readdirSync(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('stream with finish_reason=length is detected and writes no file', async () => {
      const { generator, dir } = buildGenerator(8192, { finishReason: 'length' });

      await expect(
        generator.generateFromContent(storyContent, 'playwright', undefined, { stream: true }),
      ).rejects.toBeInstanceOf(ContentTruncatedError);

      try {
        expect(fs.readdirSync(dir)).toEqual([]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('finish_reason=stop writes the file and logs outputTokens/maxTokens', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const { generator, dir } = buildGenerator(8192, {
        finishReason: 'stop',
        tokens: { input: 1, output: 42 },
      });

      const result = await generator.generateFromContent(storyContent, 'playwright', undefined, {
        stream: false,
      });

      try {
        expect(result.files).toHaveLength(1);
        expect(fs.readdirSync(dir)).toHaveLength(1);
        expect(infoSpy).toHaveBeenCalled();
        const logged = infoSpy.mock.calls.map((c) => c[0]).join(' ');
        expect(logged).toContain('42');
        expect(logged).toContain('8192');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
