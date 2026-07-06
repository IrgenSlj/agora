import { formatNumber } from '../../format.js';
import type { MarketplaceItem } from '../../marketplace.js';
import { getTrendingItems } from '../../marketplace.js';
import { readCache } from '../../news/cache.js';
import { rankItems } from '../../news/score.js';
import type { ScoredNewsItem } from '../../news/types.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { header } from '../format.js';
import { detectDataDir, stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const DAY_MS = 86400 * 1000;

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
  const wantsMarket = section === 'all' || section === 'market';

  let newsItems: ScoredNewsItem[] = [];
  let newsIsFallback = false;
  let trending: MarketplaceItem[] = [];

  if (wantsNews) {
    const cached = readCache(dataDir);
    const recent = cached.filter((item) => new Date(item.publishedAt).getTime() > cutoff);
    newsItems = rankItems(recent, DEFAULT_NEWS_CONFIG, new Date()).slice(0, 3);
    if (newsItems.length === 0 && cached.length > 0) {
      newsItems = rankItems(cached, DEFAULT_NEWS_CONFIG, new Date()).slice(0, 3);
      newsIsFallback = true;
    }
  }

  if (wantsMarket) {
    trending = getTrendingItems().slice(0, 3);
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      at: new Date().toISOString(),
      news: wantsNews ? newsItems : undefined,
      trending: wantsMarket ? trending : undefined
    });
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header(
      'agora today',
      [
        new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      ],
      theme
    )
  );
  writeLine(io.stdout, '');

  if (wantsNews) {
    const newsHeading = newsIsFallback ? 'News' + theme.dim(' · recent') : 'News';
    writeLine(io.stdout, theme.accent(newsHeading));
    if (newsItems.length === 0) {
      writeLine(io.stdout, theme.muted('No news cached yet — run `agora news --refresh`'));
    } else {
      for (const item of newsItems) {
        const src = theme.dim(item.source.toUpperCase().slice(0, 2).padEnd(3));
        const age = theme.dim(fmtAge(item.publishedAt).padStart(3));
        const up = theme.accent(('↑ ' + formatNumber(item.engagement)).padStart(7));
        writeLine(io.stdout, src + '  ' + age + '  ' + up + '  ' + item.title);
        writeLine(io.stdout, '         ' + theme.dim(hostFromUrl(item.url)));
      }
    }
    writeLine(io.stdout, '');
  }

  if (wantsMarket) {
    writeLine(io.stdout, theme.accent('Trending'));
    if (trending.length === 0) {
      writeLine(io.stdout, theme.muted('Nothing in the last 24h.'));
    } else {
      for (const item of trending) {
        const stats = theme.dim(' · ' + formatNumber(item.installs ?? 0) + ' installs');
        writeLine(io.stdout, theme.bold(item.name) + stats);
        if (item.description) {
          writeLine(io.stdout, '  ' + theme.dim(item.description.slice(0, 60)));
        }
      }
    }
  }

  return 0;
};
