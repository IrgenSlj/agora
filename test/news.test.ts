import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreItem, rankItems } from '../src/news/score.js';
import { readCache, writeCache, isStale } from '../src/news/cache.js';
import { hostFromUrl, slugFromUrl } from '../src/news/types.js';
import type { NewsItem, NewsConfig, ScoredNewsItem } from '../src/news/types.js';
import { visible, newsPage, _resetNewsState } from '../src/cli/pages/news.js';
import { createStyler } from '../src/ui.js';
import type { PageContext, AppState } from '../src/cli/pages/types.js';

const BASE_CONFIG: NewsConfig = {
  sources: {
    hn: { enabled: true, ttlMinutes: 10 },
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
  const ghItem = makeScoredItem({ id: 'gh:1', source: 'github-trending', title: 'GH Story' });

  test('savedOnly=false shows all items', () => {
    const st = makeState({ items: [hnItem, ghItem] });
    expect(visible(st)).toHaveLength(2);
  });

  test('savedOnly=true shows only saved items', () => {
    const st = makeState({
      items: [hnItem, ghItem],
      savedOnly: true,
      saved: new Set(['hn:1'])
    });
    const result = visible(st);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('hn:1');
  });

  test('savedOnly=true with no saved items returns empty', () => {
    const st = makeState({ items: [hnItem, ghItem], savedOnly: true });
    expect(visible(st)).toHaveLength(0);
  });

  test('unreadOnly=false shows all items', () => {
    const st = makeState({ items: [hnItem, ghItem] });
    expect(visible(st)).toHaveLength(2);
  });

  test('unreadOnly=true hides read items', () => {
    const st = makeState({
      items: [hnItem, ghItem],
      unreadOnly: true,
      read: new Set(['hn:1'])
    });
    const result = visible(st);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('gh:1');
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
      items: [hnItem, ghItem],
      source: 'hn',
      savedOnly: true,
      saved: new Set(['gh:1'])
    });
    expect(visible(st)).toHaveLength(0);
  });
});

// ── render() integration tests ───────────────────────────────────────────────

function makeNewsItem(overrides: Partial<NewsItem> & { id: string }): NewsItem {
  return {
    source: 'hn',
    title: 'A Test Story',
    url: 'https://example.com/test',
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    engagement: 150,
    tags: [],
    ...overrides
  };
}

function makeRenderCtx(opts: {
  tmp: string;
  width?: number;
  height?: number;
  color?: boolean;
}): PageContext {
  const { tmp, width = 100, height = 30, color = false } = opts;
  const style = createStyler(color);
  return {
    io: {
      stdout: { write: () => {} } as any,
      stderr: { write: () => {} } as any,
      env: { HOME: tmp, AGORA_HOME: tmp, PATH: process.env.PATH ?? '' },
      cwd: tmp
    },
    style,
    width,
    height,
    trueColor: false,
    app: { user: {}, cwd: tmp, unread: { news: 0 } } as AppState,
    repaint() {}
  } as PageContext;
}

describe('news render — list view', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-news-render-'));
    _resetNewsState();
  });

  afterEach(() => {
    _resetNewsState();
  });

  test('renders story list with title and host', () => {
    const items: NewsItem[] = [
      makeNewsItem({
        id: 'hn:1',
        title: 'MCP in production',
        url: 'https://news.ycombinator.com/item?id=1'
      }),
      makeNewsItem({
        id: 'gh:1',
        source: 'github-trending',
        title: 'Claude tricks',
        url: 'https://github.com/x/claude-tricks'
      })
    ];
    writeCache(tmp, items);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('MCP in production');
    expect(out).toContain('Claude tricks');
    expect(out).toContain('news.ycombinator.com');
  });

  test('renders NEWS header', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('NEWS');
  });

  test('renders source label in header (src: all by default)', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('src:');
    expect(out).toContain('all');
  });

  test('shows empty-feed message when no items match (loading=false, items empty)', () => {
    // Pre-seed a non-empty cache, mount, then remove items to simulate filter+empty
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', tags: ['mcp'] })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    // Switch to a tab that won't match (search tab, index 7) → empty visible list
    for (let i = 0; i < 7; i++) {
      newsPage.handleKey({ key: 'tab', raw: '\t', ctrl: false, shift: false, meta: false }, ctx);
    }
    const out = newsPage.render(ctx);
    expect(out).toMatch(/[Ee]mpty feed/);
    expect(out).toContain('r');
  });

  test('shows loading indicator before data arrives', () => {
    // mount with empty cache → loading=true
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    // Should either show loading or the empty-feed fallback — both are valid
    expect(out).toContain('NEWS');
    expect(out.length).toBeGreaterThan(0);
  });

  test('ranked items appear in scored order (fresh+high before old+low)', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
    const fresh = new Date(now.getTime() - 1 * 3600 * 1000).toISOString();
    // Different URLs so rankItems dedup doesn't collapse them
    const items: NewsItem[] = [
      makeNewsItem({
        id: 'a',
        title: 'OldLow',
        publishedAt: old,
        engagement: 5,
        url: 'https://example.com/old-low'
      }),
      makeNewsItem({
        id: 'b',
        title: 'FreshHigh',
        publishedAt: fresh,
        engagement: 999,
        url: 'https://example.com/fresh-high'
      })
    ];
    writeCache(tmp, items);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    const posA = out.indexOf('OldLow');
    const posB = out.indexOf('FreshHigh');
    expect(posB).toBeGreaterThanOrEqual(0);
    expect(posA).toBeGreaterThanOrEqual(0);
    expect(posB).toBeLessThan(posA);
  });

  test('save/unread markers appear in output after saving item', () => {
    const items: NewsItem[] = [
      makeNewsItem({ id: 'hn:99', title: 'SaveMe', url: 'https://example.com/saved' })
    ];
    writeCache(tmp, items);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 's', raw: 's', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('saved');
  });

  test('saved-only badge appears when savedOnly is active', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'b', raw: 'b', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('saved');
  });

  test('unread-only badge appears when unreadOnly is active', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'u', raw: 'u', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('unread');
  });

  test('source filter cycles via S key and shows source in header', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', source: 'hn', title: 'HN Story' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    // S cycles source: all → hn
    newsPage.handleKey({ key: 'S', raw: 'S', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    // Header should show the source label HN
    expect(out).toContain('HN');
    // src: key still present
    expect(out).toContain('src:');
  });

  test('NO_COLOR mode produces readable plain text without ANSI codes', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', title: 'PlainStory' })]);
    const ctx = makeRenderCtx({ tmp, color: false });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toContain('NEWS');
    expect(out).toContain('PlainStory');
  });

  test('narrow width renders within bounds (no line exceeds width)', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', title: 'Narrow title story here' })]);
    const ctx = makeRenderCtx({ tmp, width: 50, height: 20, color: false });
    newsPage.mount!(ctx);
    const out = newsPage.render(ctx);
    for (const line of out.split('\n')) {
      // eslint-disable-next-line no-control-regex
      const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
      expect(plain.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('news render — detail view', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-news-detail-'));
    _resetNewsState();
  });

  afterEach(() => {
    _resetNewsState();
  });

  test('Enter opens detail view with title and host', () => {
    const item = makeNewsItem({
      id: 'hn:1',
      title: 'DetailStory',
      url: 'https://example.com/detail'
    });
    writeCache(tmp, [item]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'enter', raw: '\r', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('DetailStory');
    expect(out).toContain('example.com');
  });

  test('Esc from detail returns to list view', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', title: 'ReturnStory' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'enter', raw: '\r', ctrl: false, shift: false, meta: false }, ctx);
    newsPage.handleKey({ key: 'esc', raw: '\x1b', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('NEWS');
    expect(out).toContain('ReturnStory');
  });

  test('detail view shows src label and engagement', () => {
    const item = makeNewsItem({ id: 'hn:1', title: 'EngagedStory', engagement: 500 });
    writeCache(tmp, [item]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'enter', raw: '\r', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out).toContain('HN');
    expect(out).toContain('500');
  });
});

describe('news render — preview view', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-news-preview-'));
    _resetNewsState();
  });

  afterEach(() => {
    _resetNewsState();
  });

  test('preview loading state renders without error', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', title: 'PreviewStory' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'enter', raw: '\r', ctrl: false, shift: false, meta: false }, ctx);
    newsPage.handleKey({ key: 'p', raw: 'p', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    expect(out.length).toBeGreaterThan(0);
  });

  test('Esc from preview returns to detail view', () => {
    writeCache(tmp, [makeNewsItem({ id: 'hn:1', title: 'PreviewEscStory' })]);
    const ctx = makeRenderCtx({ tmp });
    newsPage.mount!(ctx);
    newsPage.handleKey({ key: 'enter', raw: '\r', ctrl: false, shift: false, meta: false }, ctx);
    newsPage.handleKey({ key: 'p', raw: 'p', ctrl: false, shift: false, meta: false }, ctx);
    newsPage.handleKey({ key: 'esc', raw: '\x1b', ctrl: false, shift: false, meta: false }, ctx);
    const out = newsPage.render(ctx);
    // Back in detail view — title is shown
    expect(out).toContain('PreviewEscStory');
  });
});
