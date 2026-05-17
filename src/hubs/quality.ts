import type { HubItem } from './types.js';

export interface RawGithubRepo {
  id: number;
  full_name: string; // "owner/repo"
  name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  created_at: string;
  archived: boolean;
  license: { spdx_id: string | null } | null;
  topics: string[];
  default_branch: string;
}

export function passes(repo: RawGithubRepo, now: Date): boolean {
  if (repo.archived) return false;
  if (repo.stargazers_count < 10) return false;
  if (!repo.description || repo.description.trim().length < 10) return false;
  if (!repo.license || !repo.license.spdx_id) return false;
  const pushed = new Date(repo.pushed_at).getTime();
  const ageDays = (now.getTime() - pushed) / (1000 * 60 * 60 * 24);
  if (ageDays > 365) return false; // not abandoned
  return true;
}

export function score(repo: RawGithubRepo, now: Date): number {
  // Stars (log-scaled) + recency boost. Used for sorting; not a hard gate.
  const stars = Math.log10(Math.max(1, repo.stargazers_count));
  const pushed = new Date(repo.pushed_at).getTime();
  const ageDays = Math.max(1, (now.getTime() - pushed) / (1000 * 60 * 60 * 24));
  const recency = 1 / Math.log10(ageDays + 10);
  return stars * 0.7 + recency * 0.3;
}

export function categorize(repo: RawGithubRepo): HubItem['category'] {
  const topics = repo.topics.map((t) => t.toLowerCase());
  const desc = (repo.description ?? '').toLowerCase();
  if (
    topics.some((t) => t === 'mcp' || t === 'model-context-protocol') ||
    desc.includes('mcp server')
  )
    return 'mcp';
  if (topics.some((t) => t === 'claude-skill' || t === 'skill')) return 'skill';
  if (topics.some((t) => t === 'prompt' || t === 'prompts')) return 'prompt';
  return 'workflow';
}

export function toHubItem(repo: RawGithubRepo, fetchedAt: string): HubItem {
  return {
    id: `gh:${repo.full_name}`,
    source: 'github',
    name: repo.name,
    description: repo.description ?? '',
    author: repo.owner.login,
    version: repo.default_branch,
    category: categorize(repo),
    tags: Array.from(new Set([...repo.topics, repo.license?.spdx_id ?? ''].filter(Boolean))),
    stars: repo.stargazers_count,
    installs: repo.stargazers_count, // proxy for v1
    repository: repo.html_url,
    createdAt: repo.created_at,
    pricing: { kind: 'free' },
    fetchedAt,
    pushedAt: repo.pushed_at,
    license: repo.license?.spdx_id ?? null,
    topics: repo.topics
  };
}
