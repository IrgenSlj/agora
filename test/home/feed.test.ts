/**
 * Tests for src/home/feed.ts — pure-function coverage only.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  summarizeStack,
  computeOpportunities,
  buildHomeFeed,
  getHotRepos,
  computeSinceLastSeen
} from '../../src/home/feed';
import { writeCache } from '../../src/news/cache';
import type { NewsItem } from '../../src/news/types';
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

// ── getHotRepos ───────────────────────────────────────────────────────────────

function makeGhItem(
  repoPath: string,
  engagement: number,
  tags: string[],
  overrides: Partial<NewsItem> = {}
): NewsItem {
  const [owner, repo] = repoPath.split('/');
  return {
    id: `gh:${repoPath.replace('/', '-')}`,
    source: 'github-trending',
    title: repoPath,
    url: `https://github.com/${repoPath}`,
    author: owner,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    engagement,
    tags,
    summary: `${repo} description`,
    ...overrides
  };
}

function makeNonGhItem(id: string): NewsItem {
  return {
    id,
    source: 'hn',
    title: 'Some HN post',
    url: 'https://news.ycombinator.com/item?id=1',
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    engagement: 9999,
    tags: ['ai']
  };
}

describe('getHotRepos', () => {
  test('returns only github-trending items', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      const items: NewsItem[] = [
        makeGhItem('owner/alpha', 100, ['ai']),
        makeNonGhItem('hn-1'),
        makeGhItem('owner/beta', 50, ['mcp'])
      ];
      writeCache(tmp, items);
      const repos = getHotRepos(tmp, { limit: 10, topicsOnly: false });
      expect(repos.every((r) => r.host === 'github.com')).toBe(true);
      expect(repos.length).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('ranked by engagement descending', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      const items: NewsItem[] = [
        makeGhItem('owner/low', 10, ['ai']),
        makeGhItem('owner/high', 500, ['ai']),
        makeGhItem('owner/mid', 200, ['cli'])
      ];
      writeCache(tmp, items);
      const repos = getHotRepos(tmp, { limit: 10, topicsOnly: false });
      expect(repos[0]!.name).toBe('owner/high');
      expect(repos[1]!.name).toBe('owner/mid');
      expect(repos[2]!.name).toBe('owner/low');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('slices to limit', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      const items: NewsItem[] = [
        makeGhItem('owner/a', 100, ['ai']),
        makeGhItem('owner/b', 90, ['ai']),
        makeGhItem('owner/c', 80, ['ai']),
        makeGhItem('owner/d', 70, ['ai']),
        makeGhItem('owner/e', 60, ['ai']),
        makeGhItem('owner/f', 50, ['ai'])
      ];
      writeCache(tmp, items);
      const repos = getHotRepos(tmp, { limit: 3, topicsOnly: false });
      expect(repos.length).toBe(3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('topicsOnly prefers tagged items', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      // High engagement but no agentic tags
      const untagged = makeGhItem('owner/untagged', 9000, ['database']);
      // Lower engagement but has agentic tag
      const tagged1 = makeGhItem('owner/agent-repo', 100, ['agents']);
      const tagged2 = makeGhItem('owner/mcp-tool', 80, ['mcp']);
      const tagged3 = makeGhItem('owner/llm-lib', 70, ['llm']);
      const tagged4 = makeGhItem('owner/cli-thing', 60, ['cli']);
      const tagged5 = makeGhItem('owner/ai-stuff', 50, ['ai']);
      writeCache(tmp, [untagged, tagged1, tagged2, tagged3, tagged4, tagged5]);
      const repos = getHotRepos(tmp, { limit: 5, topicsOnly: true });
      // All 5 tagged items fill the limit — untagged should be excluded
      expect(repos.every((r) => r.name !== 'owner/untagged')).toBe(true);
      expect(repos.length).toBe(5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('topicsOnly falls back to all when too few tagged items', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      // Only 2 tagged, but limit is 5 — should fall back to all
      const tagged1 = makeGhItem('owner/agent-repo', 100, ['agents']);
      const tagged2 = makeGhItem('owner/mcp-tool', 80, ['mcp']);
      const untagged1 = makeGhItem('owner/rust-lib', 200, ['database']);
      const untagged2 = makeGhItem('owner/go-server', 300, ['devtools']);
      const untagged3 = makeGhItem('owner/py-thing', 150, ['tools']);
      writeCache(tmp, [tagged1, tagged2, untagged1, untagged2, untagged3]);
      const repos = getHotRepos(tmp, { limit: 5, topicsOnly: true });
      // Falls back to all 5 items
      expect(repos.length).toBe(5);
      // top item by engagement (go-server: 300) should lead
      expect(repos[0]!.name).toBe('owner/go-server');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('empty cache returns [] without throwing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      // No cache written — directory exists but no file
      const repos = getHotRepos(tmp, { limit: 5 });
      expect(repos).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('nonexistent dataDir returns [] without throwing', () => {
    const repos = getHotRepos('/tmp/agora-does-not-exist-xyz-' + Date.now(), { limit: 5 });
    expect(repos).toEqual([]);
  });

  test('default limit is 5', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      const items: NewsItem[] = Array.from({ length: 10 }, (_, i) =>
        makeGhItem(`owner/repo${i}`, (10 - i) * 100, ['ai'])
      );
      writeCache(tmp, items);
      const repos = getHotRepos(tmp);
      expect(repos.length).toBe(5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('tie-break by name ascending', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-hotrepos-test-'));
    try {
      const items: NewsItem[] = [
        makeGhItem('owner/zzz', 100, ['ai']),
        makeGhItem('owner/aaa', 100, ['ai']),
        makeGhItem('owner/mmm', 100, ['ai'])
      ];
      writeCache(tmp, items);
      const repos = getHotRepos(tmp, { limit: 10, topicsOnly: false });
      expect(repos[0]!.name).toBe('owner/aaa');
      expect(repos[1]!.name).toBe('owner/mmm');
      expect(repos[2]!.name).toBe('owner/zzz');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── computeSinceLastSeen ──────────────────────────────────────────────────────

function makeNewsItem(publishedAt: string, overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'item-' + publishedAt,
    source: 'hn',
    title: 'Test item',
    url: 'https://example.com',
    publishedAt,
    fetchedAt: publishedAt,
    engagement: 1,
    tags: [],
    ...overrides
  };
}

describe('computeSinceLastSeen', () => {
  test('no prev → newItems=0, serverDelta=0 (first visit)', () => {
    const news = [makeNewsItem('2026-05-20T10:00:00.000Z')];
    const result = computeSinceLastSeen(undefined, { news, serverCount: 3 });
    expect(result).toEqual({ newItems: 0, serverDelta: 0 });
  });

  test('prev with no lastSeenAt → newItems=0, serverDelta=0', () => {
    const news = [makeNewsItem('2026-05-20T10:00:00.000Z')];
    const result = computeSinceLastSeen({ serverCount: 2 }, { news, serverCount: 3 });
    expect(result).toEqual({ newItems: 0, serverDelta: 1 });
  });

  test('counts items published after lastSeenAt', () => {
    const lastSeenAt = '2026-05-20T12:00:00.000Z';
    const news = [
      makeNewsItem('2026-05-20T11:00:00.000Z'), // before — not counted
      makeNewsItem('2026-05-20T13:00:00.000Z'), // after — counted
      makeNewsItem('2026-05-20T14:00:00.000Z'), // after — counted
      makeNewsItem('2026-05-20T12:00:00.000Z') // exactly equal — NOT counted (strictly >)
    ];
    const result = computeSinceLastSeen({ lastSeenAt, serverCount: 0 }, { news, serverCount: 0 });
    expect(result.newItems).toBe(2);
  });

  test('serverDelta is positive when serverCount grew', () => {
    const result = computeSinceLastSeen(
      { lastSeenAt: '2026-05-01T00:00:00.000Z', serverCount: 2 },
      { news: [], serverCount: 5 }
    );
    expect(result.serverDelta).toBe(3);
  });

  test('serverDelta is negative when serverCount shrank', () => {
    const result = computeSinceLastSeen(
      { lastSeenAt: '2026-05-01T00:00:00.000Z', serverCount: 5 },
      { news: [], serverCount: 3 }
    );
    expect(result.serverDelta).toBe(-2);
  });

  test('serverDelta is zero when serverCount unchanged', () => {
    const result = computeSinceLastSeen(
      { lastSeenAt: '2026-05-01T00:00:00.000Z', serverCount: 4 },
      { news: [], serverCount: 4 }
    );
    expect(result.serverDelta).toBe(0);
  });

  test('serverDelta is 0 when prev.serverCount is null/undefined', () => {
    const result = computeSinceLastSeen(
      { lastSeenAt: '2026-05-01T00:00:00.000Z' },
      { news: [], serverCount: 7 }
    );
    expect(result.serverDelta).toBe(0);
  });

  test('unparseable lastSeenAt → newItems=0, no throw', () => {
    const news = [makeNewsItem('2026-05-20T10:00:00.000Z')];
    expect(() => {
      const result = computeSinceLastSeen(
        { lastSeenAt: 'not-a-date', serverCount: 1 },
        { news, serverCount: 1 }
      );
      expect(result.newItems).toBe(0);
    }).not.toThrow();
  });

  test('unparseable publishedAt on item is ignored, no throw', () => {
    const news = [makeNewsItem('not-a-date'), makeNewsItem('2026-05-21T10:00:00.000Z')];
    expect(() => {
      const result = computeSinceLastSeen(
        { lastSeenAt: '2026-05-20T00:00:00.000Z', serverCount: 0 },
        { news, serverCount: 0 }
      );
      // Only the valid item (2026-05-21) is after lastSeenAt
      expect(result.newItems).toBe(1);
    }).not.toThrow();
  });

  test('empty news list → newItems=0', () => {
    const result = computeSinceLastSeen(
      { lastSeenAt: '2026-05-01T00:00:00.000Z', serverCount: 2 },
      { news: [], serverCount: 2 }
    );
    expect(result).toEqual({ newItems: 0, serverDelta: 0 });
  });
});
