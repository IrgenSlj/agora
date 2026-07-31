import { describe, expect, test } from 'vitest';
import type { RevocationEntry, RevocationFeed } from '../src/model/revocation';
import { type FeedSource, mergeFeeds } from '../src/revocation/merge';

// The merge rule is what makes an unsigned feed safe to use, so these tests are
// the security argument. The attack they exist to prevent is **suppression**:
// an entry quietly going missing, so a user installs something known-malicious
// and Agora says nothing.

const entry = (id: string, extra: Partial<RevocationEntry> = {}): RevocationEntry => ({
  id,
  purl_pattern: 'pkg:npm/target',
  reason: 'malicious-package',
  severity: 'critical',
  refs: [`https://osv.dev/vulnerability/${id}`],
  added_at: '2026-01-01T00:00:00Z',
  ...extra
});

const feed = (entries: RevocationEntry[], feed_version = 1): RevocationFeed => ({
  feed_version,
  generated_at: '2026-01-01T00:00:00Z',
  entries
});

const source = (origin: FeedSource['origin'], entries: RevocationEntry[], v = 1): FeedSource => ({
  origin,
  feed: feed(entries, v)
});

describe('monotonic merge', () => {
  test('a fetched feed CANNOT remove a bundled entry — the whole point', () => {
    // The attack: a compromised host serves a feed with the entry naming their
    // package quietly absent. If this ever passes an empty result through, the
    // unsigned feed design is unsafe and must be reverted.
    const merged = mergeFeeds([
      source('bundled', [entry('MAL-1')]),
      source('fetched', []) // attacker suppresses it
    ]);

    expect(merged.entries.map((m) => m.entry.id)).toEqual(['MAL-1']);
  });

  test('a fetched feed CAN add an entry the bundle has not seen', () => {
    // The legitimate case: an advisory published after the last release.
    const merged = mergeFeeds([
      source('bundled', [entry('MAL-1')]),
      source('fetched', [entry('MAL-1'), entry('MAL-2')])
    ]);

    expect(merged.entries.map((m) => m.entry.id).sort()).toEqual(['MAL-1', 'MAL-2']);
    expect(merged.entries.find((m) => m.entry.id === 'MAL-2')?.origin).toBe('fetched');
  });

  test('a fetched feed cannot downgrade a bundled entry to a weaker severity', () => {
    // Suppression by another name: leave the entry present but turn `critical`
    // into `advisory` so it stops blocking. The bundled version must win.
    const merged = mergeFeeds([
      source('bundled', [entry('MAL-1', { severity: 'critical' })]),
      source('fetched', [entry('MAL-1', { severity: 'advisory' })])
    ]);

    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0]?.entry.severity).toBe('critical');
    expect(merged.entries[0]?.origin).toBe('bundled');
  });

  test('a fetched entry cannot be laundered into looking authoritative', () => {
    const merged = mergeFeeds([source('bundled', []), source('fetched', [entry('MAL-9')])]);
    expect(merged.entries[0]?.origin).toBe('fetched');
  });

  test('argument order cannot weaken the result', () => {
    // A caller passing sources in the wrong sequence must not be able to let a
    // fetched feed overwrite a bundled one.
    const strong = entry('MAL-1', { severity: 'critical' });
    const weak = entry('MAL-1', { severity: 'advisory' });

    for (const order of [
      [source('fetched', [weak]), source('bundled', [strong])],
      [source('bundled', [strong]), source('fetched', [weak])]
    ]) {
      const merged = mergeFeeds(order);
      expect(merged.entries[0]?.entry.severity).toBe('critical');
    }
  });

  test('a signed feed is authoritative and MAY remove an entry', () => {
    // The one thing a signature buys that bundling does not: the ability to
    // withdraw a revocation between releases, e.g. a retracted advisory.
    const merged = mergeFeeds([source('signed', [entry('MAL-2')])]);
    expect(merged.entries.map((m) => m.entry.id)).toEqual(['MAL-2']);
    expect(merged.hasAuthoritative).toBe(true);
  });

  test('the same revocation for different packages is not deduped', () => {
    // One advisory can name several packages. Keying on id alone would drop
    // all but the first, silently un-revoking the rest.
    const merged = mergeFeeds([
      source('bundled', [
        entry('GHSA-1', { purl_pattern: 'pkg:npm/a' }),
        entry('GHSA-1', { purl_pattern: 'pkg:npm/b' })
      ])
    ]);
    expect(merged.entries).toHaveLength(2);
  });

  test('a fetched-only feed is reported as non-authoritative', () => {
    // Callers need to distinguish "this came with the package I installed" from
    // "a network told me this", because those are different strengths.
    const merged = mergeFeeds([source('fetched', [entry('MAL-1')])]);
    expect(merged.hasAuthoritative).toBe(false);
    expect(merged.entries[0]?.origin).toBe('fetched');
  });

  test('feed version comes from authoritative sources only', () => {
    // Otherwise a fetched feed could claim a huge version and win anti-rollback
    // against every future legitimate one.
    const merged = mergeFeeds([source('bundled', [], 3), source('fetched', [], 9999)]);
    expect(merged.feedVersion).toBe(3);
  });
});
