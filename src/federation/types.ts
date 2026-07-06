/**
 * Federation contract — the flip from "own catalog" to "federated crossroads".
 *
 * Every upstream registry is an *upstream source* Agora federates; the effective
 * catalog is the union of all of them. Only `official` is required — every other
 * source degrades to "unreachable" without breaking Ring 1 (brief §5f).
 *
 * External-API reality verified 2026-07-03 (see docs/OPEN_QUESTIONS.md OQ-3):
 *   - official  registry.modelcontextprotocol.io — required, no auth for reads
 *   - smithery  api.smithery.ai — the reliable per-server tool-schema source
 *   - glama     glama.ai/api/mcp — NO tool schemas / annotation hints in practice
 *   - github    reuse src/hubs/github.ts as the long-tail source
 *   - huggingface reuse src/hubs/huggingface.ts
 *   - local     bundled data.ts / on-disk cache (offline fallback)
 * PulseMCP and mcp.so have no self-serve public API — deliberately absent.
 */

import type { MarketplaceItem } from '../marketplace/types.js';
import type { FetchLike } from '../retry.js';

/** The upstream registries Agora federates. `local` = bundled/offline cache. */
export type SourceId = 'official' | 'smithery' | 'glama' | 'github' | 'huggingface' | 'local';

/**
 * Official-registry lifecycle status, from
 * `_meta["io.modelcontextprotocol.registry/official"].status`.
 * `deleted` means spam/malware/policy violation → a hard gate `fail` + cache prune.
 * `deprecated` → gate `warn`.
 */
export type OfficialStatus = 'active' | 'deprecated' | 'deleted';

/** Where one item was found — enough to re-fetch and to attribute it in the UI. */
export interface Provenance {
  source: SourceId;
  /** Canonical URL for the item on that source, when available. */
  sourceUrl?: string;
  /** RFC3339 timestamp of when Agora last fetched it from this source. */
  fetchedAt: string;
  /** Source asserts this is an authentic / first-party listing. */
  verified?: boolean;
}

/**
 * Minimal projection of the official MCP Registry `server.schema.json`
 * (2025-12-11). Only the fields Agora's install planner + gate consume; the
 * full publisher object is preserved on `raw` for forward-compat.
 */
export interface ServerJson {
  /** reverse-DNS, e.g. `io.github.user/server`. */
  name: string;
  description?: string;
  version?: string;
  packages?: ServerPackage[];
  remotes?: ServerRemote[];
  raw?: unknown;
}

export interface ServerPackage {
  /** npm | pypi | oci | nuget | mcpb | cargo | … (open-ended by spec). */
  registryType: string;
  identifier: string;
  version?: string;
  transport?: string | { type?: string; url?: string };
  runtimeHint?: string;
  runtimeArguments?: unknown[];
  packageArguments?: unknown[];
  environmentVariables?: unknown[];
}

export interface ServerRemote {
  /** e.g. streamable-http, sse. */
  type: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * MCP tool annotation hints (per the MCP spec). Sourced from the Smithery detail
 * endpoint or a live probe — NOT from Glama, which returns none (OQ-3). Folded
 * into the trust gate's permission heuristics as warn-level signals (P2).
 */
export interface ToolAnnotationHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A tool as reported by a source's detail endpoint or a live probe. */
export interface FederatedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: ToolAnnotationHints;
}

/**
 * The unit of the federated catalog: a MarketplaceItem enriched with where it
 * came from and registry/spec metadata. One logical server may be found across
 * several sources; after canonicalization the merged item keeps every provenance
 * (official-registry metadata preferred when present).
 */
export type FederatedItem = MarketplaceItem & {
  /** Every source this item was found in (>= 1). Merged items carry several. */
  provenance: Provenance[];
  /** Official-registry lifecycle status when present (drives the gate). */
  officialStatus?: OfficialStatus;
  /** Official-registry server object when the item resolves there. */
  serverJson?: ServerJson;
  /** Per-server tool schemas from a source detail endpoint (Smithery) or probe. */
  tools?: FederatedTool[];
};

export interface FederatedSearchOptions {
  /** Restrict the search to a single source. */
  source?: SourceId;
  limit?: number;
  /** Per-source hard timeout in ms (brief §5d: default 5000, then "unreachable"). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Per-source status surfaced progressively in the UI — honest states, never a lying spinner. */
export type SourceStatus =
  | { source: SourceId; state: 'searching' }
  | { source: SourceId; state: 'ok'; count: number }
  | { source: SourceId; state: 'unreachable'; reason: string }
  | { source: SourceId; state: 'offline'; reason: string };

/** Ambient environment threaded to every source (DI fetcher keeps tests hermetic). */
export interface FederationEnv {
  fetcher?: FetchLike;
  home?: string;
  env?: Record<string, string | undefined>;
  /** Content-addressed cache dir override; defaults under AGORA_HOME. */
  cacheDir?: string;
}

/**
 * One client per upstream registry. Implementations MUST NOT throw from `search`
 * — resolve to `[]` on failure and report the reason via the caller's status
 * callback, so one unreachable source never breaks a federated query.
 */
export interface RegistrySource {
  id: SourceId;
  /** Human label used for provenance badges. */
  displayName: string;
  /** Whether this source can be reached right now (config/network/credential gate). */
  isEnabled(env: FederationEnv): boolean;
  /** Free-text search. Never throws; returns [] on failure. */
  search(query: string, opts: FederatedSearchOptions, env: FederationEnv): Promise<FederatedItem[]>;
  /** Resolve one item by this source's canonical ref (e.g. reverse-DNS name). */
  fetchItem(ref: string, env: FederationEnv): Promise<FederatedItem | null>;
}

/**
 * Canonicalization key for dedupe across sources (P1 impl): merge items whose
 * key matches by reverse-DNS server name | normalized repo URL | npm package.
 * Declared here so every source agrees on the identity rule.
 */
export type CanonicalKey = string;
