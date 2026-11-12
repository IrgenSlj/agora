import { readFileSync } from 'node:fs';
import { colorDepth, createStyler, type Styler, shouldUseColor, supportsUnicode } from '../ui.js';
import type { CommandHandler } from './commands/types.js';
import { COMMANDS, renderManual } from './commands-meta.js';
import { headerLine } from './components.js';
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

/** Every CLI token that can reach a handler: documented commands plus the help router. */
export const HIDDEN_CLI_ENTRYPOINTS = ['help'] as const;
export const ACTIVE_CLI_ENTRYPOINTS = [
  ...new Set([...COMMANDS.map((command) => command.name), ...HIDDEN_CLI_ENTRYPOINTS])
].sort();

/** Commands whose few lines of output get the shared frame; never JSON, scripts or a server. */
const FRAMED: Record<string, (sub: string) => boolean> = {
  signer: () => true,
  canary: (sub) => sub !== 'serve',
  profile: (sub) => sub !== 'show',
  policy: () => true,
  report: () => true,
  observe: () => true,
  receipt: (sub) => sub === 'write' || sub === 'install' || sub === 'uninstall',
  hook: (sub) => sub === 'install'
};

function isFramed(parsed: ReturnType<typeof parseArgs>): boolean {
  if (parsed.flags.json || parsed.flags['dry-run']) return false;
  const rule = parsed.command ? FRAMED[parsed.command] : undefined;
  return Boolean(rule?.(parsed.args[0] ?? ''));
}

const ASCII: Record<string, string> = {
  '·': '.',
  '…': '...',
  '→': '->',
  '─': '-',
  '│': '|',
  '┌': '.',
  '└': "'",
  '●': 'o',
  '■': '#',
  '◆': '*',
  '◇': '~',
  '✓': 'v',
  '✗': 'x',
  '•': '>',
  '×': 'x',
  '░': '.',
  '▒': ':',
  '▓': '=',
  '█': '#',
  '—': '-',
  '–': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"'
};
const NON_ASCII = new RegExp(`[${Object.keys(ASCII).join('')}]`, 'g');

/** On a terminal that is not UTF-8, every known glyph leaves as its ASCII fallback. */
function asciiOnly(stream: CliIo['stdout']): CliIo['stdout'] {
  const tty = stream as { isTTY?: boolean; columns?: number };
  return {
    isTTY: tty.isTTY,
    columns: tty.columns,
    write: (chunk: string) => stream.write(String(chunk).replace(NON_ASCII, (c) => ASCII[c] ?? c))
  } as CliIo['stdout'];
}

/** A stream that indents every line two columns. */
function indented(stream: CliIo['stdout']): CliIo['stdout'] {
  let atStart = true;
  return {
    write(chunk: string) {
      let out = '';
      for (const ch of String(chunk)) {
        if (atStart && ch !== '\n') out += '  ';
        out += ch;
        atStart = ch === '\n';
      }
      return stream.write(out);
    }
  };
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const env = io.env ?? {};
  if (!parsed.flags.json && !supportsUnicode(env)) io = { ...io, stdout: asciiOnly(io.stdout) };
  const useColor = shouldUseColor(
    io.stdout as { isTTY?: boolean },
    env,
    Boolean(parsed.flags.json)
  );
  style = createStyler(useColor, colorDepth(env));

  if (parsed.flags.version) {
    writeLine(io.stdout, VERSION);
    return 0;
  }

  if (parsed.flags.help) {
    if (parsed.command && COMMANDS.some((c) => c.name === parsed.command)) {
      writeLine(io.stdout, commandManual(parsed.command, io));
    } else {
      writeLine(io.stdout, usage(cliTheme(style, io), VERSION));
    }
    return 0;
  }

  if (!parsed.command) {
    writeLine(
      io.stdout,
      welcome(cliTheme(style, io), VERSION, (io.stdout as { columns?: number }).columns)
    );
    return 0;
  }

  try {
    // Every handler is behind a dynamic import so `agora --version` and the
    // GitHub Action do not pay for cedar-wasm or anything else they never use.
    const cmd: Record<string, () => Promise<CommandHandler>> = {
      hook: async () => (await import('./commands/hook.js')).commandHook,
      policy: async () => (await import('./commands/policy.js')).commandPolicy,
      run: async () => (await import('./commands/observe.js')).commandRun,
      observe: async () => (await import('./commands/observe.js')).commandObserve,
      audit: async () => (await import('./commands/audit.js')).commandAudit,
      ci: async () => (await import('./commands/ci.js')).commandCi,
      doctor: async () => (await import('./commands/doctor.js')).commandDoctor,
      log: async () => (await import('./commands/log.js')).commandLog,
      receipt: async () => (await import('./commands/receipt.js')).commandReceipt,
      signer: async () => (await import('./commands/signer.js')).commandSigner,
      replay: async () => (await import('./commands/replay.js')).commandReplay,
      learn: async () => (await import('./commands/learn.js')).commandLearn,
      plan: async () => (await import('./commands/plan.js')).commandPlan,
      apply: async () => (await import('./commands/plan.js')).commandPlan,
      canary: async () => (await import('./commands/canary.js')).commandCanary,
      report: async () => (await import('./commands/report.js')).commandReport,
      profile: async () => (await import('./commands/profile.js')).commandProfile
    };

    const load = cmd[parsed.command];
    if (load) {
      const handler = await load();
      if (!isFramed(parsed)) return await handler(parsed, io, style);
      // Short screens share one frame: the header line, a two-column indent
      // and a closing blank line (docs/TERMINAL.md).
      const theme = cliTheme(style, io);
      const sub = parsed.args[0] ?? '';
      writeLine(io.stdout, '');
      writeLine(io.stdout, headerLine(`${parsed.command} ${sub}`.trim(), '', theme));
      writeLine(io.stdout, '');
      const code = await handler(parsed, { ...io, stdout: indented(io.stdout) }, style);
      writeLine(io.stdout, '');
      return code;
    }

    if (parsed.command === 'help') {
      const helpTarget = parsed.args[0];
      if (helpTarget) {
        const meta = COMMANDS.find((c) => c.name === helpTarget);
        if (!meta) {
          writeLine(io.stderr, `Unknown command: ${helpTarget}`);
          writeLine(io.stderr, 'Run `agora help` for a list of commands.');
          return ExitCode.USAGE;
        }
        writeLine(io.stdout, commandManual(helpTarget, io));
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
      writeLine(io.stderr, retiredMessage(parsed.command, retired));
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

export function commandManual(
  name: string,
  io: CliIo = { stdout: process.stdout, stderr: process.stderr }
): string {
  const meta = COMMANDS.find((c) => c.name === name);
  if (!meta) return '';
  return renderManual(meta, cliTheme(style, io));
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
