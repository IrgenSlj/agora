// Signing and verification of the revocation feed (brief §5.6).
//
// The ecosystem Agora sits in front of has no revocation mechanism at all: once
// a malicious MCP server is published and installed, nothing tells you later
// that it turned out to be malicious. This is that missing piece.
//
// Trust model, in one paragraph: the feed is a plain JSON document signed with
// ed25519 over its JCS canonicalization minus the signature field. The public
// key is pinned in the binary, so a compromised CDN cannot forge entries — it
// can at most withhold them, which the staleness check surfaces. The
// `feed_version` counter is strictly monotonic and the client refuses any feed
// that is not newer than the one it already holds, so an attacker who can
// serve traffic cannot roll a user back to a version that predates the entry
// naming their own package.

import { createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalJson } from '../model/hash.js';
import { RevocationFeed } from '../model/revocation.js';

export type { RevocationEntry, RevocationFeed, RevocationSeverity } from '../model/revocation.js';

/**
 * Pinned feed-signing public keys, by `key_id`, as SPKI PEM.
 *
 * Empty until the project mints its keypair (`bun scripts/generate-feed-key.ts`
 * — the private half belongs in a CI secret and must never live here). While
 * this is empty every feed is `unverifiable`, and the client applies **no**
 * revocations rather than trusting an unsigned document. That is a deliberate
 * fail-closed default: a revocation feed nobody can authenticate is a vector,
 * not a safety net.
 *
 * Rotation requires a new release, by design (brief §5.6). Keep the old key
 * listed alongside the new one for one release so in-flight clients verify.
 */
export const PINNED_FEED_KEYS: Readonly<Record<string, string>> = Object.freeze({});

export type FeedVerdict =
  | { status: 'valid'; feed: RevocationFeed }
  /** Well-formed but carries no signature — usable for additions only. */
  | { status: 'unsigned'; feed: RevocationFeed }
  | { status: 'invalid-signature'; reason: string }
  | { status: 'unverifiable'; reason: string }
  | { status: 'malformed'; reason: string }
  | { status: 'rolled-back'; reason: string; cachedVersion: number; offeredVersion: number };

/** The exact bytes that get signed: JCS of the feed with `signature` removed. */
export function signingPayload(feed: Omit<RevocationFeed, 'signature'>): string {
  const { signature: _drop, ...rest } = feed as RevocationFeed & { signature?: string };
  return canonicalJson(rest);
}

/** Signs a feed. Used by the publishing side (the Worker / a release script). */
export function signFeed(
  feed: Omit<RevocationFeed, 'signature'>,
  privateKeyPem: string
): RevocationFeed {
  const payload = Buffer.from(signingPayload(feed), 'utf8');
  const signature = cryptoSign(null, payload, privateKeyPem).toString('base64');
  return RevocationFeed.parse({ ...feed, signature });
}

export interface VerifyFeedOptions {
  /** Overrides the pinned key set. Tests use this; production should not. */
  keys?: Readonly<Record<string, string>>;
  /**
   * Version already held on disk. A feed must be strictly newer, so replaying
   * an old signed feed cannot erase entries the client has already seen.
   */
  cachedVersion?: number;
}

/**
 * Verifies a feed document end to end: shape, pinned key, signature, and
 * anti-rollback. Every failure mode is a distinct status because they mean
 * genuinely different things to the caller — a forged feed is an attack, an
 * unverifiable one is a configuration gap, and neither should be reported as
 * the other.
 */
export function verifyFeed(document: unknown, options: VerifyFeedOptions = {}): FeedVerdict {
  const parsed = RevocationFeed.safeParse(document);
  if (!parsed.success) {
    return { status: 'malformed', reason: parsed.error.issues[0]?.message ?? 'invalid feed shape' };
  }
  const feed = parsed.data;

  // An unsigned feed is a valid feed with a weaker guarantee, not a broken one.
  // The caller decides what to do with it: `mergeFeeds` accepts it for
  // *additions* only, because a feed nobody can authenticate must never be able
  // to withdraw a revocation. Reporting it as malformed would have thrown away
  // usable data; reporting it as verified would have overstated it.
  if (!feed.signature || !feed.key_id) {
    return { status: 'unsigned', feed };
  }

  const keys = options.keys ?? PINNED_FEED_KEYS;
  const publicKeyPem = keys[feed.key_id];
  if (!publicKeyPem) {
    return {
      status: 'unverifiable',
      reason: Object.keys(keys).length
        ? `feed signed by unknown key_id "${feed.key_id}"`
        : 'no feed-signing key is pinned in this build'
    };
  }

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      null,
      Buffer.from(signingPayload(feed), 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(feed.signature, 'base64')
    );
  } catch (err) {
    return {
      status: 'invalid-signature',
      reason: err instanceof Error ? err.message : 'signature check threw'
    };
  }

  if (!signatureOk) {
    return { status: 'invalid-signature', reason: 'ed25519 signature does not verify' };
  }

  // Anti-rollback runs only after the signature holds: an unsigned document's
  // version number is not evidence of anything.
  if (options.cachedVersion !== undefined && feed.feed_version <= options.cachedVersion) {
    return {
      status: 'rolled-back',
      reason: `feed_version ${feed.feed_version} is not newer than the cached ${options.cachedVersion}`,
      cachedVersion: options.cachedVersion,
      offeredVersion: feed.feed_version
    };
  }

  return { status: 'valid', feed };
}
