// Federation engine: queries every enabled RegistrySource in parallel, merges
// the results into one deduped catalog, and reports an honest per-source
// status. This is the only file that knows about canonicalization/merge — a
// source implementation only ever has to satisfy RegistrySource.

import type { PackageMarketplaceItem } from '../marketplace/types.js';
import { readSourceCache, readSourceStoreCache, resolveCacheDir } from './cache.js';
import { githubSource } from './sources/github.js';
import { glamaSource } from './sources/glama.js';
import { huggingfaceSource } from './sources/huggingface.js';
import { localSource } from './sources/local.js';
import { officialSource } from './sources/official.js';
import { smitherySource } from './sources/smithery.js';
import type {
  FederatedItem,
  FederatedSearchOptions,
  FederationEnv,
  Provenance,
  RegistrySource,
  SourceId,
  SourceStatus
} from './types.js';

/**
 * Upstream registries Agora federates, in preference order (used to order
 * merged provenance and to pick which item's metadata wins a merge). P1
 * shipped `official` + `local`; P1+ adds smithery/glama/github/huggingface —
 * see docs/OPEN_QUESTIONS.md OQ-3 for the verified endpoint shapes. Adding
 * one is "implement RegistrySource, push it into this array": federatedSearch/
 * federatedFetchItem stay generic.
 */
export const SOURCES: RegistrySource[] = [
  officialSource,
  smitherySource,
  glamaSource,
  githubSource,
  huggingfaceSource,
  localSource
];

const DEFAULT_TIMEOUT_MS = 5000;

function sourceById(id: SourceId): RegistrySource | undefined {
  return SOURCES.find((s) => s.id === id);
}

function candidateSources(source?: SourceId): RegistrySource[] {
  if (!source) return SOURCES;
  const match = sourceById(source);
  return match ? [match] : [];
}

// ── honest per-source status, without any source-specific hook ─────────────
//
// RegistrySource.search() must never throw (contract) — a source resolves to
// `[]` on failure, with no side channel for *why*. Since every network-backed
// source gets its HTTP client from `env.fetcher` (the DI seam every source
// shares), we wrap that fetcher here to remember the last error it raised.
// That gives federatedSearch an honest "unreachable" signal generically, for
// any current or future source, without the source needing to report it.

function withErrorCapture(env: FederationEnv): {
  env: FederationEnv;
  lastError: () => string | undefined;
} {
  if (!env.fetcher) return { env, lastError: () => undefined };
  let lastError: string | undefined;
  const inner = env.fetcher;
  const wrapped: typeof inner = async (input, init) => {
    try {
      return await inner(input, init);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  };
  return { env: { ...env, fetcher: wrapped }, lastError: () => lastError };
}

function matchesQueryText(item: FederatedItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/** Cache → then local (brief): serve a source's last good snapshot when it's down. */
function cacheFallback(
  env: FederationEnv,
  cacheDir: string,
  sourceId: SourceId,
  query: string,
  limit?: number
): FederatedItem[] {
  try {
    const storeCached =
      env.storePath && env.casDir
        ? readSourceStoreCache(env.storePath, env.casDir, sourceId).filter((item) =>
            matchesQueryText(item, query)
          )
        : [];
    const cached =
      storeCached.length > 0
        ? storeCached
        : readSourceCache(cacheDir, sourceId).filter((item) => matchesQueryText(item, query));
    return limit ? cached.slice(0, limit) : cached;
  } catch {
    return [];
  }
}

interface SourceOutcome {
  items: FederatedItem[];
  status: SourceStatus;
}

async function runSource(
  source: RegistrySource,
  query: string,
  opts: FederatedSearchOptions,
  env: FederationEnv,
  timeoutMs: number,
  cacheDir: string
): Promise<SourceOutcome> {
  if (!source.isEnabled(env)) {
    return {
      items: cacheFallback(env, cacheDir, source.id, query, opts.limit),
      status: { source: source.id, state: 'offline', reason: 'disabled' }
    };
  }

  const controller = new AbortController();
  const { env: instrumentedEnv, lastError } = withErrorCapture(env);
  const searchOpts: FederatedSearchOptions = { ...opts, timeoutMs, signal: controller.signal };
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const items = await Promise.race([source.search(query, searchOpts, instrumentedEnv), timeout]);
    const failure = lastError();
    if (items.length === 0 && failure) {
      return {
        items: cacheFallback(env, cacheDir, source.id, query, opts.limit),
        status: { source: source.id, state: 'unreachable', reason: failure }
      };
    }
    return { items, status: { source: source.id, state: 'ok', count: items.length } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      items: cacheFallback(env, cacheDir, source.id, query, opts.limit),
      status: { source: source.id, state: 'unreachable', reason }
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── canonicalization / merge ─────────────────────────────────────────────
//
// Dedupe key (declared in types.ts as the P1 rule): merge items whose key
// matches by reverse-DNS server name | normalized repo URL | npm package.
// A group can only ever contain more than one `package`-kind item (workflows
// never produce any of these keys), so the merge logic below is safe to treat
// group members as packages once `group.length > 1`.

type FederatedPackageItem = FederatedItem & PackageMarketplaceItem;

function normalizeRepoUrl(repository?: string): string | null {
  if (!repository) return null;
  const trimmed = repository.trim();
  if (!trimmed) return null;
  const withoutSuffix = trimmed.replace(/\/+$/g, '').replace(/\.git$/i, '');
  try {
    const url = new URL(withoutSuffix);
    return (url.hostname + url.pathname).toLowerCase().replace(/\/+$/g, '');
  } catch {
    const gitMatch = withoutSuffix.match(/^git@([^:]+):(.+)$/);
    if (gitMatch) return `${gitMatch[1]}/${gitMatch[2]}`.toLowerCase().replace(/\.git$/i, '');
    return withoutSuffix.toLowerCase();
  }
}

function canonicalKeys(item: FederatedItem): string[] {
  const keys: string[] = [];
  if (item.serverJson?.name) keys.push(`name:${item.serverJson.name.toLowerCase()}`);
  if (item.kind === 'package') {
    const repo = normalizeRepoUrl(item.repository);
    if (repo) keys.push(`repo:${repo}`);
    if (item.npmPackage) keys.push(`npm:${item.npmPackage.toLowerCase()}`);
  }
  return keys;
}

function firstTruthy<K extends keyof FederatedPackageItem>(
  group: FederatedItem[],
  key: K
): FederatedPackageItem[K] | undefined {
  for (const item of group) {
    if (item.kind !== 'package') continue;
    const value = (item as FederatedPackageItem)[key];
    if (value) return value;
  }
  return undefined;
}

function mergeGroup(group: FederatedItem[], sourceOrder: Map<SourceId, number>): FederatedItem {
  if (group.length === 1) return group[0]!;

  // Prefer the official-origin item's metadata when the group has one.
  const official = group.find((i) => i.officialStatus !== undefined);
  const base = (official ?? group[0]!) as FederatedPackageItem;

  const provenance: Provenance[] = group
    .flatMap((i) => i.provenance)
    .sort((a, b) => (sourceOrder.get(a.source) ?? 99) - (sourceOrder.get(b.source) ?? 99));

  const tags = Array.from(new Set(group.flatMap((i) => i.tags)));
  const stars = Math.max(...group.map((i) => i.stars));
  const installs = Math.max(...group.map((i) => i.installs));

  return {
    ...base,
    tags,
    stars,
    installs,
    repository: base.repository ?? firstTruthy(group, 'repository'),
    npmPackage: base.npmPackage ?? firstTruthy(group, 'npmPackage'),
    provenance
  };
}

function canonicalize(items: FederatedItem[]): FederatedItem[] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byKey = new Map<string, number>();
  items.forEach((item, i) => {
    for (const key of canonicalKeys(item)) {
      const existing = byKey.get(key);
      if (existing !== undefined) union(existing, i);
      else byKey.set(key, i);
    }
  });

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  });

  const sourceOrder = new Map(SOURCES.map((s, i) => [s.id, i]));
  return Array.from(groups.values()).map((idxs) =>
    mergeGroup(
      idxs.map((i) => items[i]!),
      sourceOrder
    )
  );
}

export interface FederatedSearchResult {
  items: FederatedItem[];
  statuses: SourceStatus[];
}

export async function federatedSearch(
  query: string,
  opts: FederatedSearchOptions = {},
  env: FederationEnv = {}
): Promise<FederatedSearchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheDir = resolveCacheDir(env);
  const candidates = candidateSources(opts.source);

  const outcomes = await Promise.all(
    candidates.map((source) => runSource(source, query, opts, env, timeoutMs, cacheDir))
  );

  return {
    items: canonicalize(outcomes.flatMap((o) => o.items)),
    statuses: outcomes.map((o) => o.status)
  };
}

export async function federatedFetchItem(
  ref: string,
  env: FederationEnv = {},
  opts: { source?: SourceId } = {}
): Promise<FederatedItem | null> {
  const candidates = candidateSources(opts.source);
  const results = await Promise.all(
    candidates.map(async (source) => {
      if (!source.isEnabled(env)) return null;
      try {
        return await source.fetchItem(ref, env);
      } catch {
        return null;
      }
    })
  );

  const found = results.filter((r): r is FederatedItem => Boolean(r));
  if (found.length === 0) return null;
  return canonicalize(found)[0] ?? null;
}

export type { FederatedItem, FederatedSearchOptions, FederationEnv, SourceId, SourceStatus };
