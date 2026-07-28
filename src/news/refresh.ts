// Populating the news cache.
//
// This used to live inside `agora news`. When that command was retired (brief
// D6 keeps the feed "read-only with zero new investment"; §9 lists only
// `agora today`), the fetch had to come with it — `agora today` is a pure
// cache reader, so deleting the only writer would have left it permanently
// empty while advising users to run a command that no longer exists.

import type { FetchLike } from '../fetch.js';
import { isStale, readCache, writeCache } from './cache.js';
import { arxivSource } from './sources/arxiv.js';
import { githubTrendingSource } from './sources/github-trending.js';
import { hnSource } from './sources/hn.js';
import type { NewsConfig, NewsItem, NewsSource } from './types.js';

interface SourceAdapter {
  fetch(opts: { fetcher?: FetchLike; signal?: AbortSignal }): Promise<NewsItem[]>;
}

const ADAPTERS: [NewsSource, SourceAdapter][] = [
  ['hn', hnSource],
  ['github-trending', githubTrendingSource],
  ['arxiv', arxivSource]
];

const FETCH_TIMEOUT_MS = 10_000;

/**
 * A source that hangs must not hang the command. `AbortController` is passed
 * through to the adapter so an aborted fetch actually stops, rather than the
 * promise merely being ignored while the socket stays open.
 */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export interface RefreshNewsOptions {
  dataDir: string;
  config: NewsConfig;
  /** Ignore per-source TTLs and refetch everything. */
  force?: boolean;
  fetcher?: FetchLike;
  now?: Date;
}

export interface RefreshNewsResult {
  items: NewsItem[];
  /** Sources that were attempted this run. */
  refreshed: NewsSource[];
  /** Sources that were attempted and failed — the cached copy was kept. */
  failed: NewsSource[];
}

/**
 * Refreshes stale sources into the on-disk cache and returns the merged items.
 *
 * A source that fails keeps its cached entries rather than dropping them, and
 * is reported in `failed` so the caller can say so. Silently returning fewer
 * items would read as "there is less news today", which is not what happened.
 */
export async function refreshNews(options: RefreshNewsOptions): Promise<RefreshNewsResult> {
  const now = options.now ?? new Date();
  let items = readCache(options.dataDir);
  const refreshed: NewsSource[] = [];
  const failed: NewsSource[] = [];

  for (const [source, adapter] of ADAPTERS) {
    const cfg = options.config.sources[source];
    if (!cfg?.enabled) continue;
    if (!options.force && !isStale(items, source, cfg.ttlMinutes, now)) continue;

    refreshed.push(source);
    try {
      const fresh = await withTimeout((signal) =>
        adapter.fetch({ fetcher: options.fetcher, signal })
      );
      items = [...items.filter((item) => item.source !== source), ...fresh];
    } catch {
      failed.push(source);
    }
  }

  if (refreshed.length > 0) writeCache(options.dataDir, items);
  return { items, refreshed, failed };
}
