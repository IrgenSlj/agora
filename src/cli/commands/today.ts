import { loadAgoraState, getAuthState } from '../../state.js';
import { readCache } from '../../news/cache.js';
import { rankItems } from '../../news/score.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { communityThreadsSource } from '../../community/client.js';
import { getTrendingItems } from '../../marketplace.js';
import { formatNumber } from '../../format.js';
import { writeLine, writeJson, stringFlag, detectDataDir } from '../helpers.js';
import { header } from '../format.js';
import type { CommandHandler } from './types.js';
import type { ScoredNewsItem } from '../../news/types.js';
import type { Thread } from '../../community/types.js';
import type { MarketplaceItem } from '../../marketplace.js';
import type { SourceOptions } from '../../live.js';

const DAY_MS = 86400 * 1000;

function buildSourceOptions(dataDir: string, io: { env?: Record<string, string | undefined>; fetcher?: unknown }): SourceOptions | null {
  let apiUrl = (io.env?.['AGORA_API_URL'] ?? process.env['AGORA_API_URL']) || '';
  let token = (io.env?.['AGORA_TOKEN'] ?? process.env['AGORA_TOKEN'] ?? io.env?.['AGORA_API_TOKEN'] ?? process.env['AGORA_API_TOKEN']) || '';
  if (!apiUrl || !token) {
    try {
      const state = loadAgoraState(dataDir);
      const auth = getAuthState(state);
      if (auth) {
        if (!apiUrl) apiUrl = auth.apiUrl || '';
        if (!token) token = auth.accessToken || '';
      }
    } catch {
      /* ignore */
    }
  }
  if (!apiUrl || !token) return null;
  return { useApi: true, apiUrl, token, fetcher: io.fetcher as any, timeoutMs: 10000 };
}

function fmtAge(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm';
  if (h < 24) return Math.round(h) + 'h';
  return Math.round(h / 24) + 'd';
}

export const commandToday: CommandHandler = async (parsed, io, style) => {
  const section = stringFlag(parsed, 'section') || 'all';
  const dataDir = detectDataDir(parsed, io);
  const now = Date.now();
  const cutoff = now - DAY_MS;

  const wantsNews = section === 'all' || section === 'news';
  const wantsCommunity = section === 'all' || section === 'community';
  const wantsMarket = section === 'all' || section === 'market';

  let newsItems: ScoredNewsItem[] = [];
  let threads: Thread[] = [];
  let trending: MarketplaceItem[] = [];
  let communityHint = '';

  if (wantsNews) {
    const cached = readCache(dataDir);
    const recent = cached.filter((item) => new Date(item.publishedAt).getTime() > cutoff);
    newsItems = rankItems(recent, DEFAULT_NEWS_CONFIG, new Date()).slice(0, 3);
  }

  if (wantsCommunity) {
    const opts = buildSourceOptions(dataDir, io);
    if (!opts) {
      communityHint = 'Sign in with `agora auth login` to see live community threads.';
    } else {
      const result = await communityThreadsSource(opts, 'mcp', 'active', 1);
      threads = result.data.threads
        .filter((t) => new Date(t.createdAt).getTime() > cutoff)
        .slice(0, 3);
      if (threads.length === 0) {
        threads = result.data.threads.slice(0, 3);
      }
    }
  }

  if (wantsMarket) {
    trending = getTrendingItems().slice(0, 3);
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      at: new Date().toISOString(),
      news: wantsNews ? newsItems : undefined,
      threads: wantsCommunity ? threads : undefined,
      trending: wantsMarket ? trending : undefined
    });
    return 0;
  }

  writeLine(io.stdout, header('agora today', [new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })], style));
  writeLine(io.stdout, '');

  if (wantsNews) {
    writeLine(io.stdout, style.accent('News'));
    if (newsItems.length === 0) {
      writeLine(io.stdout, style.dim('Nothing in the last 24h.'));
    } else {
      for (const item of newsItems) {
        const src = style.dim(item.source.toUpperCase().slice(0, 2).padEnd(3));
        const age = style.dim(fmtAge(item.publishedAt).padStart(3));
        const up = style.accent(('↑ ' + formatNumber(item.engagement)).padStart(7));
        writeLine(io.stdout, src + '  ' + age + '  ' + up + '  ' + item.title);
        writeLine(io.stdout, '         ' + style.dim(hostFromUrl(item.url)));
      }
    }
    writeLine(io.stdout, '');
  }

  if (wantsCommunity) {
    writeLine(io.stdout, style.accent('Community'));
    if (communityHint) {
      writeLine(io.stdout, style.dim(communityHint));
    } else if (threads.length === 0) {
      writeLine(io.stdout, style.dim('Nothing in the last 24h.'));
    } else {
      for (const t of threads) {
        const board = style.accent('/' + t.board);
        const meta = style.dim(' · ' + fmtAge(t.createdAt) + ' · ' + t.replyCount + ' replies');
        writeLine(io.stdout, board + '  ' + t.title);
        writeLine(io.stdout, '       ' + style.dim(t.author) + meta);
      }
    }
    writeLine(io.stdout, '');
  }

  if (wantsMarket) {
    writeLine(io.stdout, style.accent('Trending'));
    if (trending.length === 0) {
      writeLine(io.stdout, style.dim('Nothing in the last 24h.'));
    } else {
      for (const item of trending) {
        const stats = style.dim(' · ' + formatNumber(item.installs ?? 0) + ' installs');
        writeLine(io.stdout, style.bold(item.name) + stats);
        if (item.description) {
          writeLine(io.stdout, '  ' + style.dim(item.description.slice(0, 60)));
        }
      }
    }
  }

  return 0;
};
