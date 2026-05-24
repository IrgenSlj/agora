import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Page, PageAction, PageContext } from './types.js';
import type { ScoredNewsItem } from '../../news/types.js';
import type { Thread } from '../../community/types.js';
import type { SourceOptions } from '../../live.js';
import { getHotItems, getTrendingItems, type MarketplaceItem } from '../../marketplace.js';
import { readCache } from '../../news/cache.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { communityThreadsSource } from '../../community/client.js';
import { vlen, sep, fmtCount, frame, pageSourceOptions, truncate } from './helpers.js';
import { formatNumber } from '../../format.js';
import { buildHomeFeed, getHotRepos, computeSinceLastSeen } from '../../home/feed.js';
import type { StackSummary, Opportunity, HotRepo, SinceDelta } from '../../home/feed.js';
import type { StackEnv } from '../../stack/types.js';
import { loadAgoraState, writeAgoraState } from '../../state.js';

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
  summary: StackSummary | null;
  opportunities: Opportunity[];
  feedLoading: boolean;
  trendLens: 'hot' | 'top' | 'repos';
  since: SinceDelta | null;
}
const state: HomeState = {
  cursor: 0,
  threads: [],
  threadsLoading: false,
  threadsHint: '',
  summary: null,
  opportunities: [],
  feedLoading: false,
  trendLens: 'hot',
  since: null
};

let lastCommunityFetchAt = 0;

function detectDataDir(ctx: PageContext): string {
  const env = ctx.io.env ?? {};
  const configured = env.AGORA_HOME || process.env.AGORA_HOME;
  if (configured) return configured;
  const xdg = env.XDG_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'agora');
}

function buildStackEnv(ctx: PageContext): StackEnv {
  return {
    cwd: ctx.io.cwd,
    home: ctx.io.env?.HOME,
    env: ctx.io.env
  };
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

const DAY_MS = 86400 * 1000;

function loadNews(ctx: PageContext, max: number): { items: ScoredNewsItem[]; isFallback: boolean } {
  const dataDir = detectDataDir(ctx);
  const cached = readCache(dataDir);
  if (cached.length === 0) return { items: [], isFallback: false };
  const cutoff = Date.now() - DAY_MS;
  const recent = cached.filter((item) => new Date(item.publishedAt).getTime() > cutoff);
  if (recent.length > 0) {
    return {
      items: rankItems(recent, DEFAULT_NEWS_CONFIG, new Date()).slice(0, max),
      isFallback: false
    };
  }
  return {
    items: rankItems(cached, DEFAULT_NEWS_CONFIG, new Date()).slice(0, max),
    isFallback: true
  };
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

async function refreshFeed(ctx: PageContext): Promise<void> {
  state.feedLoading = true;
  try {
    const stackEnv = buildStackEnv(ctx);
    const dataDir = detectDataDir(ctx);
    const { summary, opportunities } = await buildHomeFeed(stackEnv, dataDir);
    state.summary = summary;
    state.opportunities = opportunities;

    // Compute since-last-seen delta and update marker — best-effort, never crashes page
    try {
      const st = loadAgoraState(dataDir);
      const news = readCache(dataDir);
      state.since = computeSinceLastSeen(st.home, { news, serverCount: summary?.serverCount ?? 0 });
      writeAgoraState(dataDir, {
        ...st,
        home: {
          lastSeenAt: new Date().toISOString(),
          serverCount: summary?.serverCount ?? 0
        }
      });
      ctx.repaint();
    } catch {
      // best-effort — ignore any I/O errors
    }
  } catch {
    state.summary = null;
    state.opportunities = [];
  } finally {
    state.feedLoading = false;
    ctx.repaint();
  }
}

// Exported for tests (kept for backward compat — helpers.ts also exports truncate)
export function truncateLocal(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

// Legacy export used in home.test.ts
export { truncateLocal as truncate };

interface RenderColumn {
  title: string;
  lines: string[];
}

function renderNewsColumn(
  items: ScoredNewsItem[],
  isFallback: boolean,
  style: PageContext['style']
): RenderColumn {
  if (items.length === 0) {
    return {
      title: 'News',
      lines: [style.dim('No news cached yet — run `agora news --refresh`')]
    };
  }
  const title = isFallback ? 'News' + style.dim(' · recent') : 'News';
  const lines: string[] = [];
  for (const item of items) {
    const src = style.dim((SOURCE_LABELS[item.source] ?? item.source.toUpperCase()).padEnd(3));
    const age = style.dim(fmtAge(item.publishedAt).padStart(3));
    const up = style.accent(('↑ ' + formatNumber(item.engagement)).padStart(7));
    lines.push(src + '  ' + age + '  ' + up + '  ' + item.title);
    lines.push('         ' + style.dim(hostFromUrl(item.url)));
  }
  return { title, lines };
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

function renderTrendingColumn(
  items: MarketplaceItem[],
  lens: 'hot' | 'top',
  style: PageContext['style']
): RenderColumn {
  const lensLabel = lens === 'hot' ? 'Hot' : 'Top';
  const title = 'Trending · ' + style.dim(lensLabel);
  if (items.length === 0) {
    return { title, lines: [style.dim('No trending items right now.')] };
  }
  const lines: string[] = [];
  for (const t of items) {
    const stats = style.dim(' · ' + fmtCount(t.installs ?? 0) + ' installs');
    lines.push(style.bold(t.name) + stats);
    if (t.description) lines.push('  ' + style.dim(truncate(t.description, 60)));
  }
  return { title, lines };
}

function renderReposColumn(repos: HotRepo[], style: PageContext['style']): RenderColumn {
  const title = 'Trending · ' + style.dim('Repos');
  if (repos.length === 0) {
    return {
      title,
      lines: [style.dim('No trending repos cached — run `agora news --refresh`')]
    };
  }
  const lines: string[] = [];
  for (const repo of repos) {
    const velocity = style.dim(style.accent(' ▲' + fmtCount(repo.hot)));
    lines.push(style.bold(repo.name) + velocity);
    const tagStr = repo.tags.slice(0, 2).join(' ');
    const second = repo.host + (tagStr ? '  ' + tagStr : '');
    lines.push('  ' + style.dim(second));
  }
  return { title, lines };
}

function renderStackBand(width: number, style: PageContext['style']): string[] {
  const lines: string[] = [];
  lines.push(' ' + sep('Your stack', width - 2, style));

  // Since-last-visit delta line
  const { since } = state;
  if (since !== null && (since.newItems > 0 || since.serverDelta !== 0)) {
    let deltaText = 'Since last visit: ';
    if (since.newItems > 0) {
      deltaText += style.accent(since.newItems + ' new');
    }
    if (since.serverDelta !== 0) {
      const sign = since.serverDelta > 0 ? '+' : '';
      const abs = Math.abs(since.serverDelta);
      const label = sign + since.serverDelta + ' server' + (abs === 1 ? '' : 's');
      if (since.newItems > 0) deltaText += ' · ';
      deltaText += style.accent(label);
    }
    lines.push(' ' + style.dim(truncate(deltaText, width - 2)));
  }

  // Summary line
  const { summary, feedLoading } = state;
  if (feedLoading && !summary) {
    lines.push(' ' + style.dim('Loading…'));
  } else if (!summary || summary.serverCount === 0) {
    lines.push(' ' + style.dim('No MCP servers configured yet'));
  } else {
    const { serverCount, toolCount, capabilityCount, health } = summary;
    const ok = style.accent('✓') + style.dim(String(health.ok));
    const warn = style.orange('⚠') + style.dim(String(health.warn));
    const err = style.bold('✗') + style.dim(String(health.error));
    const summaryLine =
      style.dim(String(serverCount)) +
      style.dim(' servers · ') +
      style.dim(String(toolCount)) +
      style.dim(' tools · ') +
      style.dim(String(capabilityCount)) +
      style.dim(' capabilities · ') +
      ok +
      ' ' +
      warn +
      ' ' +
      err;
    lines.push(' ' + truncate(summaryLine, width - 2));
  }

  // Opportunities (up to 3)
  const opps = state.opportunities.slice(0, 3);
  for (const opp of opps) {
    const bullet = style.accent('•') + ' ' + opp.title;
    const suffix = opp.command ? style.dim(' → ' + opp.command) : '';
    const line = truncate(bullet + suffix, width - 2);
    lines.push(' ' + line);
  }

  return lines;
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
    { key: 't', label: 'hot/top/repos' },
    { key: 'r', label: 'refresh' },
    { key: 'Enter', label: 'open' }
  ],
  mount(ctx: PageContext): void {
    refreshCommunity(ctx);
    refreshFeed(ctx);
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const { items: news, isFallback: newsFallback } = loadNews(ctx, 5);

    const newsCol = renderNewsColumn(news, newsFallback, style);
    const commCol = renderCommunityColumn(
      state.threads,
      state.threadsHint,
      state.threadsLoading,
      style
    );

    let trendCol: RenderColumn;
    if (state.trendLens === 'repos') {
      const repos = getHotRepos(detectDataDir(ctx), { limit: 5 });
      trendCol = renderReposColumn(repos, style);
    } else {
      const trendItems =
        state.trendLens === 'hot' ? getHotItems({ limit: 5 }) : getTrendingItems({ limit: 5 });
      trendCol = renderTrendingColumn(trendItems, state.trendLens, style);
    }

    const headerRight = style.dim('press ') + style.accent('n c m') + style.dim(' for sections');
    const headerLeft = ' ' + style.bold(style.accent('HOME'));
    const gap = Math.max(2, width - vlen(headerLeft) - vlen(headerRight) - 2);
    const lines: string[] = [];
    lines.push(headerLeft + ' '.repeat(gap) + headerRight);
    lines.push('');

    // Top band: Your stack + opportunities
    const band = renderStackBand(width, style);
    lines.push(...band);
    lines.push('');

    // Bottom columns
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
      case 't': {
        const cycle: Record<'hot' | 'top' | 'repos', 'hot' | 'top' | 'repos'> = {
          hot: 'top',
          top: 'repos',
          repos: 'hot'
        };
        state.trendLens = cycle[state.trendLens];
        _ctx.repaint();
        return { kind: 'status', message: 'trending: ' + state.trendLens };
      }
      case 'r':
        lastCommunityFetchAt = 0;
        refreshCommunity(_ctx);
        refreshFeed(_ctx);
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
