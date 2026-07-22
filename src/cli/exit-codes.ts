/**
 * Exit codes for Agora CLI commands.
 * Source: AGORA_BRIEF_v2.md §9
 *
 * 0 — ok
 * 1 — policy forbid / drift / revocation hit
 * 2 — usage
 * 3 — network
 * 4 — sandbox unavailable
 */

export const ExitCode = {
  /** Success */
  OK: 0,
  /** Policy forbid / drift / revocation hit */
  POLICY_FORBID: 1,
  /** Usage error (bad arguments, missing required fields) */
  USAGE: 2,
  /** Network error (unreachable, timeout, DNS failure) */
  NETWORK: 3,
  /** Sandbox unavailable (Docker not running, sandbox backend missing) */
  SANDBOX_UNAVAILABLE: 4
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
