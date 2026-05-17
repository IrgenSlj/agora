/**
 * Contract tests for parseArgs and CLI commands (src/cli/app.ts).
 * Uses the CliIo harness pattern from cli.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
      expect(Array.isArray(payload.config.plugin)).toBe(true);
      expect(payload.config.plugin).toContain('opencode-agora');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora init --mcp', () => {
  test('--json --dry-run --mcp includes the Agora MCP server in the plan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-init-mcp-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['init', '--json', '--dry-run', '--mcp'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload.config.mcp.agora).toEqual({
        type: 'local',
        command: ['agora', 'mcp'],
        enabled: true
      });
      expect(payload.servers).toContain('agora');
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
      expect(config.plugin).toContain('skill-tdd-cycle');
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

  test('use without an id lists available workflows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-use-noid-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['use'], io);
      expect(code).toBe(0);
      expect(stdout.join('')).toContain('agora use');
      expect(stdout.join('')).toContain('available workflows');
      expect(stdout.join('')).toContain('wf-tdd-cycle');
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
      const occurrences = (config.plugin as string[]).filter((p) => p === 'skill-tdd-cycle').length;
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

// ── agora export ──────────────────────────────────────────────────────────────

describe('agora export', () => {
  test('export with no args outputs JSON by default', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload).toHaveProperty('count');
    expect(payload).toHaveProperty('items');
    expect(payload.count).toBeGreaterThan(0);
  });

  test('export --format csv produces CSV output', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', '--format', 'csv'], io);
    expect(code).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('id,name,kind,category');
    expect(output).toContain('mcp-github');
  });

  test('export --format markdown produces markdown table', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', '--format', 'markdown'], io);
    expect(code).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('| id | name | kind |');
    expect(output).toContain('mcp-');
  });

  test('export with query filters results', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', 'postgres'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.count).toBeGreaterThan(0);
    for (const item of payload.items) {
      const matches = item.id.toLowerCase().includes('postgres') || item.name.toLowerCase().includes('postgres');
      expect(matches).toBe(true);
    }
  });

  test('export with --category mcp only returns mcp items', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', '--category', 'mcp'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    for (const item of payload.items) {
      expect(item.category).toBe('mcp');
    }
  });

  test('export --limit N limits results', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', '--limit', '3'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.count).toBeLessThanOrEqual(3);
  });

  test('export with unknown format exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['export', '--format', 'xml'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('Unknown format');
  });
});

// ── agora config show ─────────────────────────────────────────────────────────

describe('agora config show', () => {
  test('config show with no config exists 0 and reports not found', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['config', 'show'], io);
    expect(code).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('Exists');
    expect(output).toContain('no');
  });

  test('config show --json returns JSON shape', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['config', 'show', '--json'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload).toHaveProperty('path');
    expect(payload).toHaveProperty('exists');
    expect(payload).toHaveProperty('config');
  });

  test('config show reads an existing config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-config-show-'));
    const configPath = join(dir, 'opencode.json');
    writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugin: ['test'] }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'show'], io);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain('Exists');
      expect(output).toContain('yes');
      expect(output).toContain('"test"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── agora config doctor ───────────────────────────────────────────────────────

describe('agora config doctor', () => {
  test('config doctor with no config reports not found', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['config', 'doctor'], io);
    expect(code).toBe(0);
    const output = stdout.join('');
    expect(output).toContain('Exists');
  });

  test('config doctor --json returns valid report', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['config', 'doctor', '--json'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload).toHaveProperty('path');
    expect(payload).toHaveProperty('valid');
    expect(payload).toHaveProperty('mcpServers');
    expect(payload).toHaveProperty('plugins');
  });

  test('config doctor --fix on valid config does not crash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-doctor-fix-'));
    const configPath = join(dir, 'opencode.json');
    writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugin: ['test'] }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'doctor', '--fix'], io);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain('No fixes needed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config doctor --fix adds missing $schema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-doctor-schema-'));
    const configPath = join(dir, 'opencode.json');
    writeFileSync(configPath, JSON.stringify({ plugin: ['test'] }), 'utf8');
    const { io } = createIo(dir);
    try {
      await runCli(['config', 'doctor', '--fix'], io);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.$schema).toBe('https://opencode.ai/config.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config doctor --fix deduplicates plugins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-doctor-dedupe-'));
    const configPath = join(dir, 'opencode.json');
    writeFileSync(configPath, JSON.stringify({ plugin: ['a', 'b', 'a', 'c', 'b'], $schema: 'https://opencode.ai/config.json' }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'doctor', '--fix'], io);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain('duplicate');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.plugin).toEqual(['a', 'b', 'c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config doctor --fix removes empty MCP entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-doctor-mcp-'));
    const configPath = join(dir, 'opencode.json');
    writeFileSync(configPath, JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: { valid: { type: 'local', command: ['node', 'ok.js'] }, invalid: { type: 'local', command: [] } }
    }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'doctor', '--fix'], io);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain('Removed MCP entry');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.mcp.valid).toBeDefined();
      expect(config.mcp.invalid).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── agora config diff ─────────────────────────────────────────────────────────

describe('agora config diff', () => {
  test('config diff with fewer than 2 paths exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['config', 'diff'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires two paths');
  });

  test('config diff compares two config files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-diff-'));
    const path1 = join(dir, 'c1.json');
    const path2 = join(dir, 'c2.json');
    writeFileSync(path1, JSON.stringify({ plugin: ['a'], mcp: { s1: { type: 'local', command: ['node'] } } }), 'utf8');
    writeFileSync(path2, JSON.stringify({ plugin: ['a', 'b'], mcp: { s1: { type: 'local', command: ['node'] }, s2: { type: 'local', command: ['python'] } } }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'diff', path1, path2], io);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain('Config diff');
      expect(output).toContain('MCP added');
      expect(output).toContain('Plugin added');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('config diff --json returns structured data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-diff-json-'));
    const path1 = join(dir, 'c1.json');
    const path2 = join(dir, 'c2.json');
    writeFileSync(path1, JSON.stringify({}), 'utf8');
    writeFileSync(path2, JSON.stringify({ plugin: ['a'] }), 'utf8');
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['config', 'diff', '--json', path1, path2], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload).toHaveProperty('path1');
      expect(payload).toHaveProperty('path2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── agora notify ──────────────────────────────────────────────────────────────

describe('agora notify', () => {
  test('notify with no message exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['notify'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires a message');
  });

  test('notify --json returns metadata without sending', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['notify', '--json', 'test message', '--title', 'Test'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.title).toBe('Test');
    expect(payload.message).toBe('test message');
    expect(payload.sound).toBe(false);
    expect(payload).toHaveProperty('platform');
  });

  test('notify --sound --json shows sound=true', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['notify', '--json', '--sound', 'hello'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.sound).toBe(true);
  });
});

// ── agora watch ───────────────────────────────────────────────────────────────

describe('agora watch', () => {
  test('watch with no args exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['watch'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires a command');
  });

  test('watch with invalid interval exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['watch', 'abc', 'agora', 'trending'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('Invalid interval');
  });

  test('watch with no command after interval exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['watch', '5'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires a command');
  });
});

// ── agora show (alias) ────────────────────────────────────────────────────────

describe('agora show alias', () => {
  test('show maps to config show', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['show'], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('Exists');
  });
});

// ── agora diff (alias) ────────────────────────────────────────────────────────

describe('agora diff alias', () => {
  test('diff with <2 args exits 1', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['diff'], io);
    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires two paths');
  });
});
