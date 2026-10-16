import { ParsedInput, GenConfig } from '../core/types';

export interface TemplatePrompt {
  systemPrompt: string;
  userPrompt: string;
}

export abstract class BaseTemplate {
  abstract format: string;
  abstract buildPrompt(input: ParsedInput, config: GenConfig): TemplatePrompt;
}
