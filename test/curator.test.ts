/**
 * Unit tests for src/curator/index.ts — pure helpers only; no network or opencode calls.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normaliseRepo,
  filterBundledDuplicates,
  curationStatus,
  readCuratedCache,
  writeCuratedCache,
  type CuratedPackage,
} from '../src/curator/index';
import { samplePackages } from '../src/data';
import type { HubItem } from '../src/hubs/types';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-curator-test-'));
}

function makeHubItem(overrides: Partial<HubItem> = {}): HubItem {
  return {
    id: 'gh:test-owner/test-repo',
    source: 'github',
    name: 'test-repo',
    description: 'A test MCP server',
    author: 'test-owner',
    version: 'abc1234',
    category: 'mcp',
    tags: ['mcp'],
    stars: 10,
    installs: 0,
    repository: 'https://github.com/test-owner/test-repo',
    createdAt: '2025-01-01',
    pricing: { kind: 'free' },
    fetchedAt: '2025-01-01T00:00:00Z',
    pushedAt: '2025-01-01T00:00:00Z',
    license: null,
    topics: ['mcp-server'],
    ...overrides,
  };
}

function makeCuratedPackage(overrides: Partial<CuratedPackage> = {}): CuratedPackage {
  return {
    id: 'ai-item-1',
    name: 'AI Item 1',
    description: 'Some AI-verified item',
    author: 'someone',
    version: '1.0.0',
    category: 'mcp',
    tags: ['mcp'],
    stars: 100,
    installs: 0,
    repository: 'https://github.com/someone/ai-item-1',
    createdAt: '2025-01-01',
    pricing: { kind: 'free' },
    aiVerifiedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

// ── normaliseRepo ─────────────────────────────────────────────────────────────

describe('normaliseRepo', () => {
  test('lowercases the url', () => {
    expect(normaliseRepo('https://GitHub.com/Owner/Repo')).toBe('https://github.com/owner/repo');
  });

  test('strips trailing .git', () => {
    expect(normaliseRepo('https://github.com/owner/repo.git')).toBe(
      'https://github.com/owner/repo'
    );
  });

  test('strips trailing slash', () => {
    expect(normaliseRepo('https://github.com/owner/repo/')).toBe('https://github.com/owner/repo');
  });

  test('strips both .git and trailing slash', () => {
    expect(normaliseRepo('https://github.com/owner/repo.git/')).toBe(
      'https://github.com/owner/repo'
    );
  });

  test('leaves a clean url unchanged', () => {
    expect(normaliseRepo('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });
});

// ── filterBundledDuplicates ───────────────────────────────────────────────────

describe('filterBundledDuplicates', () => {
  test('returns all items when none overlap the bundled catalog', () => {
    const candidates = [
      makeHubItem({ id: 'gh:novel/pkg-a', repository: 'https://github.com/novel/pkg-a' }),
      makeHubItem({ id: 'gh:novel/pkg-b', repository: 'https://github.com/novel/pkg-b' }),
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(2);
  });

  test('removes a candidate whose id matches a bundled package id', () => {
    const bundledId = samplePackages[0]!.id;
    const candidates = [
      makeHubItem({ id: bundledId }),
      makeHubItem({ id: 'gh:novel/pkg-x', repository: 'https://github.com/novel/pkg-x' }),
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('gh:novel/pkg-x');
  });

  test('removes a candidate whose id matches case-insensitively', () => {
    const bundledId = samplePackages[0]!.id.toUpperCase();
    const candidates = [makeHubItem({ id: bundledId })];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(0);
  });

  test('removes a candidate whose repository matches a bundled repository', () => {
    const bundledRepo = samplePackages.find((p) => p.repository)!.repository!;
    const candidates = [
      makeHubItem({
        id: 'gh:some/novel-id',
        repository: bundledRepo.toUpperCase() + '/',
      }),
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(0);
  });

  test('removes a candidate whose repository matches after stripping .git', () => {
    const bundledRepo = samplePackages.find((p) => p.repository)!.repository!;
    const candidates = [
      makeHubItem({
        id: 'gh:some/novel-id-2',
        repository: bundledRepo + '.git',
      }),
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(0);
  });

  test('empty candidate list returns empty array', () => {
    expect(filterBundledDuplicates([])).toHaveLength(0);
  });
});

// ── curationStatus ────────────────────────────────────────────────────────────

describe('curationStatus', () => {
  test('returns bundled source when no cache exists', () => {
    const dir = makeTmp();
    const status = curationStatus(dir);
    expect(status.source).toBe('bundled');
    expect(status.lastRunAt).toBeNull();
    expect(status.count).toBe(samplePackages.length);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns ai source when cache exists', () => {
    const dir = makeTmp();
    const pkg = makeCuratedPackage({ aiVerifiedAt: '2025-06-01T12:00:00.000Z' });
    writeCuratedCache(dir, [pkg]);
    const status = curationStatus(dir);
    expect(status.source).toBe('ai');
    expect(status.count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('lastRunAt is the most recent aiVerifiedAt across cached items', () => {
    const dir = makeTmp();
    const older = makeCuratedPackage({
      id: 'item-a',
      aiVerifiedAt: '2025-01-01T00:00:00.000Z',
    });
    const newer = makeCuratedPackage({
      id: 'item-b',
      aiVerifiedAt: '2025-06-15T10:00:00.000Z',
    });
    writeCuratedCache(dir, [older, newer]);
    const status = curationStatus(dir);
    expect(status.lastRunAt).toBe('2025-06-15T10:00:00.000Z');
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── incremental resumability ──────────────────────────────────────────────────

describe('readCuratedCache / writeCuratedCache — incremental resumability', () => {
  test('second read returns cached items without re-verifying', () => {
    const dir = makeTmp();

    const items = [
      makeCuratedPackage({ id: 'cached-item-1', stars: 50 }),
      makeCuratedPackage({ id: 'cached-item-2', stars: 200 }),
    ];
    writeCuratedCache(dir, items);

    const first = readCuratedCache(dir);
    expect(first).toHaveLength(2);

    const second = readCuratedCache(dir);
    expect(second).toHaveLength(2);
    expect(second.map((i) => i.id).sort()).toEqual(['cached-item-1', 'cached-item-2'].sort());

    rmSync(dir, { recursive: true, force: true });
  });

  test('writeCuratedCache sorts by stars descending', () => {
    const dir = makeTmp();
    const items = [
      makeCuratedPackage({ id: 'low-stars', stars: 5 }),
      makeCuratedPackage({ id: 'high-stars', stars: 999 }),
      makeCuratedPackage({ id: 'mid-stars', stars: 50 }),
    ];
    writeCuratedCache(dir, items);
    const cached = readCuratedCache(dir);
    expect(cached[0]!.id).toBe('high-stars');
    expect(cached[1]!.id).toBe('mid-stars');
    expect(cached[2]!.id).toBe('low-stars');
    rmSync(dir, { recursive: true, force: true });
  });

  test('curateAll with cached data and no force returns cached items directly', async () => {
    // Import curateAll here to keep the import at function scope
    // and avoid top-level side-effects in the test module.
    const { curateAll } = await import('../src/curator/index');
    const dir = makeTmp();

    const items = [makeCuratedPackage({ id: 'incremental-item', stars: 42 })];
    writeCuratedCache(dir, items);

    const logs: string[] = [];
    const result = await curateAll(dir, {
      force: false,
      limit: 50,
      onProgress: (msg) => logs.push(msg),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('incremental-item');
    // Should have short-circuited — no discovery or AI calls
    expect(logs.some((l) => l.includes('cached'))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
