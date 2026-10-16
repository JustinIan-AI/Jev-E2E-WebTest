export type InputType = 'prd' | 'openapi' | 'story';
export type OutputFormat = 'playwright' | 'api' | 'gherkin' | 'markdown';
export type TestStyle = 'descriptive' | 'concise' | 'bdd';

export interface ParsedInput {
  type: InputType;
  title: string;
  scenarios: ParsedScenario[];
  endpoints?: ParsedEndpoint[];
  rawContent: string;
}

export interface ParsedScenario {
  title: string;
  description: string;
  steps?: string[];
  preconditions?: string[];
}

export interface ParsedEndpoint {
  method: string;
  path: string;
  summary?: string;
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    type?: string;
  }>;
  requestBody?: {
    contentType: string;
    schema?: Record<string, unknown>;
  };
  responses?: Record<string, { description: string }>;
}

export interface GeneratedOutput {
  format: OutputFormat;
  files: GeneratedFile[];
  summary: {
    totalTests: number;
    totalScenarios: number;
    format: OutputFormat;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenConfig {
  provider: {
    type: 'openai' | 'anthropic' | 'custom';
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  output: {
    format: OutputFormat;
    dir: string;
    style: TestStyle;
  };
  options: {
    includeNegative: boolean;
    includeBoundary: boolean;
    maxTokens: number;
    temperature: number;
  };
  cache?: {
    dir: string;
    ttlSeconds: number;
    enabled: boolean;
  };
}

export const DEFAULT_CONFIG: GenConfig = {
  provider: {
    type: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  output: {
    format: 'playwright',
    dir: './generated-tests',
    style: 'descriptive',
  },
  options: {
    includeNegative: true,
    includeBoundary: true,
    maxTokens: 4096,
    temperature: 0.2,
  },
  cache: {
    dir: '.ai-testgen/cache',
    ttlSeconds: 86400,
    enabled: true,
  },
};
