// Fetching, caching and querying the revocation feed.
//
// Local-first, like everything else here: the cached feed is the source of
// truth for a lookup, the network only ever refreshes it, and no command
// blocks on the network to answer "is this revoked?". A user offline on a
// plane still gets every revocation Agora knew about the last time it looked,
// and is told how old that knowledge is rather than being quietly reassured.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import type { FetchLike } from '../live/types.js';
import type { RevocationEntry, RevocationFeed } from '../model/revocation.js';
import { verifyFeed } from './feed.js';
import { isBlocking, matchRevocations, type RevocationMatch } from './match.js';

export const DEFAULT_FEED_URL = 'https://api.agora-hub.dev/v1/revocations';

/** Refresh at most this often; the feed is polled opportunistically, never on a hot path. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A cached feed older than this is reported as stale — silence is not safety. */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedFeed {
  feed: RevocationFeed;
  fetchedAt: string;
}

export function feedCachePath(dataDir: string): string {
  return join(dataDir, 'revocations.json');
}

export function readCachedFeed(dataDir: string): CachedFeed | null {
  const path = feedCachePath(dataDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedFeed;
    if (!parsed?.feed) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedFeed(dataDir: string, cached: CachedFeed): void {
  const path = feedCachePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, `${JSON.stringify(cached, null, 2)}\n`);
}

export type RefreshOutcome =
  | { status: 'updated'; feedVersion: number; entryCount: number }
  | { status: 'unchanged'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'rejected'; reason: string };

export interface RefreshOptions {
  dataDir: string;
  fetcher?: FetchLike;
  feedUrl?: string;
  /** Ignore the 6h interval — `agora doctor` and explicit refreshes pass this. */
  force?: boolean;
  now?: () => Date;
  keys?: Readonly<Record<string, string>>;
}

/**
 * Pulls the feed if it is due, verifies it, and caches it on success.
 *
 * Never throws: a revocation refresh failing must not take down the command
 * the user actually ran. Every outcome is reported, and a rejected feed leaves
 * the previous cache untouched.
 */
export async function refreshFeed(options: RefreshOptions): Promise<RefreshOutcome> {
  const now = options.now?.() ?? new Date();
  const cached = readCachedFeed(options.dataDir);

  if (!options.force && cached) {
    const age = now.getTime() - new Date(cached.fetchedAt).getTime();
    if (age < REFRESH_INTERVAL_MS) {
      return { status: 'skipped', reason: 'checked recently' };
    }
  }

  const fetcher = options.fetcher ?? globalThis.fetch;
  let document: unknown;
  try {
    const res = await fetcher(options.feedUrl ?? DEFAULT_FEED_URL, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return { status: 'unchanged', reason: `feed responded ${res.status}` };
    document = await res.json();
  } catch (err) {
    return {
      status: 'unchanged',
      reason: err instanceof Error ? err.message : 'feed unreachable'
    };
  }

  const verdict = verifyFeed(document, {
    keys: options.keys,
    cachedVersion: cached?.feed.feed_version
  });

  if (verdict.status !== 'valid') {
    return { status: 'rejected', reason: `${verdict.status}: ${verdict.reason}` };
  }

  writeCachedFeed(options.dataDir, {
    feed: verdict.feed,
    fetchedAt: now.toISOString()
  });

  return {
    status: 'updated',
    feedVersion: verdict.feed.feed_version,
    entryCount: verdict.feed.entries.length
  };
}

export interface RevocationStatus {
  /** Entries covering the queried purls, blocking ones first. */
  matches: RevocationMatch[];
  /** True when any match is critical or high. */
  blocked: boolean;
  /** Age of the cached feed in ms; undefined when nothing is cached. */
  ageMs?: number;
  /** True when there is no cached feed at all — an absence of data, not a clean bill. */
  unknown: boolean;
  /** True when the cache is older than STALE_AFTER_MS. */
  stale: boolean;
  feedVersion?: number;
}

/**
 * Looks up purls against the cached feed. Offline-safe and synchronous — this
 * is what gets called on the install path, so it must never wait on a network.
 */
export function checkRevocations(
  dataDir: string,
  purls: readonly string[],
  now: Date = new Date()
): RevocationStatus {
  const cached = readCachedFeed(dataDir);
  if (!cached) {
    return { matches: [], blocked: false, unknown: true, stale: false };
  }

  const ageMs = now.getTime() - new Date(cached.fetchedAt).getTime();
  const entries: readonly RevocationEntry[] = cached.feed.entries;

  const matches = purls
    .flatMap((purl) => matchRevocations(entries, purl))
    .sort((a, b) => Number(isBlocking(b.entry)) - Number(isBlocking(a.entry)));

  return {
    matches,
    blocked: matches.some((m) => isBlocking(m.entry)),
    ageMs,
    unknown: false,
    stale: ageMs > STALE_AFTER_MS,
    feedVersion: cached.feed.feed_version
  };
}
