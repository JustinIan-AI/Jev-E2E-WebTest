import { BaseOutput } from './base.output';

export class PlaywrightOutput extends BaseOutput {
  format = 'playwright';
  extension = '.spec.ts';
}
