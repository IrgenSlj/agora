// Signs feed/entries.json into feed/revocations.json — the publishing half of
// the revocation plane (brief §5.6).
//
//   AGORA_FEED_SIGNING_KEY="$(cat key.pem)" bun scripts/sign-feed.ts
//
// The client half has been shipped and tested since S4; this is what gives it
// something to read. The feed is a static signed file served from this repo,
// so publishing a revocation is a commit — no domain, no server, no account.
//
// Two invariants this script exists to hold:
//
//   - feed_version is strictly monotonic. The client refuses any feed that is
//     not newer than the one it holds, so an attacker who can serve traffic
//     cannot roll a user back past the entry naming their package. Rewinding
//     the counter here would strand every client that saw the higher number.
//   - The signature covers JCS(feed sans signature) — the same bytes verifyFeed
//     reconstructs. Signing anything else produces a feed that verifies nowhere.

import { createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../src/atomic-write.js';
import { RevocationEntry, type RevocationFeed } from '../src/model/revocation.js';
import { signFeed, verifyFeed } from '../src/revocation/feed.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES_PATH = join(REPO, 'feed', 'entries.json');
const FEED_PATH = join(REPO, 'feed', 'revocations.json');

function fail(message: string): never {
  console.error(`sign-feed: ${message}`);
  process.exit(1);
}

const privateKey = process.env.AGORA_FEED_SIGNING_KEY;
if (!privateKey) {
  fail(
    'AGORA_FEED_SIGNING_KEY is not set.\n' +
      '  Mint a keypair with `bun scripts/generate-feed-key.ts`, pin the public\n' +
      '  half in src/revocation/feed.ts, and store the private half as the\n' +
      '  AGORA_FEED_SIGNING_KEY repository secret.'
  );
}

const keyId = process.env.AGORA_FEED_KEY_ID ?? `agora-feed-${new Date().getFullYear()}-a`;

// --- entries ---------------------------------------------------------------

let source: { entries?: unknown };
try {
  source = JSON.parse(readFileSync(ENTRIES_PATH, 'utf8'));
} catch (err) {
  fail(`could not read feed/entries.json: ${err instanceof Error ? err.message : err}`);
}

const parsed = RevocationEntry.array().safeParse(source.entries ?? []);
if (!parsed.success) {
  fail(`feed/entries.json is not a valid entry list:\n${parsed.error.message}`);
}
const entries = parsed.data;

// An id used twice makes "which revocation is this?" unanswerable, and the
// client dedupes by nothing — it would report the same purl twice.
const duplicateIds = [
  ...new Set(entries.map((e) => e.id).filter((id, i, all) => all.indexOf(id) !== i))
];
if (duplicateIds.length) fail(`duplicate entry ids: ${duplicateIds.join(', ')}`);

// --- version ---------------------------------------------------------------

let previousVersion = 0;
if (existsSync(FEED_PATH)) {
  try {
    const prior = JSON.parse(readFileSync(FEED_PATH, 'utf8')) as RevocationFeed;
    if (typeof prior.feed_version === 'number') previousVersion = prior.feed_version;
  } catch {
    // A corrupt existing feed must not silently reset the counter to 1 and
    // strand every client holding a higher version.
    fail('feed/revocations.json exists but is unreadable — refusing to guess the version');
  }
}

const feed = signFeed(
  {
    feed_version: previousVersion + 1,
    generated_at: new Date().toISOString(),
    key_id: keyId,
    entries
  },
  privateKey
);

// --- verify what we are about to publish -----------------------------------

// Sign then verify with the same code path the client uses. A feed that fails
// here would fail on every machine that fetched it, and the failure mode is
// silent: clients reject it and keep applying nothing.
const verdict = verifyFeed(feed, {
  keys: { [keyId]: derivePublicKey(privateKey) },
  cachedVersion: previousVersion || undefined
});
if (verdict.status !== 'valid') {
  fail(`refusing to publish a feed that does not verify: ${verdict.status} — ${verdict.reason}`);
}

atomicWriteFile(FEED_PATH, `${JSON.stringify(feed, null, 2)}\n`);

console.log(
  `signed feed v${feed.feed_version} — ${entries.length} ` +
    `${entries.length === 1 ? 'entry' : 'entries'}, key_id ${keyId}`
);

function derivePublicKey(privatePem: string): string {
  return createPublicKey(createPrivateKey(privatePem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}
