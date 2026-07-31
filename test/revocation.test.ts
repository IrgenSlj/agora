import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { acquire } from '../src/acquire';
import type { RevocationEntry, RevocationFeed } from '../src/model/revocation';
import type { FetchLike } from '../src/retry';
import {
  checkRevocations,
  feedCachePath,
  readCachedFeed,
  refreshFeed
} from '../src/revocation/client';
import { signFeed, signingPayload, verifyFeed } from '../src/revocation/feed';
import {
  compareVersions,
  isBlocking,
  matchRevocations,
  purlPatternMatches,
  versionInRange
} from '../src/revocation/match';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY_ID = 'agora-feed-test';
const KEYS = { [KEY_ID]: PUBLIC_PEM };

function entry(overrides: Partial<RevocationEntry> = {}): RevocationEntry {
  return {
    id: 'AGR-2026-0007',
    purl_pattern: 'pkg:npm/postmark-mcp',
    versions: '<=1.0.16',
    reason: 'credential-exfiltration',
    severity: 'critical',
    refs: ['https://example.com/advisory'],
    added_at: '2026-07-01T00:00:00.000Z',
    ...overrides
  };
}

function makeFeed(version = 42, entries: RevocationEntry[] = [entry()]): RevocationFeed {
  return signFeed(
    {
      feed_version: version,
      generated_at: '2026-07-06T00:00:00.000Z',
      key_id: KEY_ID,
      entries
    },
    PRIVATE_PEM
  );
}

describe('feed signing and verification', () => {
  test('a correctly signed feed verifies', () => {
    const verdict = verifyFeed(makeFeed(), { keys: KEYS });
    expect(verdict.status).toBe('valid');
  });

  test('the signature covers the entries — tampering is caught', () => {
    const feed = makeFeed();
    const tampered = {
      ...feed,
      entries: [entry({ id: 'AGR-2026-9999', purl_pattern: 'pkg:npm/something-else' })]
    };
    const verdict = verifyFeed(tampered, { keys: KEYS });
    expect(verdict.status).toBe('invalid-signature');
  });

  test('the signature covers the version counter too', () => {
    const feed = makeFeed(42);
    const verdict = verifyFeed({ ...feed, feed_version: 99 }, { keys: KEYS });
    expect(verdict.status).toBe('invalid-signature');
  });

  test('a feed signed by an unpinned key is unverifiable, not invalid', () => {
    // The distinction matters: "I do not know this key" is a configuration
    // gap, "this signature is wrong" is an attack.
    const verdict = verifyFeed(makeFeed(), { keys: { 'some-other-key': PUBLIC_PEM } });
    expect(verdict.status).toBe('unverifiable');
  });

  test('with no pinned keys at all, feeds are unverifiable and say why', () => {
    const verdict = verifyFeed(makeFeed(), { keys: {} });
    expect(verdict.status).toBe('unverifiable');
    if (verdict.status === 'unverifiable') {
      expect(verdict.reason).toContain('no feed-signing key');
    }
  });

  test('a malformed document is rejected before any crypto runs', () => {
    expect(verifyFeed({ nonsense: true }, { keys: KEYS }).status).toBe('malformed');
  });

  test('signingPayload excludes the signature field', () => {
    const feed = makeFeed();
    expect(signingPayload(feed)).not.toContain(feed.signature);
  });
});

describe('anti-rollback', () => {
  test('refuses a feed that is not newer than the cached one', () => {
    const verdict = verifyFeed(makeFeed(41), { keys: KEYS, cachedVersion: 42 });
    expect(verdict.status).toBe('rolled-back');
  });

  test('refuses a replay of the exact same version', () => {
    expect(verifyFeed(makeFeed(42), { keys: KEYS, cachedVersion: 42 }).status).toBe('rolled-back');
  });

  test('accepts a strictly newer feed', () => {
    expect(verifyFeed(makeFeed(43), { keys: KEYS, cachedVersion: 42 }).status).toBe('valid');
  });

  test('rollback is checked only after the signature holds', () => {
    // An unsigned document's version number is not evidence of anything, so a
    // forged "version 9999" must not be reported as a rollback (which would
    // read as benign) — it is an invalid signature.
    const forged = { ...makeFeed(9999), signature: Buffer.from('nope').toString('base64') };
    expect(verifyFeed(forged, { keys: KEYS, cachedVersion: 42 }).status).toBe('invalid-signature');
  });
});

describe('version range matching', () => {
  test('compares dotted versions numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  test('handles <= ranges', () => {
    expect(versionInRange('1.0.16', '<=1.0.16')).toBe(true);
    expect(versionInRange('1.0.17', '<=1.0.16')).toBe(false);
  });

  test('ANDs multiple clauses', () => {
    expect(versionInRange('1.5.0', '>=1.2 <1.9')).toBe(true);
    expect(versionInRange('1.9.1', '>=1.2 <1.9')).toBe(false);
  });

  test('an absent range covers every version', () => {
    expect(versionInRange('99.0.0', undefined)).toBe(true);
  });

  test('an unparseable range matches rather than silently letting it through', () => {
    // Failing open on a revocation would leave someone running a package known
    // to be harmful; failing closed only costs a warning.
    expect(versionInRange('1.0.0', '^~weird')).toBe(true);
  });
});

describe('purl pattern matching', () => {
  test('a version-less pattern covers every version', () => {
    expect(purlPatternMatches('pkg:npm/postmark-mcp', 'pkg:npm/postmark-mcp@1.0.16')).toBe(true);
  });

  test('does not match a different package', () => {
    expect(purlPatternMatches('pkg:npm/postmark-mcp', 'pkg:npm/other-mcp@1.0.0')).toBe(false);
  });

  test('respects the namespace of a scoped package', () => {
    expect(purlPatternMatches('pkg:npm/%40scope/thing', 'pkg:npm/%40scope/thing@1.0.0')).toBe(true);
    expect(purlPatternMatches('pkg:npm/%40other/thing', 'pkg:npm/%40scope/thing@1.0.0')).toBe(
      false
    );
  });

  test('does not match across ecosystems', () => {
    expect(purlPatternMatches('pkg:npm/thing', 'pkg:pypi/thing@1.0.0')).toBe(false);
  });
});

describe('matchRevocations', () => {
  test('matches a revoked version inside the range', () => {
    const matches = matchRevocations([entry()], 'pkg:npm/postmark-mcp@1.0.16');
    expect(matches).toHaveLength(1);
    expect(isBlocking(matches[0]!.entry)).toBe(true);
  });

  test('does not match a version outside the range', () => {
    expect(matchRevocations([entry()], 'pkg:npm/postmark-mcp@1.0.17')).toHaveLength(0);
  });

  test('advisory severity does not block', () => {
    const matches = matchRevocations(
      [entry({ severity: 'advisory' })],
      'pkg:npm/postmark-mcp@1.0.1'
    );
    expect(matches).toHaveLength(1);
    expect(isBlocking(matches[0]!.entry)).toBe(false);
  });
});

describe('client cache and refresh', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agora-revoke-'));
  });

  function fetcherFor(document: unknown, status = 200): FetchLike {
    return async () =>
      new Response(JSON.stringify(document), {
        status,
        headers: { 'content-type': 'application/json' }
      });
  }

  test('a valid feed is fetched and cached', async () => {
    const outcome = await refreshFeed({
      dataDir,
      fetcher: fetcherFor(makeFeed(42)),
      keys: KEYS,
      force: true
    });

    expect(outcome.status).toBe('updated');
    expect(readCachedFeed(dataDir)?.feed.feed_version).toBe(42);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('a rejected feed leaves the existing cache intact', async () => {
    await refreshFeed({ dataDir, fetcher: fetcherFor(makeFeed(42)), keys: KEYS, force: true });
    const outcome = await refreshFeed({
      dataDir,
      fetcher: fetcherFor(makeFeed(41)),
      keys: KEYS,
      force: true
    });

    expect(outcome.status).toBe('rejected');
    expect(readCachedFeed(dataDir)?.feed.feed_version).toBe(42);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('a network failure never throws and never clears the cache', async () => {
    await refreshFeed({ dataDir, fetcher: fetcherFor(makeFeed(42)), keys: KEYS, force: true });
    const outcome = await refreshFeed({
      dataDir,
      fetcher: (async () => {
        throw new Error('offline');
      }) as FetchLike,
      keys: KEYS,
      force: true
    });

    expect(outcome.status).toBe('unchanged');
    expect(readCachedFeed(dataDir)?.feed.feed_version).toBe(42);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('respects the refresh interval unless forced', async () => {
    await refreshFeed({ dataDir, fetcher: fetcherFor(makeFeed(42)), keys: KEYS, force: true });
    const outcome = await refreshFeed({
      dataDir,
      fetcher: fetcherFor(makeFeed(43)),
      keys: KEYS
    });
    expect(outcome.status).toBe('skipped');
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('a corrupt cache file reads as absent rather than throwing', () => {
    writeFileSync(feedCachePath(dataDir), '{ not json', 'utf8');
    expect(readCachedFeed(dataDir)).toBeNull();
    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe('checkRevocations', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'agora-revoke-check-'));
    await refreshFeed({
      dataDir,
      fetcher: (async () =>
        new Response(JSON.stringify(makeFeed(42)), { status: 200 })) as FetchLike,
      keys: KEYS,
      force: true
    });
  });

  test('reports a blocking match for a revoked artifact', () => {
    const status = checkRevocations(dataDir, ['pkg:npm/postmark-mcp@1.0.16']);
    expect(status.blocked).toBe(true);
    expect(status.matches).toHaveLength(1);
    expect(status.unknown).toBe(false);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('a clean artifact is not blocked', () => {
    const status = checkRevocations(dataDir, ['pkg:npm/some-other-server@2.0.0']);
    expect(status.blocked).toBe(false);
    expect(status.matches).toHaveLength(0);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('with no cache, the bundled feed still answers — that is the point of bundling', () => {
    // This test used to assert `unknown: true` for an empty data dir, which was
    // correct when the only source was a fetched cache. A feed now ships inside
    // the package, so a user who has never been online still gets every
    // revocation known at the time they installed. `unknown` is now reserved
    // for a build with no bundled feed at all, i.e. a broken install.
    const empty = mkdtempSync(join(tmpdir(), 'agora-revoke-empty-'));
    const status = checkRevocations(empty, ['pkg:npm/postmark-mcp@1.0.16']);

    expect(status.unknown).toBe(false);
    expect(status.origins).toContain('bundled');
    // postmark-mcp is not in the real feed, so this specific purl is clean.
    expect(status.blocked).toBe(false);
    rmSync(empty, { recursive: true, force: true });
  });

  test('a known-vulnerable version is blocked with no network and no cache', () => {
    // The end-to-end claim: offline, first run, revocation applies.
    const empty = mkdtempSync(join(tmpdir(), 'agora-revoke-offline-'));
    const status = checkRevocations(empty, ['pkg:npm/mcp-server-kubernetes@2.0.0']);

    expect(status.blocked).toBe(true);
    expect(status.matches.length).toBeGreaterThan(0);
    rmSync(empty, { recursive: true, force: true });
  });

  test('an unpinned version is reported but does not block', () => {
    // Three of the most-used MCP servers carry a fixed CVE. Blocking every
    // install of them because the purl has no version would make Agora wrong
    // far more often than right — so an unconfirmed match warns instead.
    const empty = mkdtempSync(join(tmpdir(), 'agora-revoke-unpinned-'));
    const status = checkRevocations(empty, ['pkg:npm/mcp-server-kubernetes']);

    expect(status.matches.length).toBeGreaterThan(0);
    expect(status.matches.every((m) => m.confirmed)).toBe(false);
    expect(status.blocked).toBe(false);
    rmSync(empty, { recursive: true, force: true });
  });

  test('flags a cache older than the staleness window', () => {
    const cached = JSON.parse(readFileSync(feedCachePath(dataDir), 'utf8'));
    cached.fetchedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(feedCachePath(dataDir), JSON.stringify(cached), 'utf8');

    const status = checkRevocations(dataDir, ['pkg:npm/postmark-mcp@1.0.16']);
    expect(status.stale).toBe(true);
    expect(status.blocked).toBe(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('sorts blocking matches ahead of advisories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-revoke-sort-'));
    const feed = makeFeed(7, [
      entry({ id: 'A', severity: 'advisory', purl_pattern: 'pkg:npm/thing', versions: undefined }),
      entry({ id: 'B', severity: 'critical', purl_pattern: 'pkg:npm/thing', versions: undefined })
    ]);
    await refreshFeed({
      dataDir: dir,
      fetcher: (async () => new Response(JSON.stringify(feed), { status: 200 })) as FetchLike,
      keys: KEYS,
      force: true
    });

    const status = checkRevocations(dir, ['pkg:npm/thing@1.0.0']);
    expect(status.matches[0]!.entry.id).toBe('B');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the acquire gate refuses a revoked artifact', () => {
  test('a critical revocation blocks the install before anything is written', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-revoke-acquire-'));
    const configPath = join(dataDir, 'opencode.json');

    // mcp-filesystem ships @modelcontextprotocol/server-filesystem in the
    // bundled catalog; revoke exactly that.
    const feed = makeFeed(1, [
      entry({
        id: 'AGR-2026-0001',
        purl_pattern: 'pkg:npm/%40modelcontextprotocol/server-filesystem',
        versions: undefined,
        severity: 'critical',
        reason: 'test-revocation'
      })
    ]);
    await refreshFeed({
      dataDir,
      fetcher: (async () => new Response(JSON.stringify(feed), { status: 200 })) as FetchLike,
      keys: KEYS,
      force: true
    });

    const result = await acquire({
      query: 'mcp-filesystem',
      configPath,
      dataDir,
      acceptWarnings: true,
      scanOptions: { offline: true },
      deps: { fetchFederatedItem: async () => null }
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('revoked');
    expect(result.reason).toContain('AGR-2026-0001');
    // Nothing may have been written.
    expect(existsSync(configPath)).toBe(false);

    rmSync(dataDir, { recursive: true, force: true });
  });

  test('an advisory revocation does not block', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-revoke-advisory-'));
    const configPath = join(dataDir, 'opencode.json');

    const feed = makeFeed(1, [
      entry({
        id: 'AGR-2026-0002',
        purl_pattern: 'pkg:npm/%40modelcontextprotocol/server-filesystem',
        versions: undefined,
        severity: 'advisory'
      })
    ]);
    await refreshFeed({
      dataDir,
      fetcher: (async () => new Response(JSON.stringify(feed), { status: 200 })) as FetchLike,
      keys: KEYS,
      force: true
    });

    const result = await acquire({
      query: 'mcp-filesystem',
      configPath,
      dataDir,
      acceptWarnings: true,
      scanOptions: { offline: true },
      deps: { fetchFederatedItem: async () => null }
    });

    expect(result.status).not.toBe('blocked');
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('with no feed cached, acquire proceeds — absence of data is not a block', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-revoke-nofeed-'));
    const configPath = join(dataDir, 'opencode.json');

    const result = await acquire({
      query: 'mcp-filesystem',
      configPath,
      dataDir,
      acceptWarnings: true,
      scanOptions: { offline: true },
      deps: { fetchFederatedItem: async () => null }
    });

    expect(result.status).not.toBe('blocked');
    rmSync(dataDir, { recursive: true, force: true });
  });
});
