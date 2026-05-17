import type { NewsItem, ScoredNewsItem, NewsConfig } from './types.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl, slugFromUrl } from './types.js';

export function scoreItem(item: NewsItem, config: NewsConfig, now: Date): ScoredNewsItem {
  const hoursOld = Math.max(0, (now.getTime() - new Date(item.publishedAt).getTime()) / 3600000);
  const recency = Math.exp(-hoursOld / 12);

  const engagement = item.engagement > 0 ? Math.log10(item.engagement + 1) / 4 : 0;

  const itemTopics = new Set((item.tags ?? []).map((t) => t.toLowerCase()));
  let topicScore = 0;
  const activeTopics = config.topics.length > 0 ? config.topics : DEFAULT_NEWS_CONFIG.topics;
  for (const t of activeTopics) {
    if (itemTopics.has(t.toLowerCase())) {
      topicScore = Math.max(topicScore, 1);
    }
  }

  const w = config.weights;
  const score = w.recency * recency + w.engagement * engagement + w.topic * topicScore;

  return {
    ...item,
    score,
    scoreBreakdown: { recency, engagement: engagement, topic: topicScore }
  };
}

export function rankItems(items: NewsItem[], config: NewsConfig, now: Date): ScoredNewsItem[] {
  const scored = items.map((item) => scoreItem(item, config, now));

  const seen = new Set<string>();
  const deduped: ScoredNewsItem[] = [];
  for (const item of scored) {
    const key = hostFromUrl(item.url) + ':' + slugFromUrl(item.url);
    const existing = key ? seen.has(key) : false;
    if (key && existing) {
      const prev = deduped.find((d) => hostFromUrl(d.url) + ':' + slugFromUrl(d.url) === key);
      if (prev && item.score > prev.score) {
        Object.assign(prev, item);
      }
      continue;
    }
    if (key) seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => b.score - a.score);
  return deduped;
}
