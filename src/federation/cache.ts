// On-disk cache for federation sources: one compatibility JSONL file per source
// under `${AGORA_HOME}/federation/`, plus an S1 SQLite index whose full item
// payloads live in CAS. Powers two things:
//   1. offline degradation — federatedSearch falls back to a source's last
//      good snapshot when the live fetch is unreachable (still labels the
//      status honestly; only the *items* come from cache).
//   2. `agora refresh` — official's `updated_since` incremental sync, which
//      also prunes entries the registry has tombstoned as `deleted`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildPurl, parsePurl } from '../model/purl.js';
import { detectAgoraDataDir } from '../state.js';
import { AgoraStore, CASCache } from '../store/index.js';
import { fetchOfficialPage } from './sources/official.js';
import type { FederatedItem, FederationEnv, ServerPackage, SourceId } from './types.js';

const MAX_ITEMS_PER_SOURCE = 5000;
/** Hard cap on pages crawled during a bootstrap (no prior `lastSyncAt`) sync. */
const MAX_BOOTSTRAP_PAGES = 20;
const PAGE_SIZE = 100;

export function resolveCacheDir(env: FederationEnv = {}): string {
  if (env.cacheDir) return env.cacheDir;
  const dataDir = detectAgoraDataDir({ home: env.home, env: env.env });
  return join(dataDir, 'federation');
}

export function sourceCachePath(cacheDir: string, sourceId: SourceId): string {
  return join(cacheDir, `${sourceId}.jsonl`);
}

export function sourceMetaPath(cacheDir: string, sourceId: SourceId): string {
  return join(cacheDir, `${sourceId}.meta.json`);
}

export interface SourceCacheMeta {
  /** RFC3339 timestamp of the last successful sync — fed back as `updated_since`. */
  lastSyncAt?: string;
}

export function readSourceCache(cacheDir: string, sourceId: SourceId): FederatedItem[] {
  const path = sourceCachePath(cacheDir, sourceId);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const items: FederatedItem[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        items.push(JSON.parse(line));
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

export function writeSourceCache(
  cacheDir: string,
  sourceId: SourceId,
  items: FederatedItem[]
): void {
  mkdirSync(cacheDir, { recursive: true });
  const path = sourceCachePath(cacheDir, sourceId);
  const trimmed = items.slice(0, MAX_ITEMS_PER_SOURCE);
  const lines = trimmed.map((item) => JSON.stringify(item));
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}

export function readSourceMeta(cacheDir: string, sourceId: SourceId): SourceCacheMeta {
  const path = sourceMetaPath(cacheDir, sourceId);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SourceCacheMeta;
  } catch {
    return {};
  }
}

export function writeSourceMeta(cacheDir: string, sourceId: SourceId, meta: SourceCacheMeta): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(sourceMetaPath(cacheDir, sourceId), JSON.stringify(meta), 'utf8');
}

export interface RefreshResult {
  source: SourceId;
  added: number;
  updated: number;
  pruned: number;
  total: number;
  syncedAt: string;
  /** Set when the crawl failed partway through; counts reflect what landed before the failure. */
  error?: string;
  /** Set when the JSONL cache refreshed but the SQLite/CAS source index could not be updated. */
  storeError?: string;
}

function resolveStorePath(env: FederationEnv): string | undefined {
  if (env.storePath) return env.storePath;
  return undefined;
}

function resolveCasDir(env: FederationEnv): string | undefined {
  if (env.casDir) return env.casDir;
  if (env.storePath) return join(dirname(env.storePath), 'cas');
  return undefined;
}

function packagePurl(pkg: ServerPackage, fallbackVersion?: string): string | undefined {
  const type = pkg.registryType.trim().toLowerCase();
  const identifier = pkg.identifier.trim();
  const version = pkg.version || fallbackVersion || undefined;
  if (!type || !identifier) return undefined;

  if (type === 'npm' && identifier.startsWith('@')) {
    const slash = identifier.indexOf('/');
    if (slash <= 1 || slash === identifier.length - 1) return undefined;
    return buildPurl({
      type,
      namespace: identifier.slice(0, slash),
      name: identifier.slice(slash + 1),
      version
    });
  }

  if (type === 'github') {
    const [namespace, name] = identifier.split('/', 2);
    if (!namespace || !name) return undefined;
    return buildPurl({ type, namespace, name, version });
  }

  if (identifier.includes('/')) return undefined;
  return buildPurl({ type, name: identifier, version });
}

export function purlForFederatedItem(item: FederatedItem): string | undefined {
  for (const pkg of item.serverJson?.packages ?? []) {
    try {
      const purl = packagePurl(pkg, item.serverJson?.version || item.version || undefined);
      if (purl) return purl;
    } catch {}
  }
  return undefined;
}

function publisherNamespace(item: FederatedItem, purl: string): string {
  try {
    const parsed = parsePurl(purl);
    return parsed.namespace || item.author || item.id;
  } catch {
    return item.author || item.id;
  }
}

function officialSourceUrl(item: FederatedItem): string {
  const official = item.provenance.find((p) => p.source === 'official');
  return (
    official?.sourceUrl ||
    `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(item.id)}/versions`
  );
}

function officialFetchedAt(item: FederatedItem, syncedAt: string): string {
  return item.provenance.find((p) => p.source === 'official')?.fetchedAt || syncedAt;
}

function persistSourceIndex(
  env: FederationEnv,
  items: FederatedItem[],
  prunedItems: FederatedItem[],
  syncedAt: string
): string | undefined {
  const storePath = resolveStorePath(env);
  if (!storePath) return undefined;
  const casDir = resolveCasDir(env);
  let store: AgoraStore | undefined;

  try {
    store = new AgoraStore(storePath);
    const cas = casDir ? new CASCache(casDir) : new CASCache();

    for (const item of prunedItems) {
      store.deleteSourceItem('official', item.id);
      const purl = purlForFederatedItem(item);
      if (purl) store.deleteArtifactSource(purl, 'official');
    }

    for (const item of items) {
      const purl = purlForFederatedItem(item);
      const fetchedAt = officialFetchedAt(item, syncedAt);
      if (purl) {
        store.upsertArtifact({
          purl,
          kind: 'mcp-server',
          display_name: item.name || item.id,
          publisher: {
            namespace: publisherNamespace(item, purl),
            identity_verified: false
          }
        });
        store.upsertArtifactSource({
          purl,
          adapter: 'official',
          upstream_id: item.id,
          url: officialSourceUrl(item),
          first_seen: fetchedAt
        });
      }

      const itemSha256 = cas.put(JSON.stringify(item));
      store.upsertSourceItem({
        source: 'official',
        upstream_id: item.id,
        purl,
        item_sha256: itemSha256,
        fetched_at: fetchedAt
      });
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    store?.close();
  }
  return undefined;
}

export function readSourceStoreCache(
  storePath: string,
  casDir: string,
  sourceId: SourceId
): FederatedItem[] {
  const store = new AgoraStore(storePath);
  const cas = new CASCache(casDir);
  try {
    const items: FederatedItem[] = [];
    for (const row of store.listSourceItems(sourceId)) {
      const blob = cas.get(row.item_sha256);
      if (!blob) continue;
      try {
        items.push(JSON.parse(blob.toString('utf8')) as FederatedItem);
      } catch {}
    }
    return items;
  } finally {
    store.close();
  }
}

/**
 * Incrementally syncs the official registry into its on-disk cache. First run
 * (no `lastSyncAt`) does a bounded full crawl (`MAX_BOOTSTRAP_PAGES` × 100 —
 * "keep it simple", not an exhaustive mirror); subsequent runs pass
 * `updated_since` and only walk the delta, pruning anything the registry
 * reports `deleted`.
 */
export async function refreshOfficialCache(
  env: FederationEnv,
  opts: { timeoutMs?: number } = {}
): Promise<RefreshResult> {
  const cacheDir = resolveCacheDir(env);
  const meta = readSourceMeta(cacheDir, 'official');
  const existing = readSourceCache(cacheDir, 'official');
  const byId = new Map(existing.map((item) => [item.id, item] as const));

  const syncedAt = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let pruned = 0;

  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_BOOTSTRAP_PAGES; page++) {
      const { items, nextCursor } = await fetchOfficialPage(
        {
          limit: PAGE_SIZE,
          cursor,
          version: 'latest',
          updatedSince: meta.lastSyncAt
        },
        { timeoutMs: opts.timeoutMs },
        env
      );

      for (const item of items) {
        if (item.officialStatus === 'deleted') {
          if (byId.delete(item.id)) pruned++;
          continue;
        }
        if (byId.has(item.id)) updated++;
        else added++;
        byId.set(item.id, item);
      }

      if (!nextCursor || items.length === 0) break;
      cursor = nextCursor;
    }
  } catch (err) {
    return {
      source: 'official',
      added,
      updated,
      pruned,
      total: byId.size,
      syncedAt: meta.lastSyncAt ?? syncedAt,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  const nextIds = new Set(byId.keys());
  const prunedItems = existing.filter((item) => !nextIds.has(item.id));
  const merged = Array.from(byId.values());
  writeSourceCache(cacheDir, 'official', merged);
  writeSourceMeta(cacheDir, 'official', { lastSyncAt: syncedAt });
  const storeError = persistSourceIndex(env, merged, prunedItems, syncedAt);

  return { source: 'official', added, updated, pruned, total: merged.length, syncedAt, storeError };
}
