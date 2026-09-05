import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { resolveTarball } from '../src/evidence/tarball';

// The tarball hash is the only signal that catches the bytes behind an already
// pinned version changing. npm treats published versions as immutable, so a
// later mismatch is an event that is not supposed to be possible — which makes
// it worth being careful about what this does and does not claim.

const BODY = new TextEncoder().encode('pretend tarball bytes');
const SHA256 = createHash('sha256').update(BODY).digest('hex');
const SHA512_B64 = createHash('sha512').update(BODY).digest('base64');

const PURL = 'pkg:npm/%40scope/server@1.2.3';

function registry(opts: { integrity?: string; body?: Uint8Array } = {}) {
  const body = opts.body ?? BODY;
  return ((url: string) => {
    if (url.includes('/-/')) {
      return Promise.resolve(new Response(body.slice().buffer as ArrayBuffer, { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          dist: {
            tarball: 'https://registry.npmjs.org/@scope/server/-/server-1.2.3.tgz',
            ...(opts.integrity ? { integrity: opts.integrity } : {})
          }
        }),
        { status: 200 }
      )
    );
  }) as never;
}

describe('resolveTarball', () => {
  test('hashes the bytes the registry actually served', async () => {
    const result = await resolveTarball(PURL, { fetcher: registry() });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.sha256).toBe(SHA256);
    expect(result.bytes).toBe(BODY.byteLength);
  });

  test('confirms agreement with npm’s published integrity', async () => {
    const result = await resolveTarball(PURL, {
      fetcher: registry({ integrity: `sha512-${SHA512_B64}` })
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.integrityMatch).toBe(true);
  });

  test('reports disagreement as false, never as merely unverified', async () => {
    // The serious case: the registry is serving bytes that disagree with the
    // metadata it publishes about them. Flattening this into the same value as
    // "npm published no integrity" would hide the only alarming outcome.
    const result = await resolveTarball(PURL, {
      fetcher: registry({ integrity: 'sha512-obviouslyWrongDigestValue==' })
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.integrityMatch).toBe(false);
  });

  test('absent integrity stays undefined, which is not a mismatch', async () => {
    const result = await resolveTarball(PURL, { fetcher: registry() });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.integrityMatch).toBeUndefined();
  });

  test('refuses a purl with no version — a range has no immutable bytes', async () => {
    const result = await resolveTarball('pkg:npm/%40scope/server', { fetcher: registry() });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('no version pinned');
  });

  test('refuses a non-npm purl rather than guessing a registry', async () => {
    const result = await resolveTarball('pkg:github/owner/repo@abc123', { fetcher: registry() });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('not an npm package');
  });

  test('a 404 is unavailable with a reason, not a thrown error', async () => {
    const fetcher = (() => Promise.resolve(new Response('', { status: 404 }))) as never;
    const result = await resolveTarball(PURL, { fetcher });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('not found');
  });

  test('an oversized tarball is refused rather than downloaded', async () => {
    // A lock command must not be a way to make someone download an unbounded
    // response just because a registry declared one.
    const big = new Uint8Array(2048);
    const result = await resolveTarball(PURL, {
      fetcher: registry({ body: big }),
      maxBytes: 1024
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('over the limit');
  });
});
