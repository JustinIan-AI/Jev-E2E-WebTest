import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli/index.js';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { COMMANDS, isCommandName } from '../../src/cli/commands.js';

describe('CLI skeleton', () => {
  it('prints usage with exit 0 for --help', async () => {
    expect(await main(['--help'])).toBe(EXIT_CODES.PASS);
  });

  it('prints version with exit 0 for --version', async () => {
    expect(await main(['--version'])).toBe(EXIT_CODES.PASS);
  });

  it('recognizes the one-shot command surface and no daemon command', () => {
    for (const name of ['init', 'validate', 'run', 'replay', 'report', 'doctor', 'judge']) {
      expect(isCommandName(name)).toBe(true);
    }
    expect(isCommandName('daemon')).toBe(false);
    expect(isCommandName('serve')).toBe(false);
    expect(isCommandName('start-server')).toBe(false);
  });

  it('does not include any server command', () => {
    expect(COMMANDS.some((c) => /server|daemon|serve/.test(c))).toBe(false);
  });
});
