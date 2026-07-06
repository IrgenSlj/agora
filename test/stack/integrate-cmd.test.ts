/**
 * Tests for `agora integrate [harness|--all]` (brief P6 deliverable 1) —
 * dogfooding the stack manager's own ToolAdapter.writeServers to install
 * agora itself as an MCP server into each harness. This is acceptance demo 5.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

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

describe('agora integrate', () => {
  test('a bare harness id writes the agora launcher into that harness only (user scope)', async () => {
    const cwd = makeTmp('agora-integrate-one-');
    const home = makeTmp('agora-integrate-one-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['integrate', 'claude-code', '--json'], io);
      expect(code).toBe(0);

      const payload = JSON.parse(out());
      expect(payload.mode).toBe('integrated');
      expect(payload.scope).toBe('user');
      expect(payload.command).toEqual(['npx', '-y', 'agora-hub', 'mcp']);
      expect(payload.targets).toHaveLength(1);
      expect(payload.targets[0].tool).toBe('claude-code');
      expect(payload.targets[0].status).toBe('written');
      expect(payload.targets[0].change.added).toEqual(['agora']);

      const written = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
      expect(written.mcpServers.agora.command).toBe('npx');
      expect(written.mcpServers.agora.args).toEqual(['-y', 'agora-hub', 'mcp']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--all writes into every supported harness on a fresh machine (demo 5)', async () => {
    const cwd = makeTmp('agora-integrate-all-');
    const home = makeTmp('agora-integrate-all-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['integrate', '--all', '--json'], io);
      expect(code).toBe(0);

      const payload = JSON.parse(out());
      const tools = payload.targets.map((t: { tool: string }) => t.tool).sort();
      expect(tools).toEqual(['claude-code', 'cursor', 'opencode', 'windsurf']);
      expect(payload.targets.every((t: { status: string }) => t.status === 'written')).toBe(true);

      // opencode user-scope config
      const opencodeConfig = JSON.parse(
        readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')
      );
      expect(opencodeConfig.mcp.agora.command).toEqual(['npx', '-y', 'agora-hub', 'mcp']);

      // cursor user-scope config
      const cursorConfig = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
      expect(cursorConfig.mcpServers.agora.command).toBe('npx');

      // windsurf
      const windsurfConfig = JSON.parse(
        readFileSync(join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'utf8')
      );
      expect(windsurfConfig.mcpServers.agora.command).toBe('npx');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('surgical write: preserves unrelated keys and existing servers', async () => {
    const cwd = makeTmp('agora-integrate-surgical-');
    const home = makeTmp('agora-integrate-surgical-home-');
    try {
      const cursorDir = join(home, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      const original = {
        mcpServers: { other: { command: 'node', args: ['other.js'] } },
        someUnrelatedKey: { nested: true }
      };
      writeFileSync(join(cursorDir, 'mcp.json'), JSON.stringify(original));

      const { io } = createIo(cwd, home);
      const code = await runCli(['integrate', 'cursor'], io);
      expect(code).toBe(0);

      const written = JSON.parse(readFileSync(join(cursorDir, 'mcp.json'), 'utf8'));
      expect(written.someUnrelatedKey).toEqual({ nested: true });
      expect(written.mcpServers.other).toEqual({ command: 'node', args: ['other.js'] });
      expect(written.mcpServers.agora.command).toBe('npx');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--dry-run previews without writing anything', async () => {
    const cwd = makeTmp('agora-integrate-dryrun-');
    const home = makeTmp('agora-integrate-dryrun-home-');
    try {
      const { io, out } = createIo(cwd, home);
      const code = await runCli(['integrate', '--all', '--dry-run', '--json'], io);
      expect(code).toBe(0);

      const payload = JSON.parse(out());
      expect(payload.mode).toBe('plan');
      expect(payload.targets.every((t: { status: string }) => t.status === 'planned')).toBe(true);

      expect(existsSync(join(home, '.claude.json'))).toBe(false);
      expect(existsSync(join(home, '.cursor', 'mcp.json'))).toBe(false);
      expect(existsSync(join(home, '.config', 'opencode', 'opencode.json'))).toBe(false);
      expect(existsSync(join(home, '.codeium', 'windsurf', 'mcp_config.json'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('re-running is idempotent: second run reports an update, not a duplicate add', async () => {
    const cwd = makeTmp('agora-integrate-idempotent-');
    const home = makeTmp('agora-integrate-idempotent-home-');
    try {
      const { io: io1 } = createIo(cwd, home);
      await runCli(['integrate', 'claude-code'], io1);

      const { io: io2, out } = createIo(cwd, home);
      const code = await runCli(['integrate', 'claude-code', '--json'], io2);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(payload.targets[0].change.added).toEqual([]);
      expect(payload.targets[0].change.updated).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('rejects an unknown harness id', async () => {
    const cwd = makeTmp('agora-integrate-unknown-');
    const home = makeTmp('agora-integrate-unknown-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['integrate', 'not-a-real-harness'], io);
      expect(code).toBe(1);
      expect(err()).toContain('Unknown harness');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('rejects both a harness id and --all together', async () => {
    const cwd = makeTmp('agora-integrate-both-');
    const home = makeTmp('agora-integrate-both-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['integrate', 'cursor', '--all'], io);
      expect(code).toBe(1);
      expect(err()).toContain('not both');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('requires a harness id or --all', async () => {
    const cwd = makeTmp('agora-integrate-none-');
    const home = makeTmp('agora-integrate-none-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['integrate'], io);
      expect(code).toBe(1);
      expect(err()).toContain('--all');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
