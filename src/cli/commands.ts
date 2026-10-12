import type { ExitCode } from './exit-codes.js';
import { EXIT_CODES } from './exit-codes.js';

export interface CommandContext {
  readonly argv: readonly string[];
}

export interface CommandHandler {
  (ctx: CommandContext): Promise<ExitCode> | ExitCode;
}

/**
 * Command surface (DD §10). Only routing placeholders exist in the skeleton;
 * each command is implemented by its owning task (validate T3, run T6/T10, etc.).
 * There is deliberately no daemon/serve/start-server command.
 */
export const COMMANDS = [
  'init',
  'validate',
  'run',
  'replay',
  'report',
  'doctor',
  'judge',
] as const;

export type CommandName = (typeof COMMANDS)[number];

const NOT_IMPLEMENTED: Partial<Record<CommandName, CommandHandler>> = {};

export function isCommandName(name: string): name is CommandName {
  return (COMMANDS as readonly string[]).includes(name);
}

export function resolveCommand(name: CommandName): CommandHandler {
  return (
    NOT_IMPLEMENTED[name] ??
    (() => EXIT_CODES.RUNTIME_ERROR)
  );
}
