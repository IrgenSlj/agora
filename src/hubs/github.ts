// Catalog source: GitHub Search REST API. Returns installable HubItems for the
// marketplace. Distinct from src/news/sources/github-trending.ts, which scrapes
// the human Trending page for news-feed cards.
import { fetchWithRetry } from '../retry.js';
import { passes, type RawGithubRepo, toHubItem } from './quality.js';
import type { HubItem } from './types.js';

export const TOPICS = [
  'mcp',
  'model-context-protocol',
  'claude-skill',
  'claude-code',
  'agent-tools',
  'llm-tools',
  'langchain',
  'opencode'
];

const PER_TOPIC = 30;

import type { FetchLike } from '../fetch.js';

export type { FetchLike };

export interface GithubSearchOptions {
  fetcher?: FetchLike;
  signal?: AbortSignal;
  token?: string; // optional PAT
  topics?: string[]; // override TOPICS for tests
  now?: Date;
}

export async function searchGithub(opts: GithubSearchOptions = {}): Promise<HubItem[]> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const topics = opts.topics ?? TOPICS;
  const now = opts.now ?? new Date();
  const fetchedAt = now.toISOString();
  const token = opts.token ?? process.env.AGORA_GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agora-cli'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Fan the topic queries out in parallel. Run sequentially, 8 topics x (1
  // request + up to 2 retries) cannot finish inside the federation layer's 5s
  // per-source budget, so this source timed out on every search and Agent
  // Skills silently returned nothing. Parallel, it is one round-trip wide.
  type TopicOutcome = { repos: RawGithubRepo[]; failure?: string };
  const pages: TopicOutcome[] = await Promise.all(
    topics.map(async (topic): Promise<TopicOutcome> => {
      const q = `topic:${topic}+stars:>=10`;
      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${PER_TOPIC}`;
      try {
        // maxRetries is a total-attempt count here, not retries-after-first
        // (withRetry loops `attempt <= maxRetries`, so 0 never calls fetch at
        // all). 1 = a single attempt: retrying inside a fan-out only burns the
        // shared budget, and unauthenticated search is capped at 10 req/min.
        const res = await fetchWithRetry(
          url,
          { headers, signal: opts.signal },
          { maxRetries: 1, fetcher }
        );
        if (!res.ok) {
          const rateLimited =
            res.status === 429 ||
            (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
          return {
            repos: [],
            failure: rateLimited
              ? token
                ? 'GitHub rate limit reached'
                : 'GitHub rate limit reached (unauthenticated — set AGORA_GITHUB_TOKEN)'
              : `GitHub returned ${res.status}`
          };
        }
        const json = (await res.json()) as { items?: RawGithubRepo[] };
        return { repos: json.items ?? [] };
      } catch (err) {
        return { repos: [], failure: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  // If every topic query failed we have no evidence of anything, which is not
  // the same as "there are no matching repos". Say so rather than reporting a
  // confident empty result — the federation layer turns this into an honest
  // `unreachable` status instead of `ok · 0`.
  const failures = pages.filter((p) => p.failure);
  if (failures.length === pages.length && pages.length > 0) {
    throw new Error(failures[0]?.failure ?? 'GitHub search failed');
  }

  const byId = new Map<number, RawGithubRepo>();
  for (const { repos } of pages) {
    for (const repo of repos) {
      if (!byId.has(repo.id)) byId.set(repo.id, repo);
    }
  }

  const items: HubItem[] = [];
  for (const repo of byId.values()) {
    if (!passes(repo, now)) continue;
    items.push(toHubItem(repo, fetchedAt));
  }

  // Sort by stars descending for simplicity
  items.sort((a, b) => b.stars - a.stars);

  return items;
}
