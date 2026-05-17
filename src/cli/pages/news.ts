import type { Page, PageAction, PageContext } from './types.js';
import type { NewsItem, ScoredNewsItem, NewsSource } from '../../news/types.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { readCache, writeCache, isStale, readNewsMeta, writeNewsMeta } from '../../news/cache.js';
import { formatNumber } from '../../format.js';
import { hnSource } from '../../news/sources/hn.js';
import { redditSource } from '../../news/sources/reddit.js';
import { githubTrendingSource } from '../../news/sources/github-trending.js';
import { arxivSource } from '../../news/sources/arxiv.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { vlen, rail, noRail, frame, scrollbar, sep } from './helpers.js';
import { FREE_MODELS } from '../commands/chat.js';

const SOURCE_LABELS: Record<string, string> = {
  hn: 'HN',
  reddit: 'R ',
  'github-trending': 'GH',
  arxiv: 'XR',
  rss: 'RS'
};

const SOURCE_CYCLE: Array<NewsSource | 'all'> = [
  'all',
  'hn',
  'reddit',
  'github-trending',
  'arxiv',
  'rss'
];

const ITEM_LINES = 3;

const TABS = [
  { id: 'all', label: 'All', match: (_tags: string[]) => true },
  { id: 'mcp', label: 'Mcp', match: (tags: string[]) => tags.some((t) => t.includes('mcp')) },
  { id: 'tools', label: 'Tools', match: (tags: string[]) => tags.some((t) => t.includes('tool')) },
  {
    id: 'skills',
    label: 'Skills',
    match: (tags: string[]) => tags.some((t) => t.includes('skill'))
  },
  { id: 'llms', label: 'Llms', match: (tags: string[]) => tags.some((t) => t.includes('llm')) },
  {
    id: 'repos',
    label: 'Repos',
    match: (tags: string[]) => tags.some((t) => t.includes('repo') || t.includes('github'))
  },
  {
    id: 'market',
    label: 'Market',
    match: (tags: string[]) => tags.some((t) => t.includes('market'))
  },
  {
    id: 'search',
    label: 'Search',
    match: (tags: string[]) => tags.some((t) => t.includes('search'))
  }
];

type View = 'list' | 'detail' | 'preview';

interface NewsState {
  cursor: number;
  tab: number;
  source: NewsSource | 'all';
  filter: string;
  filtering: boolean;
  savedOnly: boolean;
  unreadOnly: boolean;
  items: ScoredNewsItem[];
  read: Set<string>;
  saved: Set<string>;
  loading: boolean;
  view: View;
  previewItem: ScoredNewsItem | null;
  previewContent: string | null;
  previewLines: string[];
  previewScroll: number;
  previewLoading: boolean;
  previewPhase: string;
  dataDir: string | null;
}

const state: NewsState = {
  cursor: 0,
  tab: 0,
  source: 'all',
  filter: '',
  filtering: false,
  savedOnly: false,
  unreadOnly: false,
  items: [],
  read: new Set(),
  saved: new Set(),
  loading: true,
  view: 'list',
  previewItem: null,
  previewContent: null,
  previewLines: [],
  previewScroll: 0,
  previewLoading: false,
  previewPhase: '',
  dataDir: null
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
    )
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
    ['arxiv', arxivSource]
  ];

  let merged = [...cached];
  for (const [source, adapter] of adapters) {
    const cfg = config.sources[source];
    if (cfg?.enabled && isStale(merged, source, cfg.ttlMinutes, now)) {
      try {
        const fresh = await fetchWithTimeout(() => adapter.fetch({}));
        merged = merged.filter((i) => i.source !== source);
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

function htmlToText(html: string): string {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(
    /<(p|div|br|h[1-6]|li|tr|blockquote|section|article|header|footer)[^>]*>/gi,
    '\n'
  );
  text = text.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text
    .split('\n')
    .map((l) => l.trim())
    .join('\n');
  return text.trim();
}

function fmtAge(date: Date): string {
  const h = (Date.now() - date.getTime()) / 3600000;
  if (h < 1) return Math.round(h * 60) + 'm ago';
  if (h < 24) return Math.round(h) + 'h ago';
  return Math.round(h / 24) + 'd ago';
}

function wordWrap(text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      if (result.length > 0 && result[result.length - 1] !== '') result.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const test = line ? line + ' ' + word : word;
      if (test.length > maxWidth) {
        if (line) {
          result.push(line);
          line = word;
        } else {
          result.push(word.slice(0, maxWidth));
          line = word.slice(maxWidth);
        }
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
  }
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result;
}

function trySummarize(text: string): Promise<string | null> {
  const model = FREE_MODELS[0];
  const modelArg = model.includes('/') ? model : `opencode/${model}`;
  const maxChars = 12000;
  const trimmed = text.length > maxChars ? text.slice(0, maxChars) + '\n...(truncated)' : text;
  const prompt = `<system>\nYou are a news summarizer. Summarize the following article concisely in 2-4 paragraphs. Focus on key facts and conclusions. Be objective.\n<user>\n${trimmed}`;

  return new Promise((resolve) => {
    const child = spawn('opencode', ['run', '--format', 'json', '--model', modelArg, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let response = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 30000);

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'text' && ev.part?.text) response += ev.part.text;
        } catch {
          /* skip */
        }
      }
    });

    child.on('close', () => {
      clearTimeout(timer);
      resolve(response || null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function fetchArticlePreview(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Agora/0.4.0 (+https://agora.opencode.ai)' }
    });
    if (!resp.ok) return `(error: HTTP ${resp.status})`;
    const html = await resp.text();
    const text = htmlToText(html);
    const lines = text.split('\n').filter((l) => l.length > 0);
    return lines.length > 5 ? text : '(could not extract article content from this page)';
  } catch (e) {
    return '(failed to fetch: ' + (e instanceof Error ? e.message : String(e)) + ')';
  }
}

async function startPreview(item: ScoredNewsItem, ctx: PageContext): Promise<void> {
  state.view = 'preview';
  state.previewScroll = 0;
  state.previewItem = item;
  state.previewContent = item.url;
  state.previewLines = [];
  state.previewLoading = true;
  state.previewPhase = 'Fetching article…';
  ctx.repaint();
  await sleep(100);

  const rawText = await fetchArticlePreview(item.url);
  if (
    rawText.startsWith('(failed') ||
    rawText.startsWith('(error') ||
    rawText.startsWith('(could not')
  ) {
    state.previewLines = wordWrap(rawText, ctx.width - 4);
    state.previewLoading = false;
    ctx.repaint();
    return;
  }

  state.previewPhase = 'Summarizing…';
  ctx.repaint();
  await sleep(100);

  const summary = await trySummarize(rawText);
  state.previewLines = wordWrap(summary ?? rawText, ctx.width - 4);
  state.previewLoading = false;
  ctx.repaint();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function persistMeta(): void {
  if (!state.dataDir) return;
  writeNewsMeta(state.dataDir, {
    read: [...state.read],
    saved: [...state.saved]
  });
}

export function visible(st: NewsState = state): ScoredNewsItem[] {
  const tab = TABS[st.tab]!;
  return st.items.filter(
    (s) =>
      (st.source === 'all' || s.source === st.source) &&
      tab.match(s.tags) &&
      (!st.filter || s.title.toLowerCase().includes(st.filter.toLowerCase())) &&
      (!st.savedOnly || st.saved.has(s.id)) &&
      (!st.unreadOnly || !st.read.has(s.id))
  );
}

export const newsPage: Page = {
  id: 'news',
  title: 'NEWS',
  navLabel: 'News',
  navIcon: 'N',
  handlesTab: true,
  hotkeys: [
    { key: 'j/k/Pg', label: 'nav' },
    { key: 'g/G', label: 'jump' },
    { key: 'Enter', label: 'detail' },
    { key: 's', label: 'save' },
    { key: 'b', label: 'saved' },
    { key: 'u', label: 'unread' },
    { key: 'S', label: 'source' },
    { key: 'p', label: 'preview' },
    { key: '/', label: 'filter' },
    { key: 'Tab', label: 'category' },
    { key: 'r', label: 'refresh' },
    { key: 'o', label: 'open' }
  ],
  mount(ctx: PageContext): void {
    const dataDir = detectDataDir(ctx);
    state.dataDir = dataDir;
    const cached = readCache(dataDir);
    if (cached.length > 0) {
      const config = DEFAULT_NEWS_CONFIG;
      state.items = rankItems(cached, config, new Date());
      state.loading = false;
    }
    const meta = readNewsMeta(dataDir);
    state.read = new Set(meta.read);
    state.saved = new Set(meta.saved);
    refreshNews(ctx);
  },
  unmount(): void {
    persistMeta();
    state.view = 'list';
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;

    if (state.view === 'preview') {
      const lines: string[] = [];
      const item = state.previewItem;

      if (state.previewLoading) {
        const dots = state.previewPhase === 'Summarizing…' ? '◔' : '◙';
        lines.push(' ' + dots + '  ' + style.dim(state.previewPhase || 'Loading…'));
        return frame(lines, width, height);
      }
      if (!item) {
        lines.push(' ' + style.dim('No article selected.'));
        return frame(lines, width, height);
      }

      const headerLines = [
        ' ' + style.bold(item.title),
        ' ' +
          style.dim(SOURCE_LABELS[item.source] ?? item.source.toUpperCase()) +
          style.dim('  ·  ' + fmtAge(new Date(item.publishedAt))) +
          style.dim('  ·  ↑ ' + formatNumber(item.engagement)) +
          style.dim('  ·  s' + item.score.toFixed(2)),
        ' ' + sep('', width - 2, style)
      ];
      lines.push(...headerLines);

      const footerLines = [
        ' ' +
          style.accent('o') +
          style.dim(' open in browser  ') +
          style.accent('Esc') +
          style.dim(' back  ') +
          style.accent('j/k') +
          style.dim(' nav')
      ];

      const hdr = headerLines.length;
      const ftr = footerLines.length;
      const max = height - hdr - ftr;

      if (state.previewLines.length === 0) {
        lines.push(' ' + style.dim('No content available.'));
      } else {
        const total = state.previewLines.length;
        if (state.previewScroll > total - max) state.previewScroll = Math.max(0, total - max);
        const end = Math.min(total, state.previewScroll + max);
        const sbar = scrollbar(total, max, state.previewScroll, style);
        for (let i = state.previewScroll; i < end; i++) {
          lines.push(' ' + state.previewLines[i]! + ' ' + (sbar[i - state.previewScroll] ?? ''));
        }
        const pad = hdr + max - lines.length;
        for (let i = 0; i < pad; i++) lines.push('');
      }

      lines.push(...footerLines);
      return frame(lines, width, height);
    }

    if (state.view === 'detail') {
      const s = visible()[state.cursor];
      if (!s) {
        state.view = 'list';
      } else {
        const lines: string[] = [];
        const ageH = (Date.now() - new Date(s.publishedAt).getTime()) / 3600000;
        const age = Math.round(ageH) + 'h ago';
        lines.push(' ' + style.bold(s.title));
        lines.push(
          ' ' +
            style.dim(SOURCE_LABELS[s.source] ?? s.source.toUpperCase()) +
            style.dim('  ·  ' + age) +
            style.dim('  ·  ↑ ' + formatNumber(s.engagement)) +
            style.dim('  ·  s' + s.score.toFixed(2))
        );
        lines.push(' ' + style.accent(s.url));
        if (s.tags && s.tags.length > 0) {
          lines.push(' ' + style.dim('Tags: ') + s.tags.map((t) => style.accent(t)).join(', '));
        }
        if (s.summary) {
          lines.push(' ' + sep('summary', width - 2, style));
          lines.push(' ' + s.summary);
        }
        lines.push(' ' + sep('', width - 2, style));
        lines.push(' ' + style.accent('o') + style.dim(' open in browser  '));
        lines.push(' ' + style.accent('p') + style.dim(' preview article  '));
        lines.push(' ' + style.accent('Esc') + style.dim(' back'));
        return frame(lines, width, height);
      }
    }

    const list = visible();
    ctx.app.unread.news = state.loading ? 0 : list.length;
    state.cursor = Math.min(state.cursor, Math.max(0, list.length - 1));
    const lines: string[] = [];

    const srcLabel =
      state.source === 'all' ? 'all' : (SOURCE_LABELS[state.source] ?? state.source);
    const head = ' ' + style.bold(style.accent('NEWS'));
    const pos =
      list.length > 0 ? style.dim(' [' + (state.cursor + 1) + '/' + list.length + ']') : '';
    const filterBadge =
      (state.savedOnly ? style.accent(' saved-only') : '') +
      (state.unreadOnly ? style.accent(' unread-only') : '');
    const right =
      pos +
      style.dim('  ' + list.length + ' stories · src: ') +
      style.accent(srcLabel) +
      filterBadge;
    const gap = Math.max(2, width - vlen(head) - vlen(right) - 2);
    lines.push(head + ' '.repeat(gap) + right);

    const tabLine =
      ' ' +
      TABS.map((t, i) => (i === state.tab ? style.accent(t.label) : style.dim(t.label))).join(
        style.dim('  ') + '·' + style.dim('  ')
      );
    lines.push(tabLine);
    lines.push(' ' + style.dim('─'.repeat(Math.max(0, width - 2))));
    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.filter + style.dim('▏'));
    }
    if (state.loading) {
      lines.push(' ' + style.dim('Loading news…'));
      return frame(lines, width, height);
    }
    if (list.length === 0) {
      lines.push(
        ' ' + style.dim('Empty feed. Press ') + style.accent('r') + style.dim(' to refresh.')
      );
      return frame(lines, width, height);
    }

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
      const up = style.accent(('↑ ' + formatNumber(s.engagement)).padStart(7));
      const score = style.dim('s' + s.score.toFixed(2));
      const isRead = state.read.has(s.id);
      const isSaved = state.saved.has(s.id);
      const titleColor = isRead ? style.dim(s.title) : sel ? style.bold(s.title) : s.title;
      lines.push(
        ' ' +
          lead +
          style.dim(rank + '. ') +
          src +
          ' ' +
          age +
          '  ' +
          up +
          '  ' +
          score +
          '   ' +
          titleColor +
          ' ' +
          sbar[si - start]!
      );
      lines.push(
        '         ' + style.dim(hostFromUrl(s.url)) + (isSaved ? style.accent('  saved') : '')
      );
      lines.push(' ' + style.dim('─'.repeat(Math.max(0, width - 2))));
    }

    return frame(lines, width, height);
  },
  handleKey(event, ctx): PageAction {
    if (state.view === 'preview') {
      if (event.key === 'esc') {
        state.view = 'detail';
        return { kind: 'none' };
      }
      if (event.key === 'o') {
        const pi = state.previewItem;
        return pi ? { kind: 'open-url', url: pi.url } : { kind: 'none' };
      }
      if (event.key === 'j' || event.key === 'down') {
        state.previewScroll = Math.min(state.previewLines.length - 1, state.previewScroll + 1);
        return { kind: 'none' };
      }
      if (event.key === 'k' || event.key === 'up') {
        state.previewScroll = Math.max(0, state.previewScroll - 1);
        return { kind: 'none' };
      }
      if (event.key === 'pageup') {
        state.previewScroll = Math.max(0, state.previewScroll - 20);
        return { kind: 'none' };
      }
      if (event.key === 'pagedown') {
        state.previewScroll = Math.min(state.previewLines.length - 1, state.previewScroll + 20);
        return { kind: 'none' };
      }
      if (event.key === 'home') {
        state.previewScroll = 0;
        return { kind: 'none' };
      }
      if (event.key === 'end') {
        state.previewScroll = state.previewLines.length - 1;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    if (state.view === 'detail') {
      if (event.key === 'esc') {
        state.view = 'list';
        return { kind: 'none' };
      }
      if (event.key === 'o') {
        const s = visible()[state.cursor];
        return s ? { kind: 'open-url', url: s.url } : { kind: 'none' };
      }
      if (event.key === 'p') {
        const s = visible()[state.cursor];
        if (s && state.previewContent !== s.url) startPreview(s, ctx);
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    if (state.filtering) {
      if (event.key === 'esc') {
        state.filtering = false;
        state.filter = '';
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        state.filtering = false;
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        state.filter = state.filter.slice(0, -1);
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl) {
        state.filter += event.key;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    const list = visible();
    switch (event.key) {
      case 'tab':
        state.tab = (state.tab + 1) % TABS.length;
        state.cursor = 0;
        return { kind: 'none' };
      case 'left':
        state.tab = state.tab > 0 ? state.tab - 1 : TABS.length - 1;
        state.cursor = 0;
        return { kind: 'none' };
      case 'right':
        state.tab = (state.tab + 1) % TABS.length;
        state.cursor = 0;
        return { kind: 'none' };
      case 'j':
      case 'down':
        state.cursor = Math.min(list.length - 1, state.cursor + 1);
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.cursor = Math.max(0, state.cursor - 1);
        return { kind: 'none' };
      case 'g':
        state.cursor = 0;
        return { kind: 'none' };
      case 'G':
        state.cursor = Math.max(0, list.length - 1);
        return { kind: 'none' };
      case 'pageup':
        state.cursor = Math.max(0, state.cursor - 20);
        return { kind: 'none' };
      case 'pagedown':
        state.cursor = Math.min(list.length - 1, state.cursor + 20);
        return { kind: 'none' };
      case 'home':
        state.cursor = 0;
        return { kind: 'none' };
      case 'end':
        state.cursor = list.length - 1;
        return { kind: 'none' };
      case 'enter':
        if (list.length > 0) {
          state.view = 'detail';
        }
        return { kind: 'none' };
      case 's': {
        const it = list[state.cursor];
        if (it) {
          if (state.saved.has(it.id)) state.saved.delete(it.id);
          else state.saved.add(it.id);
          persistMeta();
        }
        return { kind: 'none' };
      }
      case 'S': {
        const idx = SOURCE_CYCLE.indexOf(state.source);
        state.source = SOURCE_CYCLE[(idx + 1) % SOURCE_CYCLE.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'b':
        state.savedOnly = !state.savedOnly;
        state.cursor = 0;
        return { kind: 'none' };
      case 'u':
        state.unreadOnly = !state.unreadOnly;
        state.cursor = 0;
        return { kind: 'none' };
      case 'm': {
        const it = list[state.cursor];
        if (it) {
          state.read.add(it.id);
          persistMeta();
        }
        return { kind: 'none' };
      }
      case '/':
        state.filtering = true;
        return { kind: 'none' };
      case 'p': {
        const pi = list[state.cursor];
        if (pi && state.previewContent !== pi.url) startPreview(pi, ctx);
        return { kind: 'none' };
      }
      case 'o': {
        const it = list[state.cursor];
        return it ? { kind: 'open-url', url: it.url } : { kind: 'none' };
      }
      case 'r':
        state.loading = true;
        refreshNews(ctx);
        return { kind: 'status', message: 'refreshing...' };
      default:
        return { kind: 'none' };
    }
  }
};
