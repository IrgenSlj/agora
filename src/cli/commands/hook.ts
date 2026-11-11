import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { ExitCode } from '../exit-codes.js';
import { writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

/**
 * The hooks written into a project's `.claude/settings.json`, by event.
 * Shapes per https://code.claude.com/docs/en/hooks, read 2026-11-11.
 *
 * The check runs on every tool: it denies calls to revoked MCP servers, and
 * when the repository has an agora.cedar, anything that policy does not
 * permit. Without an agora.cedar it returns on a non-MCP call before loading
 * anything. The recorder also runs on every tool.
 */
export function hookConfig(): Record<string, Record<string, unknown>> {
  const record = (timeout: number) => ({
    hooks: [{ type: 'command', command: 'agora hook record', timeout }]
  });
  return {
    PreToolUse: {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: 'agora hook check',
          // A guard, not a budget: the check is local and takes milliseconds,
          // and a hook that times out does not block the call.
          timeout: 10,
          statusMessage: 'Checking against agora.cedar and the revocation list…'
        }
      ]
    },
    PostToolUse: { matcher: '*', ...record(5) },
    PermissionDenied: { matcher: '*', ...record(5) },
    SessionStart: record(5),
    // SessionEnd hooks share a 1.5 s budget unless a timeout raises it.
    SessionEnd: record(5)
  };
}

const isAgoraEntry = (h: unknown): boolean =>
  typeof h === 'object' &&
  h !== null &&
  Array.isArray((h as { hooks?: unknown }).hooks) &&
  (h as { hooks: { command?: unknown }[] }).hooks.some(
    (c) => typeof c.command === 'string' && c.command.startsWith('agora hook')
  );

function onPath(program: string, env: Record<string, string | undefined>): boolean {
  const sepChar = process.platform === 'win32' ? ';' : ':';
  return (env.PATH ?? '').split(sepChar).some((dir) => {
    try {
      return dir !== '' && existsSync(join(dir, program));
    } catch {
      return false;
    }
  });
}

/** Whether `.claude/settings.json` under `cwd` already carries Agora's hook. */
export function hookInstalled(cwd: string): boolean {
  const path = join(cwd, '.claude', 'settings.json');
  if (!existsSync(path)) return false;
  try {
    const pre = JSON.parse(readFileSync(path, 'utf8'))?.hooks?.PreToolUse;
    return Array.isArray(pre) && pre.some(isAgoraEntry);
  } catch {
    return false;
  }
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

  // Idempotent per event: Agora's own entry is added, or replaced when it
  // differs from the current configuration; anything else is left alone.
  const added: string[] = [];
  for (const [event, entry] of Object.entries(hookConfig())) {
    const list = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    const at = list.findIndex(isAgoraEntry);
    if (at >= 0 && JSON.stringify(list[at]) === JSON.stringify(entry)) continue;
    if (at >= 0) list[at] = entry;
    else list.push(entry);
    hooks[event] = list;
    added.push(event);
  }
  doc.hooks = hooks;

  if (opts.dryRun) {
    writeLine(io.stdout, JSON.stringify(doc, null, 2));
    return ExitCode.OK;
  }
  if (!added.length) {
    writeLine(io.stdout, `Already installed in ${path}.`);
    return ExitCode.OK;
  }

  atomicWriteFile(path, `${JSON.stringify(doc, null, 2)}\n`, 0o644);
  writeLine(io.stdout, `Installed ${added.join(', ')} hooks into ${path}.`);
  writeLine(
    io.stdout,
    'Calls to revoked MCP servers, and anything agora.cedar does not permit, are denied before they run.'
  );
  writeLine(
    io.stdout,
    'Every tool call is recorded in a hash-chained session log: names, paths, programs and peers, ' +
      'never arguments or contents. See `agora log`.'
  );
  writeLine(
    io.stdout,
    'The hooks only deny; they never grant a permission Claude Code would have asked for.'
  );
  if (!onPath('agora', io.env ?? {})) {
    writeLine(
      io.stderr,
      'Warning: `agora` is not on PATH, so these hooks cannot run. Install it globally with ' +
        '`npm i -g agora-hub`.'
    );
  }
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

  if (sub === 'record') {
    const { runHookRecord } = await import('../../hook/record.js');
    return await runHookRecord();
  }

  if (sub === 'install') {
    const cwd = io.cwd ?? process.cwd();
    return commandHookInstall(io, cwd, { dryRun: Boolean(parsed.flags['dry-run']) });
  }

  writeLine(io.stderr, 'Usage: agora hook <install|check|record>');
  writeLine(io.stderr, '');
  writeLine(io.stderr, '  install   Add the Agora hooks to .claude/settings.json');
  writeLine(
    io.stderr,
    '  check     Read a PreToolUse payload on stdin and decide (used by the hook)'
  );
  writeLine(io.stderr, '  record    Read a hook payload on stdin and log it (used by the hooks)');
  return ExitCode.USAGE;
};
