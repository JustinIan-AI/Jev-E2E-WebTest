import { describe, expect, it } from 'vitest';
import { EXIT_CODES } from '../../src/cli/exit-codes.js';

describe('exit code contract', () => {
  it('exposes the fixed six exit codes', () => {
    expect(EXIT_CODES).toEqual({
      PASS: 0,
      FAIL: 1,
      BLOCKED: 2,
      CONFIG_ERROR: 3,
      RUNTIME_ERROR: 4,
      CANCELLED: 130,
    });
  });
});
