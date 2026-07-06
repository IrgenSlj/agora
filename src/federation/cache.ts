// Content-addressed (by item id) on-disk cache for federation sources, one
// JSONL file per source under `${AGORA_HOME}/federation/`. Mirrors the append
// pattern in src/hubs/cache.ts. Powers two things:
//   1. offline degradation — federatedSearch falls back to a source's last
//      good snapshot when the live fetch is unreachable (still labels the
//      status honestly; only the *items* come from cache).
//   2. `agora refresh` — official's `updated_since` incremental sync, which
//      also prunes entries the registry has tombstoned as `deleted`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAgoraDataDir } from '../state.js';
import { fetchOfficialPage } from './sources/official.js';
import type { FederatedItem, FederationEnv, SourceId } from './types.js';

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
  writeFileSync(path, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
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

  const merged = Array.from(byId.values());
  writeSourceCache(cacheDir, 'official', merged);
  writeSourceMeta(cacheDir, 'official', { lastSyncAt: syncedAt });

  return { source: 'official', added, updated, pruned, total: merged.length, syncedAt };
}
