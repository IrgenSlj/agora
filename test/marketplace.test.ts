/**
 * Contract tests for src/marketplace.ts.
 * Calls the REAL exported functions — no re-implementation of filtering logic.
 */
import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildOpenCodeConfig,
  createInstallPlan,
  findMarketplaceItem,
  getInstallKind,
  getMarketplaceItems,
  getTrendingItems,
  getTutorials,
  findTutorial,
  searchMarketplaceItems,
  similarItems,
  type MarketplaceItem,
  type PackageMarketplaceItem
} from '../src/marketplace';
import { samplePackages } from '../src/data';

// ── searchMarketplaceItems ──────────────────────────────────────────────────

describe('searchMarketplaceItems', () => {
  test('empty query returns all items (packages + workflows)', () => {
    const all = searchMarketplaceItems();
    const direct = getMarketplaceItems();
    expect(all.length).toBe(direct.length);
  });

  test('query match filters by relevant field', () => {
    const results = searchMarketplaceItems({ query: 'filesystem' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.id === 'mcp-filesystem')).toBe(true);
  });

  test('query is case-insensitive', () => {
    const lower = searchMarketplaceItems({ query: 'github' });
    const upper = searchMarketplaceItems({ query: 'GITHUB' });
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  test('category filter — package — returns only packages', () => {
    const results = searchMarketplaceItems({ category: 'package' });
    expect(results.every((r) => r.kind === 'package')).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  test('category filter — workflow — returns only workflows', () => {
    const results = searchMarketplaceItems({ category: 'workflow' });
    expect(results.every((r) => r.kind === 'workflow')).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  test('limit restricts the result count', () => {
    const results = searchMarketplaceItems({ limit: 3 });
    expect(results.length).toBe(3);
  });

  test('limit=1 returns exactly one item', () => {
    const results = searchMarketplaceItems({ query: 'github', limit: 1 });
    expect(results.length).toBe(1);
  });

  test('unknown query returns empty array', () => {
    const results = searchMarketplaceItems({ query: 'zzz-nonexistent-xyz-impossible' });
    expect(results.length).toBe(0);
  });

  test('results sorted by popularity (installs) descending for empty query', () => {
    const results = searchMarketplaceItems();
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].installs).toBeGreaterThanOrEqual(results[i + 1].installs);
    }
  });

  test('sort by stars ascending', () => {
    const results = searchMarketplaceItems({ sortBy: 'stars', sortOrder: 'asc', limit: 50 });
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].stars).toBeLessThanOrEqual(results[i + 1].stars);
    }
  });

  test('sort by stars descending', () => {
    const results = searchMarketplaceItems({ sortBy: 'stars', sortOrder: 'desc', limit: 50 });
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].stars).toBeGreaterThanOrEqual(results[i + 1].stars);
    }
  });

  test('sort by name ascending', () => {
    const results = searchMarketplaceItems({ sortBy: 'name', sortOrder: 'asc', limit: 50 });
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].name.localeCompare(results[i + 1].name)).toBeLessThanOrEqual(0);
    }
  });

  test('pagination with perPage and page', () => {
    const page1 = searchMarketplaceItems({ perPage: 3, page: 1, limit: 50 });
    const page2 = searchMarketplaceItems({ perPage: 3, page: 2, limit: 50 });
    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
    // pages should not overlap
    for (const item of page1) {
      expect(page2.find((i) => i.id === item.id)).toBeUndefined();
    }
  });
});

// ── findMarketplaceItem ─────────────────────────────────────────────────────

describe('findMarketplaceItem', () => {
  test('exact id match returns the item', () => {
    const item = findMarketplaceItem('mcp-github');
    expect(item).not.toBeNull();
    expect(item!.id).toBe('mcp-github');
  });

  test('exact name match (case-insensitive) returns the item', () => {
    // mcp-filesystem's name is '@modelcontextprotocol/server-filesystem'
    const item = findMarketplaceItem('@modelcontextprotocol/server-filesystem');
    expect(item).not.toBeNull();
    expect(item!.id).toBe('mcp-filesystem');
  });

  test('unambiguous substring match returns the item', () => {
    // 'mcp-kubernetes' is the only item with 'kubernetes' in id/name
    const item = findMarketplaceItem('kubernetes');
    expect(item).not.toBeNull();
    expect(item!.id).toBe('mcp-kubernetes');
  });

  test('ambiguous substring (matches >1 item) returns null', () => {
    // 'mcp' appears in virtually every item — must return null
    const item = findMarketplaceItem('mcp');
    expect(item).toBeNull();
  });

  test('unknown id returns null', () => {
    const item = findMarketplaceItem('zzz-does-not-exist');
    expect(item).toBeNull();
  });

  test('type filter — package — excludes workflows', () => {
    // wf-tdd-cycle is a workflow, should not be found when type=package
    const item = findMarketplaceItem('wf-tdd-cycle', { type: 'package' });
    expect(item).toBeNull();
  });

  test('type filter — workflow — excludes packages', () => {
    const item = findMarketplaceItem('mcp-github', { type: 'workflow' });
    expect(item).toBeNull();
  });

  test('type filter — workflow — finds a real workflow', () => {
    const item = findMarketplaceItem('wf-tdd-cycle', { type: 'workflow' });
    expect(item).not.toBeNull();
    expect(item!.id).toBe('wf-tdd-cycle');
  });
});

// ── getTrendingItems ────────────────────────────────────────────────────────

describe('getTrendingItems', () => {
  test('default limit is 5', () => {
    const items = getTrendingItems();
    expect(items.length).toBe(5);
  });

  test('custom limit is respected', () => {
    const items = getTrendingItems({ limit: 3 });
    expect(items.length).toBe(3);
  });

  test('returned items are sorted by popularity (installs) descending', () => {
    const items = getTrendingItems({ limit: 10 });
    for (let i = 0; i < items.length - 1; i++) {
      expect(items[i].installs).toBeGreaterThanOrEqual(items[i + 1].installs);
    }
  });

  test('category filter is respected', () => {
    const packages = getTrendingItems({ category: 'package', limit: 10 });
    expect(packages.every((i) => i.kind === 'package')).toBe(true);
  });
});

// ── getTutorials / findTutorial ─────────────────────────────────────────────

describe('getTutorials', () => {
  test('returns all tutorials when no filter applied', () => {
    const all = getTutorials();
    expect(all.length).toBeGreaterThan(0);
  });

  test('level filter restricts results', () => {
    const beginners = getTutorials({ level: 'beginner' });
    expect(beginners.every((t) => t.level === 'beginner')).toBe(true);
    expect(beginners.length).toBeGreaterThan(0);
  });

  test('limit restricts result count', () => {
    const limited = getTutorials({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  test('query filters by tutorial content', () => {
    const results = getTutorials({ query: 'mcp' });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('findTutorial', () => {
  test('finds by exact id', () => {
    const tut = findTutorial('tut-mcp-basics');
    expect(tut).not.toBeNull();
    expect(tut!.id).toBe('tut-mcp-basics');
  });

  test('finds by substring of id', () => {
    const tut = findTutorial('mcp-basics');
    expect(tut).not.toBeNull();
  });

  test('returns null for unknown id', () => {
    const tut = findTutorial('zzz-nonexistent');
    expect(tut).toBeNull();
  });
});

// ── createInstallPlan / buildOpenCodeConfig / getInstallKind ───────────────

describe('getInstallKind', () => {
  test('package with npmPackage → mcp', () => {
    const pkg = samplePackages.find((p) => p.npmPackage) as (typeof samplePackages)[0];
    const item: PackageMarketplaceItem = { ...pkg, kind: 'package' };
    expect(getInstallKind(item)).toBe('mcp');
  });

  test('package without npmPackage → unsupported', () => {
    // prompt packages have no npmPackage
    const promptPkg = samplePackages.find((p) => p.category === 'prompt' && !p.npmPackage);
    if (!promptPkg) return; // guard — skip if data changes
    const item: PackageMarketplaceItem = { ...promptPkg, kind: 'package' };
    expect(getInstallKind(item)).toBe('unsupported');
  });

  test('workflow item → workflow', () => {
    const item = findMarketplaceItem('wf-tdd-cycle');
    expect(item).not.toBeNull();
    expect(getInstallKind(item!)).toBe('workflow');
  });
});

describe('buildOpenCodeConfig', () => {
  test('adds package to mcp', () => {
    const pkg = findMarketplaceItem('mcp-github') as PackageMarketplaceItem;
    const config = buildOpenCodeConfig([pkg]);
    expect(config.$schema).toBe('https://opencode.ai/config.json');
    expect(config.mcp).toBeDefined();
    expect(config.mcp!['mcp-github']).toBeDefined();
    expect(config.mcp!['mcp-github'].command[0]).toBe('npx');
    expect(config.mcp!['mcp-github'].command[1]).toBe('@modelcontextprotocol/server-github');
  });

  test('merges with existing config without overwriting other servers', () => {
    const existing = {
      mcp: {
        'my-existing-server': { type: 'local' as const, command: ['node', 'server.js'] }
      },
      plugin: ['some-plugin']
    };
    const pkg = findMarketplaceItem('mcp-filesystem') as PackageMarketplaceItem;
    const config = buildOpenCodeConfig([pkg], existing);

    expect(config.mcp!['my-existing-server']).toBeDefined();
    expect(config.mcp!['mcp-filesystem']).toBeDefined();
    expect(config.plugin).toContain('some-plugin');
  });

  test('adds workflow plugin name for workflow items', () => {
    const wf = findMarketplaceItem('wf-tdd-cycle')!;
    const config = buildOpenCodeConfig([wf]);
    expect(config.plugin).toContain('skill-tdd-cycle');
    expect(config.mcp).toBeDefined();
    expect(Object.keys(config.mcp!).length).toBe(0);
  });

  test('handles multiple items in one call', () => {
    const github = findMarketplaceItem('mcp-github') as MarketplaceItem;
    const postgres = findMarketplaceItem('mcp-postgres') as MarketplaceItem;
    const config = buildOpenCodeConfig([github, postgres]);
    expect(config.mcp!['mcp-github']).toBeDefined();
    expect(config.mcp!['mcp-postgres']).toBeDefined();
  });
});

// ── similarItems ────────────────────────────────────────────────────────────

describe('similarItems', () => {
  test('returns similar items by tag overlap', () => {
    // mcp-postgres shares tags 'database', 'sql' with other DB items
    const results = similarItems('mcp-postgres', { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    // mcp-sqlite shares 'database' and 'sql' — should rank high
    const sqliteIdx = results.findIndex((r) => r.id === 'mcp-sqlite');
    expect(sqliteIdx).toBeGreaterThanOrEqual(0);
    // mcp-supabase shares 'database' — should appear in top results
    const supabaseIdx = results.findIndex((r) => r.id === 'mcp-supabase');
    expect(supabaseIdx).toBeGreaterThanOrEqual(0);
    // mcp-sqlite (2 shared tags) should rank above mcp-supabase (1 shared tag)
    expect(sqliteIdx).toBeLessThan(supabaseIdx);
  });

  test('excludes the target item itself', () => {
    const results = similarItems('mcp-github');
    expect(results.some((r) => r.id === 'mcp-github')).toBe(false);
  });

  test('respects type filter — package', () => {
    const results = similarItems('wf-tdd-cycle', { type: 'package', limit: 10 });
    expect(results.every((r) => r.kind === 'package')).toBe(true);
  });

  test('respects type filter — workflow', () => {
    const results = similarItems('mcp-postgres', { type: 'workflow', limit: 10 });
    expect(results.every((r) => r.kind === 'workflow')).toBe(true);
  });

  test('limit restricts result count', () => {
    const results = similarItems('mcp-filesystem', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test('returns empty array for unknown id', () => {
    const results = similarItems('zzz-nonexistent');
    expect(results).toHaveLength(0);
  });

  test('results are sorted by similarity descending', () => {
    const results = similarItems('mcp-github', { limit: 10 });
    // mcp-gitlab is most similar (shares git, api, official, devtools)
    expect(results[0]?.id).toBe('mcp-gitlab');
  });
});

// ── createInstallPlan ────────────────────────────────────────────────────────

describe('createInstallPlan', () => {
  test('MCP package produces installable plan with commands', () => {
    const pkg = findMarketplaceItem('mcp-github') as PackageMarketplaceItem;
    const plan = createInstallPlan(pkg);
    expect(plan.installable).toBe(true);
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toBe('npm install -g @modelcontextprotocol/server-github');
    expect(plan.config.mcp!['mcp-github']).toBeDefined();
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  test('prompt package (no npmPackage) produces non-installable plan', () => {
    const promptPkg = samplePackages.find((p) => p.category === 'prompt' && !p.npmPackage);
    if (!promptPkg) return;
    const item: PackageMarketplaceItem = { ...promptPkg, kind: 'package' };
    const plan = createInstallPlan(item);
    expect(plan.installable).toBe(false);
    expect(plan.commands).toHaveLength(0);
  });

  test('workflow item produces installable plan with plugin, no commands', () => {
    const wf = findMarketplaceItem('wf-tdd-cycle')!;
    const plan = createInstallPlan(wf);
    expect(plan.installable).toBe(true);
    expect(plan.commands).toHaveLength(0);
    expect(plan.config.plugin).toContain('skill-tdd-cycle');
  });

  test('merges with existing config', () => {
    const pkg = findMarketplaceItem('mcp-filesystem') as PackageMarketplaceItem;
    const existing = {
      mcp: { 'other-server': { type: 'local' as const, command: ['npx', 'other'] } }
    };
    const plan = createInstallPlan(pkg, existing);
    expect(plan.config.mcp!['other-server']).toBeDefined();
    expect(plan.config.mcp!['mcp-filesystem']).toBeDefined();
  });
});

// ── AGORA_LIVE_HUBS integration ─────────────────────────────────────────────

describe('getMarketplaceItems — AGORA_LIVE_HUBS=1', () => {
  let tmpDir: string;
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
    Object.assign(process.env, origEnv);
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }
  });

  test('with AGORA_LIVE_HUBS=1 and cached hub items, returns curated + hub items merged', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
    const hubItem = {
      id: 'gh:test/hub-repo',
      source: 'github',
      name: 'hub-repo',
      description: 'A hub repo description',
      author: 'test',
      version: 'main',
      category: 'mcp',
      tags: ['mcp'],
      stars: 100,
      installs: 100,
      repository: 'https://github.com/test/hub-repo',
      createdAt: '2026-01-01T00:00:00Z',
      pricing: { kind: 'free' },
      fetchedAt: new Date().toISOString(),
      pushedAt: '2026-04-01T00:00:00Z',
      license: 'MIT',
      topics: ['mcp']
    };
    writeFileSync(join(tmpDir, 'hubs-cache.jsonl'), JSON.stringify(hubItem) + '\n', 'utf8');

    process.env.AGORA_LIVE_HUBS = '1';
    process.env.AGORA_HOME = tmpDir;

    const items = getMarketplaceItems();
    const hubIds = items.map((i) => i.id);
    expect(hubIds).toContain('gh:test/hub-repo');
    // curated items still present
    expect(hubIds).toContain('mcp-filesystem');
  });

  test('without AGORA_LIVE_HUBS=1, hub cache items are not included', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
    const hubItem = {
      id: 'gh:test/should-not-appear',
      source: 'github',
      name: 'should-not-appear',
      description: 'Should not appear without live hubs enabled',
      author: 'test',
      version: 'main',
      category: 'mcp',
      tags: ['mcp'],
      stars: 50,
      installs: 50,
      repository: 'https://github.com/test/should-not-appear',
      createdAt: '2026-01-01T00:00:00Z',
      pricing: { kind: 'free' },
      fetchedAt: new Date().toISOString(),
      pushedAt: '2026-04-01T00:00:00Z',
      license: 'MIT',
      topics: ['mcp']
    };
    writeFileSync(join(tmpDir, 'hubs-cache.jsonl'), JSON.stringify(hubItem) + '\n', 'utf8');

    delete process.env.AGORA_LIVE_HUBS;
    process.env.AGORA_HOME = tmpDir;

    const items = getMarketplaceItems();
    expect(items.map((i) => i.id)).not.toContain('gh:test/should-not-appear');
  });
});
