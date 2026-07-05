// Federation source: Hugging Face — the long-tail model/dataset/space
// catalog. search() wraps src/hubs/huggingface.ts's existing
// searchHuggingFace() (fixed category queries, no auth needed) and maps each
// HubItem 1:1 into a FederatedItem. Like the GitHub source, searchHuggingFace
// has no free-text query of its own — this source applies the query as a
// client-side name/description/tag filter.
//
// fetchItem() does a direct GET against HF's models/datasets/spaces detail
// endpoints (tried in that order — HF doesn't expose a single "any kind of
// repo" lookup) and maps the raw response with the same shape/rules as
// searchHuggingFace()'s own (private, unexported) mapper — duplicated here
// rather than modifying src/hubs/huggingface.ts.
import { searchHuggingFace, type RawHfItem } from '../../hubs/huggingface.js';
import { fetchWithRetry } from '../../retry.js';
import type { HubItem } from '../../hubs/types.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  RegistrySource
} from '../types.js';
import type { PackageMarketplaceItem } from '../../marketplace/types.js';

const DETAIL_ENDPOINTS = ['models', 'datasets', 'spaces'] as const;

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
    provenance: [{ source: 'huggingface', sourceUrl: item.repository, fetchedAt }]
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

/** Mirrors the private `toHubItem` in src/hubs/huggingface.ts (id split,
 * pipeline-tag description fallback, tag dedupe) — kept in lockstep by hand
 * since that helper isn't exported. */
function mapRawHfItem(raw: RawHfItem, endpoint: string, fetchedAt: string): HubItem {
  const [author, name] = raw.id.split('/');
  return {
    id: `hf:${raw.id}`,
    source: 'hf',
    name: name ?? raw.id,
    description: raw.pipeline_tag
      ? `${raw.pipeline_tag} ${endpoint.slice(0, -1)}`
      : endpoint.slice(0, -1),
    author: author ?? raw.author ?? 'unknown',
    version: 'main',
    category: 'workflow',
    tags: Array.from(
      new Set([...(raw.tags ?? []), raw.pipeline_tag, raw.library_name].filter(Boolean) as string[])
    ),
    stars: raw.likes ?? 0,
    installs: raw.downloads ?? 0,
    repository: `https://huggingface.co/${raw.id}`,
    createdAt: raw.createdAt ?? fetchedAt,
    pricing: { kind: 'free' },
    fetchedAt,
    pushedAt: raw.lastModified ?? fetchedAt,
    license: null,
    topics: raw.tags ?? []
  };
}

/** `hf:owner/name` or bare `owner/name` → `{owner, name}`. */
function refToOwnerName(ref: string): { owner: string; name: string } | null {
  const stripped = ref.startsWith('hf:') ? ref.slice(3) : ref;
  const idx = stripped.indexOf('/');
  if (idx <= 0 || idx === stripped.length - 1) return null;
  return { owner: stripped.slice(0, idx), name: stripped.slice(idx + 1) };
}

export const huggingfaceSource: RegistrySource = {
  id: 'huggingface',
  displayName: 'Hugging Face',

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
      const items = await searchHuggingFace({ fetcher: env.fetcher, signal: opts.signal });
      const filtered = items.filter((i) => matchesQuery(i, query));
      const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;
      return limited.map((i) => toFederatedItem(i, fetchedAt));
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      const parsed = refToOwnerName(ref);
      if (!parsed) return null;

      const fetcher = env.fetcher ?? globalThis.fetch;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'agora-cli'
      };

      for (const endpoint of DETAIL_ENDPOINTS) {
        const res = await fetchWithRetry(
          `https://huggingface.co/api/${endpoint}/${parsed.owner}/${parsed.name}`,
          { headers },
          { fetcher, maxRetries: 1 }
        );
        if (res.ok) {
          const raw = (await res.json()) as RawHfItem;
          const fetchedAt = new Date().toISOString();
          return toFederatedItem(mapRawHfItem(raw, endpoint, fetchedAt), fetchedAt);
        }
      }
      return null;
    } catch {
      return null;
    }
  }
};
