import type { NewsItem, NewsSource } from '../types.js';

export interface SourceAdapter {
  fetch(opts: { fetcher?: (url: string, init?: RequestInit) => Promise<Response>; signal?: AbortSignal }): Promise<NewsItem[]>;
}

/**
 * RSS feed adapter.
 * Reads user-defined RSS feeds from settings. For each configured URL,
 * fetches the feed XML and parses basic RSS 2.0 / Atom entries.
 */
export const rssSource: SourceAdapter = {
  async fetch(opts): Promise<NewsItem[]> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const now = new Date().toISOString();
    const items: NewsItem[] = [];

    const feedUrls = await getConfiguredFeeds();

    for (const feedUrl of feedUrls) {
      try {
        const res = await fetcher(feedUrl, {
          signal: opts.signal,
          headers: { 'User-Agent': 'agora-cli/0.5.0' },
        });
        if (!res.ok) continue;
        const xml = await res.text();

        const entryRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = entryRegex.exec(xml)) !== null) {
          const entry = match[1];
          const title = extractXmlTag(entry, 'title');
          const link = extractXmlTag(entry, 'link');
          const pubDate = extractXmlTag(entry, 'pubDate');
          const description = extractXmlTag(entry, 'description');
          const creator = extractXmlTag(entry, 'dc:creator');

          if (!title || !link) continue;

          const published = pubDate
            ? new Date(pubDate).toISOString()
            : now;

          items.push({
            id: `rss:${Buffer.from(link).toString('base64').slice(0, 32)}`,
            source: 'rss' as NewsSource,
            title,
            url: link,
            author: creator || undefined,
            publishedAt: published,
            fetchedAt: now,
            engagement: 0,
            tags: ['rss', ...extractRssTags(title, description || '')],
            summary: description ? stripHtml(description).slice(0, 200) : undefined,
          });
        }
      } catch {
        continue;
      }
    }

    return items;
  },
};

async function getConfiguredFeeds(): Promise<string[]> {
  try {
    const { loadSettings } = await import('../../settings.js');
    const dataDir = process.env.AGORA_DATA_DIR || joinHome('.config', 'agora');
    const settings = loadSettings(dataDir);
    if (settings.news?.feeds && Array.isArray(settings.news.feeds)) {
      return settings.news.feeds.filter(Boolean);
    }
  } catch {
    // settings not available
  }
  return [];
}

function extractXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1].trim() : null;
}

function extractRssTags(title: string, description: string): string[] {
  const tags: string[] = [];
  const lower = (title + ' ' + description).toLowerCase();

  const topicMap: Record<string, string[]> = {
    mcp: ['mcp', 'model-context-protocol'],
    ai: ['ai', 'artificial intelligence'],
    llm: ['llm', 'language model', 'gpt', 'claude'],
    coding: ['coding', 'programming', 'software'],
    devtools: ['devtools', 'developer tools'],
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        tags.push(topic);
        break;
      }
    }
  }
  return tags;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/[\s\n]+/g, ' ').trim();
}

function joinHome(...parts: string[]): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return parts.length ? `${home}/${parts.join('/')}` : home;
}
