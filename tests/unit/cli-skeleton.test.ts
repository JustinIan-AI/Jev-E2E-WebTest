import { describe, expect, it, vi } from 'vitest';
import { main } from '../../src/cli/index.js';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';
import { COMMANDS, isCommandName } from '../../src/cli/commands.js';

describe('CLI skeleton', () => {
  it('prints usage with exit 0 for --help', async () => {
    expect(await main(['--help'])).toBe(EXIT_CODES.PASS);
  });

  it('#12短期 help 诚实说明 fixtures 仅声明、不触发数据准备', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    });
    try {
      expect(await main(['--help'])).toBe(EXIT_CODES.PASS);
    } finally {
      spy.mockRestore();
    }
    const text = writes.join('');
    expect(text).toMatch(/fixtures are declaration-only/i);
    expect(text).toMatch(/do NOT\s+trigger any data setup/i);
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
