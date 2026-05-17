/**
 * RSS feed adapter — uncomment the export and wire into NEWS_SOURCES
 * (src/news/types.ts) when user-configurable RSS feeds are needed.
 *
 * import type { NewsItem, NewsSource } from '../types.js';
 *
 * export interface SourceAdapter {
 *   fetch(opts: { fetcher?: (url: string, init?: RequestInit) => Promise<Response>; signal?: AbortSignal; }): Promise<NewsItem[]>;
 * }
 *
 * export const rssSource: SourceAdapter = { ... };
 */
