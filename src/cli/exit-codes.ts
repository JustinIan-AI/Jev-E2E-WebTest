/**
 * Fixed process exit-code contract (PRD FR-10 / DD §10).
 * These six values are the only exit codes IDWTH may emit.
 */
export const EXIT_CODES = {
  /** PASS */
  PASS: 0,
  /** FAIL - deterministic assertion not satisfied */
  FAIL: 1,
  /** BLOCKED - env / ambiguity / evidence / decision / recovery / postcondition / drift */
  BLOCKED: 2,
  /** CONFIG_ERROR - invalid contract / missing required fields */
  CONFIG_ERROR: 3,
  /** RUNTIME_ERROR - internal error, incl. verdict_hash mismatch */
  RUNTIME_ERROR: 4,
  /** CANCELLED - SIGINT / budget exceeded; never enters verdict aggregation */
  CANCELLED: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
