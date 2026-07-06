import { formatNumber } from '../../format.js';
import { isStale, readCache, writeCache } from '../../news/cache.js';
import { rankItems } from '../../news/score.js';
import { arxivSource } from '../../news/sources/arxiv.js';
import { githubTrendingSource } from '../../news/sources/github-trending.js';
import { hnSource } from '../../news/sources/hn.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl, normalizeNewsSource } from '../../news/types.js';
import { header } from '../format.js';
import { detectDataDir, numberFlag, stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandNews: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const sourceOpt = stringFlag(parsed, 'source', 's');
  const source = sourceOpt ? normalizeNewsSource(sourceOpt) : undefined;
  const limit = numberFlag(parsed, 'limit', 'n') || 20;
  const refresh = Boolean(parsed.flags.refresh);

  const dataDir = detectDataDir(parsed, io);
  let cached = readCache(dataDir);
  const now = new Date();
  const config = DEFAULT_NEWS_CONFIG;

  const adapters: [string, { fetch(opts: { signal?: AbortSignal }): Promise<any> }][] = [
    ['hn', hnSource],
    ['github-trending', githubTrendingSource],
    ['arxiv', arxivSource]
  ];

  const fetchWithTimeout = (
    fn: (signal: AbortSignal) => Promise<any>,
    ms = 10000
  ): Promise<any> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, ms);
      fn(controller.signal).then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  };

  const refreshSource = async (
    src: string,
    adapter: { fetch(opts: { signal?: AbortSignal }): Promise<any> }
  ): Promise<void> => {
    try {
      const fresh = await fetchWithTimeout((signal) => adapter.fetch({ signal }));
      cached = cached.filter((i: any) => i.source !== src);
      cached.push(...fresh);
    } catch {
      // keep stale
    }
  };

  if (refresh) {
    for (const [src, adapter] of adapters) {
      await refreshSource(src, adapter);
    }
  } else {
    for (const [src, adapter] of adapters) {
      const cfg = config.sources[src as keyof typeof config.sources];
      if (cfg?.enabled && isStale(cached, src as any, cfg.ttlMinutes, now)) {
        await refreshSource(src, adapter);
      }
    }
  }

  const ranked = rankItems(cached, config, now);
  writeCache(dataDir, cached);

  let items = ranked;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(
      (i) => i.title.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q))
    );
  }
  if (source) {
    items = items.filter((i) => i.source === source);
  }
  items = items.slice(0, limit);

  if (parsed.flags.json) {
    writeJson(io.stdout, { count: items.length, items, source: source || 'all' });
    return 0;
  }

  if (items.length === 0) {
    writeLine(io.stdout, 'No news items found.');
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header(
      'agora news',
      [`${items.length} stories`, source ? `source: ${source}` : 'all sources'],
      theme
    )
  );
  writeLine(io.stdout, '');
  for (const item of items) {
    const ageH = Math.round((now.getTime() - new Date(item.publishedAt).getTime()) / 3600000);
    const age = ageH < 1 ? '<1h' : ageH < 24 ? `${ageH}h` : `${Math.round(ageH / 24)}d`;
    const host = hostFromUrl(item.url);
    writeLine(
      io.stdout,
      `${style.accent(item.source.padEnd(6))} ${style.dim(age.padEnd(4))} ${style.accent(formatNumber(item.engagement).padStart(7))}  ${style.dim('s' + item.score.toFixed(2))}   ${item.title}`
    );
    if (host) writeLine(io.stdout, `       ${style.dim(host)}`);
    if (query) writeLine(io.stdout, '');
  }
  return 0;
};
