// Federation source: Glama (glama.ai/api/mcp). No auth. CORRECTION to OQ-3,
// re-verified live 2026-07-04: `tools[]` is `[]` on every sampled server
// (including the detail endpoint) — Glama genuinely has no per-tool schemas
// today, so `FederatedItem.tools` is never set here (never fabricated).
//
// API reality verified live 2026-07-04:
//   GET /v1/servers?query=&first=&after=&attributes[]=   (cursor pagination
//                                                         via `pageInfo`)
//   GET /v1/servers/{namespace}/{slug}
// `attributes[]=author:official` (array-bracket param — a bare `attributes=`
// silently no-ops) is a real, working filter: matched items carry the
// literal string `'author:official'` in their `attributes` array (confirmed
// live against e.g. `scavio-ai/arcade-scavio`). `hosting:remote-capable` /
// `hosting:local-only` / `hosting:hybrid` is present on nearly every server.
// Neither has a dedicated field on MarketplaceItem — folded into
// `Provenance.verified` (official attribute) and `tags` (hosting attribute)
// respectively, the only structural homes that fit.
import { fetchWithRetry } from '../../retry.js';
import type { FederatedItem, FederatedSearchOptions, FederationEnv, RegistrySource } from '../types.js';
import type { PackageMarketplaceItem } from '../../marketplace/types.js';

export const GLAMA_BASE_URL = 'https://glama.ai/api/mcp/v1';
const OFFICIAL_ATTRIBUTE = 'author:official';

interface RawGlamaServer {
  name: string;
  namespace: string;
  slug: string;
  description?: string;
  attributes?: string[];
  repository?: { url?: string };
  url?: string;
  [key: string]: unknown;
}

interface RawGlamaServersResponse {
  servers?: RawGlamaServer[];
  pageInfo?: { endCursor?: string; hasNextPage?: boolean };
}

function clampFirst(n?: number): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function canonicalRef(namespace: string, slug: string): string {
  return `${namespace}/${slug}`;
}

/** `{namespace}/{slug}` — encode each segment individually, same rationale
 * as smithery.ts's detailUrl(). */
function detailUrl(ref: string): string {
  const segments = ref.split('/').filter(Boolean).map(encodeURIComponent);
  return `${GLAMA_BASE_URL}/servers/${segments.join('/')}`;
}

/** Project one raw Glama server into a FederatedItem. Exported for tests. */
export function mapGlamaServer(raw: RawGlamaServer, fetchedAt: string): FederatedItem {
  const attributes = raw.attributes ?? [];
  const isOfficial = attributes.includes(OFFICIAL_ATTRIBUTE);
  const hostingTags = attributes.filter((a) => a.startsWith('hosting:'));
  const ref = canonicalRef(raw.namespace, raw.slug);

  const base: PackageMarketplaceItem = {
    kind: 'package',
    id: ref,
    name: raw.name,
    description: raw.description ?? '',
    author: raw.namespace,
    version: '',
    category: 'mcp',
    tags: hostingTags,
    stars: 0,
    installs: 0,
    createdAt: fetchedAt,
    repository: raw.repository?.url
  };

  return {
    ...base,
    provenance: [
      {
        source: 'glama',
        sourceUrl: raw.url ?? `https://glama.ai/mcp/servers/${ref}`,
        fetchedAt,
        verified: isOfficial
      }
    ]
    // tools intentionally omitted — Glama has no per-tool schemas (OQ-3).
  };
}

export interface GlamaListParams {
  /** Free-text query; omitted entirely (not sent as `query=`) when blank. */
  query?: string;
  /** Clamped to [1, 100]. */
  first?: number;
}

export async function fetchGlamaPage(
  params: GlamaListParams,
  opts: { timeoutMs?: number; signal?: AbortSignal },
  env: FederationEnv
): Promise<FederatedItem[]> {
  const url = new URL(`${GLAMA_BASE_URL}/servers`);
  if (params.query) url.searchParams.set('query', params.query);
  const first = clampFirst(params.first);
  if (first != null) url.searchParams.set('first', String(first));

  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    url,
    { signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) {
    throw new Error(`glama registry returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as RawGlamaServersResponse;
  const fetchedAt = new Date().toISOString();
  // Defensive: only map entries carrying Glama's own shape — a
  // misrouted/malformed response must degrade to "no match", never to items
  // keyed by "undefined/undefined".
  return (body.servers ?? [])
    .filter((s): s is RawGlamaServer => typeof s?.namespace === 'string' && typeof s?.slug === 'string' && typeof s?.name === 'string')
    .map((s) => mapGlamaServer(s, fetchedAt));
}

async function fetchGlamaDetail(
  ref: string,
  env: FederationEnv,
  opts: { signal?: AbortSignal } = {}
): Promise<FederatedItem | null> {
  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    detailUrl(ref),
    { signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as RawGlamaServer;
  if (!body.namespace || !body.name) return null;
  return mapGlamaServer(body, new Date().toISOString());
}

export const glamaSource: RegistrySource = {
  id: 'glama',
  displayName: 'Glama',

  isEnabled(env: FederationEnv): boolean {
    return env.env?.AGORA_OFFLINE !== '1';
  },

  async search(
    query: string,
    opts: FederatedSearchOptions,
    env: FederationEnv
  ): Promise<FederatedItem[]> {
    try {
      return await fetchGlamaPage(
        { query: query || undefined, first: opts.limit },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
        env
      );
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      return await fetchGlamaDetail(ref, env);
    } catch {
      return null;
    }
  }
};
