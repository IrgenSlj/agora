import { describe, expect, test } from 'bun:test';
import { scoreItem, rankItems } from '../src/news/score.js';
import { readCache, writeCache, isStale } from '../src/news/cache.js';
import { hostFromUrl, slugFromUrl } from '../src/news/types.js';
import type { NewsItem, NewsConfig } from '../src/news/types.js';

const BASE_CONFIG: NewsConfig = {
  sources: {
    hn: { enabled: true, ttlMinutes: 10 },
    reddit: { enabled: true, ttlMinutes: 15 },
    'github-trending': { enabled: true, ttlMinutes: 30 },
    arxiv: { enabled: false, ttlMinutes: 60 },
    rss: { enabled: false, ttlMinutes: 60 },
  },
  topics: ['mcp', 'ai', 'agents'],
  weights: { recency: 1.0, engagement: 0.6, topic: 0.8 },
};

const makeItem = (overrides: Partial<NewsItem> & { id: string }): NewsItem => ({
  source: 'hn',
  title: 'Test Story',
  url: 'https://example.com/test',
  publishedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  engagement: 100,
  tags: [],
  ...overrides,
});

// ── scoreItem ────────────────────────────────────────────────────────────────

describe('scoreItem', () => {
  test('recency decreases with age', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const fresh = scoreItem(
      makeItem({ id: 'a', publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    const old = scoreItem(
      makeItem({ id: 'b', publishedAt: '2026-05-10T12:00:00Z' }),
      BASE_CONFIG,
      now
    );
    expect(fresh.scoreBreakdown.recency).toBeGreaterThan(old.scoreBreakdown.recency);
  });

  test('engagement increases with upvotes', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const high = scoreItem(
      makeItem({ id: 'a', engagement: 1000, publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    const low = scoreItem(
      makeItem({ id: 'b', engagement: 10, publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    expect(high.scoreBreakdown.engagement).toBeGreaterThan(low.scoreBreakdown.engagement);
  });

  test('topic match adds to score', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const matched = scoreItem(
      makeItem({ id: 'a', tags: ['mcp'], publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    const unmatched = scoreItem(
      makeItem({ id: 'b', tags: ['unrelated'], publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    expect(matched.scoreBreakdown.topic).toBeGreaterThan(unmatched.scoreBreakdown.topic);
  });

  test('engagement normalizes via log10', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const item = scoreItem(
      makeItem({ id: 'a', engagement: 9999, publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    expect(item.scoreBreakdown.engagement).toBeLessThanOrEqual(1);
    expect(item.scoreBreakdown.engagement).toBeGreaterThan(0);
  });

  test('zero engagement is handled', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const item = scoreItem(
      makeItem({ id: 'a', engagement: 0, publishedAt: '2026-05-15T11:00:00Z' }),
      BASE_CONFIG,
      now
    );
    expect(item.scoreBreakdown.engagement).toBe(0);
  });
});

// ── rankItems ────────────────────────────────────────────────────────────────

describe('rankItems', () => {
  test('items sorted by score descending', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const items = [
      makeItem({ id: 'a', tags: ['mcp'], url: 'https://example.com/a', publishedAt: '2026-05-15T11:00:00Z', engagement: 500 }),
      makeItem({ id: 'b', tags: ['unrelated'], url: 'https://example.com/b', publishedAt: '2026-05-15T10:00:00Z', engagement: 10 }),
    ];
    const ranked = rankItems(items, BASE_CONFIG, now);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe('a');
    expect(ranked[1].id).toBe('b');
  });

  test('dedup by host+slug, keeps higher score', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const items = [
      makeItem({ id: 'a', url: 'https://example.com/story', engagement: 100, publishedAt: '2026-05-15T11:00:00Z', tags: [] }),
      makeItem({ id: 'b', url: 'https://example.com/story', engagement: 10, publishedAt: '2026-05-15T10:00:00Z', tags: [] }),
    ];
    const ranked = rankItems(items, BASE_CONFIG, now);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('a');
  });

  test('empty input returns empty array', () => {
    const ranked = rankItems([], BASE_CONFIG, new Date());
    expect(ranked).toHaveLength(0);
  });
});

// ── hostFromUrl / slugFromUrl ────────────────────────────────────────────────

describe('hostFromUrl', () => {
  test('extracts hostname', () => {
    expect(hostFromUrl('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
  });

  test('strips www', () => {
    expect(hostFromUrl('https://www.github.com/foo')).toBe('github.com');
  });

  test('empty for invalid url', () => {
    expect(hostFromUrl('')).toBe('');
  });
});

describe('slugFromUrl', () => {
  test('extracts path segments', () => {
    expect(slugFromUrl('https://github.com/foo/bar')).toBe('foo/bar');
  });

  test('handles trailing slash', () => {
    expect(slugFromUrl('https://github.com/foo/bar/')).toBe('foo/bar');
  });

  test('empty for invalid url', () => {
    expect(slugFromUrl('')).toBe('');
  });
});

// ── Cache ────────────────────────────────────────────────────────────────────

describe('readCache / writeCache', () => {
  test('readCache returns empty array for missing file', () => {
    const items = readCache('/tmp/agora-test-nonexistent');
    expect(items).toEqual([]);
  });

  test('writeCache + readCache round-trips', () => {
    const dir = '/tmp/agora-cache-test';
    const items: NewsItem[] = [
      makeItem({ id: 'test:1', title: 'Test' }),
    ];
    writeCache(dir, items);
    const loaded = readCache(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test:1');
  });
});

describe('isStale', () => {
  test('empty items is stale', () => {
    expect(isStale([], 'hn', 10, new Date())).toBe(true);
  });

  test('recent items is not stale', () => {
    const items = [makeItem({ id: 'a', fetchedAt: new Date().toISOString() })];
    expect(isStale(items, 'hn', 10, new Date())).toBe(false);
  });

  test('old items is stale', () => {
    const old = new Date(Date.now() - 3600000).toISOString();
    const items = [makeItem({ id: 'a', fetchedAt: old })];
    expect(isStale(items, 'hn', 10, new Date())).toBe(true);
  });
});
