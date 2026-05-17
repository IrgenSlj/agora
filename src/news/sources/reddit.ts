import type { NewsItem, NewsSource } from '../types.js';
import { agoraUserAgent } from '../types.js';

export interface SourceAdapter {
  fetch(opts: {
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
  }): Promise<NewsItem[]>;
}

const SUBREDDITS = ['mcp', 'LocalLLaMA', 'programming', 'MachineLearning'];

export const redditSource: SourceAdapter = {
  async fetch(opts): Promise<NewsItem[]> {
    const fetcher = opts.fetcher ?? globalThis.fetch;
    const allItems: NewsItem[] = [];
    const now = new Date().toISOString();

    for (const sub of SUBREDDITS) {
      try {
        const url = `https://www.reddit.com/r/${sub}/hot.json?limit=25`;
        const res = await fetcher(url, {
          signal: opts.signal,
          headers: { 'User-Agent': agoraUserAgent }
        });
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        const children = data?.data?.children ?? [];
        for (const child of children) {
          const post = child?.data;
          if (!post || post.stickied) continue;
          allItems.push({
            id: `reddit:${post.id}`,
            source: 'reddit' as NewsSource,
            title: post.title ?? '',
            url: `https://reddit.com${post.permalink}`,
            author: post.author,
            publishedAt: new Date(post.created_utc * 1000).toISOString(),
            fetchedAt: now,
            engagement: post.ups ?? 0,
            tags: extractRedditTags(post, sub),
            summary: post.selftext ? post.selftext.slice(0, 200) : undefined
          });
        }
      } catch {
        continue;
      }
    }

    return allItems;
  }
};

function extractRedditTags(post: any, subreddit: string): string[] {
  const tags: string[] = [];
  const title = (post.title ?? '').toLowerCase();
  const linkFlair = (post.link_flair_text ?? '').toLowerCase();
  const subLower = subreddit.toLowerCase();

  tags.push(subLower === 'localllama' ? 'llm' : subLower);

  const topicMap: Record<string, string[]> = {
    mcp: ['mcp', 'model-context-protocol'],
    ai: ['ai', 'artificial intelligence'],
    agents: ['agent'],
    coding: ['code', 'programming', 'coding', 'developer'],
    tools: ['tool', 'framework', 'library']
  };

  for (const [topic, keywords] of Object.entries(topicMap)) {
    for (const kw of keywords) {
      if (title.includes(kw) || linkFlair.includes(kw)) {
        tags.push(topic);
        break;
      }
    }
  }

  if (linkFlair) tags.push(linkFlair.replace(/[^a-z0-9-]/g, ''));
  return tags;
}
