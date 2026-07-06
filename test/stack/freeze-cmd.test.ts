/**
 * Tests for `agora freeze` CLI command.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';

// ── Harness ───────────────────────────────────────────────────────────────────

function createIo(cwd: string, home: string, extraEnv?: Record<string, string | undefined>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { HOME: home, NO_COLOR: '1', ...extraEnv },
      cwd
    },
    stdout,
    stderr,
    out: () => stdout.join(''),
    err: () => stderr.join('')
  };
}

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeOpencodeConfig(cwd: string, servers: Record<string, unknown>): void {
  writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: servers }));
}

function writeCursorConfig(cwd: string, mcpServers: Record<string, unknown>): void {
  const dir = join(cwd, '.cursor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers }));
}

// ── agora freeze ──────────────────────────────────────────────────────────────

describe('agora freeze', () => {
  test('prints TOML to stdout by default (preview)', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, {
        postgres: { command: ['npx', '@mcp/postgres'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('[mcp.postgres]');
      expect(output).toContain('command =');
      // No file written
      expect(existsSync(join(cwd, 'agora.toml'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json returns StackManifest object', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, {
        linear: { url: 'https://mcp.linear.app/sse', type: 'remote' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(typeof payload.mcp).toBe('object');
      expect(payload.mcp['linear']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--tool filters to a single tool', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, { 'oc-server': { command: ['node', 'oc.js'], type: 'local' } });
      writeCursorConfig(cwd, { 'cursor-server': { command: 'node', args: ['cursor.js'] } });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze', '--tool', 'opencode'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('oc-server');
      expect(output).not.toContain('cursor-server');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --tool returns non-zero with error message', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['freeze', '--tool', 'vscode-unknown'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('Unknown tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('empty stack shows friendly message, exits 0', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze'], io);
      expect(code).toBe(0);
      expect(out()).toContain('No MCP servers configured');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write creates agora.toml at cwd', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, {
        redis: { command: ['npx', '@mcp/redis'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze', '--write'], io);
      expect(code).toBe(0);
      expect(existsSync(join(cwd, 'agora.toml'))).toBe(true);
      expect(out()).toContain('Written to');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write refuses to overwrite existing agora.toml without --force', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, { redis: { command: ['npx', '@mcp/redis'], type: 'local' } });
      writeFileSync(join(cwd, 'agora.toml'), '# existing\n');
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['freeze', '--write'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('--force');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write --force overwrites existing agora.toml', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, { redis: { command: ['npx', '@mcp/redis'], type: 'local' } });
      writeFileSync(join(cwd, 'agora.toml'), '# existing\n');
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze', '--write', '--force'], io);
      expect(code).toBe(0);
      expect(out()).toContain('Written to');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write --out writes to custom path', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    const outPath = join(cwd, 'custom-stack.toml');
    try {
      writeOpencodeConfig(cwd, { srv: { command: ['node', 'srv.js'], type: 'local' } });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze', '--write', '--out', outPath], io);
      expect(code).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      expect(out()).toContain(outPath);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('conflict: server in multiple tools emits a warning to stderr', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, { shared: { command: ['node', 'oc.js'], type: 'local' } });
      writeCursorConfig(cwd, { shared: { command: 'python', args: ['cursor.py'] } });
      const { io, out, err } = createIo(cwd, home);
      const code = await runCli(['freeze'], io);
      expect(code).toBe(0);
      // Only one entry in output
      const toml = out();
      const occurrences = (toml.match(/\[mcp\.shared\]/g) ?? []).length;
      expect(occurrences).toBe(1);
      // Warning on stderr
      expect(err()).toContain('shared');
      expect(err()).toContain('opencode');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('output is valid TOML that round-trips via parseManifest', async () => {
    const cwd = makeTmp('agora-freeze-');
    const home = makeTmp('agora-freeze-home-');
    try {
      writeOpencodeConfig(cwd, {
        alpha: { command: ['npx', 'alpha-mcp'], type: 'local' },
        beta: { url: 'https://beta.example.com/sse', type: 'remote' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['freeze'], io);
      expect(code).toBe(0);

      const { parseManifest } = await import('../../src/stack/manifest');
      const parsed = parseManifest(out());
      expect(parsed.mcp['alpha']?.command).toBeDefined();
      expect(parsed.mcp['beta']?.url).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
