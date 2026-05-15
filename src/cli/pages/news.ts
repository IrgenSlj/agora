import type { Page, PageAction, PageContext } from './types.js';
import type { NewsItem, ScoredNewsItem, NewsSource } from '../../news/types.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { readCache, writeCache, isStale } from '../../news/cache.js';
import { formatNumber } from '../../format.js';
import { hnSource } from '../../news/sources/hn.js';
import { redditSource } from '../../news/sources/reddit.js';
import { githubTrendingSource } from '../../news/sources/github-trending.js';
import { arxivSource } from '../../news/sources/arxiv.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { vlen, rail, noRail, frame, scrollbar } from './helpers.js';

const SOURCE_LABELS: Record<string, string> = {
  hn: 'HN',
  reddit: 'R ',
  'github-trending': 'GH',
  arxiv: 'XR',
  rss: 'RS',
};

const ITEM_LINES = 3; // title, url, rule

interface NewsState {
  cursor: number;
  source: NewsSource | 'all';
  topic: string;
  filter: string;
  filtering: boolean;
  items: ScoredNewsItem[];
  read: Set<string>;
  saved: Set<string>;
  loading: boolean;
}

const state: NewsState = {
  cursor: 0,
  source: 'all',
  topic: 'all',
  filter: '',
  filtering: false,
  items: [],
  read: new Set(),
  saved: new Set(),
  loading: true,
};

function detectDataDir(ctx: PageContext): string {
  const env = ctx.io.env ?? {};
  const configured = env.AGORA_HOME || process.env.AGORA_HOME;
  if (configured) return configured;
  const xdg = env.XDG_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'agora');
}

function fetchWithTimeout(fn: () => Promise<NewsItem[]>, timeoutMs = 8000): Promise<NewsItem[]> {
  return Promise.race([
    fn(),
    new Promise<NewsItem[]>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ]);
}

async function refreshNews(ctx: PageContext): Promise<void> {
  const dataDir = detectDataDir(ctx);
  const cached = readCache(dataDir);
  const now = new Date();
  const config = DEFAULT_NEWS_CONFIG;

  const adapters: [NewsSource, { fetch(opts: { signal?: AbortSignal }): Promise<NewsItem[]> }][] = [
    ['hn', hnSource],
    ['reddit', redditSource],
    ['github-trending', githubTrendingSource],
    ['arxiv', arxivSource],
  ];

  let merged = [...cached];
  for (const [source, adapter] of adapters) {
    const cfg = config.sources[source];
    if (cfg?.enabled && isStale(merged, source, cfg.ttlMinutes, now)) {
      try {
        const fresh = await fetchWithTimeout(() => adapter.fetch({}));
        merged = merged.filter(i => i.source !== source);
        merged.push(...fresh);
      } catch {
        // keep stale
      }
    }
  }

  const ranked = rankItems(merged, config, now);
  writeCache(dataDir, merged);
  state.items = ranked;
  state.loading = false;
}

function visible(): ScoredNewsItem[] {
  return state.items.filter(s =>
    (state.source === 'all' || s.source === state.source)
    && (state.topic === 'all' || s.tags.includes(state.topic))
    && (!state.filter || s.title.toLowerCase().includes(state.filter.toLowerCase())),
  );
}

export const newsPage: Page = {
  id: 'news',
  title: 'NEWS',
  navLabel: 'News',
  navIcon: 'N',
  hotkeys: [
    { key: 'j/k/Pg', label: 'nav' },
    { key: 'Enter', label: 'open' },
    { key: 's', label: 'save' },
    { key: 'p', label: 'mark read' },
    { key: '/', label: 'filter' },
    { key: 't', label: 'topic' },
    { key: 'r', label: 'refresh' },
    { key: 'A/H/R/G/X', label: 'source' },
  ],
  mount(ctx: PageContext): void {
    const dataDir = detectDataDir(ctx);
    const cached = readCache(dataDir);
    if (cached.length > 0) {
      const config = DEFAULT_NEWS_CONFIG;
      state.items = rankItems(cached, config, new Date());
      state.loading = false;
    }
    refreshNews(ctx);
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const list = visible();
    ctx.app.unread.news = state.loading ? 0 : list.length;
    state.cursor = Math.min(state.cursor, Math.max(0, list.length - 1));
    const lines: string[] = [];
    const head = ' ' + style.bold(style.accent('NEWS'));
    const pos = list.length > 0 ? style.dim(' [' + (state.cursor + 1) + '/' + list.length + ']') : '';
    const right = pos + style.dim(' src:') + style.accent(state.source)
      + style.dim('  topic:') + style.accent(state.topic)
      + style.dim('  ' + list.length + ' stories');
    const gap = Math.max(2, width - vlen(head) - vlen(right) - 2);
    lines.push(head + ' '.repeat(gap) + right);
    lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));
    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('\u258f'));
    }
    if (state.loading) {
      lines.push(' ' + style.dim('Loading news\u2026'));
      return frame(lines, width, height);
    }
    if (list.length === 0) {
      lines.push(' ' + style.dim('Empty feed. Press ')
        + style.accent('r') + style.dim(' to refresh, or adjust: ')
        + style.accent('t') + style.dim(' topic, ')
        + style.accent('A/H/R/G/X') + style.dim(' source.'));
      return frame(lines, width, height);
    }

    // Virtualized render: only build lines for visible items
    const used = lines.length;
    const maxItems = Math.max(1, Math.floor((height - used) / ITEM_LINES));
    const half = Math.floor(maxItems / 2);
    let start = Math.max(0, state.cursor - half);
    if (start + maxItems > list.length) start = Math.max(0, list.length - maxItems);
    const end = Math.min(list.length, start + maxItems);

    const sbar = scrollbar(list.length, end - start, state.cursor, style);
    for (let si = start; si < end; si++) {
      const s = list[si]!;
      const sel = si === state.cursor;
      const lead = sel ? rail(style) : noRail();
      const rank = (si + 1).toString().padStart(2);
      const src = style.accent((SOURCE_LABELS[s.source] ?? s.source.toUpperCase()).padEnd(6));
      const ageH = (Date.now() - new Date(s.publishedAt).getTime()) / 3600000;
      const age = style.dim((Math.round(ageH) + 'h').padEnd(4));
      const up = style.accent(('\u2191 ' + formatNumber(s.engagement)).padStart(7));
      const score = style.dim('s' + s.score.toFixed(2));
      const isRead = state.read.has(s.id);
      const isSaved = state.saved.has(s.id);
      const titleColor = isRead ? style.dim(s.title)
        : (sel ? style.bold(s.title) : s.title);
      lines.push(' ' + lead + style.dim(rank + '. ') + src + ' ' + age + '  '
        + up + '  ' + score + '   ' + titleColor + ' ' + sbar[si - start]!);
      lines.push('         ' + style.dim(hostFromUrl(s.url))
        + (isSaved ? style.accent('  saved') : ''));
      lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));
    }

    return frame(lines, width, height);
  },
  handleKey(event, ctx): PageAction {
    if (state.filtering) {
      if (event.key === 'esc') { state.filtering = false; state.filter = ''; return { kind: 'none' }; }
      if (event.key === 'enter') { state.filtering = false; return { kind: 'none' }; }
      if (event.key === 'backspace') { state.filter = state.filter.slice(0, -1); return { kind: 'none' }; }
      if (event.key.length === 1 && !event.ctrl) { state.filter += event.key; return { kind: 'none' }; }
      return { kind: 'none' };
    }
    const list = visible();
    switch (event.key) {
      case 'j': case 'down':
        state.cursor = Math.min(list.length - 1, state.cursor + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.cursor = Math.max(0, state.cursor - 1); return { kind: 'none' };
      case 'pageup':
        state.cursor = Math.max(0, state.cursor - 20); return { kind: 'none' };
      case 'pagedown':
        state.cursor = Math.min(list.length - 1, state.cursor + 20); return { kind: 'none' };
      case 'home':
        state.cursor = 0; return { kind: 'none' };
      case 'end':
        state.cursor = list.length - 1; return { kind: 'none' };
      case 'enter': {
        const it = list[state.cursor];
        return it ? { kind: 'open-url', url: it.url } : { kind: 'none' };
      }
      case 's': {
        const it = list[state.cursor];
        if (it) {
          if (state.saved.has(it.id)) state.saved.delete(it.id);
          else state.saved.add(it.id);
        }
        return { kind: 'none' };
      }
      case 'p': {
        const it = list[state.cursor];
        if (it) state.read.add(it.id);
        return { kind: 'none' };
      }
      case '/': state.filtering = true; return { kind: 'none' };
      case 't': {
        const order = ['all', 'mcp', 'ai', 'agents', 'coding', 'security'];
        state.topic = order[(order.indexOf(state.topic) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'r':
        state.loading = true;
        refreshNews(ctx);
        return { kind: 'status', message: 'refreshing...' };
      case 'A': state.source = 'all'; state.cursor = 0; return { kind: 'none' };
      case 'H': state.source = 'hn'; state.cursor = 0; return { kind: 'none' };
      case 'R': state.source = 'reddit'; state.cursor = 0; return { kind: 'none' };
      case 'G': state.source = 'github-trending'; state.cursor = 0; return { kind: 'none' };
      case 'X': state.source = 'arxiv'; state.cursor = 0; return { kind: 'none' };
      default: return { kind: 'none' };
    }
  },
};
