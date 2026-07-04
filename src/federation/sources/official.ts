// Federation source: the official MCP Registry (registry.modelcontextprotocol.io).
// The only *required* source — every other upstream degrades to "unreachable"
// without breaking a federated query (brief §5f). No auth for reads.
//
// API reality verified 2026-07-03 (docs/OPEN_QUESTIONS.md OQ-3):
//   GET /v0.1/servers?search=&limit=&cursor=&version=latest&updated_since=
//   GET /v0.1/servers/{encoded-name}/versions[/{version}]
// `updated_since` auto-includes deleted tombstones — that's what src/federation/cache.ts
// uses for incremental refresh + prune.
import { fetchWithRetry } from '../../retry.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  OfficialStatus,
  RegistrySource,
  ServerJson,
  ServerPackage,
  ServerRemote
} from '../types.js';
import type { PackageMarketplaceItem } from '../../marketplace/types.js';

export const OFFICIAL_BASE_URL = 'https://registry.modelcontextprotocol.io';
const META_KEY = 'io.modelcontextprotocol.registry/official';

// ── Raw wire shapes (only the fields we read; publisher object kept on `raw`) ──

interface RawServerRepository {
  url?: string;
  source?: string;
}

interface RawServer {
  name: string;
  description?: string;
  title?: string;
  version?: string;
  repository?: RawServerRepository;
  packages?: ServerPackage[];
  remotes?: ServerRemote[];
  [key: string]: unknown;
}

interface RawOfficialMeta {
  status: OfficialStatus;
  publishedAt?: string;
  updatedAt?: string;
  statusChangedAt?: string;
  statusMessage?: string;
  isLatest?: boolean;
}

interface RawServerEntry {
  server: RawServer;
  _meta?: {
    [META_KEY]?: RawOfficialMeta;
  };
}

interface RawServersResponse {
  servers?: RawServerEntry[];
  metadata?: {
    nextCursor?: string;
    count?: number;
  };
}

export interface OfficialListParams {
  /** Free-text query; omitted entirely (not sent as `search=`) when blank. */
  search?: string;
  /** Clamped to [1, 100] by the caller; server default is 30 when omitted. */
  limit?: number;
  /** Opaque `metadata.nextCursor` from a previous page — never parsed, only replayed. */
  cursor?: string;
  version?: 'latest';
  /** RFC3339. Auto-includes deleted tombstones server-side. */
  updatedSince?: string;
}

export interface OfficialListResult {
  items: FederatedItem[];
  nextCursor?: string;
}

function clampLimit(limit?: number): number | undefined {
  if (limit == null || !Number.isFinite(limit)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

/** `io.github.user/server` → `io.github.user`. Falls back to the full name. */
function authorFromName(name: string): string {
  const idx = name.lastIndexOf('/');
  return idx > 0 ? name.slice(0, idx) : name;
}

function firstNpmPackage(packages?: ServerPackage[]): ServerPackage | undefined {
  return packages?.find((p) => p.registryType === 'npm');
}

function detailUrl(name: string): string {
  return `${OFFICIAL_BASE_URL}/v0.1/servers/${encodeURIComponent(name)}/versions`;
}

/** Project one raw registry entry into a FederatedItem. Exported for tests. */
export function mapServerEntry(entry: RawServerEntry, fetchedAt: string): FederatedItem {
  const server = entry.server;
  const meta = entry._meta?.[META_KEY];
  const npmPkg = firstNpmPackage(server.packages);
  // `repository` lives on the top-level server object in the live schema; the
  // ServerJson contract doesn't type it (forward-compat via `raw`), so we read
  // it defensively off the raw payload rather than off `packages[]`.
  const repository = server.repository?.url;

  const serverJson: ServerJson = {
    name: server.name,
    description: server.description,
    version: server.version,
    packages: server.packages,
    remotes: server.remotes,
    raw: server
  };

  const base: PackageMarketplaceItem = {
    kind: 'package',
    id: server.name,
    name: server.name,
    description: server.description ?? '',
    author: authorFromName(server.name),
    version: server.version ?? '',
    category: 'mcp',
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: meta?.publishedAt ?? fetchedAt,
    repository,
    npmPackage: npmPkg?.identifier
  };

  return {
    ...base,
    provenance: [
      {
        source: 'official',
        sourceUrl: detailUrl(server.name),
        fetchedAt,
        verified: true
      }
    ],
    officialStatus: meta?.status,
    serverJson
  };
}

/** One page of `GET /v0.1/servers`. Can throw — callers decide how to degrade. */
export async function fetchOfficialPage(
  params: OfficialListParams,
  opts: { timeoutMs?: number; signal?: AbortSignal },
  env: FederationEnv
): Promise<OfficialListResult> {
  const url = new URL(`${OFFICIAL_BASE_URL}/v0.1/servers`);
  if (params.search) url.searchParams.set('search', params.search);
  const limit = clampLimit(params.limit);
  if (limit != null) url.searchParams.set('limit', String(limit));
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  if (params.version) url.searchParams.set('version', params.version);
  if (params.updatedSince) url.searchParams.set('updated_since', params.updatedSince);

  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    url,
    { signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) {
    throw new Error(`official registry returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as RawServersResponse;
  const fetchedAt = new Date().toISOString();
  const items = (body.servers ?? []).map((entry) => mapServerEntry(entry, fetchedAt));
  return { items, nextCursor: body.metadata?.nextCursor };
}

async function fetchOfficialDetail(
  ref: string,
  env: FederationEnv,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<FederatedItem | null> {
  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    detailUrl(ref),
    { signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) return null;
  const body = (await res.json()) as RawServersResponse;
  const entries = body.servers ?? [];
  if (entries.length === 0) return null;
  const latest = entries.find((e) => e._meta?.[META_KEY]?.isLatest) ?? entries[0]!;
  return mapServerEntry(latest, new Date().toISOString());
}

export const officialSource: RegistrySource = {
  id: 'official',
  displayName: 'Official MCP Registry',

  isEnabled(env: FederationEnv): boolean {
    // No auth required for reads; the only opt-out is an explicit offline flag.
    return env.env?.AGORA_OFFLINE !== '1';
  },

  async search(
    query: string,
    opts: FederatedSearchOptions,
    env: FederationEnv
  ): Promise<FederatedItem[]> {
    try {
      const { items } = await fetchOfficialPage(
        { search: query || undefined, limit: opts.limit, version: 'latest' },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
        env
      );
      return items;
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      return await fetchOfficialDetail(ref, env);
    } catch {
      return null;
    }
  }
};
