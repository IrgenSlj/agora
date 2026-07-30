import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { RevocationEntry } from '../src/model/revocation';
import { DEFAULT_FEED_URL } from '../src/revocation/client';
import { signFeed, verifyFeed } from '../src/revocation/feed';

// The client half of revocation has been tested since S4. This covers the
// publishing half: the hand-edited source file, and the guarantee that what
// scripts/sign-feed.ts produces is what the client will accept.

const REPO = join(__dirname, '..');

describe('feed/entries.json', () => {
  const source = JSON.parse(readFileSync(join(REPO, 'feed', 'entries.json'), 'utf8'));

  test('every entry is a valid RevocationEntry', () => {
    // This file is hand-edited under time pressure — a malicious package is
    // in the wild and someone is typing fast. A malformed entry must fail
    // here, not at signing time and certainly not on a user's machine.
    const parsed = RevocationEntry.array().safeParse(source.entries);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  test('entry ids are unique', () => {
    const ids = (source.entries as { id: string }[]).map((e) => e.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

describe('feed distribution', () => {
  test('the default feed URL is a file in this repo, not a service', () => {
    // api.agora-hub.dev blocked this plane for weeks on an unregistered domain
    // and an undeployed Worker, for a document that is static and signed. The
    // signature is what makes the host untrusted by construction, so the host
    // may as well be one that already exists and costs nothing.
    expect(DEFAULT_FEED_URL).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
    expect(DEFAULT_FEED_URL).toContain('/feed/revocations.json');
    expect(DEFAULT_FEED_URL).not.toContain('agora-hub.dev');
  });
});

describe('scripts/sign-feed.ts', () => {
  const key = generateKeyPairSync('ed25519');
  const privatePem = key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  test('what the signer produces is what the client accepts', () => {
    // Signer and verifier must reconstruct byte-identical payloads. If they
    // ever diverge the failure is silent: every client rejects the feed and
    // goes on applying no revocations, which looks exactly like "nothing is
    // revoked".
    const feed = signFeed(
      {
        feed_version: 1,
        generated_at: new Date().toISOString(),
        key_id: 'test-key',
        entries: [
          {
            id: 'AGR-2026-0001',
            purl_pattern: 'pkg:npm/example-malicious',
            reason: 'credential-exfiltration',
            severity: 'critical',
            refs: ['https://example.com/advisory'],
            added_at: new Date().toISOString()
          }
        ]
      },
      privatePem
    );

    expect(verifyFeed(feed, { keys: { 'test-key': publicPem } }).status).toBe('valid');
  });

  test('refuses to sign without a key rather than emitting an unsigned feed', () => {
    // A feed that cannot be authenticated is a vector, not a safety net, so the
    // script must bail before it writes anything.
    //
    // Asserted against the source rather than by running it. Spawning the
    // signer from a test starves a vitest fork worker — it took unrelated
    // suites from 13s to 17min and timed out a different three files on each
    // run — and a spawn that inherited a real AGORA_FEED_SIGNING_KEY would
    // overwrite the actual published feed from a test run.
    const source = readFileSync(join(REPO, 'scripts', 'sign-feed.ts'), 'utf8');
    const guardAt = source.indexOf('AGORA_FEED_SIGNING_KEY');
    const writeAt = source.indexOf('atomicWriteFile(FEED_PATH');

    expect(guardAt, 'the signer must read AGORA_FEED_SIGNING_KEY').toBeGreaterThan(-1);
    expect(writeAt, 'the signer must write the feed').toBeGreaterThan(-1);
    expect(guardAt, 'the key check must come before the write').toBeLessThan(writeAt);
    expect(source).toMatch(/process\.exit\(1\)/);
  });
});
