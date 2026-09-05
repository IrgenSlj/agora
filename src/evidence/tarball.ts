// Resolving the immutable bytes — the last piece of the acquisition transaction.
//
// Every other hash in `agora.lock` describes what a server *says*: its tool
// names, its descriptions, its input schemas. Those catch a rug-pull that
// arrives through a published update, which is the common case. None of them
// catch the rarer and worse one — the bytes behind a version you already pinned
// changing underneath you. npm treats published versions as immutable, so if
// the tarball for `pkg@1.2.3` ever hashes differently, something happened that
// is not supposed to be possible, and that is exactly the class of event this
// product exists to notice.
//
// Two things are recorded, and they are not the same thing:
//
//   sha256          — Agora downloaded the bytes and hashed them. Evidence.
//   integrity_match — whether those bytes agree with npm's own published
//                     `dist.integrity`. Corroboration from a second source.
//
// A mismatch between them is a serious finding: the registry is serving bytes
// that disagree with the metadata it publishes about them. It is reported, never
// silently preferred one way or the other.

import { createHash } from 'node:crypto';
import type { FetchLike } from '../fetch.js';
import { parsePurl } from '../model/purl.js';
import { fetchWithRetry } from '../retry.js';

export type TarballResolution =
  | {
      status: 'resolved';
      sha256: string;
      bytes: number;
      url: string;
      /**
       * True when npm's published `dist.integrity` agrees with the bytes we
       * hashed, false when it disagrees, undefined when npm published none.
       *
       * `false` is the alarming one and must never be flattened into
       * "unverified" alongside `undefined`.
       */
      integrityMatch: boolean | undefined;
    }
  | {
      status: 'unavailable';
      /** Why, in words a user can act on. Never rendered as a clean result. */
      reason: string;
    };

export interface ResolveTarballOptions {
  fetcher?: FetchLike;
  registry?: string;
  timeoutMs?: number;
  /** Refuse downloads beyond this size. Default 64 MiB. */
  maxBytes?: number;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** npm encodes a scope's slash but keeps the `@`. */
function encodeName(name: string): string {
  return encodeURIComponent(name).replace('%40', '@').replace('%2F', '/');
}

/** `sha512-<base64>` → the same digest we can compute, for comparison. */
function integrityMatches(integrity: string | undefined, body: Uint8Array): boolean | undefined {
  if (!integrity) return undefined;
  // Subresource-integrity strings may carry several space-separated hashes.
  for (const entry of integrity.trim().split(/\s+/)) {
    const [algorithm, expected] = entry.split('-', 2);
    if (!algorithm || !expected) continue;
    if (algorithm !== 'sha512' && algorithm !== 'sha384' && algorithm !== 'sha256') continue;
    const actual = createHash(algorithm).update(body).digest('base64');
    if (actual === expected) return true;
  }
  return false;
}

/**
 * Download and hash the tarball for an exact npm purl.
 *
 * Returns `unavailable` rather than throwing for every network and shape
 * failure. A lockfile entry with no tarball hash is honest; one whose hash is
 * missing because an error was swallowed into a default is not, so the reason
 * always travels with the absence.
 */
export async function resolveTarball(
  purl: string,
  opts: ResolveTarballOptions = {}
): Promise<TarballResolution> {
  let name: string;
  let version: string | undefined;
  try {
    const parsed = parsePurl(purl);
    if (parsed.type !== 'npm') {
      return { status: 'unavailable', reason: `not an npm package (${parsed.type})` };
    }
    name = parsed.namespace ? `${parsed.namespace}/${parsed.name}` : parsed.name;
    version = parsed.version;
  } catch (e) {
    return {
      status: 'unavailable',
      reason: `unparseable purl: ${e instanceof Error ? e.message : String(e)}`
    };
  }

  // Without an exact version there is no immutable artifact to hash — a range
  // resolves to different bytes on different days, which is the opposite of a
  // baseline.
  if (!version) return { status: 'unavailable', reason: 'no version pinned' };

  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetcher = opts.fetcher ?? globalThis.fetch;

  let tarballUrl: string;
  let publishedIntegrity: string | undefined;
  try {
    const metaRes = await fetchWithRetry(
      `${registry}/${encodeName(name)}/${encodeURIComponent(version)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
      { maxRetries: 2, fetcher }
    );
    if (metaRes.status === 404) {
      return { status: 'unavailable', reason: `${name}@${version} not found on the registry` };
    }
    if (!metaRes.ok) {
      return { status: 'unavailable', reason: `registry returned HTTP ${metaRes.status}` };
    }
    const meta = (await metaRes.json()) as {
      dist?: { tarball?: string; integrity?: string };
    };
    if (!meta.dist?.tarball) {
      return { status: 'unavailable', reason: 'registry metadata declares no tarball' };
    }
    tarballUrl = meta.dist.tarball;
    publishedIntegrity = meta.dist.integrity;
  } catch (e) {
    return {
      status: 'unavailable',
      reason: `registry unreachable: ${e instanceof Error ? e.message : String(e)}`
    };
  }

  try {
    const res = await fetchWithRetry(
      tarballUrl,
      { signal: AbortSignal.timeout(timeoutMs) },
      { maxRetries: 2, fetcher }
    );
    if (!res.ok) {
      return { status: 'unavailable', reason: `tarball fetch returned HTTP ${res.status}` };
    }

    // Declared length is a hint, not a promise, so the real bytes are checked
    // too — a lock command must not be a way to make someone download an
    // unbounded response.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > maxBytes) {
      return {
        status: 'unavailable',
        reason: `tarball declares ${declared} bytes, over the limit`
      };
    }

    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength > maxBytes) {
      return {
        status: 'unavailable',
        reason: `tarball is ${body.byteLength} bytes, over the limit`
      };
    }

    return {
      status: 'resolved',
      sha256: createHash('sha256').update(body).digest('hex'),
      bytes: body.byteLength,
      url: tarballUrl,
      integrityMatch: integrityMatches(publishedIntegrity, body)
    };
  } catch (e) {
    return {
      status: 'unavailable',
      reason: `tarball unreachable: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}
