import type { NewsItem, NewsSource } from '../types.js';

export interface SourceAdapter {
  fetch(opts: {
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  }): Promise<NewsItem[]>;
}

const QUERY_CATEGORIES = ['cs.AI', 'cs.CL', 'cs.SE', 'cs.LG'];
const MAX_RESULTS = 25;

export const arxivSource: SourceAdapter = {
  async fetch(opts): Promise<NewsItem[]> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const allItems: NewsItem[] = [];
    const now = new Date().toISOString();

    const categories = QUERY_CATEGORIES.join('+OR+');
    const url = `http://export.arxiv.org/api/query?search_query=cat:${categories}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_RESULTS}`;

    try {
      const res = await fetcher(url, {
        signal: opts.signal,
        headers: { 'User-Agent': 'agora-cli/0.5.0' }
      });
      if (!res.ok) throw new Error(`arXiv API returned ${res.status}`);
      const xml = await res.text();
      const items = parseArxivAtom(xml, now);
      allItems.push(...items);
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') throw e;
    }

    return allItems;
  }
};

function parseArxivAtom(xml: string, now: string): NewsItem[] {
  const items: NewsItem[] = [];

  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    try {
      const entry = match[1];

      const idMatch = entry.match(/<id>([^<]+)<\/id>/);
      if (!idMatch) continue;
      const paperUrl = idMatch[1].trim();
      const paperId = paperUrl.split('/').pop() || paperUrl;

      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
      const title = titleMatch ? cleanXml(titleMatch[1]) : '';

      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
      const summary = summaryMatch ? cleanXml(summaryMatch[1]).slice(0, 300) : '';

      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
      const published = publishedMatch ? publishedMatch[1].trim() : now;

      const authorRegex = /<author>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/gi;
      const authors: string[] = [];
      let aMatch;
      while ((aMatch = authorRegex.exec(entry)) !== null) {
        authors.push(cleanXml(aMatch[1]));
      }

      const catRegex = /<category[^>]*term="([^"]+)"[^>]*\/>/gi;
      const categories: string[] = [];
      let cMatch;
      while ((cMatch = catRegex.exec(entry)) !== null) {
        categories.push(cMatch[1]);
      }

      items.push({
        id: `arxiv:${paperId}`,
        source: 'arxiv' as NewsSource,
        title,
        url: `https://arxiv.org/abs/${paperId}`,
        author: authors[0] || 'Unknown',
        publishedAt: published,
        fetchedAt: now,
        engagement: 0,
        tags: extractArxivTags(categories, title, summary),
        summary: summary || undefined
      });
    } catch {
      continue;
    }
  }

  return items;
}

function extractArxivTags(categories: string[], title: string, summary: string): string[] {
  const tags: string[] = [];
  const lower = (title + ' ' + summary).toLowerCase();

  for (const cat of categories) {
    tags.push(cat.replace(/\./g, '-').toLowerCase());
  }

  const topicMap: Record<string, string[]> = {
    ai: ['artificial intelligence', 'machine learning', 'deep learning'],
    llm: ['language model', 'llm', 'gpt', 'transformer', 'attention'],
    agents: ['agent', 'tool use', 'tool-use', 'function calling'],
    coding: ['code generation', 'program synthesis', 'software engineering'],
    security: ['security', 'safety', 'alignment', 'harmlessness']
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

function cleanXml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
