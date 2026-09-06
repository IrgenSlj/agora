import { readFileSync } from 'node:fs';
import { createStyler, type Styler, shouldUseColor, supportsTrueColor } from '../ui.js';
import * as acquireModule from './commands/acquire.js';
import * as applyModule from './commands/apply.js';
import * as approveModule from './commands/approve.js';
import * as auditModule from './commands/audit.js';
import * as browseModule from './commands/browse.js';
import * as capabilitiesModule from './commands/capabilities.js';
import * as ciModule from './commands/ci.js';
import * as doctorModule from './commands/doctor.js';
import * as exportModule from './commands/export.js';
import * as freezeModule from './commands/freeze.js';
import * as initModule from './commands/init.js';
import * as installedModule from './commands/installed.js';
import * as integrateModule from './commands/integrate.js';
import * as lockModule from './commands/lock.js';
import * as marketplace from './commands/marketplace.js';
import * as notifyModule from './commands/notify.js';
import * as observeModule from './commands/observe.js';
import * as operations from './commands/operations.js';
import * as outdatedModule from './commands/outdated.js';
import * as planModule from './commands/plan.js';
import * as policyModule from './commands/policy.js';
import * as quarantineModule from './commands/quarantine.js';
import * as refreshModule from './commands/refresh.js';
import * as removeModule from './commands/remove.js';
import * as scanModule from './commands/scan.js';
import * as syncModule from './commands/sync.js';
import * as todayModule from './commands/today.js';
import * as trustModule from './commands/trust.js';
import * as tryModule from './commands/try.js';
import type { CommandMap } from './commands/types.js';
import * as updateModule from './commands/update.js';
import * as watchModule from './commands/watch.js';
import * as welcomeModule from './commands/welcome.js';
import { COMMANDS, renderManual } from './commands-meta.js';
import { ExitCode } from './exit-codes.js';
import { type CliIo, parseArgs } from './flags.js';
import { usage, welcome } from './format.js';
import { writeLine } from './helpers.js';
import { RETIRED_COMMANDS, retiredMessage } from './retired.js';
import { cliTheme } from './theme.js';
import { runTui } from './tui.js';

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
    const cmd: CommandMap = {
      search: marketplace.commandSearch,
      info: marketplace.commandInfo,
      browse: marketplace.commandBrowse,
      init: initModule.commandInit,
      install: operations.commandInstall,
      mcp: operations.commandMcp,
      preferences: operations.commandPreferences,
      history: operations.commandHistory,
      config: operations.commandConfig,
      show: (p, io2, style2) =>
        operations.commandConfig(
          { ...p, args: ['show', ...p.args], command: 'config' },
          io2,
          style2
        ),
      edit: (p, io2, style2) =>
        operations.commandConfig(
          { ...p, args: ['edit', ...p.args], command: 'config' },
          io2,
          style2
        ),
      diff: (p, io2, style2) =>
        operations.commandConfig(
          { ...p, args: ['diff', ...p.args], command: 'config' },
          io2,
          style2
        ),
      export: exportModule.commandExport,
      watch: watchModule.commandWatch,
      notify: notifyModule.commandNotify,
      observe: observeModule.commandObserve,
      run: observeModule.commandRun,
      today: todayModule.commandToday,
      open: browseModule.commandOpen,
      scan: scanModule.commandScan,
      verify: scanModule.commandScan,
      acquire: acquireModule.commandAcquire,
      outdated: outdatedModule.commandOutdated,
      refresh: refreshModule.commandRefresh,
      remove: removeModule.commandRemove,
      installed: installedModule.commandInstalled,
      doctor: doctorModule.commandDoctor,
      freeze: freezeModule.commandFreeze,
      sync: syncModule.commandSync,
      plan: planModule.commandPlan,
      policy: policyModule.commandPolicy,
      quarantine: quarantineModule.commandQuarantine,
      unquarantine: quarantineModule.commandUnquarantine,
      apply: applyModule.commandApply,
      update: updateModule.commandUpdate,
      approve: approveModule.commandApprove,
      audit: auditModule.commandAudit,
      ci: ciModule.commandCi,
      trust: trustModule.commandTrust,
      try: tryModule.commandTry,
      capabilities: capabilitiesModule.commandCapabilities,
      integrate: integrateModule.commandIntegrate,
      lock: lockModule.commandLock,
      welcome: welcomeModule.commandWelcome
    };

    const handler = cmd[parsed.command];
    if (handler) return await handler(parsed, io, style);

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

    if (parsed.command === 'tui') return await runTui(io, { initial: 'home' });
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
