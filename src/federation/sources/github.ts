// Federation source: GitHub — the long-tail catalog beyond curated
// registries. search() wraps src/hubs/github.ts's existing searchGithub()
// (topic-based Search API, cross-topic dedupe, quality gate) rather than
// re-implementing GitHub API access, then maps each HubItem 1:1 into a
// FederatedItem. searchGithub() has no free-text query parameter of its own
// (it always crawls a fixed topic list) — this source applies the query as a
// client-side name/description/tag filter, same as the federation engine's
// own cache-fallback matcher.
//
// fetchItem() is a direct `GET /repos/{owner}/{repo}` (a superset of the
// search API's repo shape) reusing `toHubItem` from src/hubs/quality.ts so a
// single-item resolve stays byte-for-byte consistent with search()'s mapping
// instead of re-deriving it.
import { searchGithub } from '../../hubs/github.js';
import { toHubItem, type RawGithubRepo } from '../../hubs/quality.js';
import { fetchWithRetry } from '../../retry.js';
import type { HubItem } from '../../hubs/types.js';
import type { FederatedItem, FederatedSearchOptions, FederationEnv, RegistrySource } from '../types.js';
import type { PackageMarketplaceItem } from '../../marketplace/types.js';

function toFederatedItem(item: HubItem, fetchedAt: string): FederatedItem {
  const base: PackageMarketplaceItem = {
    kind: 'package',
    id: item.id,
    name: item.name,
    description: item.description,
    author: item.author,
    version: item.version,
    category: item.category,
    tags: item.tags,
    stars: item.stars,
    installs: item.installs,
    repository: item.repository,
    npmPackage: item.npmPackage,
    createdAt: item.createdAt,
    pricing: item.pricing,
    source: item.source,
    pushedAt: item.pushedAt
  };

  return {
    ...base,
    provenance: [{ source: 'github', sourceUrl: item.repository, fetchedAt }]
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

/** `gh:owner/repo` or bare `owner/repo` → `{owner, repo}`. Null on anything
 * that doesn't look like a repo ref. */
function refToOwnerRepo(ref: string): { owner: string; repo: string } | null {
  const stripped = ref.startsWith('gh:') ? ref.slice(3) : ref;
  const idx = stripped.indexOf('/');
  if (idx <= 0 || idx === stripped.length - 1) return null;
  return { owner: stripped.slice(0, idx), repo: stripped.slice(idx + 1) };
}

export const githubSource: RegistrySource = {
  id: 'github',
  displayName: 'GitHub',

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
        token: env.env?.AGORA_GITHUB_TOKEN
      });
      const filtered = items.filter((i) => matchesQuery(i, query));
      const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;
      return limited.map((i) => toFederatedItem(i, fetchedAt));
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
      return toFederatedItem(toHubItem(raw, fetchedAt), fetchedAt);
    } catch {
      return null;
    }
  }
};
