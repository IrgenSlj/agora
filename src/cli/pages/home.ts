import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Page, PageAction, PageContext } from './types.js';
import type { ScoredNewsItem } from '../../news/types.js';
import { getHotItems, getTrendingItems, type MarketplaceItem } from '../../marketplace.js';
import { readCache } from '../../news/cache.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { vlen, fmtCount, frame, truncate } from './helpers.js';
import { formatNumber } from '../../format.js';
import { buildHomeFeed, getHotRepos, computeSinceLastSeen } from '../../home/feed.js';
import type { StackSummary, Opportunity, HotRepo, SinceDelta } from '../../home/feed.js';
import type { StackEnv } from '../../stack/types.js';
import { loadAgoraState, writeAgoraState } from '../../state.js';
import { liftStyler } from '../theme.js';
import { rule, status, pageHeader, bp } from './components.js';

const SOURCE_LABELS: Record<string, string> = {
  hn: 'HN',
  'github-trending': 'GH',
  arxiv: 'XR',
  rss: 'RS'
};

interface HomeState {
  cursor: number; // 0 = news, 1 = trending
  summary: StackSummary | null;
  opportunities: Opportunity[];
  feedLoading: boolean;
  trendLens: 'hot' | 'top' | 'repos';
  since: SinceDelta | null;
}
const state: HomeState = {
  cursor: 0,
  summary: null,
  opportunities: [],
  feedLoading: false,
  trendLens: 'hot',
  since: null
};

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
  ctx: PageContext
): RenderColumn {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  if (items.length === 0) {
    return {
      title: 'News',
      lines: [theme.dim('No news cached yet — run `agora news --refresh`')]
    };
  }
  const title = isFallback ? 'News' + theme.dim(' · recent') : 'News';
  const lines: string[] = [];
  for (const item of items) {
    const src = theme.muted((SOURCE_LABELS[item.source] ?? item.source.toUpperCase()).padEnd(3));
    const age = theme.dim(fmtAge(item.publishedAt).padStart(3));
    const up = theme.accent(('↑ ' + formatNumber(item.engagement)).padStart(7));
    lines.push(src + '  ' + age + '  ' + up + '  ' + item.title);
    lines.push('         ' + theme.muted(hostFromUrl(item.url)));
  }
  return { title, lines };
}

function renderTrendingColumn(
  items: MarketplaceItem[],
  lens: 'hot' | 'top',
  ctx: PageContext
): RenderColumn {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  const lensLabel = lens === 'hot' ? 'Hot' : 'Top';
  const title = 'Trending · ' + theme.dim(lensLabel);
  if (items.length === 0) {
    return { title, lines: [theme.dim('No trending items right now.')] };
  }
  const lines: string[] = [];
  for (const t of items) {
    const stats = theme.dim(' · ' + fmtCount(t.installs ?? 0) + ' installs');
    lines.push(theme.bold(t.name) + stats);
    if (t.description) lines.push('  ' + theme.muted(truncate(t.description, 60)));
  }
  return { title, lines };
}

function renderReposColumn(repos: HotRepo[], ctx: PageContext): RenderColumn {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  const title = 'Trending · ' + theme.dim('Repos');
  if (repos.length === 0) {
    return {
      title,
      lines: [theme.dim('No trending repos cached — run `agora news --refresh`')]
    };
  }
  const lines: string[] = [];
  for (const repo of repos) {
    const velocity = theme.accent(' ▲' + fmtCount(repo.hot));
    lines.push(theme.bold(repo.name) + velocity);
    const tagStr = repo.tags.slice(0, 2).join(' ');
    const second = repo.host + (tagStr ? '  ' + tagStr : '');
    lines.push('  ' + theme.muted(second));
  }
  return { title, lines };
}

function renderStackBand(width: number, ctx: PageContext): string[] {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  const lines: string[] = [];
  lines.push(' ' + rule(width - 2, 'Your stack', theme));

  // Since-last-visit delta line
  const { since } = state;
  if (since !== null && (since.newItems > 0 || since.serverDelta !== 0)) {
    let deltaText = 'Since last visit: ';
    if (since.newItems > 0) {
      deltaText += theme.accent(since.newItems + ' new');
    }
    if (since.serverDelta !== 0) {
      const sign = since.serverDelta > 0 ? '+' : '';
      const abs = Math.abs(since.serverDelta);
      const label = sign + since.serverDelta + ' server' + (abs === 1 ? '' : 's');
      if (since.newItems > 0) deltaText += ' · ';
      deltaText += theme.accent(label);
    }
    lines.push(' ' + theme.dim(truncate(deltaText, width - 2)));
  }

  // Summary line
  const { summary, feedLoading } = state;
  if (feedLoading && !summary) {
    lines.push(' ' + theme.dim('Loading…'));
  } else if (!summary || summary.serverCount === 0) {
    lines.push(' ' + theme.dim('No MCP servers configured yet'));
  } else {
    const { serverCount, toolCount, capabilityCount, health } = summary;
    const ok = status('success', String(health.ok), theme);
    const warn = status('warning', String(health.warn), theme);
    const err = status('error', String(health.error), theme);
    const counts =
      theme.dim(String(serverCount)) +
      theme.dim(' servers · ') +
      theme.dim(String(toolCount)) +
      theme.dim(' tools · ') +
      theme.dim(String(capabilityCount)) +
      theme.dim(' capabilities');
    const summaryLine = counts + '   ' + ok + '  ' + warn + '  ' + err;
    lines.push(' ' + truncate(summaryLine, width - 2));
  }

  // Opportunities (up to 3)
  const opps = state.opportunities.slice(0, 3);
  for (const opp of opps) {
    const bulletTone =
      opp.kind === 'health'
        ? theme.warning(theme.glyph('bullet'))
        : opp.kind === 'gap'
          ? theme.accent(theme.glyph('bullet'))
          : theme.dim(theme.glyph('bullet'));
    const title = ' ' + opp.title;
    const suffix = opp.command ? theme.dim(' → ' + opp.command) : '';
    const line = truncate(bulletTone + title + suffix, width - 2);
    lines.push(' ' + line);
  }

  return lines;
}

function focusedTitle(title: string, focused: boolean, ctx: PageContext): string {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  return focused ? theme.accent('▸ ' + title) : title;
}

function composeStacked(
  width: number,
  cols: RenderColumn[],
  focusedIdx: number,
  ctx: PageContext
): string[] {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  const out: string[] = [];
  cols.forEach((col, i) => {
    out.push(' ' + rule(width - 2, focusedTitle(col.title, i === focusedIdx, ctx), theme));
    for (const line of col.lines) out.push(' ' + line);
    out.push('');
  });
  return out;
}

function composeTwoColumn(
  width: number,
  left: RenderColumn,
  right: RenderColumn,
  focusedIdx: number,
  ctx: PageContext
): string[] {
  const theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
  const leftWidth = Math.floor((width - 3) * 0.55);
  const rightWidth = width - leftWidth - 3;
  const leftLines = [
    ' ' + rule(leftWidth - 1, focusedTitle(left.title, focusedIdx === 0, ctx), theme),
    ...left.lines.map((l) => ' ' + l)
  ];
  const rightLines = [
    rule(rightWidth - 1, focusedTitle(right.title, focusedIdx === 1, ctx), theme),
    ...right.lines.map((l) => ' ' + l)
  ];
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = leftLines[i] ?? '';
    const r = rightLines[i] ?? '';
    const pad = ' '.repeat(Math.max(0, leftWidth - vlen(l) + 1));
    out.push(l + pad + theme.dim('│') + ' ' + r);
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
    { key: 'm', label: 'market' },
    { key: 't', label: 'hot/top/repos' },
    { key: 'r', label: 'refresh' },
    { key: 'Enter', label: 'open' }
  ],
  mount(ctx: PageContext): void {
    refreshFeed(ctx);
  },
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const theme = liftStyler(style, { trueColor: ctx.trueColor });
    const { items: news, isFallback: newsFallback } = loadNews(ctx, 5);

    const newsCol = renderNewsColumn(news, newsFallback, ctx);

    let trendCol: RenderColumn;
    if (state.trendLens === 'repos') {
      const repos = getHotRepos(detectDataDir(ctx), { limit: 5 });
      trendCol = renderReposColumn(repos, ctx);
    } else {
      const trendItems =
        state.trendLens === 'hot' ? getHotItems({ limit: 5 }) : getTrendingItems({ limit: 5 });
      trendCol = renderTrendingColumn(trendItems, state.trendLens, ctx);
    }

    const headerRight = theme.dim('press ') + theme.accent('n m') + theme.dim(' for sections');
    const lines: string[] = [];
    lines.push(pageHeader({ title: 'HOME', right: headerRight, width, theme }));
    lines.push('');

    // Top band: Your stack + opportunities
    const band = renderStackBand(width, ctx);
    lines.push(...band);
    lines.push('');

    // Bottom columns — two-column layout at ≥100 wide, stacked below
    const body =
      bp(width) !== 'xs' && width >= 100
        ? composeTwoColumn(width, newsCol, trendCol, state.cursor, ctx)
        : composeStacked(width, [newsCol, trendCol], state.cursor, ctx);
    lines.push(...body);

    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    switch (event.key) {
      case 'n':
        return { kind: 'switch', to: 'news' };
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
        refreshFeed(_ctx);
        return { kind: 'status', message: 'refreshing' };
      case 'enter': {
        if (state.cursor === 0) return { kind: 'switch', to: 'news' };
        return { kind: 'switch', to: 'marketplace' };
      }
      case 'j':
      case 'down':
        state.cursor = Math.min(1, state.cursor + 1);
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
