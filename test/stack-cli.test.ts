/**
 * Tests for `agora installed` and `agora doctor` CLI commands.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { writeCapabilityCache } from '../src/stack/capability-cache';

// ── Test harness ─────────────────────────────────────────────────────────────

function createIo(cwd: string, home: string, extraEnv?: Record<string, string | undefined>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { HOME: home, ...extraEnv },
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

/** Write an opencode.json with one local MCP server. */
function writeOpencodeConfig(cwd: string, servers: Record<string, unknown>): void {
  writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: servers }));
}

/** Write a .cursor/mcp.json with mcpServers. */
function writeCursorConfig(cwd: string, mcpServers: Record<string, unknown>): void {
  const dir = join(cwd, '.cursor');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers }));
}

/** Create a stub executable in binDir and return the PATH string. */
function stubBin(binDir: string, name: string): string {
  const p = join(binDir, name);
  writeFileSync(p, '#!/bin/sh\n');
  chmodSync(p, 0o755);
  return binDir;
}

// ── agora installed ──────────────────────────────────────────────────────────

describe('agora installed', () => {
  test('lists configured servers from opencode.json', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      writeOpencodeConfig(cwd, {
        postgres: { command: ['npx', '@mcp/postgres'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      expect(out()).toContain('postgres');
      expect(out()).toContain('opencode');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('groups server present in multiple tools', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      writeOpencodeConfig(cwd, {
        'my-server': { command: ['node', 'server.js'], type: 'local' }
      });
      writeCursorConfig(cwd, {
        'my-server': { command: 'node', args: ['server.js'] }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('my-server');
      // Should only list once (grouped by name)
      const occurrences = (output.match(/my-server/g) ?? []).length;
      expect(occurrences).toBe(1);
      expect(output).toContain('opencode');
      expect(output).toContain('cursor');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--tool opencode filters to opencode servers only', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      writeOpencodeConfig(cwd, {
        'oc-server': { command: ['node', 'oc.js'], type: 'local' }
      });
      writeCursorConfig(cwd, {
        'cursor-server': { command: 'node', args: ['cursor.js'] }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed', '--tool', 'opencode'], io);
      expect(code).toBe(0);
      expect(out()).toContain('oc-server');
      expect(out()).not.toContain('cursor-server');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --tool returns non-zero and writes error', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['installed', '--tool', 'vscode-unknown'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('Unknown tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json returns expected shape with no configs', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(Array.isArray(payload.servers)).toBe(true);
      expect(Array.isArray(payload.tools)).toBe(true);
      expect(typeof payload.summary.servers).toBe('number');
      expect(typeof payload.summary.tools).toBe('number');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json includes servers when configured', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      writeOpencodeConfig(cwd, {
        redis: { command: ['npx', '@mcp/redis'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(payload.servers.length).toBe(1);
      expect(payload.servers[0].name).toBe('redis');
      expect(payload.summary.servers).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('empty case shows friendly message with search hint', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('No MCP servers configured');
      expect(output).toContain('agora search');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('summary line shows server and tool counts', async () => {
    const cwd = makeTmp('agora-installed-');
    const home = makeTmp('agora-home-');
    try {
      writeOpencodeConfig(cwd, {
        alpha: { command: ['node', 'a.js'], type: 'local' },
        beta: { command: ['node', 'b.js'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      expect(out()).toContain('2 server(s)');
      expect(out()).toContain('1 tool(s)');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── agora doctor ─────────────────────────────────────────────────────────────

describe('agora doctor', () => {
  test('reports ok for a server with a resolvable binary', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const binDir = makeTmp('agora-bin-');
    try {
      stubBin(binDir, 'my-mcp-server');
      writeOpencodeConfig(cwd, {
        'good-server': { command: ['my-mcp-server', '--stdio'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home, { PATH: binDir });
      const code = await runCli(['doctor'], io);
      expect(code).toBe(0);
      expect(out()).toContain('good-server');
      // ok summary
      expect(out()).toContain('ok: 1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('reports error for a server with a missing binary', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const emptyBinDir = makeTmp('agora-bin-');
    try {
      writeOpencodeConfig(cwd, {
        'bad-server': { command: ['totally-nonexistent-xyz-binary', '--stdio'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home, { PATH: emptyBinDir });
      const code = await runCli(['doctor'], io);
      // Without --strict, exit code is 0 even with errors
      expect(code).toBe(0);
      expect(out()).toContain('bad-server');
      expect(out()).toContain('error: 1');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(emptyBinDir, { recursive: true, force: true });
    }
  });

  test('--strict returns 1 when there is an error', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const emptyBinDir = makeTmp('agora-bin-');
    try {
      writeOpencodeConfig(cwd, {
        'bad-server': { command: ['totally-nonexistent-xyz-binary', '--stdio'], type: 'local' }
      });
      const { io } = createIo(cwd, home, { PATH: emptyBinDir });
      const code = await runCli(['doctor', '--strict'], io);
      expect(code).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(emptyBinDir, { recursive: true, force: true });
    }
  });

  test('--strict returns 0 when all servers are ok', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const binDir = makeTmp('agora-bin-');
    try {
      stubBin(binDir, 'my-mcp-server');
      writeOpencodeConfig(cwd, {
        'good-server': { command: ['my-mcp-server', '--stdio'], type: 'local' }
      });
      const { io } = createIo(cwd, home, { PATH: binDir });
      const code = await runCli(['doctor', '--strict'], io);
      expect(code).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('--json returns StackHealth shape', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const binDir = makeTmp('agora-bin-');
    try {
      stubBin(binDir, 'my-mcp-server');
      writeOpencodeConfig(cwd, {
        'json-server': { command: ['my-mcp-server', '--stdio'], type: 'local' }
      });
      const { io, out } = createIo(cwd, home, { PATH: binDir });
      const code = await runCli(['doctor', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(Array.isArray(payload.servers)).toBe(true);
      expect(typeof payload.summary.ok).toBe('number');
      expect(typeof payload.summary.warn).toBe('number');
      expect(typeof payload.summary.error).toBe('number');
      expect(payload.servers[0].name).toBe('json-server');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('--json empty case returns empty StackHealth', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['doctor', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(payload.servers).toEqual([]);
      expect(payload.summary).toEqual({ ok: 0, warn: 0, error: 0 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('empty case shows friendly message', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['doctor'], io);
      expect(code).toBe(0);
      expect(out()).toContain('No MCP servers configured');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --tool returns non-zero', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['doctor', '--tool', 'vscode'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('Unknown tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--tool filters results to that tool', async () => {
    const cwd = makeTmp('agora-doctor-');
    const home = makeTmp('agora-home-');
    const binDir = makeTmp('agora-bin-');
    try {
      stubBin(binDir, 'my-mcp-server');
      writeOpencodeConfig(cwd, {
        'oc-server': { command: ['my-mcp-server', '--stdio'], type: 'local' }
      });
      writeCursorConfig(cwd, {
        'cursor-server': { command: 'totally-nonexistent-xyz-binary', args: ['--stdio'] }
      });
      const { io, out } = createIo(cwd, home, { PATH: binDir });
      // Only check opencode — cursor-server is missing binary but we're filtering to opencode
      const code = await runCli(['doctor', '--tool', 'opencode', '--strict'], io);
      expect(code).toBe(0);
      expect(out()).toContain('oc-server');
      expect(out()).not.toContain('cursor-server');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});

// ── Fix 3: agora installed shows cached tool counts ──────────────────────────

describe('agora installed: capability cache tool counts (Fix 3)', () => {
  test('human output shows · N tools when cache entry exists', async () => {
    const cwd = makeTmp('agora-inst-tc-');
    const home = makeTmp('agora-inst-tc-home-');
    try {
      // Write a server config
      writeOpencodeConfig(cwd, {
        postgres: { type: 'local', command: ['npx', '@mcp/postgres'] }
      });

      // Use AGORA_HOME to deterministically control the data dir location
      const dataDir = join(home, 'agora-data');
      mkdirSync(dataDir, { recursive: true });
      writeCapabilityCache(dataDir, [
        {
          key: 'postgres@abc12345',
          name: 'postgres',
          command: ['npx', '@mcp/postgres'],
          tools: [{ name: 'query' }, { name: 'insert' }, { name: 'update' }],
          ok: true,
          probedAt: new Date().toISOString()
        }
      ]);

      const { io, out } = createIo(cwd, home, { AGORA_HOME: dataDir });
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('postgres');
      expect(output).toContain('3 tools');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('human output shows nothing extra when no cache entry', async () => {
    const cwd = makeTmp('agora-inst-tc-nocache-');
    const home = makeTmp('agora-inst-tc-nocache-home-');
    try {
      writeOpencodeConfig(cwd, {
        redis: { type: 'local', command: ['npx', '@mcp/redis'] }
      });

      // No capability cache written

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      const output = out();
      expect(output).toContain('redis');
      // Should NOT show "0 tools" — absence is the correct behavior
      expect(output).not.toContain('0 tools');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json includes tools count per server when cache entry exists', async () => {
    const cwd = makeTmp('agora-inst-tc-json-');
    const home = makeTmp('agora-inst-tc-json-home-');
    try {
      writeOpencodeConfig(cwd, {
        myserver: { type: 'local', command: ['npx', 'myserver'] }
      });

      const dataDir = join(home, 'agora-data');
      mkdirSync(dataDir, { recursive: true });
      writeCapabilityCache(dataDir, [
        {
          key: 'myserver@deadbeef',
          name: 'myserver',
          command: ['npx', 'myserver'],
          tools: [{ name: 'toolA' }, { name: 'toolB' }],
          ok: true,
          probedAt: new Date().toISOString()
        }
      ]);

      const { io, out } = createIo(cwd, home, { AGORA_HOME: dataDir });
      const code = await runCli(['installed', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(Array.isArray(payload.servers)).toBe(true);
      const srv = payload.servers.find((s: { name: string }) => s.name === 'myserver');
      expect(srv).toBeDefined();
      expect(srv.tools).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json omits tools field when no cache entry', async () => {
    const cwd = makeTmp('agora-inst-tc-json-no-');
    const home = makeTmp('agora-inst-tc-json-no-home-');
    try {
      writeOpencodeConfig(cwd, {
        alpha: { type: 'local', command: ['npx', 'alpha'] }
      });

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['installed', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      const srv = payload.servers.find((s: { name: string }) => s.name === 'alpha');
      expect(srv).toBeDefined();
      // No tools key when no cache entry
      expect(srv.tools).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cache entry with ok:false does not show tool count', async () => {
    const cwd = makeTmp('agora-inst-tc-notok-');
    const home = makeTmp('agora-inst-tc-notok-home-');
    try {
      writeOpencodeConfig(cwd, {
        broken: { type: 'local', command: ['npx', 'broken'] }
      });

      const dataDir = join(home, 'agora-data');
      mkdirSync(dataDir, { recursive: true });
      writeCapabilityCache(dataDir, [
        {
          key: 'broken@11111111',
          name: 'broken',
          command: ['npx', 'broken'],
          tools: [],
          ok: false,
          probedAt: new Date().toISOString()
        }
      ]);

      const { io, out } = createIo(cwd, home, { AGORA_HOME: dataDir });
      const code = await runCli(['installed'], io);
      expect(code).toBe(0);
      // ok:false → no tool count shown
      expect(out()).not.toContain(' tools');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
