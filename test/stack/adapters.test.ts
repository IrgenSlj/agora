/**
 * Tests for each tool adapter: opencode, claude-code, cursor, windsurf.
 * Uses temp dirs. No network. No spawns.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { opencodeAdapter } from '../../src/stack/adapters/opencode';
import { claudeCodeAdapter } from '../../src/stack/adapters/claude-code';
import { cursorAdapter } from '../../src/stack/adapters/cursor';
import { windsurfAdapter } from '../../src/stack/adapters/windsurf';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-stack-test-'));
}

// ---------------------------------------------------------------------------
// opencode adapter
// ---------------------------------------------------------------------------
describe('opencodeAdapter', () => {
  test('reads local and remote servers from opencode.json in cwd', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const config = {
        mcp: {
          'my-local': {
            type: 'local',
            command: ['npx', 'my-pkg'],
            environment: { TOKEN: 'abc' },
            enabled: true
          },
          'my-disabled': {
            type: 'local',
            command: ['node', 'server.js'],
            enabled: false
          }
        }
      };
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify(config));

      const opts = { cwd, home };
      const servers = opencodeAdapter.readServers(opts);

      expect(servers.length).toBe(2);

      const local = servers.find((s) => s.name === 'my-local')!;
      expect(local.transport).toBe('local');
      expect(local.command).toEqual(['npx', 'my-pkg']);
      expect(local.env).toEqual({ TOKEN: 'abc' });
      expect(local.enabled).toBe(true);
      expect(local.scope).toBe('project');
      expect(local.tool).toBe('opencode');

      const disabled = servers.find((s) => s.name === 'my-disabled')!;
      expect(disabled.enabled).toBe(false);
      expect(disabled.command).toEqual(['node', 'server.js']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads from ~/.config/opencode/opencode.json with scope user', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const userConfigDir = join(home, '.config', 'opencode');
      mkdirSync(userConfigDir, { recursive: true });
      const config = {
        mcp: {
          'user-server': {
            type: 'local',
            command: ['uvx', 'mcp-server'],
            enabled: true
          }
        }
      };
      writeFileSync(join(userConfigDir, 'opencode.json'), JSON.stringify(config));

      const servers = opencodeAdapter.readServers({ cwd, home });
      const s = servers.find((s) => s.name === 'user-server')!;
      expect(s).toBeDefined();
      expect(s.scope).toBe('user');
      expect(s.command).toEqual(['uvx', 'mcp-server']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('handles remote/url entry', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const config = {
        mcp: {
          'remote-srv': {
            type: 'remote',
            url: 'https://example.com/mcp'
          }
        }
      };
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify(config));
      const servers = opencodeAdapter.readServers({ cwd, home });
      const s = servers[0]!;
      expect(s.transport).toBe('remote');
      expect(s.url).toBe('https://example.com/mcp');
      expect(s.enabled).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing file returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const servers = opencodeAdapter.readServers({ cwd, home });
      expect(servers).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid JSON returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeFileSync(join(cwd, 'opencode.json'), 'NOT JSON {{{');
      const servers = opencodeAdapter.readServers({ cwd, home });
      expect(servers).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('locations() returns priority order', () => {
    const cwd = '/fake/cwd';
    const home = '/fake/home';
    const locs = opencodeAdapter.locations({ cwd, home });
    expect(locs[0]!.path).toContain('opencode.json');
    expect(locs[0]!.scope).toBe('project');
    expect(locs[1]!.scope).toBe('user');
    expect(locs[2]!.scope).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// claude-code adapter
// ---------------------------------------------------------------------------
describe('claudeCodeAdapter', () => {
  test('reads local server from .mcp.json (project scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const mcp = {
        mcpServers: {
          'proj-server': {
            command: 'npx',
            args: ['-y', 'mcp-tool'],
            env: { KEY: 'val' }
          }
        }
      };
      writeFileSync(join(cwd, '.mcp.json'), JSON.stringify(mcp));

      const servers = claudeCodeAdapter.readServers({ cwd, home });
      expect(servers.length).toBe(1);
      const s = servers[0]!;
      expect(s.name).toBe('proj-server');
      expect(s.transport).toBe('local');
      expect(s.command).toEqual(['npx', '-y', 'mcp-tool']);
      expect(s.env).toEqual({ KEY: 'val' });
      expect(s.scope).toBe('project');
      expect(s.enabled).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads remote server from .mcp.json', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const mcp = {
        mcpServers: {
          'remote-mcp': { url: 'https://remote.example.com/sse', type: 'sse' }
        }
      };
      writeFileSync(join(cwd, '.mcp.json'), JSON.stringify(mcp));
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      const s = servers[0]!;
      expect(s.transport).toBe('remote');
      expect(s.url).toBe('https://remote.example.com/sse');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads top-level mcpServers from ~/.claude.json (user scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const claude = {
        mcpServers: {
          'user-tool': { command: 'node', args: ['server.js'] }
        }
      };
      writeFileSync(join(home, '.claude.json'), JSON.stringify(claude));
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'user-tool')!;
      expect(s).toBeDefined();
      expect(s.scope).toBe('user');
      expect(s.command).toEqual(['node', 'server.js']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads projects[cwd].mcpServers from ~/.claude.json (project scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const claude = {
        mcpServers: {
          'user-level': { command: 'node', args: ['a.js'] }
        },
        projects: {
          [cwd]: {
            mcpServers: {
              'proj-in-user-file': { command: 'python3', args: ['serve.py'] }
            }
          }
        }
      };
      writeFileSync(join(home, '.claude.json'), JSON.stringify(claude));
      const servers = claudeCodeAdapter.readServers({ cwd, home });

      const userServer = servers.find((s) => s.name === 'user-level')!;
      expect(userServer.scope).toBe('user');

      const projServer = servers.find((s) => s.name === 'proj-in-user-file')!;
      expect(projServer).toBeDefined();
      expect(projServer.scope).toBe('project');
      expect(projServer.command).toEqual(['python3', 'serve.py']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('dedupe: same name+command in user-level and projects map is not duplicated', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const claude = {
        mcpServers: {
          shared: { command: 'node', args: ['shared.js'] }
        },
        projects: {
          [cwd]: {
            mcpServers: {
              shared: { command: 'node', args: ['shared.js'] }
            }
          }
        }
      };
      writeFileSync(join(home, '.claude.json'), JSON.stringify(claude));
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      const sharedServers = servers.filter((s) => s.name === 'shared');
      // Should have exactly 1 from top-level (scope: user); the project dupe is skipped
      expect(sharedServers.length).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid JSON returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeFileSync(join(cwd, '.mcp.json'), '{{ bad json');
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      expect(servers).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing files return []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      expect(claudeCodeAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// cursor adapter
// ---------------------------------------------------------------------------
describe('cursorAdapter', () => {
  test('reads local server from <cwd>/.cursor/mcp.json (project scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const cursorDir = join(cwd, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      const mcp = {
        mcpServers: {
          'cursor-local': { command: 'npx', args: ['cursor-mcp'] }
        }
      };
      writeFileSync(join(cursorDir, 'mcp.json'), JSON.stringify(mcp));

      const servers = cursorAdapter.readServers({ cwd, home });
      expect(servers.length).toBe(1);
      const s = servers[0]!;
      expect(s.name).toBe('cursor-local');
      expect(s.scope).toBe('project');
      expect(s.command).toEqual(['npx', 'cursor-mcp']);
      expect(s.tool).toBe('cursor');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads remote server from <home>/.cursor/mcp.json (user scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const cursorDir = join(home, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      const mcp = {
        mcpServers: {
          'cursor-remote': { url: 'https://cursor.example.com/mcp' }
        }
      };
      writeFileSync(join(cursorDir, 'mcp.json'), JSON.stringify(mcp));

      const servers = cursorAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'cursor-remote')!;
      expect(s).toBeDefined();
      expect(s.scope).toBe('user');
      expect(s.transport).toBe('remote');
      expect(s.url).toBe('https://cursor.example.com/mcp');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid JSON returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const cursorDir = join(cwd, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      writeFileSync(join(cursorDir, 'mcp.json'), 'not json');
      expect(cursorAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing files return []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      expect(cursorAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// windsurf adapter
// ---------------------------------------------------------------------------
describe('windsurfAdapter', () => {
  test('reads local server from mcp_config.json (user scope)', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const wsDir = join(home, '.codeium', 'windsurf');
      mkdirSync(wsDir, { recursive: true });
      const mcp = {
        mcpServers: {
          'ws-local': { command: 'bunx', args: ['windsurf-mcp'], env: { X: '1' } }
        }
      };
      writeFileSync(join(wsDir, 'mcp_config.json'), JSON.stringify(mcp));

      const servers = windsurfAdapter.readServers({ cwd, home });
      expect(servers.length).toBe(1);
      const s = servers[0]!;
      expect(s.name).toBe('ws-local');
      expect(s.scope).toBe('user');
      expect(s.transport).toBe('local');
      expect(s.command).toEqual(['bunx', 'windsurf-mcp']);
      expect(s.env).toEqual({ X: '1' });
      expect(s.tool).toBe('windsurf');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads remote server from mcp_config.json', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const wsDir = join(home, '.codeium', 'windsurf');
      mkdirSync(wsDir, { recursive: true });
      const mcp = {
        mcpServers: {
          'ws-remote': { url: 'https://ws.example.com/mcp' }
        }
      };
      writeFileSync(join(wsDir, 'mcp_config.json'), JSON.stringify(mcp));

      const servers = windsurfAdapter.readServers({ cwd, home });
      const s = servers[0]!;
      expect(s.transport).toBe('remote');
      expect(s.url).toBe('https://ws.example.com/mcp');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid JSON returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const wsDir = join(home, '.codeium', 'windsurf');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wsDir, 'mcp_config.json'), '{ bad');
      expect(windsurfAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('missing file returns []', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      expect(windsurfAdapter.readServers({ cwd, home })).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('locations() returns only user scope', () => {
    const locs = windsurfAdapter.locations({ cwd: '/x', home: '/home/user' });
    expect(locs.length).toBe(1);
    expect(locs[0]!.scope).toBe('user');
    expect(locs[0]!.path).toContain('mcp_config.json');
  });
});
