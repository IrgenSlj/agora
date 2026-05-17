import type { HubItem } from './types.js';
import { passes, toHubItem, type RawGithubRepo } from './quality.js';

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

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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

  const byId = new Map<number, RawGithubRepo>();
  for (const topic of topics) {
    const q = `topic:${topic}+stars:>=10`;
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${PER_TOPIC}`;
    try {
      const res = await fetcher(url, { headers, signal: opts.signal });
      if (!res.ok) continue;
      const json = (await res.json()) as { items?: RawGithubRepo[] };
      for (const repo of json.items ?? []) {
        if (!byId.has(repo.id)) byId.set(repo.id, repo);
      }
    } catch {
      continue; // graceful; we have cache fallback
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
