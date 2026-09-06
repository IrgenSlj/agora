import { readFileSync } from 'node:fs';
import { createStyler, type Styler, shouldUseColor, supportsTrueColor } from '../ui.js';
import type { CommandHandler } from './commands/types.js';
import { COMMANDS, renderManual } from './commands-meta.js';
import { ExitCode } from './exit-codes.js';
import { type CliIo, parseArgs } from './flags.js';
import { usage, welcome } from './format.js';
import { writeLine } from './helpers.js';
import { RETIRED_COMMANDS, retiredMessage } from './retired.js';
import { cliTheme } from './theme.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const AGORA_VERSION = pkg.version;
const VERSION = AGORA_VERSION;

/**
 * Levenshtein-based suggestion: when the user mistypes a command, pick the
 * closest registered name if it's within edit-distance 3 AND no further from
 * the input than half its length (so "z" doesn't suggest "saved").
 */
export function nearestCommand(input: string): string | null {
  if (!input) return null;
  const targets = COMMANDS.map((c) => c.name);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = levenshtein(input, t);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  const cap = Math.max(2, Math.floor(input.length / 2));
  return best && bestDist <= Math.min(3, cap) ? best : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

// Active terminal styler. Reassigned once per `runCli` invocation from the
// caller's stream + env; defaults to plain so any direct formatter use is safe.
let style: Styler = createStyler(false);

/**
 * Every CLI token that can reach a handler. Most come from user-facing command
 * metadata; the remainder are compatibility aliases or the help router. Gate
 * inventory tests consume this so a newly documented command cannot appear
 * without an explicit mutation classification.
 */
export const HIDDEN_CLI_ENTRYPOINTS = ['help', 'show', 'edit', 'diff', 'verify', 'mcp'] as const;
export const ACTIVE_CLI_ENTRYPOINTS = [
  ...new Set([...COMMANDS.map((command) => command.name), ...HIDDEN_CLI_ENTRYPOINTS])
].sort();

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const env = io.env ?? {};
  const useColor = shouldUseColor(
    io.stdout as { isTTY?: boolean },
    env,
    Boolean(parsed.flags.json)
  );
  style = createStyler(useColor, supportsTrueColor(env));

  if (parsed.flags.version) {
    writeLine(io.stdout, VERSION);
    return 0;
  }

  if (parsed.flags.help) {
    if (parsed.command && COMMANDS.some((c) => c.name === parsed.command)) {
      writeLine(io.stdout, commandManual(parsed.command));
    } else {
      writeLine(io.stdout, usage(cliTheme(style, io), VERSION));
    }
    return 0;
  }

  // Bare `agora` used to drop into an interactive shell when stdout was a TTY.
  // It now prints the same welcome in both cases. A command that behaves
  // differently depending on whether it is being watched is a command nobody
  // can script against, and the shell it launched is gone.
  if (!parsed.command) {
    writeLine(io.stdout, welcome(useColor, supportsTrueColor(env), cliTheme(style, io), VERSION));
    return 0;
  }

  try {
    // Every handler is behind a dynamic import, and it matters more than it
    // looks. Importing all thirty eagerly meant `agora --version` resolved 322
    // modules and paid 107ms for sigstore plus 75ms for the MCP SDK before
    // printing a string it already had. The GitHub Action pays that on every
    // run of every repository that adopts it.
    //
    // `src/policy/engine.ts` already did this for cedar-wasm, for the same
    // reason and with the same comment. This is that rule applied to the
    // dispatch table instead of one dependency.
    const cmd: Record<string, () => Promise<CommandHandler>> = {
      search: async () => (await import('./commands/marketplace.js')).commandSearch,
      info: async () => (await import('./commands/marketplace.js')).commandInfo,
      browse: async () => (await import('./commands/marketplace.js')).commandBrowse,
      init: async () => (await import('./commands/init.js')).commandInit,
      install: async () => (await import('./commands/operations.js')).commandInstall,
      mcp: async () => (await import('./commands/operations.js')).commandMcp,
      preferences: async () => (await import('./commands/operations.js')).commandPreferences,
      history: async () => (await import('./commands/operations.js')).commandHistory,
      config: async () => (await import('./commands/operations.js')).commandConfig,
      show: () => configAlias('show'),
      edit: () => configAlias('edit'),
      diff: () => configAlias('diff'),
      export: async () => (await import('./commands/export.js')).commandExport,
      watch: async () => (await import('./commands/watch.js')).commandWatch,
      notify: async () => (await import('./commands/notify.js')).commandNotify,
      observe: async () => (await import('./commands/observe.js')).commandObserve,
      run: async () => (await import('./commands/observe.js')).commandRun,
      today: async () => (await import('./commands/today.js')).commandToday,
      open: async () => (await import('./commands/browse.js')).commandOpen,
      scan: async () => (await import('./commands/scan.js')).commandScan,
      verify: async () => (await import('./commands/scan.js')).commandScan,
      acquire: async () => (await import('./commands/acquire.js')).commandAcquire,
      outdated: async () => (await import('./commands/outdated.js')).commandOutdated,
      refresh: async () => (await import('./commands/refresh.js')).commandRefresh,
      remove: async () => (await import('./commands/remove.js')).commandRemove,
      installed: async () => (await import('./commands/installed.js')).commandInstalled,
      doctor: async () => (await import('./commands/doctor.js')).commandDoctor,
      freeze: async () => (await import('./commands/freeze.js')).commandFreeze,
      sync: async () => (await import('./commands/sync.js')).commandSync,
      plan: async () => (await import('./commands/plan.js')).commandPlan,
      policy: async () => (await import('./commands/policy.js')).commandPolicy,
      quarantine: async () => (await import('./commands/quarantine.js')).commandQuarantine,
      unquarantine: async () => (await import('./commands/quarantine.js')).commandUnquarantine,
      apply: async () => (await import('./commands/apply.js')).commandApply,
      update: async () => (await import('./commands/update.js')).commandUpdate,
      approve: async () => (await import('./commands/approve.js')).commandApprove,
      audit: async () => (await import('./commands/audit.js')).commandAudit,
      ci: async () => (await import('./commands/ci.js')).commandCi,
      trust: async () => (await import('./commands/trust.js')).commandTrust,
      try: async () => (await import('./commands/try.js')).commandTry,
      capabilities: async () => (await import('./commands/capabilities.js')).commandCapabilities,
      integrate: async () => (await import('./commands/integrate.js')).commandIntegrate,
      lock: async () => (await import('./commands/lock.js')).commandLock,
      welcome: async () => (await import('./commands/welcome.js')).commandWelcome
    };

    const load = cmd[parsed.command];
    if (load) return await (await load())(parsed, io, style);

    if (parsed.command === 'help') {
      const helpTarget = parsed.args[0];
      if (helpTarget) {
        const meta = COMMANDS.find((c) => c.name === helpTarget);
        if (!meta) {
          writeLine(io.stderr, `Unknown command: ${helpTarget}`);
          writeLine(io.stderr, 'Run `agora help` for a list of commands.');
          return ExitCode.USAGE;
        }
        writeLine(io.stdout, commandManual(helpTarget));
      } else {
        writeLine(io.stdout, usage(cliTheme(style, io), VERSION));
      }
      return 0;
    }

    if (parsed.command === 'completions') return await commandCompletions(parsed, io, style);

    // A command we deliberately removed explains itself. Falling through to
    // "Unknown command" would read as a broken install rather than a decision.
    const retired = RETIRED_COMMANDS[parsed.command];
    if (retired) {
      writeLine(io.stderr, retiredMessage(parsed.command, retired, VERSION));
      return ExitCode.USAGE;
    }

    writeLine(io.stderr, `Unknown command: ${parsed.command}`);
    const suggestion = nearestCommand(parsed.command);
    if (suggestion) writeLine(io.stderr, `Did you mean: ${suggestion}?`);
    writeLine(io.stderr, 'Run agora help for usage.');
    return ExitCode.USAGE;
  } catch (error) {
    writeLine(io.stderr, error instanceof Error ? error.message : String(error));
    return ExitCode.USAGE;
  }
}

/**
 * `agora show|edit|diff` are compatibility aliases for `agora config <verb>`.
 * They rewrite the parsed arguments rather than calling a second entry point,
 * so the aliases cannot drift from the command they stand for.
 */
async function configAlias(verb: 'show' | 'edit' | 'diff'): Promise<CommandHandler> {
  const { commandConfig } = await import('./commands/operations.js');
  return (parsed, io, style) =>
    commandConfig({ ...parsed, args: [verb, ...parsed.args], command: 'config' }, io, style);
}

export function commandManual(name: string): string {
  const meta = COMMANDS.find((c) => c.name === name);
  if (!meta) return '';
  return renderManual(meta, style);
}

export async function commandCompletions(
  parsed: { args: string[] },
  io: CliIo,
  _style: Styler
): Promise<number> {
  const shell = parsed.args[0] || 'bash';
  const { generateCompletions } = await import('./completions-gen.js');
  const output = generateCompletions(shell);
  if (output.startsWith('Unknown shell')) {
    writeLine(io.stderr, output);
    return ExitCode.USAGE;
  }
  writeLine(io.stdout, output);
  return 0;
}
