export type NewsSource = 'hn' | 'reddit' | 'github-trending' | 'arxiv' | 'rss';

export interface NewsItem {
  id: string;
  source: NewsSource;
  title: string;
  url: string;
  author?: string;
  publishedAt: string;
  fetchedAt: string;
  engagement: number;
  tags: string[];
  summary?: string;
}

export interface ScoredNewsItem extends NewsItem {
  score: number;
  scoreBreakdown: { recency: number; engagement: number; topic: number };
}

export interface NewsConfig {
  sources: Record<NewsSource, { enabled: boolean; ttlMinutes: number }>;
  topics: string[];
  weights: { recency: number; engagement: number; topic: number };
}

export const DEFAULT_NEWS_CONFIG: NewsConfig = {
  sources: {
    hn: { enabled: true, ttlMinutes: 10 },
    reddit: { enabled: true, ttlMinutes: 15 },
    'github-trending': { enabled: true, ttlMinutes: 30 },
    arxiv: { enabled: false, ttlMinutes: 60 },
    rss: { enabled: false, ttlMinutes: 60 },
  },
  topics: ['mcp', 'ai', 'agents', 'workflows', 'llm', 'tool-use', 'coding', 'agents', 'security'],
  weights: { recency: 1.0, engagement: 0.6, topic: 0.8 },
};

export const NEWS_SOURCE_LABELS: Record<NewsSource, string> = {
  hn: 'Hacker News',
  reddit: 'Reddit',
  'github-trending': 'GitHub Trending',
  arxiv: 'arXiv',
  rss: 'RSS',
};

export function normalizeNewsSource(s: string): NewsSource | undefined {
  const map: Record<string, NewsSource> = {
    hn: 'hn', hackernews: 'hn', 'hacker-news': 'hn',
    reddit: 'reddit',
    gh: 'github-trending', github: 'github-trending', 'github-trending': 'github-trending',
    arxiv: 'arxiv',
    rss: 'rss',
  };
  return map[s.toLowerCase().trim()];
}

export function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/$/, '').split('/').filter(Boolean).slice(-2).join('/');
  } catch {
    return '';
  }
}
