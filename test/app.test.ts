/**
 * Contract tests for parseArgs and CLI commands (src/cli/app.ts).
 * Uses the CliIo harness pattern from cli.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli/app';

function createIo(
  cwd = process.cwd(),
  options: { env?: Record<string, string | undefined> } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: options.env ?? {},
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

describe('agora init --dry-run', () => {
  test('does not crash and exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-init-test-'));
    const { io, stdout, stderr } = createIo(dir);
    try {
      const code = await runCli(['init', '--dry-run'], io);
      expect(code).toBe(0);
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json --dry-run emits a plan with config, servers, and commands keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-init-json-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['init', '--json', '--dry-run'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload).toHaveProperty('config');
      expect(payload).toHaveProperty('servers');
      expect(payload).toHaveProperty('commands');
      expect(payload.dryRun).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json --dry-run config contains $schema and plugins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-init-schema-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['init', '--json', '--dry-run'], io);
      const payload = JSON.parse(stdout.join(''));
      expect(payload.config.$schema).toBe('https://opencode.ai/config.json');
      expect(Array.isArray(payload.config.plugins)).toBe(true);
      expect(payload.config.plugins).toContain('opencode-agora');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── agora use ────────────────────────────────────────────────────────────────

describe('agora use', () => {
  test('use with a valid workflow id exits 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-test-'));
    const { io, stdout, stderr } = createIo(dir);
    try {
      const code = await runCli(['use', 'wf-tdd-cycle', '--json'], io);
      expect(code).toBe(0);
      expect(stderr.join('')).toBe('');
      const payload = JSON.parse(stdout.join(''));
      expect(payload.workflow).toBe('wf-tdd-cycle');
      expect(payload.registered).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use writes the skill file to .opencode/skills/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-skill-'));
    const { io } = createIo(dir);
    try {
      await runCli(['use', 'wf-tdd-cycle'], io);
      const skillPath = join(dir, '.opencode', 'skills', 'skill-tdd-cycle.md');
      const content = readFileSync(skillPath, 'utf8');
      expect(content).toContain('TDD Development Cycle');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use registers the skill in opencode.json plugins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-plugins-'));
    const configPath = join(dir, 'opencode.json');
    const { io } = createIo(dir);
    try {
      await runCli(['use', 'wf-tdd-cycle'], io);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.plugins).toContain('skill-tdd-cycle');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use with unknown workflow id exits 1 with an error message', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-unknown-'));
    const { io, stderr } = createIo(dir);
    try {
      const code = await runCli(['use', 'wf-does-not-exist'], io);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('Workflow not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use without an id exits 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-noid-'));
    const { io, stderr } = createIo(dir);
    try {
      const code = await runCli(['use'], io);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('use requires a workflow id');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use bails with non-zero exit when opencode.json is malformed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-malformed-'));
    const configPath = join(dir, 'opencode.json');
    try {
      writeFileSync(configPath, 'this is not json', 'utf8');
      const { io, stderr } = createIo(dir);
      const code = await runCli(['use', 'wf-tdd-cycle'], io);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('Config file is not valid JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('use is idempotent — running twice does not duplicate the plugin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-idem-'));
    const configPath = join(dir, 'opencode.json');
    const { io } = createIo(dir);
    try {
      await runCli(['use', 'wf-tdd-cycle'], io);
      const io2 = createIo(dir).io;
      await runCli(['use', 'wf-tdd-cycle'], io2);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const occurrences = (config.plugins as string[]).filter((p) => p === 'skill-tdd-cycle').length;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── unknown command ──────────────────────────────────────────────────────────

describe('unknown command', () => {
  test('exits 1 with a helpful message', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['totally-unknown-command'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('Unknown command');
  });
});
