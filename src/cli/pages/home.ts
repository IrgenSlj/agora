import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Page, PageAction, PageContext } from './types.js';
import type { ScoredNewsItem } from '../../news/types.js';
import type { Thread } from '../../community/types.js';
import type { SourceOptions } from '../../live.js';
import { getTrendingItems, type MarketplaceItem } from '../../marketplace.js';
import { readCache } from '../../news/cache.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { communityThreadsSource } from '../../community/client.js';
import { vlen, sep, fmtCount, frame, pageSourceOptions } from './helpers.js';
import { formatNumber } from '../../format.js';

const SOURCE_LABELS: Record<string, string> = {
  hn: 'HN',
  reddit: 'R ',
  'github-trending': 'GH',
  arxiv: 'XR',
  rss: 'RS'
};

interface HomeState {
  cursor: number; // 0 = news, 1 = community, 2 = trending
  threads: Thread[];
  threadsLoading: boolean;
  threadsHint: string;
}
const state: HomeState = {
  cursor: 0,
  threads: [],
  threadsLoading: false,
  threadsHint: ''
};

let lastCommunityFetchAt = 0;

function detectDataDir(ctx: PageContext): string {
  const env = ctx.io.env ?? {};
  const configured = env.AGORA_HOME || process.env.AGORA_HOME;
  if (configured) return configured;
  const xdg = env.XDG_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'agora');
}

function buildSourceOptions(ctx: PageContext): SourceOptions | null {
  return pageSourceOptions(ctx, { requireAuth: true });
}

function fmtAge(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

function loadNews(ctx: PageContext, max: number): ScoredNewsItem[] {
  const cached = readCache(detectDataDir(ctx));
  if (cached.length === 0) return [];
  return rankItems(cached, DEFAULT_NEWS_CONFIG, new Date()).slice(0, max);
}

async function refreshCommunity(ctx: PageContext): Promise<void> {
  const opts = buildSourceOptions(ctx);
  if (!opts) {
    state.threads = [];
    state.threadsHint = 'Sign in with `agora auth login` to see live community activity.';
    state.threadsLoading = false;
    ctx.repaint();
    return;
  }
  if (Date.now() - lastCommunityFetchAt < 5000) return;
  lastCommunityFetchAt = Date.now();
  state.threadsLoading = true;
  try {
    const result = await communityThreadsSource(opts, 'mcp', 'active', 1);
    state.threads = result.data.threads.slice(0, 5);
    state.threadsHint = '';
  } catch {
    state.threadsHint = 'Community fetch failed; try again with `r`.';
  } finally {
    state.threadsLoading = false;
    ctx.repaint();
  }
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

interface RenderColumn {
  title: string;
  lines: string[];
}

function renderNewsColumn(items: ScoredNewsItem[], style: PageContext['style']): RenderColumn {
  if (items.length === 0) {
    return {
      title: 'News',
      lines: [style.dim('No news yet. Press `n` or run `agora news` to populate.')]
    };
  }
  const lines: string[] = [];
  for (const item of items) {
    const src = style.dim((SOURCE_LABELS[item.source] ?? item.source.toUpperCase()).padEnd(3));
    const age = style.dim(fmtAge(item.publishedAt).padStart(3));
    const up = style.accent(('↑ ' + formatNumber(item.engagement)).padStart(7));
    lines.push(src + '  ' + age + '  ' + up + '  ' + item.title);
    lines.push('         ' + style.dim(hostFromUrl(item.url)));
  }
  return { title: 'News', lines };
}

function renderCommunityColumn(
  threads: Thread[],
  hint: string,
  loading: boolean,
  style: PageContext['style']
): RenderColumn {
  if (loading) return { title: 'Community', lines: [style.dim('Loading…')] };
  if (threads.length === 0) {
    return { title: 'Community', lines: [style.dim(hint || 'No threads yet.')] };
  }
  const lines: string[] = [];
  for (const t of threads) {
    const board = style.accent('/' + t.board);
    const meta = style.dim(' · ' + fmtAge(t.createdAt) + ' · ' + t.replyCount + ' replies');
    lines.push(board + '  ' + t.title);
    lines.push('       ' + style.dim(t.author) + meta);
  }
  return { title: 'Community', lines };
}

function renderTrendingColumn(items: MarketplaceItem[], style: PageContext['style']): RenderColumn {
  if (items.length === 0) {
    return { title: 'Trending', lines: [style.dim('No trending items right now.')] };
  }
  const lines: string[] = [];
  for (const t of items) {
    const stats = style.dim(' · ' + fmtCount(t.installs ?? 0) + ' installs');
    lines.push(style.bold(t.name) + stats);
    if (t.description) lines.push('  ' + style.dim(truncate(t.description, 60)));
  }
  return { title: 'Trending', lines };
}

function focusedTitle(title: string, focused: boolean, style: PageContext['style']): string {
  return focused ? style.accent('▸ ' + title) : title;
}

function composeStacked(
  width: number,
  cols: RenderColumn[],
  focusedIdx: number,
  style: PageContext['style']
): string[] {
  const out: string[] = [];
  cols.forEach((col, i) => {
    out.push(' ' + sep(focusedTitle(col.title, i === focusedIdx, style), width - 2, style));
    for (const line of col.lines) out.push(' ' + line);
    out.push('');
  });
  return out;
}

function composeTwoColumn(
  width: number,
  left: RenderColumn,
  rightTop: RenderColumn,
  rightBottom: RenderColumn,
  focusedIdx: number,
  style: PageContext['style']
): string[] {
  const leftWidth = Math.floor((width - 3) * 0.55);
  const rightWidth = width - leftWidth - 3;
  const leftLines = [
    ' ' + sep(focusedTitle(left.title, focusedIdx === 0, style), leftWidth - 1, style),
    ...left.lines.map((l) => ' ' + l)
  ];
  const rightTopLines = [
    sep(focusedTitle(rightTop.title, focusedIdx === 1, style), rightWidth - 1, style),
    ...rightTop.lines.map((l) => ' ' + l)
  ];
  const rightBottomLines = [
    sep(focusedTitle(rightBottom.title, focusedIdx === 2, style), rightWidth - 1, style),
    ...rightBottom.lines.map((l) => ' ' + l)
  ];
  const rightLines = [...rightTopLines, '', ...rightBottomLines];
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    const pad = ' '.repeat(Math.max(0, leftWidth - vlen(l) + 1));
    out.push(l + pad + style.dim('│') + ' ' + r);
  }
  return out;
}

export const homePage: Page = {
  id: 'home',
  title: 'HOME',
  navLabel: 'Home',
  navIcon: 'H',
  hotkeys: [
    { key: 'n', label: 'news' },
    { key: 'c', label: 'community' },
    { key: 'm', label: 'market' },
    { key: 'r', label: 'refresh' },
    { key: 'Enter', label: 'open' }
  ],
  mount(ctx: PageContext): void {
    refreshCommunity(ctx);
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const news = loadNews(ctx, 5);
    const trending = getTrendingItems().slice(0, 5);

    const newsCol = renderNewsColumn(news, style);
    const commCol = renderCommunityColumn(state.threads, state.threadsHint, state.threadsLoading, style);
    const trendCol = renderTrendingColumn(trending, style);

    const headerRight = style.dim('press ') + style.accent('n c m') + style.dim(' for sections');
    const headerLeft = ' ' + style.bold(style.accent('HOME'));
    const gap = Math.max(2, width - vlen(headerLeft) - vlen(headerRight) - 2);
    const lines: string[] = [];
    lines.push(headerLeft + ' '.repeat(gap) + headerRight);
    lines.push('');

    const body =
      width >= 100
        ? composeTwoColumn(width, newsCol, commCol, trendCol, state.cursor, style)
        : composeStacked(width, [newsCol, commCol, trendCol], state.cursor, style);
    lines.push(...body);

    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    switch (event.key) {
      case 'n':
        return { kind: 'switch', to: 'news' };
      case 'c':
        return { kind: 'switch', to: 'community' };
      case 'm':
      case '/':
        return { kind: 'switch', to: 'marketplace' };
      case 'r':
        lastCommunityFetchAt = 0;
        refreshCommunity(_ctx);
        return { kind: 'status', message: 'refreshing' };
      case 'enter': {
        if (state.cursor === 0) return { kind: 'switch', to: 'news' };
        if (state.cursor === 1) return { kind: 'switch', to: 'community' };
        return { kind: 'switch', to: 'marketplace' };
      }
      case 'j':
      case 'down':
        state.cursor = Math.min(2, state.cursor + 1);
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.cursor = Math.max(0, state.cursor - 1);
        return { kind: 'none' };
      default:
        return { kind: 'none' };
    }
  }
};

