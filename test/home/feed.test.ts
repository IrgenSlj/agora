/**
 * Tests for src/home/feed.ts — pure-function coverage only.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { summarizeStack, computeOpportunities, buildHomeFeed } from '../../src/home/feed';
import type { Opportunity } from '../../src/home/feed';
import type { ConfiguredServer } from '../../src/stack/types';
import type { StackHealth, ServerHealth } from '../../src/stack/doctor';
import type { StackManifest } from '../../src/stack/manifest';
import type { MarketplaceItem } from '../../src/marketplace';
import type { ServerCapabilities } from '../../src/stack/capability-cache';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeServer(overrides: Partial<ConfiguredServer> = {}): ConfiguredServer {
  return {
    name: 'my-server',
    tool: 'opencode',
    scope: 'user',
    configPath: '/fake/opencode.json',
    transport: 'local',
    command: ['node', 'server.js'],
    enabled: true,
    raw: {},
    ...overrides
  };
}

function makeHealth(overrides: Partial<StackHealth> = {}): StackHealth {
  return {
    servers: [],
    summary: { ok: 0, warn: 0, error: 0 },
    ...overrides
  };
}

function makeServerHealth(name: string, status: 'ok' | 'warn' | 'error'): ServerHealth {
  return {
    name,
    instances: [],
    status,
    checks: []
  };
}

function makeCap(name: string, toolCount: number, ok = true): ServerCapabilities {
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    name: `tool_${i}`,
    description: '',
    inputSchema: { type: 'object' as const, properties: {} }
  }));
  return {
    key: `${name}@abc12345`,
    name,
    command: ['node', 'server.js'],
    tools,
    ok,
    probedAt: '2026-01-01T00:00:00.000Z'
  };
}

function makeManifest(names: string[]): StackManifest {
  const mcp: Record<string, { command: string[] }> = {};
  for (const n of names) {
    mcp[n] = { command: ['node', 'server.js'] };
  }
  return { mcp };
}

function makeHotItem(
  id: string,
  name: string,
  kind: 'package' | 'workflow' = 'package'
): MarketplaceItem {
  if (kind === 'workflow') {
    return {
      id,
      name,
      description: `${name} workflow`,
      author: 'test',
      kind: 'workflow',
      category: 'workflow',
      tags: [],
      stars: 100,
      installs: 50,
      createdAt: '2025-01-01T00:00:00.000Z',
      forks: 5,
      prompt: ''
    };
  }
  return {
    id,
    name,
    description: `${name} description`,
    author: 'test',
    kind: 'package',
    category: 'mcp',
    tags: [],
    stars: 100,
    installs: 500,
    createdAt: '2025-01-01T00:00:00.000Z',
    version: '1.0.0',
    repository: `https://github.com/test/${id}`,
    pricing: { kind: 'free' }
  };
}

// ── summarizeStack ─────────────────────────────────────────────────────────────

describe('summarizeStack', () => {
  test('counts distinct server names', () => {
    const servers = [
      makeServer({ name: 'alpha', tool: 'opencode' }),
      makeServer({ name: 'alpha', tool: 'cursor' }), // same name, different tool
      makeServer({ name: 'beta', tool: 'opencode' })
    ];
    const health = makeHealth({ summary: { ok: 2, warn: 0, error: 0 } });
    const caps: ServerCapabilities[] = [];
    const result = summarizeStack(servers, health, caps);
    expect(result.serverCount).toBe(2); // alpha, beta
  });

  test('counts distinct tool ids', () => {
    const servers = [
      makeServer({ name: 'alpha', tool: 'opencode' }),
      makeServer({ name: 'beta', tool: 'opencode' }),
      makeServer({ name: 'gamma', tool: 'cursor' })
    ];
    const health = makeHealth({ summary: { ok: 3, warn: 0, error: 0 } });
    const result = summarizeStack(servers, health, []);
    expect(result.toolCount).toBe(2); // opencode, cursor
  });

  test('sums capability tools from ok entries only', () => {
    const caps = [
      makeCap('alpha', 3, true),
      makeCap('beta', 5, false), // not ok — excluded
      makeCap('gamma', 2, true)
    ];
    const result = summarizeStack([], makeHealth(), caps);
    expect(result.capabilityCount).toBe(5); // 3 + 2
  });

  test('passes health summary through unchanged', () => {
    const health = makeHealth({ summary: { ok: 2, warn: 1, error: 3 } });
    const result = summarizeStack([], health, []);
    expect(result.health).toEqual({ ok: 2, warn: 1, error: 3 });
  });

  test('returns zeros when no servers or caps', () => {
    const result = summarizeStack([], makeHealth(), []);
    expect(result.serverCount).toBe(0);
    expect(result.toolCount).toBe(0);
    expect(result.capabilityCount).toBe(0);
  });
});

// ── computeOpportunities ───────────────────────────────────────────────────────

describe('computeOpportunities: getting-started', () => {
  test('emits getting-started when no servers', () => {
    const ops = computeOpportunities({
      servers: [],
      manifest: null,
      health: makeHealth(),
      hot: []
    });
    const gs = ops.find((o) => o.kind === 'getting-started');
    expect(gs).toBeDefined();
    expect(gs!.command).toBe('agora search');
  });

  test('getting-started has the highest priority among all kinds', () => {
    const ops = computeOpportunities({
      servers: [],
      manifest: null,
      health: makeHealth({
        summary: { ok: 0, warn: 0, error: 1 },
        servers: [makeServerHealth('dead', 'error')]
      }),
      hot: []
    });
    // getting-started priority=100 > health error priority=90
    expect(ops[0]!.kind).toBe('getting-started');
  });

  test('no getting-started when servers are present', () => {
    const ops = computeOpportunities({
      servers: [makeServer()],
      manifest: null,
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'getting-started')).toBeUndefined();
  });
});

describe('computeOpportunities: health', () => {
  test('emits health opportunity when error count > 0', () => {
    const sh = makeServerHealth('broken-server', 'error');
    const health: StackHealth = {
      servers: [sh],
      summary: { ok: 0, warn: 0, error: 1 }
    };
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'broken-server' })],
      manifest: makeManifest(['broken-server']),
      health,
      hot: []
    });
    const h = ops.find((o) => o.kind === 'health');
    expect(h).toBeDefined();
    expect(h!.command).toBe('agora doctor');
    expect(h!.detail).toContain('broken-server');
  });

  test('names the failing server in detail', () => {
    const sh = makeServerHealth('srv-a', 'error');
    const health: StackHealth = {
      servers: [sh, makeServerHealth('srv-b', 'ok')],
      summary: { ok: 1, warn: 0, error: 1 }
    };
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'srv-a' }), makeServer({ name: 'srv-b' })],
      manifest: makeManifest(['srv-a', 'srv-b']),
      health,
      hot: []
    });
    const h = ops.find((o) => o.kind === 'health')!;
    expect(h.detail).toContain('srv-a');
    expect(h.detail).not.toContain('srv-b');
  });

  test('emits health opportunity for warn-only at lower priority', () => {
    const sh = makeServerHealth('warn-srv', 'warn');
    const health: StackHealth = {
      servers: [sh],
      summary: { ok: 0, warn: 1, error: 0 }
    };
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'warn-srv' })],
      manifest: makeManifest(['warn-srv']),
      health,
      hot: []
    });
    const h = ops.find((o) => o.kind === 'health');
    expect(h).toBeDefined();
    expect(h!.priority).toBeLessThan(90);
  });
});

describe('computeOpportunities: untracked', () => {
  test('emits untracked when servers present and manifest is null', () => {
    const ops = computeOpportunities({
      servers: [makeServer()],
      manifest: null,
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot: []
    });
    const u = ops.find((o) => o.kind === 'untracked');
    expect(u).toBeDefined();
    expect(u!.command).toBe('agora freeze --write');
  });

  test('no untracked when manifest exists', () => {
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'alpha' })],
      manifest: makeManifest(['alpha']),
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'untracked')).toBeUndefined();
  });

  test('no untracked when no servers (getting-started takes precedence)', () => {
    const ops = computeOpportunities({
      servers: [],
      manifest: null,
      health: makeHealth(),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'untracked')).toBeUndefined();
  });
});

describe('computeOpportunities: drift', () => {
  test('emits drift when name sets differ', () => {
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'alpha' }), makeServer({ name: 'beta' })],
      manifest: makeManifest(['alpha', 'gamma']), // beta missing, gamma extra
      health: makeHealth({ summary: { ok: 2, warn: 0, error: 0 } }),
      hot: []
    });
    const d = ops.find((o) => o.kind === 'drift');
    expect(d).toBeDefined();
    expect(d!.command).toBe('agora sync');
  });

  test('no drift when name sets match', () => {
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'alpha' }), makeServer({ name: 'beta' })],
      manifest: makeManifest(['alpha', 'beta']),
      health: makeHealth({ summary: { ok: 2, warn: 0, error: 0 } }),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'drift')).toBeUndefined();
  });

  test('drift is case-insensitive', () => {
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'Alpha' })],
      manifest: makeManifest(['alpha']), // same name, different case
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'drift')).toBeUndefined();
  });

  test('no drift when manifest is null', () => {
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'alpha' })],
      manifest: null,
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot: []
    });
    expect(ops.find((o) => o.kind === 'drift')).toBeUndefined();
  });
});

describe('computeOpportunities: gap', () => {
  test('suggests hot package items not in configured set', () => {
    const hot = [
      makeHotItem('trending-1', 'Trending One'),
      makeHotItem('trending-2', 'Trending Two')
    ];
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'my-server' })],
      manifest: makeManifest(['my-server']),
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot
    });
    const gaps = ops.filter((o) => o.kind === 'gap');
    expect(gaps.length).toBe(2);
    expect(gaps[0]!.command).toContain('agora scan');
  });

  test('skips hot items already in configured server names', () => {
    const hot = [makeHotItem('my-server', 'my-server')];
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'my-server' })],
      manifest: makeManifest(['my-server']),
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot
    });
    expect(ops.find((o) => o.kind === 'gap')).toBeUndefined();
  });

  test('skips workflow items', () => {
    const hot = [
      makeHotItem('wf-some-workflow', 'Some Workflow', 'workflow'),
      makeHotItem('pkg-real', 'Real Package', 'package')
    ];
    const ops = computeOpportunities({
      servers: [],
      manifest: makeManifest([]),
      health: makeHealth(),
      hot
    });
    const gaps = ops.filter((o) => o.kind === 'gap');
    // workflow is skipped; getting-started fires instead but gap should not include workflow
    expect(gaps.every((g) => g.command?.includes('pkg-real'))).toBe(true);
  });

  test('caps gap suggestions at 2', () => {
    const hot = [
      makeHotItem('pkg-a', 'Package A'),
      makeHotItem('pkg-b', 'Package B'),
      makeHotItem('pkg-c', 'Package C'),
      makeHotItem('pkg-d', 'Package D')
    ];
    const ops = computeOpportunities({
      servers: [makeServer({ name: 'my-server' })],
      manifest: makeManifest(['my-server']),
      health: makeHealth({ summary: { ok: 1, warn: 0, error: 0 } }),
      hot
    });
    expect(ops.filter((o) => o.kind === 'gap').length).toBe(2);
  });
});

describe('computeOpportunities: ordering and cap', () => {
  test('result is sorted by priority descending', () => {
    const ops = computeOpportunities({
      servers: [],
      manifest: null,
      health: makeHealth({
        summary: { ok: 0, warn: 0, error: 1 },
        servers: [makeServerHealth('x', 'error')]
      }),
      hot: []
    });
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i - 1]!.priority).toBeGreaterThanOrEqual(ops[i]!.priority);
    }
  });

  test('total result is capped at 6', () => {
    // Create enough entries to potentially exceed 6
    const hot = [
      makeHotItem('pkg-1', 'Package 1'),
      makeHotItem('pkg-2', 'Package 2'),
      makeHotItem('pkg-3', 'Package 3')
    ];
    const sh = makeServerHealth('srv', 'error');
    const ops = computeOpportunities({
      servers: [], // triggers getting-started
      manifest: null,
      health: { servers: [sh], summary: { ok: 0, warn: 0, error: 1 } },
      hot
    });
    expect(ops.length).toBeLessThanOrEqual(6);
  });
});

// ── buildHomeFeed — I/O wrapper ───────────────────────────────────────────────

describe('buildHomeFeed', () => {
  test('returns a sensible summary without throwing for empty dataDir', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-feed-test-'));
    try {
      const env = { cwd: tmp, home: tmp, env: { PATH: process.env.PATH ?? '' } };
      const result = await buildHomeFeed(env, tmp);
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('opportunities');
      expect(typeof result.summary.serverCount).toBe('number');
      expect(Array.isArray(result.opportunities)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns getting-started opportunity when no config files exist', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-feed-test-'));
    try {
      const env = { cwd: tmp, home: tmp, env: { PATH: process.env.PATH ?? '' } };
      const result = await buildHomeFeed(env, tmp);
      // An empty directory has no servers → getting-started
      const gs = result.opportunities.find((o) => o.kind === 'getting-started');
      expect(gs).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('reads capability cache when present', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-feed-test-'));
    try {
      // Write a minimal capability cache
      const caps: ServerCapabilities[] = [makeCap('cached-server', 4, true)];
      writeFileSync(join(tmp, 'capabilities.json'), JSON.stringify(caps));

      const env = { cwd: tmp, home: tmp, env: { PATH: process.env.PATH ?? '' } };
      const result = await buildHomeFeed(env, tmp);
      expect(result.summary.capabilityCount).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
