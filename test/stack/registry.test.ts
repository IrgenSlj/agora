/**
 * Tests for src/stack/registry.ts
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectTools,
  readAllServers,
  groupServersByName,
  getAdapter,
  ALL_ADAPTERS
} from '../../src/stack/registry';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-registry-test-'));
}

describe('getAdapter', () => {
  test('returns adapter by id', () => {
    const a = getAdapter('opencode');
    expect(a).toBeDefined();
    expect(a!.id).toBe('opencode');
  });

  test('returns undefined for unknown id', () => {
    const a = getAdapter('nonexistent' as any);
    expect(a).toBeUndefined();
  });

  test('ALL_ADAPTERS has 4 entries', () => {
    expect(ALL_ADAPTERS.length).toBe(4);
    const ids = ALL_ADAPTERS.map((a) => a.id);
    expect(ids).toContain('opencode');
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('windsurf');
  });
});

describe('detectTools', () => {
  test('marks present=false when no config files exist', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const results = detectTools({ cwd, home });
      expect(results.every((r) => !r.present)).toBe(true);
      expect(results.length).toBe(4);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('marks opencode present when opencode.json exists', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      const results = detectTools({ cwd, home });
      const oc = results.find((r) => r.adapter.id === 'opencode')!;
      expect(oc.present).toBe(true);

      const cc = results.find((r) => r.adapter.id === 'claude-code')!;
      expect(cc.present).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('marks cursor present when .cursor/mcp.json exists', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const cursorDir = join(cwd, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      writeFileSync(join(cursorDir, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
      const results = detectTools({ cwd, home });
      const cursor = results.find((r) => r.adapter.id === 'cursor')!;
      expect(cursor.present).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('readAllServers', () => {
  test('returns empty array when no config files exist', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const servers = readAllServers({ cwd, home });
      expect(servers).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('unions servers from multiple tools', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      // opencode config
      writeFileSync(
        join(cwd, 'opencode.json'),
        JSON.stringify({
          mcp: {
            'oc-server': { type: 'local', command: ['npx', 'oc-mcp'] }
          }
        })
      );

      // cursor config
      const cursorDir = join(cwd, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      writeFileSync(
        join(cursorDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'cursor-server': { command: 'node', args: ['cursor.js'] }
          }
        })
      );

      const servers = readAllServers({ cwd, home });
      const names = servers.map((s) => s.name);
      expect(names).toContain('oc-server');
      expect(names).toContain('cursor-server');
      expect(servers.length).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('groupServersByName', () => {
  test('groups servers with same name across tools', () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      // opencode has "shared-server"
      writeFileSync(
        join(cwd, 'opencode.json'),
        JSON.stringify({
          mcp: {
            'shared-server': { type: 'local', command: ['npx', 'shared'] },
            'oc-only': { type: 'local', command: ['npx', 'oc-only'] }
          }
        })
      );

      // cursor also has "shared-server" with different command
      const cursorDir = join(cwd, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      writeFileSync(
        join(cursorDir, 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            'shared-server': { command: 'node', args: ['shared-cursor.js'] }
          }
        })
      );

      const servers = readAllServers({ cwd, home });
      const grouped = groupServersByName(servers);

      expect(grouped.has('shared-server')).toBe(true);
      expect(grouped.get('shared-server')!.length).toBe(2);

      expect(grouped.has('oc-only')).toBe(true);
      expect(grouped.get('oc-only')!.length).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('preserves insertion order', () => {
    const server = (name: string, tool: string) =>
      ({
        name,
        tool,
        scope: 'project',
        configPath: '/x',
        transport: 'local',
        command: ['node'],
        enabled: true,
        raw: {}
      }) as any;

    const servers = [server('a', 'opencode'), server('b', 'cursor'), server('a', 'windsurf')];
    const grouped = groupServersByName(servers);
    const keys = [...grouped.keys()];
    expect(keys).toEqual(['a', 'b']);
  });
});
