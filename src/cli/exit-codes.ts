/**
 * Exit codes for every Agora command (docs/PLAN.md, standing rule 9).
 *
 * 0 — clean
 * 1 — policy failure: a deny, a revocation hit, a receipt that does not verify
 * 2 — usage
 * 3 — could not check: a source was unreachable or evidence was missing, and
 *     the command was asked to treat that as failure
 */
export const ExitCode = {
  OK: 0,
  POLICY_FORBID: 1,
  USAGE: 2,
  COULD_NOT_CHECK: 3
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
