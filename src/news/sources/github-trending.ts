// News source: scrapes github.com/trending HTML for news-feed cards. Distinct
// from src/hubs/github.ts, which uses the REST API to find installable repos
// for the marketplace catalog.
import type { NewsItem, NewsSource } from '../types.js';
import { agoraUserAgent } from '../types.js';

export interface SourceAdapter {
  fetch(opts: {
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  }): Promise<NewsItem[]>;
}

const LANGUAGES = ['typescript', 'python', 'go', 'rust'];

export const githubTrendingSource: SourceAdapter = {
  async fetch(opts): Promise<NewsItem[]> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const allItems: NewsItem[] = [];
    const now = new Date().toISOString();

    for (const lang of LANGUAGES) {
      try {
        const url = `https://github.com/trending/${lang}?since=daily`;
        const res = await fetcher(url, {
          signal: opts.signal,
          headers: { 'User-Agent': agoraUserAgent }
        });
        if (!res.ok) continue;
        const html = await res.text();
        const items = parseTrendingHtml(html, lang, now);
        allItems.push(...items);
      } catch {
        continue;
      }
    }

    return allItems;
  }
};

function parseTrendingHtml(html: string, lang: string, now: string): NewsItem[] {
  const items: NewsItem[] = [];
  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    try {
      const article = match[1];

      const repoMatch = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[^>]*>/i);
      if (!repoMatch) continue;
      const repoPath = repoMatch[1];

      const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      const description = descMatch ? stripHtml(descMatch[1]).trim() : '';

      const starsMatch = article.match(
        /<span[^>]*class="[^"]*d-inline-block[^"]*float-sm-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      );
      const starsStr = starsMatch ? stripHtml(starsMatch[1]).trim().replace(/,/g, '') : '0';
      const stars = parseInt(starsStr, 10) || 0;

      const forksMatch = article.match(/<a[^>]*href="\/[^"]+\/fork"[^>]*>([\s\S]*?)<\/a>/i);
      const forksStr = forksMatch ? stripHtml(forksMatch[1]).trim().replace(/,/g, '') : '0';
      const forks = parseInt(forksStr, 10) || 0;

      const [owner, repo] = repoPath.split('/');
      const id = `gh:${repoPath.replace('/', '-')}`;
      const engagement = stars + forks;

      items.push({
        id,
        source: 'github-trending' as NewsSource,
        title: `${owner}/${repo}`,
        url: `https://github.com/${repoPath}`,
        author: owner,
        publishedAt: now,
        fetchedAt: now,
        engagement,
        tags: extractGithubTags(repoPath, description, lang),
        summary: description || undefined
      });
    } catch {
      continue;
    }
  }

  return items;
}

function extractGithubTags(repoPath: string, description: string, lang: string): string[] {
  const tags = new Set<string>();
  const lower = (repoPath + ' ' + description).toLowerCase();
  tags.add(lang);

  const topicMap: Record<string, string[]> = {
    mcp: ['mcp', 'model-context-protocol', 'modelcontextprotocol'],
    ai: ['ai', 'artificial-intelligence', 'llm', 'machine-learning'],
    agents: ['agent', 'agents', 'autonomous'],
    tools: ['cli', 'tool', 'framework', 'sdk'],
    database: ['database', 'sql', 'nosql', 'postgres', 'redis', 'sqlite'],
    devtools: ['devtools', 'developer-tools', 'github', 'git']
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        tags.add(topic);
        break;
      }
    }
  }

  return Array.from(tags);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/[\s\n]+/g, ' ')
    .trim();
}
