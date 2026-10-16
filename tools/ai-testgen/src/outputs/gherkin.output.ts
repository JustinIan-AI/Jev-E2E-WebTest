import { BaseOutput } from './base.output';

export class GherkinOutput extends BaseOutput {
  format = 'gherkin';
  extension = '.feature';
}
