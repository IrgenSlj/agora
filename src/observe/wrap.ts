// Rewriting a host's launch command so a server runs under `agora run`.
//
// `agora observe enable` edits every host config to turn
//
//     command = ["npx", "some-server"]
// into
//     command = ["agora", "run", "--", "npx", "some-server"]
//
// which is what makes observation something a person will actually switch on.
// Doing it by hand across four hosts is why nobody did.
//
// ── WHAT MAKES THIS SAFE TO RUN ─────────────────────────────────────────────
//
// These functions edit the command line that starts every MCP server the user
// depends on. Three properties, each with a test:
//
//   1. **Idempotent.** Wrapping twice must not produce
//      `agora run -- agora run -- npx x`. Enable is safe to re-run, which
//      matters because a user who is unsure whether it worked will run it again.
//   2. **Exactly invertible.** `unwrap(wrap(c))` is `c` for every command, so
//      `disable` restores the original argv rather than an approximation.
//   3. **Never applied to what it cannot supervise.** Remote (URL) servers have
//      no local process, and Agora's own entries must never wrap themselves.

/** argv prefix inserted ahead of the real command. */
export const RUN_PREFIX = ['agora', 'run', '--'] as const;

/**
 * True when a command already runs through the shim.
 *
 * Matches on the `agora run --` shape rather than the first token alone, so a
 * server that genuinely happens to be called `agora` is not mistaken for one
 * that is already wrapped.
 */
export function isWrapped(command: readonly string[] | undefined): boolean {
  if (!command || command.length < RUN_PREFIX.length) return false;
  // A wrapper may be an absolute path (/usr/local/bin/agora) after a host
  // rewrote it, so compare the basename of the first token.
  const bin = command[0]!.split(/[\\/]/).pop();
  return bin === 'agora' && command[1] === 'run' && command[2] === '--';
}

/**
 * Why a command cannot be observed, or undefined when it can.
 *
 * Returning a reason rather than a boolean means the CLI can tell the user
 * which servers it skipped and why, instead of silently doing less than they
 * asked for.
 */
export function unobservableReason(server: {
  command?: readonly string[];
  url?: string;
  name: string;
}): string | undefined {
  if (server.url) return 'remote server — no local process to supervise';
  if (!server.command || server.command.length === 0) return 'no launch command recorded';
  // Wrapping Agora in Agora would recurse on every start.
  const bin = server.command[0]!.split(/[\\/]/).pop();
  if (bin === 'agora' && !isWrapped(server.command)) return 'this is Agora itself';
  return undefined;
}

/** Adds the shim. Returns the command unchanged when it is already wrapped. */
export function wrapCommand(command: readonly string[]): string[] {
  if (isWrapped(command)) return [...command];
  return [...RUN_PREFIX, ...command];
}

/** Removes the shim. Returns the command unchanged when it is not wrapped. */
export function unwrapCommand(command: readonly string[]): string[] {
  if (!isWrapped(command)) return [...command];
  return command.slice(RUN_PREFIX.length);
}
