import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli/app';

function createIo(cwd = process.cwd()) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: {},
      cwd
    },
    stdout,
    stderr
  };
}

describe('CLI argument parsing', () => {
  test('parses commands, positionals, and flags', () => {
    const parsed = parseArgs(['search', 'filesystem', '--category', 'mcp', '-n', '3', '--json']);

    expect(parsed.command).toBe('search');
    expect(parsed.args).toEqual(['filesystem']);
    expect(parsed.flags.category).toBe('mcp');
    expect(parsed.flags.n).toBe('3');
    expect(parsed.flags.json).toBe(true);
  });

  test('parses inline flag values', () => {
    const parsed = parseArgs(['browse', 'mcp-github', '--type=package']);

    expect(parsed.command).toBe('browse');
    expect(parsed.flags.type).toBe('package');
  });
});

describe('CLI commands', () => {
  test('search prints matching marketplace results', async () => {
    const { io, stdout, stderr } = createIo();
    const code = await runCli(['search', 'filesystem'], io);

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('mcp-filesystem');
  });

  test('search supports JSON output', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['search', 'github', '--json'], io);
    const payload = JSON.parse(stdout.join(''));

    expect(code).toBe(0);
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.items[0].id).toContain('github');
  });

  test('browse returns an error for missing items', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['browse', 'missing-package'], io);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('Item not found');
  });

  test('install previews config without writing by default', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--config', configPath], io);

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Install preview');
      expect(stdout.join('')).toContain('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write creates an OpenCode config', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--write', '--config', configPath], io);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Updated');
      expect(config.mcpServers['mcp-github'].args).toEqual(['@modelcontextprotocol/server-github']);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('config doctor reports config metadata', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const setup = createIo(temp);

    try {
      await runCli(['install', 'mcp-filesystem', '--write', '--config', configPath], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['config', 'doctor', '--config', configPath, '--json'], io);
      const report = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(report.exists).toBe(true);
      expect(report.valid).toBe(true);
      expect(report.mcpServers).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('save stores items in the Agora data directory', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['save', 'wf-security-audit', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Saved wf-security-audit');
      expect(state.savedItems[0].id).toBe('wf-security-audit');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('saved lists persisted items as JSON', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['saved', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.count).toBe(1);
      expect(payload.items[0].item.id).toBe('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('save is idempotent', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['save', 'mcp-github', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('already saved');
      expect(state.savedItems).toHaveLength(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('remove deletes saved items', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['remove', 'mcp-github', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Removed mcp-github');
      expect(state.savedItems).toHaveLength(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('saved does not create state when empty', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['saved', '--data-dir', dataDir], io);

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('No saved items yet');
      expect(existsSync(join(dataDir, 'state.json'))).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
