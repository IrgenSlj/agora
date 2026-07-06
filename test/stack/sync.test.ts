/**
 * Tests for `agora sync` — safety-critical coverage.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import { claudeCodeAdapter } from '../../src/stack/adapters/claude-code';
import { cursorAdapter } from '../../src/stack/adapters/cursor';
import { opencodeAdapter } from '../../src/stack/adapters/opencode';
import { windsurfAdapter } from '../../src/stack/adapters/windsurf';
import type { StackManifest } from '../../src/stack/manifest';
import { applySync, planSync } from '../../src/stack/sync';

// ── Harness ───────────────────────────────────────────────────────────────────

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

function writeManifestToml(cwd: string, content: string): void {
  writeFileSync(join(cwd, 'agora.toml'), content);
}

// ── Preservation tests ────────────────────────────────────────────────────────

describe('opencode: preservation of unrelated keys', () => {
  test('unrelated keys survive writeServers', () => {
    const cwd = makeTmp('agora-sync-oc-');
    try {
      const existing = {
        $schema: 'https://opencode.ai/schema/opencode.json',
        theme: 'monokai',
        mcp: {
          old: { type: 'local', command: ['node', 'old.js'] }
        }
      };
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const desired = [{ name: 'new-server', command: ['npx', 'new-mcp'] }];

      opencodeAdapter.writeServers(location, desired, { prune: false });

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      // Unrelated keys preserved
      expect(result['$schema']).toBe('https://opencode.ai/schema/opencode.json');
      expect(result['theme']).toBe('monokai');
      // Old server preserved (no prune)
      expect(result['mcp']['old']).toBeDefined();
      // New server added
      expect(result['mcp']['new-server']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('prune removes old but preserves unrelated keys', () => {
    const cwd = makeTmp('agora-sync-oc-prune-');
    try {
      const existing = {
        theme: 'nord',
        mcp: {
          old: { type: 'local', command: ['node', 'old.js'] }
        }
      };
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const desired = [{ name: 'new-server', command: ['npx', 'new-mcp'] }];

      opencodeAdapter.writeServers(location, desired, { prune: true });

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result['theme']).toBe('nord');
      expect(result['mcp']['old']).toBeUndefined();
      expect(result['mcp']['new-server']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('claude-code: preservation of unrelated keys + projects map', () => {
  test('projects key is untouched when writing mcpServers', () => {
    const home = makeTmp('agora-sync-cc-home-');
    try {
      const userPath = join(home, '.claude.json');
      const existing = {
        mcpServers: {
          existing: { command: 'node', args: ['existing.js'] }
        },
        projects: {
          '/some/project': { mcpServers: { local: { command: 'node' } } }
        },
        someOtherKey: 'preserve-me'
      };
      writeFileSync(userPath, JSON.stringify(existing, null, 2));

      const location = { path: userPath, scope: 'user' as const };
      const desired = [{ name: 'new-server', command: ['npx', 'new-mcp'] }];
      claudeCodeAdapter.writeServers(location, desired, { prune: false });

      const result = JSON.parse(readFileSync(userPath, 'utf8'));
      // projects map untouched
      expect(result['projects']).toEqual(existing.projects);
      // other key preserved
      expect(result['someOtherKey']).toBe('preserve-me');
      // existing server preserved (no prune)
      expect(result['mcpServers']['existing']).toBeDefined();
      // new server added
      expect(result['mcpServers']['new-server']).toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── add / update / remove ─────────────────────────────────────────────────────

describe('writeServers: add / update / remove', () => {
  test('opencode: add new server', () => {
    const cwd = makeTmp('agora-sync-add-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.added).toContain('pg');
      expect(change.updated).toHaveLength(0);
      expect(change.removed).toHaveLength(0);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['pg']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('opencode: update existing server', () => {
    const cwd = makeTmp('agora-sync-update-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(
        filePath,
        JSON.stringify({ mcp: { pg: { type: 'local', command: ['old-cmd'] } } })
      );

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toContain('pg');
      expect(change.added).toHaveLength(0);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['pg'].command).toEqual(['npx', '@mcp/postgres']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('opencode: prune:false keeps unmanaged servers', () => {
    const cwd = makeTmp('agora-sync-noprune-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(
        filePath,
        JSON.stringify({ mcp: { unmanaged: { type: 'local', command: ['unmanaged'] } } })
      );

      const location = { path: filePath, scope: 'project' as const };
      opencodeAdapter.writeServers(location, [{ name: 'pg', command: ['npx', 'pg'] }], {
        prune: false
      });

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['unmanaged']).toBeDefined();
      expect(result.mcp['pg']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('opencode: prune:true removes unmanaged servers', () => {
    const cwd = makeTmp('agora-sync-prune-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(
        filePath,
        JSON.stringify({ mcp: { unmanaged: { type: 'local', command: ['unmanaged'] } } })
      );

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', 'pg'] }],
        { prune: true }
      );

      expect(change.removed).toContain('unmanaged');

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['unmanaged']).toBeUndefined();
      expect(result.mcp['pg']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ── Invalid JSON → throws, file left intact ───────────────────────────────────

describe('invalid existing JSON → throws, file left intact', () => {
  test('opencode: throws on invalid JSON', () => {
    const cwd = makeTmp('agora-sync-bad-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const badContent = '{ "mcp": { INVALID JSON }';
      writeFileSync(filePath, badContent);

      const location = { path: filePath, scope: 'project' as const };
      expect(() => {
        opencodeAdapter.writeServers(location, [{ name: 'pg', command: ['npx', 'pg'] }], {
          prune: false
        });
      }).toThrow();

      // File must be intact
      expect(readFileSync(filePath, 'utf8')).toBe(badContent);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('claude-code: throws on invalid JSON', () => {
    const home = makeTmp('agora-sync-cc-bad-');
    try {
      const filePath = join(home, '.claude.json');
      const badContent = '{ "mcpServers": BROKEN }';
      writeFileSync(filePath, badContent);

      const location = { path: filePath, scope: 'user' as const };
      expect(() => {
        claudeCodeAdapter.writeServers(location, [{ name: 'pg', command: ['npx', 'pg'] }], {
          prune: false
        });
      }).toThrow();

      expect(readFileSync(filePath, 'utf8')).toBe(badContent);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: throws on invalid JSON', () => {
    const cwd = makeTmp('agora-sync-cur-bad-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      const badContent = 'not json at all';
      writeFileSync(filePath, badContent);

      const location = { path: filePath, scope: 'project' as const };
      expect(() => {
        cursorAdapter.writeServers(location, [{ name: 'pg', command: ['npx', 'pg'] }], {
          prune: false
        });
      }).toThrow();

      expect(readFileSync(filePath, 'utf8')).toBe(badContent);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ── disabled-on-unsupported-tool ──────────────────────────────────────────────

describe('disabled-on-unsupported-tool', () => {
  test('opencode: enabled:false is written (opencode supports it)', () => {
    const cwd = makeTmp('agora-sync-oc-disabled-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const location = { path: filePath, scope: 'project' as const };
      opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', 'pg'], enabled: false }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['pg']).toBeDefined();
      expect(result.mcp['pg'].enabled).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('claude-code: enabled:false skips writing the server', () => {
    const home = makeTmp('agora-sync-cc-disabled-');
    try {
      const filePath = join(home, '.claude.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const location = { path: filePath, scope: 'user' as const };
      claudeCodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', 'pg'], enabled: false }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      // disabled server not written at all
      expect(result.mcpServers['pg']).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: enabled:false skips writing the server', () => {
    const cwd = makeTmp('agora-sync-cur-disabled-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const location = { path: filePath, scope: 'project' as const };
      cursorAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', 'pg'], enabled: false }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcpServers['pg']).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('windsurf: enabled:false skips writing the server', () => {
    const home = makeTmp('agora-sync-ws-disabled-');
    try {
      mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
      const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const location = { path: filePath, scope: 'user' as const };
      windsurfAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', 'pg'], enabled: false }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcpServers['pg']).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('planSync: disabled entry in manifest lists as skipped for claude-code', () => {
    const cwd = makeTmp('agora-sync-plan-disabled-');
    const home = makeTmp('agora-sync-plan-disabled-home-');
    try {
      // Create an empty .mcp.json so claude-code is "present"
      writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

      const manifest: StackManifest = {
        mcp: {
          pg: { command: ['npx', 'pg'] },
          disabled: { command: ['npx', 'disabled'], enabled: false }
        }
      };
      const env = { cwd, home };
      const plans = planSync(manifest, env, ['claude-code'], 'project', false);
      expect(plans).toHaveLength(1);
      const plan = plans[0]!;
      const skippedNames = plan.skipped.map((s) => s.name);
      expect(skippedNames).toContain('disabled');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── planSync vs applySync agree ───────────────────────────────────────────────

describe('planSync vs applySync agreement', () => {
  test('plan change set equals applied change set on fresh fixture', () => {
    const cwd = makeTmp('agora-sync-agree-');
    const home = makeTmp('agora-sync-agree-home-');
    try {
      // Empty opencode.json so adapter is "present"
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));

      const manifest: StackManifest = {
        mcp: {
          pg: { command: ['npx', '@mcp/postgres'] },
          gh: { url: 'https://mcp.github.com' }
        }
      };
      const env = { cwd, home };

      const plans = planSync(manifest, env, ['opencode'], 'project', false);
      const applied = applySync(manifest, env, ['opencode'], 'project', false);

      expect(plans).toHaveLength(1);
      expect(applied).toHaveLength(1);

      const plan = plans[0]!;
      const result = applied[0]!;

      expect(plan.change.added.sort()).toEqual(result.change.added.sort());
      expect(plan.change.updated.sort()).toEqual(result.change.updated.sort());
      expect(plan.change.removed.sort()).toEqual(result.change.removed.sort());
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Round-trip: write then readServers ────────────────────────────────────────

describe('round-trip: write then readServers', () => {
  test('opencode: local server round-trips', () => {
    const cwd = makeTmp('agora-sync-rt-oc-');
    const home = makeTmp('agora-sync-rt-oc-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const env = { cwd, home };
      const location = { path: filePath, scope: 'project' as const };
      opencodeAdapter.writeServers(
        location,
        [
          { name: 'pg', command: ['npx', '@mcp/postgres'], env: { DB_URL: 'postgres://localhost' } }
        ],
        { prune: false }
      );

      const servers = opencodeAdapter.readServers(env).filter((s) => s.name === 'pg');
      expect(servers).toHaveLength(1);
      const srv = servers[0]!;
      expect(srv.transport).toBe('local');
      expect(srv.command).toEqual(['npx', '@mcp/postgres']);
      expect(srv.env?.DB_URL).toBe('postgres://localhost');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('opencode: remote server round-trips', () => {
    const cwd = makeTmp('agora-sync-rt-oc-remote-');
    const home = makeTmp('agora-sync-rt-oc-remote-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const env = { cwd, home };
      const location = { path: filePath, scope: 'project' as const };
      opencodeAdapter.writeServers(location, [{ name: 'gh', url: 'https://mcp.github.com/sse' }], {
        prune: false
      });

      const servers = opencodeAdapter.readServers(env).filter((s) => s.name === 'gh');
      expect(servers).toHaveLength(1);
      const srv = servers[0]!;
      expect(srv.transport).toBe('remote');
      expect(srv.url).toBe('https://mcp.github.com/sse');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('claude-code: local server round-trips', () => {
    const cwd = makeTmp('agora-sync-rt-cc-');
    const home = makeTmp('agora-sync-rt-cc-home-');
    try {
      const filePath = join(cwd, '.mcp.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const env = { cwd, home };
      const location = { path: filePath, scope: 'project' as const };
      claudeCodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      const servers = claudeCodeAdapter.readServers(env).filter((s) => s.name === 'pg');
      expect(servers).toHaveLength(1);
      expect(servers[0]!.transport).toBe('local');
      expect(servers[0]!.command).toEqual(['npx', '@mcp/postgres']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: local server round-trips', () => {
    const cwd = makeTmp('agora-sync-rt-cur-');
    const home = makeTmp('agora-sync-rt-cur-home-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const env = { cwd, home };
      const location = { path: filePath, scope: 'project' as const };
      cursorAdapter.writeServers(location, [{ name: 'pg', command: ['npx', '@mcp/postgres'] }], {
        prune: false
      });

      const servers = cursorAdapter.readServers(env).filter((s) => s.name === 'pg');
      expect(servers).toHaveLength(1);
      expect(servers[0]!.command).toEqual(['npx', '@mcp/postgres']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('windsurf: local server round-trips', () => {
    const home = makeTmp('agora-sync-rt-ws-home-');
    try {
      mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
      const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
      writeFileSync(filePath, JSON.stringify({ mcpServers: {} }));

      const env = { home };
      const location = { path: filePath, scope: 'user' as const };
      windsurfAdapter.writeServers(location, [{ name: 'pg', command: ['npx', '@mcp/postgres'] }], {
        prune: false
      });

      const servers = windsurfAdapter.readServers(env).filter((s) => s.name === 'pg');
      expect(servers).toHaveLength(1);
      expect(servers[0]!.command).toEqual(['npx', '@mcp/postgres']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Windsurf: project scope returns null ──────────────────────────────────────

describe('windsurf: project scope → null writeLocation', () => {
  test('writeLocation returns null for project scope', () => {
    const cwd = makeTmp('agora-sync-ws-null-');
    const home = makeTmp('agora-sync-ws-null-home-');
    try {
      const loc = windsurfAdapter.writeLocation({ cwd, home }, 'project');
      expect(loc).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('planSync reports null location for windsurf at project scope', () => {
    const cwd = makeTmp('agora-sync-ws-plan-null-');
    const home = makeTmp('agora-sync-ws-plan-null-home-');
    try {
      const manifest: StackManifest = {
        mcp: { pg: { command: ['npx', 'pg'] } }
      };
      const plans = planSync(manifest, { cwd, home }, ['windsurf'], 'project', false);
      expect(plans[0]!.location).toBeNull();
      expect(plans[0]!.skipped.length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Command integration tests ─────────────────────────────────────────────────

describe('agora sync command', () => {
  test('missing manifest → usageError with hint to agora freeze', async () => {
    const cwd = makeTmp('agora-sync-cmd-nomanifest-');
    const home = makeTmp('agora-sync-cmd-nomanifest-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['sync'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('agora.toml');
      expect(err()).toContain('freeze');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('dry-run does NOT modify files', async () => {
    const cwd = makeTmp('agora-sync-cmd-dryrun-');
    const home = makeTmp('agora-sync-cmd-dryrun-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const originalContent = JSON.stringify({ theme: 'dark', mcp: {} });
      writeFileSync(filePath, originalContent);

      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode'], io);
      expect(code).toBe(0);

      // File must not be modified
      expect(readFileSync(filePath, 'utf8')).toBe(originalContent);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write without --yes refuses and does NOT write', async () => {
    const cwd = makeTmp('agora-sync-cmd-noyes-');
    const home = makeTmp('agora-sync-cmd-noyes-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const originalContent = JSON.stringify({ mcp: {} });
      writeFileSync(filePath, originalContent);

      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, err } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode', '--write'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('--yes');

      // File must not be modified
      expect(readFileSync(filePath, 'utf8')).toBe(originalContent);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--write --yes applies and modifies file', async () => {
    const cwd = makeTmp('agora-sync-cmd-apply-');
    const home = makeTmp('agora-sync-cmd-apply-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode', '--write', '--yes'], io);
      expect(code).toBe(0);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['pg']).toBeDefined();

      // Output should mention the file
      expect(out()).toContain(filePath);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('dry-run shows diff markers in output', async () => {
    const cwd = makeTmp('agora-sync-cmd-diff-');
    const home = makeTmp('agora-sync-cmd-diff-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode'], io);
      expect(code).toBe(0);

      const output = out();
      expect(output).toContain('+ pg');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json dry-run emits { mode: plan, tools: [...] }', async () => {
    const cwd = makeTmp('agora-sync-cmd-json-');
    const home = makeTmp('agora-sync-cmd-json-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode', '--json'], io);
      expect(code).toBe(0);

      const payload = JSON.parse(out());
      expect(payload.mode).toBe('plan');
      expect(Array.isArray(payload.tools)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json applied emits { mode: applied, tools: [...] }', async () => {
    const cwd = makeTmp('agora-sync-cmd-json-apply-');
    const home = makeTmp('agora-sync-cmd-json-apply-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'opencode', '--write', '--yes', '--json'], io);
      expect(code).toBe(0);

      const payload = JSON.parse(out());
      expect(payload.mode).toBe('applied');
      expect(Array.isArray(payload.tools)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('empty manifest → friendly message, no writes', async () => {
    const cwd = makeTmp('agora-sync-cmd-empty-');
    const home = makeTmp('agora-sync-cmd-empty-home-');
    try {
      writeManifestToml(cwd, '# agora stack manifest\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['sync'], io);
      expect(code).toBe(0);
      expect(out()).toContain('Nothing to sync');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --tool returns non-zero', async () => {
    const cwd = makeTmp('agora-sync-cmd-badtool-');
    const home = makeTmp('agora-sync-cmd-badtool-home-');
    try {
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "pg"]\n');
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['sync', '--tool', 'vscode-unknown'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('Unknown tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --scope returns non-zero', async () => {
    const cwd = makeTmp('agora-sync-cmd-badscope-');
    const home = makeTmp('agora-sync-cmd-badscope-home-');
    try {
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "pg"]\n');
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['sync', '--scope', 'global'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('scope');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Fix 1: Field preservation on UPDATE ──────────────────────────────────────

describe('field preservation on UPDATE (Fix 1)', () => {
  test('opencode: extra user key survives update of managed fields', () => {
    const cwd = makeTmp('agora-fp-oc-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const existing = {
        mcp: {
          pg: { type: 'local', command: ['old-cmd'], customFlag: true, retries: 3 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toContain('pg');
      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['pg'].command).toEqual(['npx', '@mcp/postgres']);
      expect(result.mcp['pg'].customFlag).toBe(true);
      expect(result.mcp['pg'].retries).toBe(3);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('claude-code: extra user key survives update of managed fields', () => {
    const home = makeTmp('agora-fp-cc-home-');
    try {
      const filePath = join(home, '.claude.json');
      const existing = {
        mcpServers: {
          pg: { command: 'old-cmd', args: ['--old'], timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'user' as const };
      const change = claudeCodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toContain('pg');
      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcpServers['pg'].command).toBe('npx');
      expect(result.mcpServers['pg'].args).toEqual(['@mcp/postgres']);
      expect(result.mcpServers['pg'].timeout).toBe(5000);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: extra user key survives update of managed fields', () => {
    const cwd = makeTmp('agora-fp-cur-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      const existing = {
        mcpServers: {
          pg: { command: 'old-cmd', timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const change = cursorAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toContain('pg');
      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcpServers['pg'].command).toBe('npx');
      expect(result.mcpServers['pg'].timeout).toBe(5000);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('windsurf: extra user key survives update of managed fields', () => {
    const home = makeTmp('agora-fp-ws-home-');
    try {
      mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
      const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
      const existing = {
        mcpServers: {
          pg: { command: 'old-cmd', timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'user' as const };
      const change = windsurfAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toContain('pg');
      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcpServers['pg'].command).toBe('npx');
      expect(result.mcpServers['pg'].timeout).toBe(5000);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Fix 1: Transport switch cleanup ──────────────────────────────────────────

describe('transport switch cleanup (Fix 1)', () => {
  test('cursor: LOCAL → REMOTE drops command/args/env, gains url', () => {
    const cwd = makeTmp('agora-ts-cur-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      const existing = {
        mcpServers: {
          srv: { command: 'node', args: ['server.js'], env: { KEY: 'val' }, timeout: 9999 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      cursorAdapter.writeServers(
        location,
        [{ name: 'srv', url: 'https://remote.example.com/sse' }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      const entry = result.mcpServers['srv'];
      expect(entry.url).toBe('https://remote.example.com/sse');
      expect(entry.command).toBeUndefined();
      expect(entry.args).toBeUndefined();
      expect(entry.env).toBeUndefined();
      expect(entry.timeout).toBe(9999);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('cursor: REMOTE → LOCAL drops url, gains command/args', () => {
    const cwd = makeTmp('agora-ts2-cur-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      const existing = {
        mcpServers: {
          srv: { url: 'https://remote.example.com/sse', timeout: 1234 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      cursorAdapter.writeServers(location, [{ name: 'srv', command: ['npx', 'mcp-local'] }], {
        prune: false
      });

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      const entry = result.mcpServers['srv'];
      expect(entry.command).toBe('npx');
      expect(entry.args).toEqual(['mcp-local']);
      expect(entry.url).toBeUndefined();
      expect(entry.timeout).toBe(1234);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('claude-code: LOCAL → REMOTE drops command/args/env, gains url', () => {
    const home = makeTmp('agora-ts-cc-home-');
    try {
      const filePath = join(home, '.claude.json');
      const existing = {
        mcpServers: {
          srv: { command: 'node', args: ['s.js'], env: { A: '1' }, timeout: 777 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'user' as const };
      claudeCodeAdapter.writeServers(
        location,
        [{ name: 'srv', url: 'https://remote.example.com/mcp' }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      const entry = result.mcpServers['srv'];
      expect(entry.url).toBe('https://remote.example.com/mcp');
      expect(entry.command).toBeUndefined();
      expect(entry.args).toBeUndefined();
      expect(entry.env).toBeUndefined();
      expect(entry.timeout).toBe(777);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('opencode: LOCAL → REMOTE drops command/environment, gains url', () => {
    const cwd = makeTmp('agora-ts-oc-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const existing = {
        mcp: {
          srv: { type: 'local', command: ['node', 's.js'], environment: { A: '1' }, retries: 5 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      opencodeAdapter.writeServers(
        location,
        [{ name: 'srv', url: 'https://remote.example.com/mcp' }],
        { prune: false }
      );

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      const entry = result.mcp['srv'];
      expect(entry.type).toBe('remote');
      expect(entry.url).toBe('https://remote.example.com/mcp');
      expect(entry.command).toBeUndefined();
      expect(entry.environment).toBeUndefined();
      expect(entry.retries).toBe(5);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ── Fix 1: No-op update with extra keys ──────────────────────────────────────

describe('no-op update with extra keys present (Fix 1)', () => {
  test('cursor: re-applying same server with extra keys reports no update', () => {
    const cwd = makeTmp('agora-noop-cur-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      const existing = {
        mcpServers: {
          pg: { command: 'npx', args: ['@mcp/postgres'], timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const change = cursorAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toHaveLength(0);
      expect(change.added).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('claude-code: re-applying same server with extra keys reports no update', () => {
    const home = makeTmp('agora-noop-cc-home-');
    try {
      const filePath = join(home, '.claude.json');
      const existing = {
        mcpServers: {
          pg: { command: 'npx', args: ['@mcp/postgres'], timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'user' as const };
      const change = claudeCodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toHaveLength(0);
      expect(change.added).toHaveLength(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('opencode: re-applying same server with extra keys reports no update', () => {
    const cwd = makeTmp('agora-noop-oc-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const existing = {
        mcp: {
          pg: { type: 'local', command: ['npx', '@mcp/postgres'], retries: 3 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'project' as const };
      const change = opencodeAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toHaveLength(0);
      expect(change.added).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('windsurf: re-applying same server with extra keys reports no update', () => {
    const home = makeTmp('agora-noop-ws-home-');
    try {
      mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
      const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
      const existing = {
        mcpServers: {
          pg: { command: 'npx', args: ['@mcp/postgres'], timeout: 5000 }
        }
      };
      writeFileSync(filePath, JSON.stringify(existing, null, 2));

      const location = { path: filePath, scope: 'user' as const };
      const change = windsurfAdapter.writeServers(
        location,
        [{ name: 'pg', command: ['npx', '@mcp/postgres'] }],
        { prune: false }
      );

      expect(change.updated).toHaveLength(0);
      expect(change.added).toHaveLength(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── --from flag tests ─────────────────────────────────────────────────────────

describe('agora sync --from', () => {
  const sharedToml = '[mcp.shared-server]\ncommand = ["npx", "@mcp/shared"]\n';

  // --from now runs the scan gate (P3) on every mcp/instruction entry before
  // writing anything. The gate's npm_exists check hits the real npm registry
  // unless a fetcher is injected — this hermetic stub keeps these tests
  // offline by answering that check with a clean "pass" for any package.
  const okNpmFetcher = async (_url: string) =>
    ({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({ version: '1.0.0' })
    }) as Response;

  test('--from <file path>: dry-run uses shared manifest, ignores missing local agora.toml', async () => {
    const cwd = makeTmp('agora-sync-from-file-');
    const home = makeTmp('agora-sync-from-file-home-');
    try {
      // No agora.toml in cwd
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));

      // Write shared manifest to a temp file
      const sharedPath = join(cwd, 'shared.toml');
      writeFileSync(sharedPath, sharedToml);

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = okNpmFetcher;
      const code = await runCli(['sync', '--from', sharedPath, '--tool', 'opencode'], io);
      expect(code).toBe(0);
      expect(out()).toContain('+ shared-server');
      // No warning for file source
      expect(out()).not.toContain('remote source');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from <file path>: --write --yes applies shared manifest', async () => {
    const cwd = makeTmp('agora-sync-from-file-apply-');
    const home = makeTmp('agora-sync-from-file-apply-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const sharedPath = join(cwd, 'shared.toml');
      writeFileSync(sharedPath, sharedToml);

      const { io } = createIo(cwd, home);
      (io as any).fetcher = okNpmFetcher;
      const code = await runCli(
        ['sync', '--from', sharedPath, '--tool', 'opencode', '--write', '--yes'],
        io
      );
      expect(code).toBe(0);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['shared-server']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from <url>: fake fetcher returns manifest, plan reflects fetched servers', async () => {
    const cwd = makeTmp('agora-sync-from-url-');
    const home = makeTmp('agora-sync-from-url-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));

      const fakeFetcher = async (_url: string) =>
        ({ ok: true, status: 200, text: async () => sharedToml }) as Response;

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', 'https://example.com/agora.toml', '--tool', 'opencode'],
        io
      );
      expect(code).toBe(0);
      expect(out()).toContain('+ shared-server');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from <url>: fetcher returns 404 → usageError', async () => {
    const cwd = makeTmp('agora-sync-from-url-404-');
    const home = makeTmp('agora-sync-from-url-404-home-');
    try {
      const fakeFetcher = async (_url: string) =>
        ({ ok: false, status: 404, text: async () => '' }) as Response;

      const { io, err } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', 'https://example.com/agora.toml', '--tool', 'opencode'],
        io
      );
      expect(code).not.toBe(0);
      expect(err()).toContain('Could not fetch manifest');
      expect(err()).toContain('404');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from <url>: fetcher throws → usageError', async () => {
    const cwd = makeTmp('agora-sync-from-url-throw-');
    const home = makeTmp('agora-sync-from-url-throw-home-');
    try {
      const fakeFetcher = async (_url: string): Promise<Response> => {
        throw new Error('network unreachable');
      };

      const { io, err } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', 'https://example.com/agora.toml', '--tool', 'opencode'],
        io
      );
      expect(code).not.toBe(0);
      expect(err()).toContain('Could not fetch manifest');
      expect(err()).toContain('network unreachable');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from with malformed TOML → usageError', async () => {
    const cwd = makeTmp('agora-sync-from-bad-toml-');
    const home = makeTmp('agora-sync-from-bad-toml-home-');
    try {
      const sharedPath = join(cwd, 'bad.toml');
      writeFileSync(sharedPath, 'this is not valid toml [[[');

      const { io, err } = createIo(cwd, home);
      const code = await runCli(['sync', '--from', sharedPath, '--tool', 'opencode'], io);
      expect(code).not.toBe(0);
      expect(err()).toContain('Invalid manifest');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--from missing file path → usageError', async () => {
    const cwd = makeTmp('agora-sync-from-missing-');
    const home = makeTmp('agora-sync-from-missing-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(
        ['sync', '--from', join(cwd, 'nonexistent.toml'), '--tool', 'opencode'],
        io
      );
      expect(code).not.toBe(0);
      expect(err()).toContain('Could not read manifest');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('remote-source warning appears in human dry-run for URL source', async () => {
    const cwd = makeTmp('agora-sync-from-url-warn-');
    const home = makeTmp('agora-sync-from-url-warn-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));

      const fakeFetcher = async (_url: string) =>
        ({ ok: true, status: 200, text: async () => sharedToml }) as Response;

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', 'https://example.com/agora.toml', '--tool', 'opencode'],
        io
      );
      expect(code).toBe(0);
      expect(out()).toContain('remote source');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('remote-source warning does NOT appear for file source', async () => {
    const cwd = makeTmp('agora-sync-from-file-nowarn-');
    const home = makeTmp('agora-sync-from-file-nowarn-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      const sharedPath = join(cwd, 'shared.toml');
      writeFileSync(sharedPath, sharedToml);

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = okNpmFetcher;
      const code = await runCli(['sync', '--from', sharedPath, '--tool', 'opencode'], io);
      expect(code).toBe(0);
      expect(out()).not.toContain('remote source');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('remote-source warning does NOT appear in --json mode', async () => {
    const cwd = makeTmp('agora-sync-from-url-json-nowarn-');
    const home = makeTmp('agora-sync-from-url-json-nowarn-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));

      const fakeFetcher = async (_url: string) =>
        ({ ok: true, status: 200, text: async () => sharedToml }) as Response;

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', 'https://example.com/agora.toml', '--tool', 'opencode', '--json'],
        io
      );
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(payload.mode).toBe('plan');
      // No warning in JSON mode — raw JSON should be parseable and not contain extra text
      expect(out()).not.toContain('remote source');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── Fix 2: Transport detection robustness ────────────────────────────────────

describe('transport detection robustness (Fix 2)', () => {
  test('cursor: type:sse entry is classified as remote', () => {
    const cwd = makeTmp('agora-td-cur-sse-');
    const home = makeTmp('agora-td-cur-sse-home-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'sse', url: 'https://example.com/sse' } }
        })
      );
      const servers = cursorAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('remote');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: type:http entry is classified as remote', () => {
    const cwd = makeTmp('agora-td-cur-http-');
    const home = makeTmp('agora-td-cur-http-home-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'http', url: 'https://example.com/mcp' } }
        })
      );
      const servers = cursorAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('remote');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('cursor: type:stdio entry is classified as local', () => {
    const cwd = makeTmp('agora-td-cur-stdio-');
    const home = makeTmp('agora-td-cur-stdio-home-');
    try {
      mkdirSync(join(cwd, '.cursor'), { recursive: true });
      const filePath = join(cwd, '.cursor', 'mcp.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'stdio', command: 'node', args: ['s.js'] } }
        })
      );
      const servers = cursorAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('local');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('windsurf: type:sse entry is classified as remote', () => {
    const home = makeTmp('agora-td-ws-sse-home-');
    try {
      mkdirSync(join(home, '.codeium', 'windsurf'), { recursive: true });
      const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'sse', url: 'https://example.com/sse' } }
        })
      );
      const servers = windsurfAdapter.readServers({ home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('remote');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('claude-code: type:sse entry is classified as remote', () => {
    const cwd = makeTmp('agora-td-cc-sse-');
    const home = makeTmp('agora-td-cc-sse-home-');
    try {
      const filePath = join(cwd, '.mcp.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'sse', url: 'https://example.com/sse' } }
        })
      );
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('remote');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('claude-code: type:stdio with command prefers local (stdio wins)', () => {
    const cwd = makeTmp('agora-td-cc-both-');
    const home = makeTmp('agora-td-cc-both-home-');
    try {
      const filePath = join(cwd, '.mcp.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          mcpServers: { srv: { type: 'stdio', command: 'node', url: 'https://example.com' } }
        })
      );
      const servers = claudeCodeAdapter.readServers({ cwd, home });
      const s = servers.find((x) => x.name === 'srv');
      expect(s?.transport).toBe('local');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
