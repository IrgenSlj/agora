import yargs from 'yargs';
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
  'acceptWarnings',
  'accept-warnings',
  'api',
  'clear',
  'continue',
  'down',
  'dryRun',
  'dry-run',
  'fix',
  'force',
  'help',
  'json',
  'live',
  'mcp',
  'offline',
  'once',
  'probe',
  'prune',
  'refresh',
  'save',
  'skipScan',
  'skip-scan',
  'sound',
  'status',
  'strict',
  'table',
  'up',
  'version',
  'verbose',
  'write',
  'yes'
]);

export function normalizeFlag(flag: string): string {
  return flag.trim().replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parser = yargs(argv)
    .strict(false)
    .help(false)
    .version(false)
    .alias('h', 'help')
    .alias('j', 'json')
    .alias('m', 'model')
    .alias('y', 'yes');

  for (const flag of booleanFlags) {
    parser.boolean(flag);
  }

  const parsed = parser.parseSync();

  const positionals = parsed._.map(String);
  const command = positionals[0];
  const args = positionals.slice(1);

  const flags: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === '_' || key === '$0') continue;
    if (key === 'h' || key === 'j' || key === 'm' || key === 'y') continue;
    flags[key] = typeof value === 'number' ? String(value) : (value as string | boolean);
  }

  return { command, args, flags };
}
