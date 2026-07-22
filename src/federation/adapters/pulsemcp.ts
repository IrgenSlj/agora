// Federation source: PulseMCP Sub-Registry API (api.pulsemcp.com).
//
// Re-verified 2026-07-22: PulseMCP documents a v0.1 Sub-Registry API, but it
// is a private B2B integration requiring `X-API-Key` and `X-Tenant-ID`. The
// live endpoint returns HTTP 401 without those headers, so this source is
// optional and disabled unless credentials are present in the environment.

import { fetchWithRetry } from '../../retry.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  RegistrySource
} from '../types.js';
import { mapServerEntry } from './official.js';

export const PULSEMCP_BASE_URL = 'https://api.pulsemcp.com';
const PULSE_SERVER_META = 'com.pulsemcp/server';
const PULSE_VERSION_META = 'com.pulsemcp/server-version';

interface RawPulseEntry {
  server?: {
    name?: string;
    version?: string;
    [key: string]: unknown;
  };
  _meta?: {
    [PULSE_SERVER_META]?: {
      visitorsEstimateLastFourWeeks?: number;
      isOfficial?: boolean;
    };
    [PULSE_VERSION_META]?: {
      status?: 'active' | 'deprecated' | 'deleted' | string;
    };
    [key: string]: unknown;
  };
}

interface RawPulseListResponse {
  servers?: RawPulseEntry[];
  metadata?: { nextCursor?: string; count?: number };
}

function authHeaders(env: FederationEnv): Record<string, string> | null {
  const record = env.env ?? {};
  const apiKey = record.AGORA_PULSEMCP_API_KEY || record.PULSEMCP_API_KEY;
  const tenantId = record.AGORA_PULSEMCP_TENANT_ID || record.PULSEMCP_TENANT_ID;
  if (!apiKey || !tenantId) return null;
  return {
    'X-API-Key': apiKey,
    'X-Tenant-ID': tenantId,
    'Content-Type': 'application/json'
  };
}

function clampLimit(limit?: number): number | undefined {
  if (limit == null || !Number.isFinite(limit)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function detailApiUrl(name: string, version = 'latest'): string {
  return `${PULSEMCP_BASE_URL}/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
}

function isActive(entry: RawPulseEntry): boolean {
  return entry._meta?.[PULSE_VERSION_META]?.status !== 'deleted';
}

export function mapPulseEntry(entry: RawPulseEntry, fetchedAt: string): FederatedItem | null {
  if (!entry.server?.name) return null;
  const item = mapServerEntry(entry as Parameters<typeof mapServerEntry>[0], fetchedAt);
  const serverMeta = entry._meta?.[PULSE_SERVER_META];
  const visitors = serverMeta?.visitorsEstimateLastFourWeeks;
  const visitorCount = typeof visitors === 'number' && Number.isFinite(visitors) ? visitors : 0;

  return {
    ...item,
    installs: visitorCount || item.installs,
    provenance: [
      {
        source: 'pulsemcp',
        sourceUrl: detailApiUrl(entry.server.name),
        fetchedAt,
        verified: Boolean(serverMeta?.isOfficial)
      }
    ]
  };
}

export interface PulseMcpListParams {
  search?: string;
  limit?: number;
  cursor?: string;
  version?: 'latest';
  updatedSince?: string;
}

export async function fetchPulseMcpPage(
  params: PulseMcpListParams,
  opts: { timeoutMs?: number; signal?: AbortSignal },
  env: FederationEnv
): Promise<FederatedItem[]> {
  const headers = authHeaders(env);
  if (!headers) throw new Error('PulseMCP credentials missing');

  const url = new URL(`${PULSEMCP_BASE_URL}/v0.1/servers`);
  if (params.search) url.searchParams.set('search', params.search);
  const limit = clampLimit(params.limit);
  if (limit != null) url.searchParams.set('limit', String(limit));
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  if (params.version) url.searchParams.set('version', params.version);
  if (params.updatedSince) url.searchParams.set('updated_since', params.updatedSince);

  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(
    url,
    { headers, signal: opts.signal },
    { fetcher, maxRetries: 1, signal: opts.signal }
  );
  if (!res.ok) throw new Error(`PulseMCP registry returned HTTP ${res.status}`);

  const body = (await res.json()) as RawPulseListResponse;
  const fetchedAt = new Date().toISOString();
  return (body.servers ?? [])
    .filter((entry) => entry.server?.name && isActive(entry))
    .map((entry) => mapPulseEntry(entry, fetchedAt))
    .filter((item): item is FederatedItem => Boolean(item));
}

async function fetchPulseMcpDetail(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
  const headers = authHeaders(env);
  if (!headers) return null;

  const fetcher = env.fetcher ?? globalThis.fetch;
  const res = await fetchWithRetry(detailApiUrl(ref), { headers }, { fetcher, maxRetries: 1 });
  if (!res.ok) return null;

  const entry = (await res.json()) as RawPulseEntry;
  if (!isActive(entry)) return null;
  return mapPulseEntry(entry, new Date().toISOString());
}

export const pulseMcpSource: RegistrySource = {
  id: 'pulsemcp',
  displayName: 'PulseMCP',

  isEnabled(env: FederationEnv): boolean {
    return env.env?.AGORA_OFFLINE !== '1' && authHeaders(env) !== null;
  },

  async search(
    query: string,
    opts: FederatedSearchOptions,
    env: FederationEnv
  ): Promise<FederatedItem[]> {
    try {
      return await fetchPulseMcpPage(
        { search: query || undefined, limit: opts.limit, version: 'latest' },
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
        env
      );
    } catch {
      return [];
    }
  },

  async fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null> {
    try {
      return await fetchPulseMcpDetail(ref, env);
    } catch {
      return null;
    }
  }
};
