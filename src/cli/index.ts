import { EXIT_CODES } from './exit-codes.js';
import type { ExitCode } from './exit-codes.js';

/**
 * IDWTH CLI entry point. Single-shot: parse, dispatch, set exit code, terminate.
 * No listener is kept alive and no port is ever bound.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<ExitCode> {
  const [command] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return EXIT_CODES.PASS;
  }
  if (command === '--version' || command === '-V') {
    process.stdout.write('idwth 0.1.0\n');
    return EXIT_CODES.PASS;
  }

  // Full routing is Task 10; skeleton only validates the command surface.
  process.stderr.write(`idwth: command not implemented in skeleton: ${command}\n`);
  return EXIT_CODES.RUNTIME_ERROR;
}

const USAGE = `idwth - Intent-Driven Web Test Harness

Usage: idwth <command> [options]

Commands:
  init        Scaffold project + environment probe
  validate    Validate a contract (schema + executability)
  run         Execute a contract (one-shot)
  replay      Replay a trace (--verify default | --heal explicit)
  report      Render/export a static self-contained report
  doctor      Environment diagnostics
  judge       Judge operations (e.g. recompute)

All commands run once and exit; there is no daemon or server mode.
`;

// Only execute when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = EXIT_CODES.RUNTIME_ERROR;
    });
}
