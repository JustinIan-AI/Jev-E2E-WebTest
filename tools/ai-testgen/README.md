# AI TestGen

[![CI](https://github.com/mustafaautomation/ai-testgen/actions/workflows/ci.yml/badge.svg)](https://github.com/mustafaautomation/ai-testgen/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](Dockerfile)

AI-powered test case generator that transforms PRDs, OpenAPI specs, and user stories into Playwright tests, API tests, Gherkin features, or Markdown test plans. Provider-agnostic — works with OpenAI, Anthropic, or any custom LLM endpoint.

---

## Table of Contents

- [Why?](#why)
- [Demo](#demo)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [CLI Commands](#cli-commands)
- [Input Format Detection](#input-format-detection)
- [Configuration](#configuration)
- [Caching](#caching)
- [Streaming](#streaming)
- [Error Handling](#error-handling)
- [Programmatic API](#programmatic-api)
- [Provider Support](#provider-support)
- [CI/CD Integration](#cicd-integration)
- [Project Structure](#project-structure)
- [Development](#development)

---

## Why?

42% of testers struggle to write automation scripts. AI TestGen bridges the gap by generating structured, runnable test cases from natural-language requirements — no prompt engineering required.

- **3 input formats**: PRD/Markdown, OpenAPI (YAML/JSON), User Stories (As a.../Given/When/Then)
- **4 output formats**: Playwright tests, API tests, Gherkin features, Markdown test plans
- **Provider-agnostic**: OpenAI, Anthropic, or custom LLM endpoints
- **TypeScript validation**: Validates generated code via `tsc --noEmit`
- **Configurable**: Test style (descriptive/concise/BDD), include negative/boundary cases

---

## Demo

```
$ npm test

 Test Files  13 passed (13)
      Tests  94 passed (94)
   Duration  1.44s
```

> **94 unit tests** covering parsers, templates, validation, config, generator, CLI, providers, retry logic, streaming, and caching.

---

## Quick Start

```bash
npm install ai-testgen

# Copy and fill in your API keys
cp .env.example .env

# Initialize config
npx ai-testgen init

# Generate Playwright tests from a PRD
npx ai-testgen generate requirements.md --format playwright

# Generate API tests from OpenAPI spec
npx ai-testgen from-spec api-spec.yaml

# Generate Gherkin features from user stories
npx ai-testgen generate stories.txt --format gherkin
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CLI / API                         │
├─────────────────────────────────────────────────────┤
│                   Generator                         │
│         (detect input → parse → prompt → output)    │
├──────────┬──────────┬───────────────────────────────┤
│  Parsers │Templates │        Outputs                │
│  PRD     │Playwright│    Playwright (.spec.ts)       │
│  OpenAPI │API       │    Gherkin (.feature)          │
│  Stories │Gherkin   │    Markdown (.md)              │
│          │Markdown  │                                │
├──────────┴──────────┴───────────────────────────────┤
│              Provider Layer (fetch-based)             │
│         OpenAI  │  Anthropic  │  Custom HTTP         │
└─────────────────────────────────────────────────────┘
```

---

## CLI Commands

### `generate <file>`

Generate test cases from any supported input file.

```bash
npx ai-testgen generate <file> [options]

Options:
  -f, --format <type>   playwright, api, gherkin, markdown (default: playwright)
  -o, --output <dir>    Output directory (default: ./generated-tests)
  -c, --config <path>   Path to config file
  --style <type>        descriptive, concise, bdd (default: descriptive)
  --no-negative         Skip negative test cases
  --no-boundary         Skip boundary test cases
  --no-stream           Disable streaming output
  --dry-run             Show parsed input and prompt without calling LLM
  --model <model>       Override LLM model from command line
  --no-cache            Bypass response cache
  --clear-cache         Clear all cached responses
  -v, --verbose         Enable debug logging
```

### `from-spec <file>`

Generate API tests specifically from OpenAPI specs.

### `plan <file>`

Generate a Markdown test plan from any input.

### `validate <file>`

Validate generated test files (TypeScript compilation, Gherkin syntax, Markdown structure).

### `init`

Create default configuration file.

```bash
npx ai-testgen init [options]

Options:
  --force               Overwrite existing config
```

---

## Input Format Detection

| Format | Detection |
|--------|-----------|
| **OpenAPI** | `openapi` or `swagger` key in YAML/JSON |
| **User Stories** | Contains "As a" or "Given" keywords |
| **PRD** | Markdown with headers + requirement keywords |

---

## Configuration

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

Then create or edit `ai-testgen.config.json`:

```json
{
  "provider": {
    "type": "openai",
    "apiKey": "$OPENAI_API_KEY",
    "model": "gpt-4o-mini"
  },
  "output": {
    "format": "playwright",
    "dir": "./generated-tests",
    "style": "descriptive"
  },
  "options": {
    "includeNegative": true,
    "includeBoundary": true,
    "maxTokens": 4096,
    "temperature": 0.2
  }
}
```

---

## Caching

AI TestGen caches LLM responses to avoid redundant API calls. Cache behavior:

- **Key**: SHA-256 hash of input content + model + format + style + temperature
- **Location**: `.ai-testgen/cache/` (configurable)
- **TTL**: 24 hours default (configurable via `cache.ttlSeconds`)
- **Bypass**: `--no-cache` flag
- **Clear**: `--clear-cache` flag

Cache config in `ai-testgen.config.json`:

```json
{
  "cache": {
    "dir": ".ai-testgen/cache",
    "ttlSeconds": 86400,
    "enabled": true
  }
}
```

---

## Streaming

When running in a TTY (interactive terminal), AI TestGen streams LLM tokens in real-time with a progress spinner. In non-TTY environments (CI pipelines), it falls back to plain log lines. Use `--no-stream` to disable streaming.

---

## Error Handling

- **Retry with exponential backoff**: 3 retries with 1s → 2s → 4s delays on 429/5xx errors
- **API key validation**: Clear error message if no key is configured
- **Graceful errors**: File not found, invalid config, and API errors produce clean messages (no stack traces)

---

## Programmatic API

```typescript
import { Generator, DEFAULT_CONFIG } from 'ai-testgen';

const generator = new Generator({
  ...DEFAULT_CONFIG,
  provider: {
    type: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
  },
});

const result = await generator.generate('./requirements.md', 'playwright');
console.log(`Generated ${result.summary.totalTests} tests`);
```

---

## Provider Support

| Provider | Config Type | Default Model |
|----------|------------|---------------|
| OpenAI | `openai` | gpt-4o-mini |
| Anthropic | `anthropic` | claude-sonnet-4-5-20250514 |
| Custom | `custom` | (configurable) |

---

## CI/CD Integration

The included GitHub Actions workflow:

1. Runs lint, format, type check on Node 18 & 20
2. Executes all 94 unit tests
3. Builds the package to verify publishability

Add your API keys as repository secrets for generation:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

---

## Project Structure

```
ai-testgen/
├── .github/
│   ├── workflows/ci.yml          # CI pipeline (Node 18/20 matrix)
│   ├── dependabot.yml            # Automated dependency updates
│   ├── CODEOWNERS                # Review ownership
│   └── pull_request_template.md  # PR checklist
├── src/
│   ├── parsers/                  # Input format parsers
│   │   ├── prd.parser.ts         # PRD/Markdown parser
│   │   ├── openapi.parser.ts     # OpenAPI spec parser
│   │   └── story.parser.ts       # User story parser
│   ├── templates/                # LLM prompt templates
│   │   ├── base.template.ts      # Abstract template
│   │   ├── playwright.template.ts
│   │   ├── api.template.ts
│   │   ├── gherkin.template.ts
│   │   └── markdown.template.ts
│   ├── providers/                # LLM provider adapters
│   │   ├── base.provider.ts      # Abstract base with timedCall
│   │   ├── openai.provider.ts    # OpenAI chat completions
│   │   ├── anthropic.provider.ts # Anthropic messages API
│   │   └── custom.provider.ts    # Any HTTP-based LLM
│   ├── outputs/                  # Output file writers
│   │   ├── base.output.ts
│   │   ├── playwright.output.ts
│   │   ├── gherkin.output.ts
│   │   └── markdown.output.ts
│   ├── core/                     # Framework core
│   │   ├── generator.ts          # Main generator orchestrator
│   │   ├── config.ts             # Config loader + env resolution
│   │   ├── validator.ts          # TS/Gherkin/MD validation
│   │   └── types.ts              # Type definitions
│   ├── utils/                    # Shared utilities
│   │   ├── prompt.ts             # Code block extraction
│   │   └── logger.ts             # Colored structured logging
│   ├── cli.ts                    # Command-line interface
│   └── index.ts                  # Public API exports
├── tests/unit/                   # 94 unit tests
├── CONTRIBUTING.md
├── SECURITY.md
├── Dockerfile
└── .dockerignore
```

---

## Development

```bash
git clone https://github.com/mustafaautomation/ai-testgen.git
cd ai-testgen
npm install
npm test              # Run unit tests
npm run typecheck     # Type checking
npm run lint          # ESLint
npm run format:check  # Prettier
npm run build         # Compile TypeScript
```

---

## License

MIT

---

Built by [Quvantic](https://quvantic.com)
