import type { FetchLike } from '../live.js';

export type OutputStream = {
  write(chunk: string): unknown;
};

export interface CliIo {
  stdout: OutputStream;
  stderr: OutputStream;
  env?: Record<string, string | undefined>;
  cwd?: string;
  fetcher?: FetchLike;
}

export interface ParsedArgs {
  command?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const booleanFlags = new Set([
  'api',
  'continue',
  'dryRun',
  'help',
  'json',
  'live',
  'mcp',
  'offline',
  'table',
  'version',
  'verbose',
  'write'
]);

export function normalizeFlag(flag: string): string {
  return flag.trim().replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function shortFlag(arg: string): string {
  const flag = arg.slice(1);
  if (flag === 'h') return 'help';
  if (flag === 'j') return 'json';
  if (flag === 'm') return 'model';
  if (flag === 'c') return 'c';
  if (flag === 'n') return 'n';
  if (flag === 't') return 't';
  return flag;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const key = normalizeFlag(rawKey);

      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (
        !booleanFlags.has(key) &&
        argv[index + 1] &&
        (!argv[index + 1].startsWith('-') || /^-\d/.test(argv[index + 1]))
      ) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const key = shortFlag(arg);
      if (
        !booleanFlags.has(key) &&
        argv[index + 1] &&
        (!argv[index + 1].startsWith('-') || /^-\d/.test(argv[index + 1]))
      ) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return {
    command: positionals[0],
    args: positionals.slice(1),
    flags
  };
}
