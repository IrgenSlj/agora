import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { parseArgs } from '../src/cli/flags';

function createIo(cwd = process.cwd(), options: { env?: Record<string, string | undefined> } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  // Pin the OpenCode config to the (temp) cwd so a test can never write to
  // the developer's real ~/.config/opencode/opencode.json. Callers can still
  // override via options.env.
  const env = { OPENCODE_CONFIG: join(cwd, 'opencode.json'), ...options.env };
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env,
      cwd
    },
    stdout,
    stderr
  };
}

// ── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  test('extracts command and positional args', () => {
    const p = parseArgs(['search', 'filesystem', 'extra']);
    expect(p.command).toBe('search');
    expect(p.args).toEqual(['filesystem', 'extra']);
  });

  test('boolean flags are set to true', () => {
    const p = parseArgs(['search', '--json', '--offline']);
    expect(p.flags.json).toBe(true);
    expect(p.flags.offline).toBe(true);
  });

  test('string flags with a space consume the next token', () => {
    const p = parseArgs(['search', '--category', 'mcp', '--limit', '5']);
    expect(p.flags.category).toBe('mcp');
    expect(p.flags.limit).toBe('5');
  });

  test('inline flag value with = is parsed correctly', () => {
    const p = parseArgs(['browse', '--type=workflow']);
    expect(p.flags.type).toBe('workflow');
  });

  test('negative-number values are NOT treated as flags', () => {
    // --rating -3 should parse -3 as the value, not drop it
    const p = parseArgs(['review', 'mcp-github', '--rating', '-3']);
    expect(p.flags.rating).toBe('-3');
  });

  test('-- stops flag parsing and passes remaining as positionals', () => {
    const p = parseArgs(['search', '--', '--not-a-flag', 'also-not']);
    expect(p.args).toContain('--not-a-flag');
    expect(p.args).toContain('also-not');
  });

  test('short flags are expanded to their canonical name', () => {
    const p = parseArgs(['-h']);
    expect(p.flags.help).toBe(true);
  });

  test('camelCase normalisation of kebab flags', () => {
    const p = parseArgs(['init', '--dry-run']);
    expect(p.flags.dryRun).toBe(true);
  });

  test('no args produces undefined command', () => {
    const p = parseArgs([]);
    expect(p.command).toBeUndefined();
    expect(p.args).toHaveLength(0);
  });
});

// ── agora init --dry-run ─────────────────────────────────────────────────────

describe('unknown command', () => {
  test('exits 2 with a helpful message', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['totally-unknown-command'], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown command');
  });
});

// ── agora export ──────────────────────────────────────────────────────────────
