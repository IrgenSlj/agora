import yargs from 'yargs';
import type { FetchLike } from '../fetch.js';

export type OutputStream = {
  write(chunk: string): unknown;
};

/**
 * Runs an install-plan shell command. Injectable for the same reason `fetcher`
 * is: without it, exercising an install path in a test shells out for real
 * (`npm install -g …`), mutating the machine running the suite.
 */
export type ExecLike = (command: string, options: { timeout: number }) => void;

export interface CliIo {
  stdout: OutputStream;
  stderr: OutputStream;
  env?: Record<string, string | undefined>;
  cwd?: string;
  fetcher?: FetchLike;
  exec?: ExecLike;
}

export interface ParsedArgs {
  command?: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const booleanFlags = new Set([
  'acceptRisk',
  'accept-risk',
  'acceptWarnings',
  'accept-warnings',
  'attestations',
  'clear',
  'continue',
  // Without this, `agora approve --deny k7m2xq` swallows the id as the flag's
  // value and silently lists pending requests instead of denying one.
  'deny',
  'down',
  'dryRun',
  'dry-run',
  'failOnUnknown',
  'fail-on-unknown',
  // Registered as the positive form: yargs turns `--no-fetch` into
  // `fetch: false` natively, and fighting that produces a flag that silently
  // does nothing.
  'fetch',
  'fix',
  'force',
  'help',
  'json',
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
