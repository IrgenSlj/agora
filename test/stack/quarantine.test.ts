import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { quarantineConfiguredServers } from '../../src/stack/quarantine';
import type { ConfiguredServer } from '../../src/stack/types';

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeServer(overrides: Partial<ConfiguredServer>): ConfiguredServer {
  return {
    name: 'bad',
    tool: 'opencode',
    scope: 'project',
    configPath: '/tmp/opencode.json',
    transport: 'local',
    command: ['node', 'server.js'],
    enabled: true,
    raw: {},
    ...overrides
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('quarantineConfiguredServers', () => {
  test('disables OpenCode servers while preserving unrelated config and peers', () => {
    const cwd = makeTmp('agora-quarantine-oc-');
    try {
      const path = join(cwd, 'opencode.json');
      writeFileSync(
        path,
        JSON.stringify(
          {
            theme: 'nord',
            mcp: {
              bad: { type: 'local', command: ['node', 'bad.js'] },
              good: { type: 'local', command: ['node', 'good.js'] }
            }
          },
          null,
          2
        )
      );

      const rewrites = quarantineConfiguredServers(
        [
          makeServer({ name: 'bad', configPath: path, command: ['node', 'bad.js'] }),
          makeServer({ name: 'good', configPath: path, command: ['node', 'good.js'] })
        ],
        ['bad'],
        { cwd }
      );

      expect(rewrites).toEqual([
        expect.objectContaining({
          tool: 'opencode',
          action: 'disabled',
          ok: true,
          serverNames: ['bad']
        })
      ]);
      const json = readJson(path);
      expect(json.theme).toBe('nord');
      const mcp = json.mcp as Record<string, Record<string, unknown>>;
      expect(mcp.bad?.enabled).toBe(false);
      expect(mcp.good).toEqual({ type: 'local', command: ['node', 'good.js'] });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('removes servers from hosts that cannot represent disabled state', () => {
    const cwd = makeTmp('agora-quarantine-cc-');
    try {
      const path = join(cwd, '.mcp.json');
      writeFileSync(
        path,
        JSON.stringify(
          {
            unrelated: true,
            mcpServers: {
              bad: { command: 'node', args: ['bad.js'] },
              good: { command: 'node', args: ['good.js'] }
            }
          },
          null,
          2
        )
      );

      const rewrites = quarantineConfiguredServers(
        [
          makeServer({
            name: 'bad',
            tool: 'claude-code',
            configPath: path,
            command: ['node', 'bad.js']
          }),
          makeServer({
            name: 'good',
            tool: 'claude-code',
            configPath: path,
            command: ['node', 'good.js']
          })
        ],
        ['bad'],
        { cwd }
      );

      expect(rewrites).toEqual([
        expect.objectContaining({
          tool: 'claude-code',
          action: 'removed',
          ok: true,
          serverNames: ['bad']
        })
      ]);
      const json = readJson(path);
      expect(json.unrelated).toBe(true);
      const mcpServers = json.mcpServers as Record<string, unknown>;
      expect(mcpServers.bad).toBeUndefined();
      expect(mcpServers.good).toEqual({ command: 'node', args: ['good.js'] });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('reports Claude Code project entries nested in user config as skipped', () => {
    const cwd = makeTmp('agora-quarantine-cwd-');
    const home = makeTmp('agora-quarantine-home-');
    try {
      const path = join(home, '.claude.json');
      const rewrites = quarantineConfiguredServers(
        [
          makeServer({
            name: 'bad',
            tool: 'claude-code',
            scope: 'project',
            configPath: path,
            command: ['node', 'bad.js']
          })
        ],
        ['bad'],
        { cwd, home }
      );

      expect(rewrites).toEqual([
        expect.objectContaining({
          tool: 'claude-code',
          ok: false,
          reason: expect.stringContaining('nested config')
        })
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
