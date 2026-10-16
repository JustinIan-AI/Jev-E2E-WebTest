# AI TestGen Enterprise Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ai-testgen production-grade — fix broken providers, add error handling with retry, streaming output, TTL caching, and expand test coverage to 80%+.

**Architecture:** Bottom-up fix of existing clean architecture. No restructuring needed — the parser→template→provider→output pipeline is sound. We fix bugs first, add reliability layers (retry, error handling), then add features (streaming, caching), then expand tests, then polish CLI.

**Tech Stack:** TypeScript strict, Node.js 18+, vitest, Commander.js, native fetch with AbortController, crypto (SHA-256 for cache keys)

---

### Task 1: Fix Anthropic Provider — Wrong API Version & Model

**Files:**
- Modify: `src/providers/anthropic.provider.ts:25,52`
- Test: `tests/unit/providers.test.ts` (create)

**Step 1: Write the failing test**

Create `tests/unit/providers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.provider';

describe('AnthropicProvider', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use correct API version header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'test response' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    await provider.call('hello');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('should use correct default model', () => {
    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    // Access via a call to verify model is sent correctly
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-5-20250514',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    });

    return provider.call('hello').then(() => {
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4-5-20250514');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: FAIL — `'2024-10-22'` does not equal `'2023-06-01'`

**Step 3: Fix the Anthropic provider**

In `src/providers/anthropic.provider.ts`:
- Line 25: change `'claude-sonnet-4-6'` → `'claude-sonnet-4-5-20250514'`
- Line 52: change `'2024-10-22'` → `'2023-06-01'`

**Step 4: Run test to verify it passes**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/providers/anthropic.provider.ts tests/unit/providers.test.ts
git commit -m "fix: correct Anthropic API version header and default model"
```

---

### Task 2: Fix clearTimeout Bug in All Providers

**Files:**
- Modify: `src/providers/openai.provider.ts:42-59`
- Modify: `src/providers/anthropic.provider.ts:43-64`
- Modify: `src/providers/custom.provider.ts:37-53`
- Test: `tests/unit/providers.test.ts` (append)

**Step 1: Write the failing test**

Append to `tests/unit/providers.test.ts`:

```typescript
import { OpenAIProvider } from '../../src/providers/openai.provider';

describe('OpenAIProvider', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clear timeout even when API returns error', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });

    await expect(provider.call('hello')).rejects.toThrow('OpenAI API error (400)');
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: FAIL — clearTimeout not called on error path

**Step 3: Fix all three providers with try/finally**

In `src/providers/openai.provider.ts`, replace the `timedCall` block (lines 45-59):

```typescript
    const { result, latencyMs } = await this.timedCall(async () => {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`OpenAI API error (${response.status}): ${error}`);
        }
        return response.json() as Promise<OpenAIResponse>;
      } finally {
        clearTimeout(timer);
      }
    });
```

Apply same `try/finally` pattern to `src/providers/anthropic.provider.ts` (lines 46-64) and `src/providers/custom.provider.ts` (lines 40-53).

**Step 4: Run test to verify it passes**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/providers/openai.provider.ts src/providers/anthropic.provider.ts src/providers/custom.provider.ts tests/unit/providers.test.ts
git commit -m "fix: clear timeout on error path in all providers"
```

---

### Task 3: Remove Dead Code & Fix Duplicated getOutput

**Files:**
- Modify: `src/core/types.ts:52-58` (remove TestScenario)
- Modify: `src/utils/prompt.ts:22-27` (remove buildPrompt)
- Modify: `src/index.ts:19,50` (remove TestScenario and buildPrompt exports)
- Modify: `src/core/generator.ts:33-73` (generator writes files too)
- Modify: `src/cli.ts:11-13,48-49,148-158` (remove duplicated getOutput, use generator)

**Step 1: Remove dead code**

In `src/core/types.ts`, delete lines 52-58 (the `TestScenario` interface).

In `src/utils/prompt.ts`, delete lines 22-27 (the `buildPrompt` function).

In `src/index.ts`:
- Line 19: remove `TestScenario` from the types export
- Line 50: change to `export { extractCodeBlocks, extractFirstCodeBlock } from './utils/prompt';`

**Step 2: Update Generator to accept outputDir and write files**

In `src/core/generator.ts`, update `generate()` method signature and body:

```typescript
  async generate(filePath: string, format?: OutputFormat, outputDir?: string): Promise<GeneratedOutput> {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this.generateFromContent(content, format, outputDir);
  }

  async generateFromContent(content: string, format?: OutputFormat, outputDir?: string): Promise<GeneratedOutput> {
    const input = this.detectAndParse(content);
    const outputFormat = format || this.config.output.format;
    const template = this.getTemplate(outputFormat);
    const output = this.getOutput(outputFormat);

    logger.info(`Detected input type: ${input.type} (${input.scenarios.length} scenarios)`);
    logger.info(`Generating ${outputFormat} tests...`);

    const { systemPrompt, userPrompt } = template.buildPrompt(input, this.config);

    const response = await this.provider.call(userPrompt, {
      systemPrompt,
      temperature: this.config.options.temperature,
      maxTokens: this.config.options.maxTokens,
    });

    logger.info(`LLM response: ${response.tokens.output} tokens, ${response.latencyMs}ms`);

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
```

**Step 3: Simplify CLI — remove duplicate getOutput**

In `src/cli.ts`:
- Remove imports: `PlaywrightOutput`, `GherkinOutput`, `MarkdownOutput` (lines 11-13)
- Remove the `getOutput` function (lines 148-158)
- In `generate` action (line 46-53), replace:
  ```typescript
  const result = await generator.generate(file, options.format as OutputFormat, config.output.dir);
  console.log(`\nGenerated ${result.summary.totalTests} tests in ${result.files.length} file(s)`);
  console.log(`Format: ${result.format}`);
  console.log(`Output: ${config.output.dir}`);
  ```
- Apply same simplification to `from-spec` (line 71-74) and `plan` (line 94-97) actions

**Step 4: Run all tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All existing tests PASS (some may need minor adjustments if they import TestScenario or buildPrompt)

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/core/types.ts src/utils/prompt.ts src/index.ts src/core/generator.ts src/cli.ts
git commit -m "refactor: remove dead code, consolidate file writing in generator"
```

---

### Task 4: Fix CustomProvider Unreachable + Story Parser Detection

**Files:**
- Modify: `src/core/generator.ts:115-125` (add custom case)
- Modify: `src/parsers/story.parser.ts:16-18` (tighten canParse)
- Test: `tests/unit/generator.test.ts` (append)
- Test: `tests/unit/parsers.test.ts` (append)

**Step 1: Write failing tests**

Append to `tests/unit/generator.test.ts`:

```typescript
it('should not classify PRD with "Given the requirements" as user story', () => {
  const content = `# Login Feature PRD

## Requirements
Given the requirements above, the system should authenticate users.

## Acceptance Criteria
- User can log in with email and password
`;
  const result = generator.detectAndParse(content);
  expect(result.type).toBe('prd');
});
```

Append to `tests/unit/parsers.test.ts`:

```typescript
describe('StoryParser - canParse', () => {
  it('should not match casual use of "Given" in a PRD', () => {
    const parser = new StoryParser();
    const content = 'Given the complexity of the system, we need to test edge cases.';
    expect(parser.canParse(content)).toBe(false);
  });

  it('should match structured "As a" user story', () => {
    const parser = new StoryParser();
    const content = 'As a user, I want to log in, so that I can access my dashboard.';
    expect(parser.canParse(content)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/generator.test.ts tests/unit/parsers.test.ts`
Expected: FAIL — PRD with "Given" gets classified as story

**Step 3: Fix story parser detection**

In `src/parsers/story.parser.ts`, replace `canParse` (line 16-18):

```typescript
  canParse(content: string): boolean {
    const hasAsA = /\bAs an?\s+.+?,\s*I want\b/i.test(content);
    const hasStructuredGWT =
      /\bGiven\b/i.test(content) &&
      /\bWhen\b/i.test(content) &&
      /\bThen\b/i.test(content) &&
      /\bScenario[:\s]/i.test(content);
    return hasAsA || hasStructuredGWT;
  }
```

**Step 4: Fix CustomProvider in generator**

In `src/core/generator.ts`, update `initProvider()`:

```typescript
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
          parseResponse: (data: any) => ({
            text: data?.choices?.[0]?.message?.content || data?.content?.[0]?.text || '',
            tokens: { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 },
          }),
        });
      case 'openai':
      default:
        return new OpenAIProvider({ apiKey: apiKey || '', baseUrl, defaultModel: model });
    }
  }
```

Add import at top of generator.ts:
```typescript
import { CustomProvider } from '../providers/custom.provider';
```

**Step 5: Run tests to verify they pass**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
cd /tmp/ai-testgen
git add src/core/generator.ts src/parsers/story.parser.ts tests/unit/generator.test.ts tests/unit/parsers.test.ts
git commit -m "fix: make CustomProvider reachable, tighten story parser detection"
```

---

### Task 5: Add Retry Utility with Exponential Backoff

**Files:**
- Create: `src/utils/retry.ts`
- Test: `tests/unit/retry.test.ts` (create)

**Step 1: Write the failing test**

Create `tests/unit/retry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry, RetryableError } from '../../src/utils/retry';

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on 429 and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('Rate limited', 429))
      .mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 500 and succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('Server error', 500))
      .mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on 401', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('Unauthorized', 401));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should NOT retry on 400', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('Bad request', 400));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should exhaust retries and throw last error', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new RetryableError('Rate limited', 429));

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('Rate limited');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('should use exponential backoff delays', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: Function, ms: number) => {
      delays.push(ms);
      return originalSetTimeout(fn, 0); // Execute immediately in tests
    }) as any);

    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('Rate limited', 429))
      .mockRejectedValueOnce(new RetryableError('Rate limited', 429))
      .mockResolvedValue('success');

    await withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });

    // Backoff: 100ms, 200ms (ignore any AbortController timeouts by checking only retry delays)
    const retryDelays = delays.filter(d => d >= 100);
    expect(retryDelays[0]).toBe(100);
    expect(retryDelays[1]).toBe(200);
  });

  it('should retry non-RetryableError (network failures)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('success');

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/retry.test.ts`
Expected: FAIL — module not found

**Step 3: Implement retry utility**

Create `src/utils/retry.ts`:

```typescript
import { logger } from './logger';

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

export class RetryableError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableError) {
    if (error.statusCode && NON_RETRYABLE_STATUS_CODES.has(error.statusCode)) {
      return false;
    }
    if (error.statusCode && RETRYABLE_STATUS_CODES.has(error.statusCode)) {
      return true;
    }
  }
  // Network errors (no statusCode) are retryable
  return !(error instanceof RetryableError);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries || !isRetryable(err)) {
        throw lastError;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);

      if (options?.onRetry) {
        options.onRetry(attempt + 1, lastError, delayMs);
      } else {
        logger.warn(`Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms: ${lastError.message}`);
      }

      await delay(delayMs);
    }
  }

  throw lastError;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/retry.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/utils/retry.ts tests/unit/retry.test.ts
git commit -m "feat: add exponential backoff retry utility"
```

---

### Task 6: Integrate Retry into Providers + API Key Validation

**Files:**
- Modify: `src/providers/base.provider.ts` (add apiKey validation, integrate retry)
- Modify: `src/providers/openai.provider.ts` (use retry, throw RetryableError)
- Modify: `src/providers/anthropic.provider.ts` (use retry, throw RetryableError)
- Modify: `src/providers/custom.provider.ts` (use retry, throw RetryableError)
- Test: `tests/unit/providers.test.ts` (expand)

**Step 1: Write failing tests**

Append to `tests/unit/providers.test.ts`:

```typescript
describe('OpenAIProvider - retry', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw on missing API key', async () => {
    const provider = new OpenAIProvider({ apiKey: '' });
    await expect(provider.call('hello')).rejects.toThrow(/API key/i);
  });

  it('should retry on 429 and succeed', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limited' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'response' } }],
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('response');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT retry on 401', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' });

    const provider = new OpenAIProvider({ apiKey: 'bad-key' });
    await expect(provider.call('hello')).rejects.toThrow('401');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('AnthropicProvider - retry', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw on missing API key', async () => {
    const provider = new AnthropicProvider({ apiKey: '' });
    await expect(provider.call('hello')).rejects.toThrow(/API key/i);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: FAIL — no API key validation, no retry

**Step 3: Update providers**

In `src/providers/base.provider.ts`, add a `validateApiKey` method:

```typescript
export abstract class BaseLLMProvider implements LLMProvider {
  abstract name: string;
  abstract call(prompt: string, options?: CallOptions): Promise<LLMResponse>;

  protected validateApiKey(apiKey: string): void {
    if (!apiKey || apiKey.startsWith('$')) {
      throw new Error(
        `No API key configured for ${this.name}. Set ${this.name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} environment variable or add apiKey to your config.`,
      );
    }
  }

  protected async timedCall<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
    const start = performance.now();
    const result = await fn();
    const latencyMs = Math.round(performance.now() - start);
    return { result, latencyMs };
  }
}
```

In `src/providers/openai.provider.ts`, wrap the fetch call with retry:

```typescript
import { withRetry, RetryableError } from '../utils/retry';

// Inside call() method, at the very start:
this.validateApiKey(this.apiKey);

// Replace the throw inside the timedCall with RetryableError:
if (!response.ok) {
  const error = await response.text();
  throw new RetryableError(`OpenAI API error (${response.status}): ${error}`, response.status);
}

// Wrap the entire timedCall in withRetry:
const { result, latencyMs } = await withRetry(
  () => this.timedCall(async () => { ... }),
  { maxRetries: 3, baseDelayMs: 1000 },
).then(r => r); // withRetry wraps the timedCall result
```

Actually, cleaner approach — wrap at the `call()` method level. The full `call()` method for OpenAI becomes:

```typescript
  async call(prompt: string, options?: CallOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);

    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || 60000;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 4096,
    };

    return withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const { result, latencyMs } = await this.timedCall(async () => {
        try {
          const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const error = await response.text();
            throw new RetryableError(`OpenAI API error (${response.status}): ${error}`, response.status);
          }
          return response.json() as Promise<OpenAIResponse>;
        } finally {
          clearTimeout(timer);
        }
      });

      return {
        text: result.choices?.[0]?.message?.content || '',
        model: result.model || model,
        tokens: { input: result.usage?.prompt_tokens || 0, output: result.usage?.completion_tokens || 0 },
        latencyMs,
        raw: result,
      };
    }, { maxRetries: 3, baseDelayMs: 1000 });
  }
```

Apply same pattern to Anthropic and Custom providers.

**Step 4: Run tests to verify they pass**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/providers/base.provider.ts src/providers/openai.provider.ts src/providers/anthropic.provider.ts src/providers/custom.provider.ts src/utils/retry.ts tests/unit/providers.test.ts
git commit -m "feat: add API key validation and retry with backoff to all providers"
```

---

### Task 7: Add Global CLI Error Handler + Format Validation

**Files:**
- Modify: `src/cli.ts` (global error handler, format validation, dynamic version)
- Test: `tests/unit/cli.test.ts` (create)

**Step 1: Write failing tests**

Create `tests/unit/cli.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { OutputFormat } from '../../src/core/types';

// Test the format validation helper
const VALID_FORMATS: OutputFormat[] = ['playwright', 'api', 'gherkin', 'markdown'];

function validateFormat(format: string): format is OutputFormat {
  return VALID_FORMATS.includes(format as OutputFormat);
}

describe('CLI helpers', () => {
  it('should accept valid formats', () => {
    expect(validateFormat('playwright')).toBe(true);
    expect(validateFormat('api')).toBe(true);
    expect(validateFormat('gherkin')).toBe(true);
    expect(validateFormat('markdown')).toBe(true);
  });

  it('should reject invalid formats', () => {
    expect(validateFormat('excel')).toBe(false);
    expect(validateFormat('json')).toBe(false);
    expect(validateFormat('')).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes (helper is inline)**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/cli.test.ts`
Expected: PASS (this test defines the contract we'll implement)

**Step 3: Update CLI**

In `src/cli.ts`:

1. Dynamic version — replace `.version('1.0.0')` with:
```typescript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// Or for CommonJS:
const pkg = require('../package.json');
program.version(pkg.version);
```

Actually, since this is CommonJS (tsconfig module is CommonJS), simpler:
```typescript
// At top of file, after other imports:
import * as path from 'path';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

// Then:
.version(pkg.version);
```

2. Format validation — add before each action:
```typescript
const VALID_FORMATS = ['playwright', 'api', 'gherkin', 'markdown'];

function validateFormat(format: string): format is OutputFormat {
  if (!VALID_FORMATS.includes(format)) {
    console.error(`Unknown format '${format}'. Supported: ${VALID_FORMATS.join(', ')}`);
    process.exit(1);
  }
  return true;
}
```

Call `validateFormat(options.format)` at the start of the `generate` action.

3. Global error handler — replace `program.parse()` with:
```typescript
program.parseAsync().catch((err: Error) => {
  if (err.message.includes('API key')) {
    console.error(`\nConfiguration error: ${err.message}`);
    process.exit(1);
  } else if (err.message.includes('ENOENT')) {
    const match = err.message.match(/ENOENT.*?'(.+?)'/);
    console.error(`\nFile not found: ${match?.[1] || 'unknown'}`);
    process.exit(1);
  } else {
    console.error(`\nError: ${err.message}`);
    process.exit(2);
  }
});
```

4. Init overwrite protection:
```typescript
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
```

**Step 4: Run all tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/cli.ts tests/unit/cli.test.ts
git commit -m "feat: global CLI error handler, format validation, dynamic version"
```

---

### Task 8: Add Progress Spinner Utility

**Files:**
- Create: `src/utils/progress.ts`
- Test: `tests/unit/progress.test.ts` (create)

**Step 1: Write the failing test**

Create `tests/unit/progress.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Progress } from '../../src/utils/progress';

describe('Progress', () => {
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start and stop a spinner phase', () => {
    const progress = new Progress();
    progress.start('Parsing input...');
    progress.stop();
    expect(stderrWrite).toHaveBeenCalled();
  });

  it('should update phase text', () => {
    const progress = new Progress();
    progress.start('Phase 1');
    progress.update('Phase 2');
    progress.stop();
    expect(stderrWrite).toHaveBeenCalled();
  });

  it('should show done message', () => {
    const progress = new Progress();
    progress.start('Working...');
    progress.done('Complete');
    const allCalls = stderrWrite.mock.calls.map(c => c[0]).join('');
    expect(allCalls).toContain('Complete');
  });

  it('should use plain text in non-TTY', () => {
    const origIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });

    const progress = new Progress();
    progress.start('Working...');
    progress.stop();

    Object.defineProperty(process.stderr, 'isTTY', { value: origIsTTY, configurable: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/progress.test.ts`
Expected: FAIL — module not found

**Step 3: Implement progress spinner**

Create `src/utils/progress.ts`:

```typescript
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Progress {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message = '';
  private isTTY: boolean;

  constructor() {
    this.isTTY = !!process.stderr.isTTY;
  }

  start(message: string): void {
    this.message = message;
    if (this.isTTY) {
      this.interval = setInterval(() => {
        const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
        process.stderr.write(`\r${frame} ${this.message}`);
        this.frameIndex++;
      }, 80);
    } else {
      process.stderr.write(`${message}\n`);
    }
  }

  update(message: string): void {
    this.message = message;
    if (!this.isTTY) {
      process.stderr.write(`${message}\n`);
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.isTTY) {
      process.stderr.write('\r\x1b[K'); // Clear line
    }
  }

  done(message: string): void {
    this.stop();
    process.stderr.write(`${this.isTTY ? '\r\x1b[K' : ''}✓ ${message}\n`);
  }

  stream(token: string): void {
    process.stderr.write(token);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/progress.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/utils/progress.ts tests/unit/progress.test.ts
git commit -m "feat: add progress spinner utility with TTY detection"
```

---

### Task 9: Add Streaming to Providers

**Files:**
- Modify: `src/providers/base.provider.ts` (add stream method to interface)
- Modify: `src/providers/openai.provider.ts` (add stream method)
- Modify: `src/providers/anthropic.provider.ts` (add stream method)
- Test: `tests/unit/providers.test.ts` (expand with streaming tests)

**Step 1: Write failing tests**

Append to `tests/unit/providers.test.ts`:

```typescript
describe('OpenAIProvider - streaming', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should yield tokens from SSE stream', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const chunks: string[] = [];

    const result = await provider.stream('hello', {
      onToken: (token) => chunks.push(token),
    });

    expect(chunks.join('')).toBe('Hello world!');
    expect(result.text).toBe('Hello world!');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: FAIL — `provider.stream` is not a function

**Step 3: Add streaming interface and implementations**

In `src/providers/base.provider.ts`, add to the interface and base class:

```typescript
export interface StreamOptions extends CallOptions {
  onToken?: (token: string) => void;
}

export interface LLMProvider {
  name: string;
  call(prompt: string, options?: CallOptions): Promise<LLMResponse>;
  stream(prompt: string, options?: StreamOptions): Promise<LLMResponse>;
}

export abstract class BaseLLMProvider implements LLMProvider {
  abstract name: string;
  abstract call(prompt: string, options?: CallOptions): Promise<LLMResponse>;

  // Default: fallback to non-streaming call
  async stream(prompt: string, options?: StreamOptions): Promise<LLMResponse> {
    return this.call(prompt, options);
  }

  // ... rest stays
}
```

In `src/providers/openai.provider.ts`, add `stream()` method:

```typescript
  async stream(prompt: string, options?: StreamOptions): Promise<LLMResponse> {
    this.validateApiKey(this.apiKey);

    const model = options?.model || this.defaultModel;
    const timeout = options?.timeout || 120000;

    const body = {
      model,
      messages: [
        ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0.2,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const start = performance.now();
    let fullText = '';
    let tokens = { input: 0, output: 0 };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new RetryableError(`OpenAI API error (${response.status}): ${error}`, response.status);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              options?.onToken?.(content);
            }
            if (data.usage) {
              tokens = {
                input: data.usage.prompt_tokens || 0,
                output: data.usage.completion_tokens || 0,
              };
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }

    return {
      text: fullText,
      model,
      tokens,
      latencyMs: Math.round(performance.now() - start),
    };
  }
```

Add similar `stream()` method to `src/providers/anthropic.provider.ts` using Anthropic's SSE format (`event: content_block_delta`, `data: {"delta":{"text":"..."}}`).

**Step 4: Run tests to verify they pass**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/providers.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/providers/base.provider.ts src/providers/openai.provider.ts src/providers/anthropic.provider.ts tests/unit/providers.test.ts
git commit -m "feat: add streaming support to OpenAI and Anthropic providers"
```

---

### Task 10: Integrate Streaming + Progress into Generator and CLI

**Files:**
- Modify: `src/core/generator.ts` (add streaming mode)
- Modify: `src/cli.ts` (use Progress, add --no-stream and --dry-run flags)
- Modify: `src/index.ts` (export Progress)

**Step 1: Update Generator to support streaming**

In `src/core/generator.ts`, add a `generateWithProgress` method or update `generateFromContent` to accept a progress callback:

```typescript
import { Progress } from '../utils/progress';
import { StreamOptions } from '../providers/base.provider';

// Add to generateFromContent:
async generateFromContent(
  content: string,
  format?: OutputFormat,
  outputDir?: string,
  options?: { stream?: boolean; progress?: Progress },
): Promise<GeneratedOutput> {
  const progress = options?.progress;
  const input = this.detectAndParse(content);
  const outputFormat = format || this.config.output.format;
  const template = this.getTemplate(outputFormat);
  const output = this.getOutput(outputFormat);

  progress?.update(`Detected: ${input.type} (${input.scenarios.length} scenarios)`);

  const { systemPrompt, userPrompt } = template.buildPrompt(input, this.config);

  progress?.update(`Calling ${this.config.provider.type}...`);

  let response;
  if (options?.stream && this.provider.stream) {
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

  // ... rest of method stays the same
}
```

**Step 2: Update CLI to use progress and new flags**

In `src/cli.ts`, update the `generate` command:

```typescript
  .option('--no-stream', 'Disable streaming output')
  .option('--dry-run', 'Show parsed input and prompt without calling LLM')
  .option('--model <model>', 'Override LLM model')
```

In the action handler:

```typescript
  .action(async (file: string, options) => {
    if (options.verbose) setLogLevel('debug');
    validateFormat(options.format);

    const config = loadConfig(options.config);
    // ... existing config overrides ...
    if (options.model) config.provider.model = options.model;

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
    const result = await generator.generate(file, options.format as OutputFormat, config.output.dir, {
      stream: useStream,
      progress,
    });

    progress.done(`Generated ${result.summary.totalTests} tests in ${result.files.length} file(s)`);
    console.log(`Format: ${result.format}`);
    console.log(`Output: ${config.output.dir}`);
  });
```

**Step 3: Run all tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
cd /tmp/ai-testgen
git add src/core/generator.ts src/cli.ts src/index.ts
git commit -m "feat: integrate streaming and progress indicators into generator and CLI"
```

---

### Task 11: Add TTL Cache

**Files:**
- Create: `src/utils/cache.ts`
- Test: `tests/unit/cache.test.ts` (create)

**Step 1: Write failing tests**

Create `tests/unit/cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Cache } from '../../src/utils/cache';

describe('Cache', () => {
  let tmpDir: string;
  let cache: Cache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-cache-'));
    cache = new Cache({ dir: tmpDir, ttlSeconds: 3600 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null on cache miss', () => {
    const result = cache.get('nonexistent-key');
    expect(result).toBeNull();
  });

  it('should store and retrieve cached response', () => {
    cache.set('test-key', 'cached response', { model: 'gpt-4o-mini' });
    const result = cache.get('test-key');
    expect(result).not.toBeNull();
    expect(result!.response).toBe('cached response');
  });

  it('should return null for expired entries', () => {
    const expiredCache = new Cache({ dir: tmpDir, ttlSeconds: 0 });
    expiredCache.set('test-key', 'old response', {});

    // TTL is 0 seconds, so it should be expired immediately
    const result = expiredCache.get('test-key');
    expect(result).toBeNull();
  });

  it('should generate consistent cache keys from content', () => {
    const key1 = Cache.buildKey('content', 'gpt-4o-mini', 'playwright', 'descriptive', 0.2);
    const key2 = Cache.buildKey('content', 'gpt-4o-mini', 'playwright', 'descriptive', 0.2);
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different inputs', () => {
    const key1 = Cache.buildKey('content1', 'gpt-4o-mini', 'playwright', 'descriptive', 0.2);
    const key2 = Cache.buildKey('content2', 'gpt-4o-mini', 'playwright', 'descriptive', 0.2);
    expect(key1).not.toBe(key2);
  });

  it('should clear all cached entries', () => {
    cache.set('key1', 'response1', {});
    cache.set('key2', 'response2', {});
    cache.clear();

    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBeNull();
  });

  it('should delete expired entry on read', () => {
    const expiredCache = new Cache({ dir: tmpDir, ttlSeconds: 0 });
    expiredCache.set('test-key', 'old', {});

    // Read should return null AND delete the file
    expiredCache.get('test-key');
    const files = fs.readdirSync(tmpDir);
    expect(files.length).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/cache.test.ts`
Expected: FAIL — module not found

**Step 3: Implement cache**

Create `src/utils/cache.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from './logger';

interface CacheEntry {
  response: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

interface CacheConfig {
  dir: string;
  ttlSeconds: number;
}

export class Cache {
  private dir: string;
  private ttlMs: number;

  constructor(config: CacheConfig) {
    this.dir = config.dir;
    this.ttlMs = config.ttlSeconds * 1000;

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  static buildKey(
    content: string,
    model: string,
    format: string,
    style: string,
    temperature: number,
  ): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${content}|${model}|${format}|${style}|${temperature}`);
    return hash.digest('hex');
  }

  get(key: string): { response: string; metadata: Record<string, unknown>; age: number } | null {
    const filePath = path.join(this.dir, `${key}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(raw);
      const age = Date.now() - entry.createdAt;

      if (age > this.ttlMs) {
        // Lazy delete expired
        fs.unlinkSync(filePath);
        logger.debug(`Cache expired: ${key}`);
        return null;
      }

      logger.debug(`Cache hit: ${key} (${Math.round(age / 1000)}s old)`);
      return { response: entry.response, metadata: entry.metadata, age };
    } catch {
      return null;
    }
  }

  set(key: string, response: string, metadata: Record<string, unknown>): void {
    const entry: CacheEntry = {
      response,
      createdAt: Date.now(),
      metadata,
    };

    const filePath = path.join(this.dir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    logger.debug(`Cache saved: ${key}`);
  }

  clear(): void {
    if (!fs.existsSync(this.dir)) return;

    for (const file of fs.readdirSync(this.dir)) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.dir, file));
      }
    }
    logger.info('Cache cleared');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/cache.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/utils/cache.ts tests/unit/cache.test.ts
git commit -m "feat: add TTL content-hash cache utility"
```

---

### Task 12: Integrate Cache into Generator and CLI

**Files:**
- Modify: `src/core/types.ts` (add cache config to GenConfig)
- Modify: `src/core/generator.ts` (use cache before/after LLM call)
- Modify: `src/cli.ts` (add --no-cache, --clear-cache flags)

**Step 1: Add cache config to types**

In `src/core/types.ts`, add to `GenConfig`:

```typescript
export interface GenConfig {
  provider: { ... };
  output: { ... };
  options: { ... };
  cache?: {
    dir: string;
    ttlSeconds: number;
    enabled: boolean;
  };
}

export const DEFAULT_CONFIG: GenConfig = {
  // ... existing ...
  cache: {
    dir: '.ai-testgen/cache',
    ttlSeconds: 86400, // 24 hours
    enabled: true,
  },
};
```

**Step 2: Use cache in generator**

In `src/core/generator.ts`, in `generateFromContent`:

```typescript
import { Cache } from '../utils/cache';

// After building prompt, before calling provider:
const cacheKey = this.config.cache?.enabled
  ? Cache.buildKey(content, this.config.provider.model || 'default', outputFormat, this.config.output.style, this.config.options.temperature)
  : null;

if (cacheKey && this.config.cache?.enabled) {
  const cache = new Cache({ dir: this.config.cache.dir, ttlSeconds: this.config.cache.ttlSeconds });
  const cached = cache.get(cacheKey);
  if (cached) {
    const ageStr = cached.age < 3600000
      ? `${Math.round(cached.age / 60000)}m ago`
      : `${Math.round(cached.age / 3600000)}h ago`;
    progress?.done(`Using cached response (${ageStr})`);
    // Use cached.response as the LLM response text
    // Skip the provider call, proceed to create files
    const generatedCode = extractFirstCodeBlock(cached.response);
    // ... create file and return
  }
}

// After successful LLM call, save to cache:
if (cacheKey && this.config.cache?.enabled) {
  const cache = new Cache({ dir: this.config.cache.dir, ttlSeconds: this.config.cache.ttlSeconds });
  cache.set(cacheKey, response.text, { model: response.model, tokens: response.tokens });
}
```

**Step 3: Add CLI flags**

In `src/cli.ts`, add to generate command:

```typescript
.option('--no-cache', 'Bypass response cache')
.option('--clear-cache', 'Clear all cached responses')
```

In the action:

```typescript
if (options.clearCache) {
  const cache = new Cache({ dir: config.cache?.dir || '.ai-testgen/cache', ttlSeconds: 0 });
  cache.clear();
  console.log('Cache cleared.');
  if (!file) return; // If only clearing cache
}

if (options.cache === false) {
  config.cache = { ...config.cache!, enabled: false };
}
```

**Step 4: Run all tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add src/core/types.ts src/core/generator.ts src/cli.ts
git commit -m "feat: integrate TTL cache into generator and CLI"
```

---

### Task 13: Expand Test Coverage — Output Writers

**Files:**
- Create: `tests/unit/outputs.test.ts`

**Step 1: Write tests**

Create `tests/unit/outputs.test.ts`:

```typescript
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
```

**Step 2: Run tests**

Run: `cd /tmp/ai-testgen && npx vitest run tests/unit/outputs.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
cd /tmp/ai-testgen
git add tests/unit/outputs.test.ts
git commit -m "test: add output writer tests"
```

---

### Task 14: Expand Test Coverage — Config and Error Paths

**Files:**
- Modify: `tests/unit/config.test.ts` (expand)
- Create: `tests/unit/error-paths.test.ts`

**Step 1: Expand config tests**

Add to `tests/unit/config.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, writeDefaultConfig } from '../../src/core/config';

describe('loadConfig - edge cases', () => {
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
    fs.writeFileSync(configPath, JSON.stringify({ provider: { type: 'openai', apiKey: '$OPENAI_API_KEY' } }));

    const origEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';

    const config = loadConfig(configPath);
    expect(config.provider.apiKey).toBe('test-openai-key');

    process.env.OPENAI_API_KEY = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('writeDefaultConfig', () => {
  it('should write valid JSON config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-cfg-'));
    const configPath = path.join(tmpDir, 'config.json');
    writeDefaultConfig(configPath);

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.provider.type).toBe('openai');
    expect(config.provider.apiKey).toBe('$OPENAI_API_KEY');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

**Step 2: Create error paths test**

Create `tests/unit/error-paths.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.provider';
import { AnthropicProvider } from '../../src/providers/anthropic.provider';

describe('Error paths', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('OpenAI: should include status code in error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('403');
  });

  it('OpenAI: should handle empty response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('');
  });

  it('Anthropic: should handle missing content in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [], model: 'test', usage: {} }),
    });

    const provider = new AnthropicProvider({ apiKey: 'test-key' });
    const result = await provider.call('hello');
    expect(result.text).toBe('');
  });

  it('OpenAI: should handle network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const provider = new OpenAIProvider({ apiKey: 'test-key' });
    await expect(provider.call('hello')).rejects.toThrow('fetch failed');
  });
});
```

**Step 3: Run tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
cd /tmp/ai-testgen
git add tests/unit/config.test.ts tests/unit/error-paths.test.ts
git commit -m "test: expand config and error path test coverage"
```

---

### Task 15: Add Integration Tests (Real API)

**Files:**
- Create: `tests/integration/openai.test.ts`
- Modify: `package.json` (add test:integration script)

**Step 1: Create integration test**

Create `tests/integration/openai.test.ts`:

```typescript
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
  };

  it('should generate Playwright tests from a PRD', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testgen-int-'));
    const inputFile = path.join(tmpDir, 'login.md');
    fs.writeFileSync(inputFile, `# Login Feature

## Requirements
- Users can log in with email and password
- Invalid credentials show an error message
- Successful login redirects to dashboard
`);

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
    fs.writeFileSync(inputFile, `openapi: "3.0.0"
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
`);

    const generator = new Generator(config);
    const result = await generator.generate(inputFile, 'api', tmpDir);

    expect(result.files.length).toBeGreaterThan(0);
    expect(result.summary.totalTests).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 30000);
});
```

**Step 2: Add script to package.json**

In `package.json`, add to scripts:

```json
"test:integration": "vitest run tests/integration/"
```

**Step 3: Run integration tests (only if API key available)**

Run: `cd /tmp/ai-testgen && OPENAI_API_KEY=$OPENAI_API_KEY npx vitest run tests/integration/`
Expected: PASS (or SKIP if no key)

**Step 4: Run all unit tests to verify nothing broke**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/ai-testgen
git add tests/integration/openai.test.ts package.json
git commit -m "test: add integration tests for OpenAI provider (real API)"
```

---

### Task 16: CLI Polish — Help Examples, Stderr Logging, --verbose Enhancements

**Files:**
- Modify: `src/cli.ts` (help examples, stderr for logs)
- Modify: `src/utils/logger.ts` (use stderr instead of stdout)
- Modify: `src/index.ts` (export new utilities)

**Step 1: Fix logger to use stderr**

In `src/utils/logger.ts`, change `console.log` to `console.error` (writes to stderr):

```typescript
function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const prefix = `${COLORS[level]}[${level.toUpperCase()}]${RESET}`;
  if (data) {
    console.error(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`${prefix} ${message}`);
  }
}
```

**Step 2: Add help examples**

In `src/cli.ts`, after the init command, before `program.parseAsync()`:

```typescript
program.addHelpText('after', `
Examples:
  $ ai-testgen generate requirements.md --format playwright
  $ ai-testgen generate api-spec.yaml --format api --model gpt-4o
  $ ai-testgen generate stories.txt --format gherkin --style bdd
  $ ai-testgen generate spec.yaml --dry-run
  $ ai-testgen validate generated-tests/login.spec.ts
  $ ai-testgen init
`);
```

**Step 3: Enhance --verbose output**

In the generate action, after result is computed and when verbose is on:

```typescript
if (options.verbose) {
  logger.info('Details:', {
    model: result.summary.format,
    tests: result.summary.totalTests,
    scenarios: result.summary.totalScenarios,
    cached: false, // or true if from cache
  });
}
```

**Step 4: Update exports in index.ts**

Add new exports:

```typescript
export { Cache } from './utils/cache';
export { Progress } from './utils/progress';
export { withRetry, RetryableError } from './utils/retry';
```

**Step 5: Run all tests**

Run: `cd /tmp/ai-testgen && npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
cd /tmp/ai-testgen
git add src/cli.ts src/utils/logger.ts src/index.ts
git commit -m "feat: CLI polish — help examples, stderr logging, enhanced verbose output"
```

---

### Task 17: Update README and Final Verification

**Files:**
- Modify: `README.md` (document new features)
- Run: full build + lint + format + typecheck + tests

**Step 1: Update README sections**

Add to README after Quick Start:

1. **New CLI flags section** documenting `--no-stream`, `--dry-run`, `--model`, `--no-cache`, `--clear-cache`
2. **Caching section** explaining TTL cache behavior
3. **Streaming section** explaining smart hybrid output
4. **Error handling section** explaining retry behavior
5. Update test count in Demo section

**Step 2: Full verification**

Run all checks:

```bash
cd /tmp/ai-testgen
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Expected: All PASS, zero errors

**Step 3: Commit**

```bash
cd /tmp/ai-testgen
git add README.md
git commit -m "docs: update README with caching, streaming, retry, and new CLI flags"
```

---

### Task 18: Force Push and Create Release

**Step 1: Push to GitHub**

```bash
cd /tmp/ai-testgen
git push --force origin main
```

**Step 2: Delete old release and create new one**

```bash
cd /tmp/ai-testgen
gh release delete v1.0.0 --yes 2>/dev/null
gh release create v2.0.0 --title "v2.0.0" --notes "..."
```

Release notes should list all new features: streaming, caching, retry, error handling, expanded tests.

**Step 3: Verify on GitHub**

Check that CI passes, README renders correctly, release is visible.
