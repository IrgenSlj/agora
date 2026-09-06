import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { ExitCode } from '../exit-codes.js';
import { writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

/**
 * The hook configuration written into a project's `.claude/settings.json`.
 *
 * `mcp__.*` rather than a per-server list on purpose: a matcher enumerating
 * today's servers would silently stop covering the one added tomorrow, and the
 * server nobody remembered to add is the one this exists for.
 */
export function hookConfig(): Record<string, unknown> {
  return {
    matcher: 'mcp__.*',
    hooks: [
      {
        type: 'command',
        command: 'agora hook check',
        // Generous relative to what this does — the check is local, synchronous
        // and typically single-digit milliseconds. The timeout is a guard
        // against a pathological config, not a budget. A hook that times out
        // does not block the call, which is the correct direction.
        timeout: 10,
        statusMessage: 'Checking the tool against the revocation feed…'
      }
    ]
  };
}

/** `agora hook install` — merge the hook into `.claude/settings.json`. */
function commandHookInstall(
  io: Parameters<CommandHandler>[1],
  cwd: string,
  opts: { dryRun: boolean }
): number {
  // atomicWriteFile creates the parent directory, so `.claude/` not existing
  // yet is the ordinary first-run case rather than something to guard.
  const path = join(cwd, '.claude', 'settings.json');

  let doc: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) doc = parsed as Record<string, unknown>;
    } catch (e) {
      writeLine(
        io.stderr,
        `${path} is not valid JSON — refusing to overwrite it: ${e instanceof Error ? e.message : String(e)}`
      );
      return ExitCode.USAGE;
    }
  }

  const hooks =
    typeof doc.hooks === 'object' && doc.hooks !== null
      ? { ...(doc.hooks as Record<string, unknown>) }
      : {};
  const pre = Array.isArray(hooks.PreToolUse) ? [...(hooks.PreToolUse as unknown[])] : [];

  // Idempotent by matcher. Running install twice should not produce two hooks
  // that both run on every tool call.
  const already = pre.some(
    (h) => typeof h === 'object' && h !== null && (h as { matcher?: string }).matcher === 'mcp__.*'
  );
  if (already) {
    writeLine(io.stdout, `Already installed in ${path}.`);
    return ExitCode.OK;
  }

  pre.push(hookConfig());
  hooks.PreToolUse = pre;
  doc.hooks = hooks;

  if (opts.dryRun) {
    writeLine(io.stdout, JSON.stringify(doc, null, 2));
    return ExitCode.OK;
  }

  atomicWriteFile(path, `${JSON.stringify(doc, null, 2)}\n`, 0o644);
  writeLine(io.stdout, `Installed the PreToolUse hook into ${path}.`);
  writeLine(
    io.stdout,
    'Every MCP tool call is now checked against the revocation feed and your approved baseline ' +
      'before it runs.'
  );
  writeLine(
    io.stdout,
    'It can only block. It never grants a permission Claude Code would otherwise have asked you for.'
  );
  return ExitCode.OK;
}

export const commandHook: CommandHandler = async (parsed, io, _style) => {
  const sub = parsed.args[0];

  // `src/cli.ts` short-circuits the exact `agora hook check` invocation before
  // the CLI loads, because yargs costs more than the check does and this runs
  // before every MCP tool call. Reaching here means something else was on the
  // command line; the handler is the same one either way, so the two paths
  // cannot answer differently.
  if (sub === 'check') {
    const { runHookCheck } = await import('../../hook/run.js');
    return await runHookCheck();
  }

  if (sub === 'install') {
    const cwd = io.cwd ?? process.cwd();
    return commandHookInstall(io, cwd, { dryRun: Boolean(parsed.flags['dry-run']) });
  }

  writeLine(io.stderr, 'Usage: agora hook <install|check>');
  writeLine(io.stderr, '');
  writeLine(io.stderr, '  install   Add the PreToolUse hook to .claude/settings.json');
  writeLine(
    io.stderr,
    '  check     Read a PreToolUse payload on stdin and decide (used by the hook)'
  );
  return ExitCode.USAGE;
};
