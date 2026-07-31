// Fetching, caching and querying the revocation feed.
//
// Local-first, like everything else here: the cached feed is the source of
// truth for a lookup, the network only ever refreshes it, and no command
// blocks on the network to answer "is this revoked?". A user offline on a
// plane still gets every revocation Agora knew about the last time it looked,
// and is told how old that knowledge is rather than being quietly reassured.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../atomic-write.js';
import type { FetchLike } from '../fetch.js';
import type { RevocationEntry, RevocationFeed } from '../model/revocation.js';
import { RevocationFeed as RevocationFeedSchema } from '../model/revocation.js';
import { verifyFeed } from './feed.js';
import { isBlockingMatch, matchRevocations, type RevocationMatch } from './match.js';
import { type FeedSource, mergeFeeds } from './merge.js';

/**
 * Where the signed feed is served from.
 *
 * A file in this repository, not an API. `api.agora-hub.dev` was the original
 * plan and blocked the whole plane for weeks on a domain that was never
 * registered and a Worker that was never deployed — for a document that is
 * static, signed, and read a few times a day per user. Serving it from raw
 * githubusercontent costs nothing, has no account to lapse, and removes the
 * only piece of Agora that would have failed when someone else's server did.
 *
 * What makes an untrusted host safe here is not a signature but the merge rule
 * (`./merge.ts`): this copy is *additive only*. It can contribute revocations
 * the bundled feed has not seen yet, and it can never remove one. So the worst
 * a compromised host achieves is adding noise — loud, visible, recoverable —
 * rather than the attack that would actually matter, which is making a real
 * revocation quietly disappear.
 */
export const DEFAULT_FEED_URL =
  'https://raw.githubusercontent.com/IrgenSlj/agora/main/feed/revocations.json';

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

const HERE = dirname(fileURLToPath(import.meta.url));

/** The feed shipped inside the package, in both src and dist layouts. */
export function bundledFeedPath(): string {
  const candidates = [
    join(HERE, '..', 'revocations.json'), // dist/revocations.json
    join(HERE, '..', '..', 'feed', 'revocations.json') // repo checkout
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * Reads the feed that shipped with this build.
 *
 * This is the floor the whole design rests on: it arrives inside the npm
 * tarball, so it is covered by that package's provenance attestation, and a
 * fetched feed can add to it but never take from it. No signature of its own is
 * needed or expected — the package's own signature already covers these bytes.
 */
export function readBundledFeed(): RevocationFeed | null {
  const path = bundledFeedPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = RevocationFeedSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

  // `unsigned` is accepted here and constrained later: `checkRevocations` merges
  // it as an additive source, so it can contribute revocations but never remove
  // one. Rejecting it outright is what kept this plane inert — it meant no feed
  // applied at all unless a key existed.
  if (verdict.status !== 'valid' && verdict.status !== 'unsigned') {
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
  /** Which sources contributed — `bundled` alone still means revocations apply. */
  origins?: string[];
}

/**
 * Looks up purls against the merged feed. Offline-safe and synchronous — this
 * is what gets called on the install path, so it must never wait on a network.
 *
 * Sources are merged monotonically (`./merge.ts`): the feed bundled with this
 * build is the authoritative floor, and a fetched feed may add to it but never
 * remove from it. That is what lets an unsigned feed be used at all.
 */
export function checkRevocations(
  dataDir: string,
  purls: readonly string[],
  now: Date = new Date()
): RevocationStatus {
  const cached = readCachedFeed(dataDir);
  const bundled = readBundledFeed();

  const sources: FeedSource[] = [];
  if (bundled) sources.push({ origin: 'bundled', feed: bundled });
  if (cached) {
    // A cached feed that verified against a pinned key was stored as such; with
    // no key pinned it is `fetched`, and therefore additive only.
    const verdict = verifyFeed(cached.feed);
    sources.push({ origin: verdict.status === 'valid' ? 'signed' : 'fetched', feed: cached.feed });
  }

  // Nothing at all is genuinely unknown. Note this is now reachable only when
  // the bundled feed is missing too, which means a broken install.
  if (!sources.length) {
    return { matches: [], blocked: false, unknown: true, stale: false };
  }

  const merged = mergeFeeds(sources);
  const ageMs = cached ? now.getTime() - new Date(cached.fetchedAt).getTime() : undefined;
  const entries: readonly RevocationEntry[] = merged.entries.map((m) => m.entry);

  const matches = purls
    .flatMap((purl) => matchRevocations(entries, purl))
    .sort((a, b) => Number(isBlockingMatch(b)) - Number(isBlockingMatch(a)));

  return {
    matches,
    blocked: matches.some(isBlockingMatch),
    ...(ageMs !== undefined ? { ageMs } : {}),
    unknown: false,
    // Staleness is a property of the *fetched* copy. A build running purely on
    // its bundled feed is not stale — it is exactly as current as the release
    // the user installed, and saying otherwise would nag about a state they
    // cannot fix without an update they may not want.
    stale: ageMs !== undefined && ageMs > STALE_AFTER_MS,
    ...(merged.feedVersion !== undefined ? { feedVersion: merged.feedVersion } : {}),
    origins: [...new Set(merged.origins)]
  };
}
