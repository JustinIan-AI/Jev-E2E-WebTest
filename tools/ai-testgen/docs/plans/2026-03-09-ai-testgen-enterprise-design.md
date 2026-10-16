# AI TestGen Enterprise Upgrade — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Approach:** Bottom-Up Fix (layer by layer on existing architecture)

---

## Goal

Make ai-testgen production-grade: demo-worthy for Upwork portfolio AND actually publishable as a working npm package. Full scope — all 3 providers (OpenAI, Anthropic, Custom), all 4 output formats (Playwright, API, Gherkin, Markdown).

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full (3 providers, 4 outputs) | Portfolio needs breadth |
| Streaming | Smart hybrid (spinner + LLM streaming) | Best UX |
| Caching | TTL content-hash cache (24h default) | Saves API cost, stale protection |
| Tests | Unit (mocked) + Integration (real API) | Proves it works, no snapshot maintenance |
| Retry | Exponential backoff (3 retries, 1→2→4s) | Industry standard, YAGNI on config |
| Architecture | Keep existing, fix gaps | Already clean, rewrite is overkill |

---

## Section 1: Bug Fixes & Dead Code Cleanup

1. **Anthropic API version** — `'2024-10-22'` → `'2023-06-01'`
2. **Anthropic default model** — `'claude-sonnet-4-6'` → `'claude-sonnet-4-5-20250514'`
3. **Remove duplicated `getOutput()`** — keep in generator, remove from CLI. Generator's `generate()` writes files too, not just creates.
4. **Remove dead code** — unused `TestScenario` type in types.ts, unused `buildPrompt()` export in utils/prompt.ts, unused `format` field on template subclasses
5. **Fix `clearTimeout` bug** — `try/finally` in providers so timer always clears
6. **Fix CustomProvider unreachable** — add `case 'custom'` in `initProvider()` switch
7. **CLI version** — read from package.json dynamically
8. **Story parser detection** — tighten from `\bGiven\b` to require structured user story patterns

---

## Section 2: Error Handling & Retry

### Global CLI error handler
- `program.parseAsync().catch()` — clean message to stderr, exit code 1

### API key pre-flight validation
- Check before LLM call: `"No API key configured. Set OPENAI_API_KEY environment variable or add apiKey to your config."`

### Exponential backoff retry
- New `src/utils/retry.ts`
- 3 retries, delays: 1s → 2s → 4s
- Retry on: 429, 500, 502, 503, 504
- Fail immediately on: 400, 401, 403
- Progress message: `"Rate limited, retrying in 2s... (attempt 2/3)"`

### Graceful errors
- File not found → `"Input file not found: requirements.md"`
- Malformed config → `"Invalid config file: expected JSON at line 5"`
- YAML parse error → `"Failed to parse OpenAPI spec: invalid YAML"`
- Empty LLM response → `"LLM returned empty response. Try increasing maxTokens or adjusting temperature."`
- `init` overwrite protection → check if exists, `--force` to overwrite

### Format validation
- Validate `--format` against known formats
- Unknown → `"Unknown format 'excel'. Supported: playwright, api, gherkin, markdown"`

---

## Section 3: Streaming & Progress

### Phase indicators (spinner)
- New `src/utils/progress.ts` — ora-style spinner on stderr
- Phases: `"Parsing input..."` → `"Building prompt..."` → `"Calling <provider>..."` → `"Writing files..."` → `"Done"`
- Non-TTY: plain log lines, no spinner

### LLM streaming
- OpenAI: `stream: true` → SSE tokens
- Anthropic: `stream: true` → `content_block_delta` events
- Custom: fallback to non-streaming
- Tokens print to stderr real-time
- `--no-stream` flag for CI/debugging

### Provider base class
- `BaseLLMProvider` gets `call()` (existing) and `stream()` (new, yields chunks)
- Generator checks TTY + `--no-stream` to decide

---

## Section 4: TTL Cache

- New `src/utils/cache.ts`
- Cache key: SHA-256 of `inputContent + model + format + style + temperature`
- Location: `.ai-testgen/cache/` (configurable)
- Entry: `{ response, createdAt, metadata }` as JSON, named by hash
- Default TTL: 24 hours, configurable via `cache.ttl`
- CLI flags: `--no-cache`, `--clear-cache`
- Flow: parse → compute key → hit? use cached : call LLM → save
- Print `"Using cached response (2h ago)"` on hit
- Lazy delete expired entries on read

---

## Section 5: Test Coverage

**Target: 80%+ coverage**

### New test areas
- **Providers** (mocked fetch): success, 401, 429+retry, 500+retry, timeout, empty response, streaming
- **Outputs**: correct file content, directory creation, overwrite behavior
- **CLI**: command parsing, format validation, error handler, exit codes
- **Error paths**: file not found, malformed config, empty response, missing API key
- **Cache**: hit, miss, TTL expiry, `--no-cache`, `--clear-cache`
- **Retry**: 3 attempts on 429, immediate fail on 401

### Integration tests (2-3, real API)
- OpenAI gpt-4o-mini: PRD → Playwright
- OpenAI gpt-4o-mini: OpenAPI → API test
- CI: `workflow_dispatch` only, skip if no API key
- Estimate: ~60-70 new tests on top of existing 40

---

## Section 6: CLI Polish

- Dynamic version from package.json
- `--dry-run` flag: show parsed input + prompt preview, no LLM call
- `--model` CLI flag: override config model
- `--verbose`: show token count, model, cost estimate, cache status
- Help examples in `--help` output
- Stderr for logs, stdout for output (pipeable)
- Exit codes: 0 success, 1 user error, 2 API error
- `validate` command: fix TS validation for Playwright (add types) or switch to structural checks

---

## Out of Scope

- Batch processing (multiple files in one run)
- `--stdin` support
- ESM dual-publish
- Monorepo / workspace setup
- Web UI / dashboard
- Cost tracking across runs (beyond per-run estimate in verbose mode)
