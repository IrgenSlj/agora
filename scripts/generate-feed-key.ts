// Mints the ed25519 keypair that signs the revocation feed.
//
//   bun scripts/generate-feed-key.ts [key-id]
//
// Prints both halves and stops. Nothing is written to disk, because the
// private key must not end up in the repository, in your shell history file,
// or in a scratch file you forget about:
//
//   - PUBLIC half  → paste into PINNED_FEED_KEYS in src/revocation/feed.ts and
//                    ship it in a release. Clients trust exactly what is pinned
//                    in the binary they installed, so rotating the key requires
//                    cutting a new release — that is the design, not a wart.
//   - PRIVATE half → a CI secret (AGORA_FEED_SIGNING_KEY). It signs the feed in
//                    the publishing workflow and should never exist anywhere a
//                    person can copy it from.
//
// Rotation: add the new key alongside the old one, release, wait for clients to
// update, then drop the old entry in the release after.

import { generateKeyPairSync } from 'node:crypto';

const keyId = process.argv[2] ?? `agora-feed-${new Date().getFullYear()}-a`;

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();

console.log(`key_id: ${keyId}\n`);
console.log('── PUBLIC — pin this in src/revocation/feed.ts ──────────────────');
console.log(`
export const PINNED_FEED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  '${keyId}': \`${publicPem}\`
});
`);
console.log('── PRIVATE — store as the AGORA_FEED_SIGNING_KEY CI secret ──────');
console.log('── Do NOT commit it, and do not leave it in your terminal buffer ─\n');
console.log(privatePem);
console.log(
  '\nUntil a public key is pinned, every feed is treated as unverifiable and no\nrevocations are applied — a feed nobody can authenticate is a vector, not a\nsafety net.'
);
