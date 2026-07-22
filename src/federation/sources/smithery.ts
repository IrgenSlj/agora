// Federation source: Smithery (registry.smithery.ai). Keyless reads still
// work (OQ-3), but S2 treats this as a non-canonical opt-in source. This is
// the reliable per-server tool-schema source: fetchItem()'s
// detail endpoint returns tools[]/resources[]/prompts[], which flow straight
// into FederatedItem.tools and from there into the P2 gate's
// annotation_hints / observed_permissions checks (src/acquire.ts already
// wires `federated?.tools` into ScanOptions — no gate change needed here).
//
// API reality verified live 2026-07-04 (docs/OPEN_QUESTIONS.md OQ-3):
//   GET /servers?q=&page=&pageSize=       (pageSize clamped to <=100 — a
//                                          request over 100 gets HTTP 400)
//   GET /servers/{qualifiedName}          (qualifiedName may itself contain a
//                                          `/`, e.g. "thinair/data" — the
//                                          detail route treats it as a single
//                                          two-segment path, not a nested
//                                          resource)
// `registry.smithery.ai` and `api.smithery.ai` both resolve to byte-identical
// responses in testing; `registry.smithery.ai` is used here as the more
// literal name for a registry client.
//
// Correction to OQ-3's "tools[]/... + security.scanPassed": in a live sample
// of ~15 varied servers (including one with 79 tools) every `security` was
// `null` and no tool ever carried an `annotations` object — the fields exist
// in the response shape but aren't populated in practice yet. Both are
// mapped defensively (annotations passed through when present) so real data
// flows through the day upstream starts setting them, without this source
// depending on it.

import type { PackageMarketplaceItem } from '../../marketplace/types.js';
import { fetchWithRetry } from '../../retry.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederatedTool,
  FederationEnv,
  RegistrySource,
  ToolAnnotationHints
} from '../types.js';
import { isNonCanonicalSourceEnabled } from './noncanonical.js';

export const SMITHERY_BASE_URL = 'https://registry.smithery.ai';

// Enriching every search result with its own detail-endpoint tool schemas is
// what makes `agora search --source smithery` (not just `acquire`) carry
// `tools[]` for the gate — capped so a large --limit doesn't fan out into an
// unbounded burst of detail requests against a keyless, best-effort API.
const MAX_TOOL_ENRICHMENT = 15;

// ── raw wire shapes (only the fields Agora reads) ───────────────────────────

interface RawSmitheryServerSummary {
  qualifiedName: string;
  namespace?: string;
  slug?: string;
  displayName?: string;
  description?: string;
  verified?: boolean;
  useCount?: number;
  homepage?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface RawSmitheryServersResponse {
  servers?: RawSmitheryServerSummary[];
  pagination?: {
    currentPage?: number;
    pageSize?: number;
    totalPages?: number;
    totalCount?: number;
  };
}

interface RawSmitheryTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: ToolAnnotationHints;
}

interface RawSmitheryDetail {
  qualifiedName?: string;
  displayName?: string;
  description?: string;
  homepage?: string;
  security?: { scanPassed?: boolean } | null;
  tools?: RawSmitheryTool[];
  [key: string]: unknown;
}

function clampPageSize(n?: number): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

/** `groundroute-ai/web-search` → path segments encoded individually so a `/`
 * inside a qualifiedName round-trips through URL encoding safely (Smithery's
 * router accepts both raw and %2F-encoded slashes; encoding per-segment is
 * the form that can never be misread as an extra path level). */
function detailUrl(qualifiedName: string): string {
  const segments = qualifiedName.split('/').filter(Boolean).map(encodeURIComponent);
  return `${SMITHERY_BASE_URL}/servers/${segments.join('/')}`;
}

function authorFromQualifiedName(name: string): string {
  const idx = name.indexOf('/');
  return idx > 0 ? name.slice(0, idx) : name;
}

function mapTool(raw: RawSmitheryTool): FederatedTool {
  return {
    name: raw.name,
    description: raw.description,
    inputSchema: raw.inputSchema,
    annotations: raw.annotations
  };
}

/**
 * Smithery's `homepage` is inconsistent in practice — sometimes the
 * upstream project's real repo (e.g. a github.com URL), sometimes just a
 * self-referential `smithery.ai/servers/...` marketing page. Only the
 * former is worth setting as `repository`: it's what lets canonicalize()
 * (repo-URL dedupe key) merge a Smithery listing with the *same* server
 * found via official/github, instead of every Smithery item staying an
 * island with no cross-source merge key at all.
 */
function repositoryFromHomepage(homepage?: string): string | undefined {
  if (!homepage) return undefined;
  try {
    const url = new URL(homepage);
    return url.hostname === 'github.com' ? homepage : undefined;
  } catch {
    return undefined;
  }
}

function mapSummary(raw: RawSmitheryServerSummary, fetchedAt: string): FederatedItem {
  const base: PackageMarketplaceItem = {
    kind: 'package',
    id: raw.qualifiedName,
    name: raw.displayName || raw.qualifiedName,
    description: raw.description ?? '',
    author: raw.namespace || authorFromQualifiedName(raw.qualifiedName),
    version: '',
    category: 'mcp',
    tags: [],
    stars: raw.useCount ?? 0,
    installs: raw.useCount ?? 0,
    createdAt: raw.createdAt ?? fetchedAt,
    repository: repositoryFromHomepage(raw.homepage)
  };

  return {
    ...base,
    provenance: [
      {
        source: 'smithery',
        sourceUrl: `https://smithery.ai/servers/${raw.qualifiedName}`,
        fetchedAt,
        verified: raw.verified
      }
    ]
  };
}

function mapDetailOnto(item: FederatedItem, raw: RawSmitheryDetail): FederatedItem {
  const tools = (raw.tools ?? []).map(mapTool);
  return tools.length > 0 ? { ...item, tools } : item;
}

// ── list + detail fetch (exported for tests) ────────────────────────────────

export interface SmitheryListParams {
  /** Free-text query; omitted entirely (not sent as `q=`) when blank. */
  q?: string;
  /** Clamped to [1, 100] by the caller — Smithery 400s above 100. */
  pageSize?: number;
}

export async function fetchSmitheryPage(
  params: SmitheryListParams,
  opts: { timeoutMs?: number; signal?: AbortSignal },
  env: FederationEnv
): Promise<FederatedItem[]> {
  const url = new URL(`${SMITHERY_BASE_URL}/servers`);
  if (params.q) url.searchParams.set('q', params.q);
  const pageSize = clampPageSize(params.pageSize);
  if (pageSize != null) url.searchParams.set('pageSize', String(pageSize));

  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    url,
    { signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) {
    throw new Error(`smithery registry returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as RawSmitheryServersResponse;
  const fetchedAt = new Date().toISOString();
  // Defensive: only map entries that actually carry Smithery's own shape —
  // a misrouted/malformed response (or another source's fixture reused
  // against the same DI fetcher in tests) must degrade to "no match", never
  // to items keyed by `undefined`.
  return (body.servers ?? [])
    .filter(
      (s): s is RawSmitheryServerSummary =>
        typeof s?.qualifiedName === 'string' && s.qualifiedName.length > 0
    )
    .map((s) => mapSummary(s, fetchedAt));
}

async function fetchSmitheryDetail(
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
  const body = (await res.json()) as RawSmitheryDetail;
  if (!body.qualifiedName) return null;
  const summary = mapSummary(
    {
      qualifiedName: body.qualifiedName,
      displayName: body.displayName,
      description: body.description,
      homepage: body.homepage
    },
    new Date().toISOString()
  );
  return mapDetailOnto(summary, body);
}

/** Best-effort per-item tool enrichment: a failed/slow detail fetch just
 * leaves that one summary without `tools` — never drops the item and never
 * throws (each enrichment is independently caught). */
async function enrichWithTools(
  items: FederatedItem[],
  env: FederationEnv,
  opts: { signal?: AbortSignal }
): Promise<FederatedItem[]> {
  const fetcher = env.fetcher ?? globalThis.fetch;
  const toEnrich = items.slice(0, MAX_TOOL_ENRICHMENT);
  const rest = items.slice(MAX_TOOL_ENRICHMENT);

  const enriched = await Promise.all(
    toEnrich.map(async (item) => {
      try {
        const res = await fetchWithRetry(
          detailUrl(item.id),
          { signal: opts.signal },
          { fetcher, maxRetries: 1, signal: opts.signal }
        );
        if (!res.ok) return item;
        const body = (await res.json()) as RawSmitheryDetail;
        return mapDetailOnto(item, body);
      } catch {
        return item;
      }
    })
  );

  return [...enriched, ...rest];
}

export const smitherySource: RegistrySource = {
  id: 'smithery',
  displayName: 'Smithery',

  isEnabled(env: FederationEnv): boolean {
    return isNonCanonicalSourceEnabled(env, 'smithery', 'AGORA_ENABLE_SMITHERY');
  },

  async search(
    query: string,
    opts: FederatedSearchOptions,
    env: FederationEnv
  ): Promise<FederatedItem[]> {
    try {
      const items = await fetchSmitheryPage(
        { q: query || undefined, pageSize: opts.limit },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
        env
      );
      return await enrichWithTools(items, env, { signal: opts.signal });
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      return await fetchSmitheryDetail(ref, env);
    } catch {
      return null;
    }
  }
};
