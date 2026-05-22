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
  mapWithConcurrency,
  isStale,
  dedupeById,
  type CuratedPackage
} from '../src/curator/index';
import { parsePositiveIntFlag } from '../src/cli/commands/curate';
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
    ...overrides
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
    ...overrides
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
      makeHubItem({ id: 'gh:novel/pkg-b', repository: 'https://github.com/novel/pkg-b' })
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(2);
  });

  test('removes a candidate whose id matches a bundled package id', () => {
    const bundledId = samplePackages[0]!.id;
    const candidates = [
      makeHubItem({ id: bundledId }),
      makeHubItem({ id: 'gh:novel/pkg-x', repository: 'https://github.com/novel/pkg-x' })
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
        repository: bundledRepo.toUpperCase() + '/'
      })
    ];
    const filtered = filterBundledDuplicates(candidates);
    expect(filtered).toHaveLength(0);
  });

  test('removes a candidate whose repository matches after stripping .git', () => {
    const bundledRepo = samplePackages.find((p) => p.repository)!.repository!;
    const candidates = [
      makeHubItem({
        id: 'gh:some/novel-id-2',
        repository: bundledRepo + '.git'
      })
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
      aiVerifiedAt: '2025-01-01T00:00:00.000Z'
    });
    const newer = makeCuratedPackage({
      id: 'item-b',
      aiVerifiedAt: '2025-06-15T10:00:00.000Z'
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
      makeCuratedPackage({ id: 'cached-item-2', stars: 200 })
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
      makeCuratedPackage({ id: 'mid-stars', stars: 50 })
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
      onProgress: (msg) => logs.push(msg)
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('incremental-item');
    // Should have short-circuited — no discovery or AI calls
    expect(logs.some((l) => l.includes('cached'))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

// ── mapWithConcurrency ────────────────────────────────────────────────────────

describe('mapWithConcurrency', () => {
  test('preserves input order in returned array', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test('handles empty array', async () => {
    const results = await mapWithConcurrency([], 4, async (n: number) => n);
    expect(results).toEqual([]);
  });

  test('respects concurrency limit', async () => {
    let active = 0;
    let maxObserved = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (_item) => {
      active += 1;
      if (active > maxObserved) maxObserved = active;
      // Yield to let other tasks start
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
    });

    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  test('limit 1 runs sequentially', async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await mapWithConcurrency(items, 1, async (n) => {
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });
});

// ── isStale ───────────────────────────────────────────────────────────────────

describe('isStale', () => {
  const base = new Date('2025-06-01T00:00:00.000Z');

  test('returns false when age is less than staleDays', () => {
    const verifiedAt = new Date(base.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(verifiedAt, 30, base)).toBe(false);
  });

  test('returns true when age equals staleDays exactly', () => {
    const verifiedAt = new Date(base.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(verifiedAt, 30, base)).toBe(true);
  });

  test('returns true when age is greater than staleDays', () => {
    const verifiedAt = new Date(base.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isStale(verifiedAt, 30, base)).toBe(true);
  });

  test('returns false for a very recent timestamp', () => {
    const verifiedAt = new Date(base.getTime() - 1000).toISOString();
    expect(isStale(verifiedAt, 30, base)).toBe(false);
  });
});

// ── dedupeById ────────────────────────────────────────────────────────────────

describe('dedupeById', () => {
  test('returns all items when no duplicates', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupeById(items)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  test('keeps first occurrence and removes subsequent duplicates', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'a', v: 3 }
    ];
    const result = dedupeById(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'a', v: 1 });
    expect(result[1]).toEqual({ id: 'b', v: 2 });
  });

  test('returns empty array for empty input', () => {
    expect(dedupeById([])).toEqual([]);
  });

  test('handles all-duplicate input', () => {
    const items = [{ id: 'x' }, { id: 'x' }, { id: 'x' }];
    const result = dedupeById(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('x');
  });
});

// ── parsePositiveIntFlag ──────────────────────────────────────────────────────

describe('parsePositiveIntFlag', () => {
  test('returns numeric string coerced to integer', () => {
    expect(parsePositiveIntFlag('20', 50)).toBe(20);
  });

  test('returns fallback for boolean true', () => {
    expect(parsePositiveIntFlag(true, 50)).toBe(50);
  });

  test('returns fallback for boolean false', () => {
    expect(parsePositiveIntFlag(false, 50)).toBe(50);
  });

  test('returns fallback for undefined', () => {
    expect(parsePositiveIntFlag(undefined, 50)).toBe(50);
  });

  test('returns fallback for zero', () => {
    expect(parsePositiveIntFlag('0', 50)).toBe(50);
  });

  test('returns fallback for negative number', () => {
    expect(parsePositiveIntFlag('-5', 50)).toBe(50);
  });

  test('returns fallback for non-numeric string', () => {
    expect(parsePositiveIntFlag('abc', 50)).toBe(50);
  });

  test('truncates floating point to integer', () => {
    expect(parsePositiveIntFlag('7.9', 50)).toBe(7);
  });
});
