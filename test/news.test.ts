import { describe, expect, test } from 'bun:test';
import { scoreItem, rankItems } from '../src/news/score.js';
import { readCache, writeCache, isStale } from '../src/news/cache.js';
import { hostFromUrl, slugFromUrl } from '../src/news/types.js';
import type { NewsItem, NewsConfig, ScoredNewsItem } from '../src/news/types.js';
import { visible } from '../src/cli/pages/news.js';

const BASE_CONFIG: NewsConfig = {
  sources: {
    hn: { enabled: true, ttlMinutes: 10 },
    reddit: { enabled: true, ttlMinutes: 15 },
    'github-trending': { enabled: true, ttlMinutes: 30 },
    arxiv: { enabled: false, ttlMinutes: 60 },
    rss: { enabled: false, ttlMinutes: 60 }
  },
  topics: ['mcp', 'ai', 'agents'],
  weights: { recency: 1.0, engagement: 0.6, topic: 0.8 }
};

const makeItem = (overrides: Partial<NewsItem> & { id: string }): NewsItem => ({
  source: 'hn',
  title: 'Test Story',
  url: 'https://example.com/test',
  publishedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  engagement: 100,
  tags: [],
  ...overrides
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
      makeItem({
        id: 'a',
        tags: ['mcp'],
        url: 'https://example.com/a',
        publishedAt: '2026-05-15T11:00:00Z',
        engagement: 500
      }),
      makeItem({
        id: 'b',
        tags: ['unrelated'],
        url: 'https://example.com/b',
        publishedAt: '2026-05-15T10:00:00Z',
        engagement: 10
      })
    ];
    const ranked = rankItems(items, BASE_CONFIG, now);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe('a');
    expect(ranked[1].id).toBe('b');
  });

  test('dedup by host+slug, keeps higher score', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const items = [
      makeItem({
        id: 'a',
        url: 'https://example.com/story',
        engagement: 100,
        publishedAt: '2026-05-15T11:00:00Z',
        tags: []
      }),
      makeItem({
        id: 'b',
        url: 'https://example.com/story',
        engagement: 10,
        publishedAt: '2026-05-15T10:00:00Z',
        tags: []
      })
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
    const items: NewsItem[] = [makeItem({ id: 'test:1', title: 'Test' })];
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

// ── visible() boolean filters ────────────────────────────────────────────────

function makeScoredItem(overrides: Partial<ScoredNewsItem> & { id: string }): ScoredNewsItem {
  return {
    source: 'hn',
    title: 'Test Story',
    url: 'https://example.com/test',
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    engagement: 100,
    tags: [],
    score: 1.0,
    scoreBreakdown: { recency: 1, engagement: 1, topic: 0 },
    ...overrides
  };
}

function makeState(
  overrides: Partial<{
    items: ScoredNewsItem[];
    source: string;
    tab: number;
    filter: string;
    savedOnly: boolean;
    unreadOnly: boolean;
    saved: Set<string>;
    read: Set<string>;
  }> = {}
) {
  return {
    items: overrides.items ?? [],
    source: overrides.source ?? 'all',
    tab: overrides.tab ?? 0,
    filter: overrides.filter ?? '',
    savedOnly: overrides.savedOnly ?? false,
    unreadOnly: overrides.unreadOnly ?? false,
    saved: overrides.saved ?? new Set<string>(),
    read: overrides.read ?? new Set<string>()
  } as any;
}

describe('visible() — boolean filters', () => {
  const hnItem = makeScoredItem({ id: 'hn:1', source: 'hn', title: 'HN Story' });
  const redditItem = makeScoredItem({ id: 'reddit:1', source: 'reddit', title: 'Reddit Story' });

  test('savedOnly=false shows all items', () => {
    const st = makeState({ items: [hnItem, redditItem] });
    expect(visible(st)).toHaveLength(2);
  });

  test('savedOnly=true shows only saved items', () => {
    const st = makeState({
      items: [hnItem, redditItem],
      savedOnly: true,
      saved: new Set(['hn:1'])
    });
    const result = visible(st);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('hn:1');
  });

  test('savedOnly=true with no saved items returns empty', () => {
    const st = makeState({ items: [hnItem, redditItem], savedOnly: true });
    expect(visible(st)).toHaveLength(0);
  });

  test('unreadOnly=false shows all items', () => {
    const st = makeState({ items: [hnItem, redditItem] });
    expect(visible(st)).toHaveLength(2);
  });

  test('unreadOnly=true hides read items', () => {
    const st = makeState({
      items: [hnItem, redditItem],
      unreadOnly: true,
      read: new Set(['hn:1'])
    });
    const result = visible(st);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('reddit:1');
  });

  test('savedOnly + unreadOnly AND together', () => {
    const both = makeScoredItem({ id: 'both:1', source: 'hn', title: 'Both' });
    const onlySaved = makeScoredItem({ id: 'saved:1', source: 'hn', title: 'Saved only' });
    const st = makeState({
      items: [both, onlySaved, hnItem],
      savedOnly: true,
      unreadOnly: true,
      saved: new Set(['both:1', 'saved:1']),
      read: new Set(['saved:1'])
    });
    const result = visible(st);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('both:1');
  });

  test('source filter still works alongside savedOnly', () => {
    const st = makeState({
      items: [hnItem, redditItem],
      source: 'hn',
      savedOnly: true,
      saved: new Set(['reddit:1'])
    });
    expect(visible(st)).toHaveLength(0);
  });
});
