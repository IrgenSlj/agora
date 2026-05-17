import type { NewsItem, NewsSource } from '../types.js';

export interface SourceAdapter {
  fetch(opts: {
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  }): Promise<NewsItem[]>;
}

export const hnSource: SourceAdapter = {
  async fetch(opts): Promise<NewsItem[]> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const url =
      'https://hn.algolia.com/api/v1/search?tags=front_page&numericFilters=points>50&hitsPerPage=30';

    const res = await fetcher(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`HN API returned ${res.status}`);
    const data = (await res.json()) as any;

    const now = new Date().toISOString();
    return (data.hits ?? []).map((hit: any) => {
      const item: NewsItem = {
        id: `hn:${hit.objectID}`,
        source: 'hn' as NewsSource,
        title: hit.title ?? '',
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author,
        publishedAt: new Date(hit.created_at).toISOString(),
        fetchedAt: now,
        engagement: hit.points ?? 0,
        tags: extractHnTags(hit)
      };
      return item;
    });
  }
};

function extractHnTags(hit: any): string[] {
  const tags: string[] = [];
  const title = (hit.title ?? '').toLowerCase();
  const url = (hit.url ?? '').toLowerCase();

  const topicMap: Record<string, string[]> = {
    mcp: ['mcp', 'model-context-protocol', 'modelcontextprotocol'],
    ai: ['ai', 'artificial-intelligence'],
    llm: ['llm', 'large-language-model', 'gpt', 'claude', 'gemini'],
    agents: ['agent', 'agents', 'autonomous'],
    coding: ['coding', 'programming', 'software', 'developer'],
    security: ['security', 'vulnerability', 'exploit'],
    devtools: ['devtools', 'developer-tools', 'sdk', 'api']
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    for (const kw of keywords) {
      if (title.includes(kw) || url.includes(kw)) {
        tags.push(topic);
        break;
      }
    }
  }

  if ((hit._tags ?? []).includes('show')) tags.push('show');
  if ((hit._tags ?? []).includes('ask')) tags.push('ask');

  return tags;
}
