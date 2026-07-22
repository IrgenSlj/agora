// Federation source: GitHub-hosted Agent Skills.
//
// This is deliberately narrower than the generic GitHub source. It reuses the
// existing topic-based GitHub repository crawler, but only with skill-oriented
// topics and maps every result as an `agent-skill` candidate (`category: skill`)
// keyed by its GitHub repository purl in the S2 sync layer.

import { searchGithub } from '../../hubs/github.js';
import { type RawGithubRepo, toHubItem } from '../../hubs/quality.js';
import type { HubItem } from '../../hubs/types.js';
import type { PackageMarketplaceItem } from '../../marketplace/types.js';
import { fetchWithRetry } from '../../retry.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  RegistrySource
} from '../types.js';

export const SKILLS_GITHUB_TOPICS = [
  'agent-skill',
  'claude-skill',
  'claude-code-skill',
  'codex-skill',
  'opencode-skill',
  'agentskills',
  'skill'
];

function skillId(fullName: string): string {
  return `skill:${fullName}`;
}

function toSkillItem(item: HubItem, fetchedAt: string): FederatedItem {
  const fullName = item.id.startsWith('gh:') ? item.id.slice(3) : item.id;
  const base: PackageMarketplaceItem = {
    kind: 'package',
    id: skillId(fullName),
    name: item.name,
    description: item.description,
    author: item.author,
    version: item.version,
    category: 'skill',
    tags: Array.from(new Set(['agent-skill', ...item.tags])),
    stars: item.stars,
    installs: item.installs,
    repository: item.repository,
    createdAt: item.createdAt,
    pricing: item.pricing,
    source: item.source,
    pushedAt: item.pushedAt
  };

  return {
    ...base,
    provenance: [{ source: 'skills-github', sourceUrl: item.repository, fetchedAt }]
  };
}

function matchesQuery(item: HubItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function refToOwnerRepo(ref: string): { owner: string; repo: string } | null {
  const stripped = ref.startsWith('skill:')
    ? ref.slice(6)
    : ref.startsWith('gh:')
      ? ref.slice(3)
      : ref;
  const idx = stripped.indexOf('/');
  if (idx <= 0 || idx === stripped.length - 1) return null;
  return { owner: stripped.slice(0, idx), repo: stripped.slice(idx + 1) };
}

export const skillsGithubSource: RegistrySource = {
  id: 'skills-github',
  displayName: 'GitHub Skills',

  isEnabled(env: FederationEnv): boolean {
    return env.env?.AGORA_OFFLINE !== '1';
  },

  async search(
    query: string,
    opts: FederatedSearchOptions,
    env: FederationEnv
  ): Promise<FederatedItem[]> {
    try {
      const fetchedAt = new Date().toISOString();
      const items = await searchGithub({
        fetcher: env.fetcher,
        signal: opts.signal,
        token: env.env?.AGORA_GITHUB_TOKEN,
        topics: SKILLS_GITHUB_TOPICS
      });
      const filtered = items.filter((i) => matchesQuery(i, query));
      const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;
      return limited.map((i) => toSkillItem(i, fetchedAt));
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      const parsed = refToOwnerRepo(ref);
      if (!parsed) return null;

      const fetcher = env.fetcher ?? globalThis.fetch;
      const token = env.env?.AGORA_GITHUB_TOKEN;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agora-cli'
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetchWithRetry(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
        { headers },
        { fetcher, maxRetries: 1 }
      );
      if (!res.ok) return null;

      const raw = (await res.json()) as RawGithubRepo;
      const fetchedAt = new Date().toISOString();
      return toSkillItem(toHubItem(raw, fetchedAt), fetchedAt);
    } catch {
      return null;
    }
  }
};
