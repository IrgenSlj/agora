# The revocation feed

The ecosystem Agora sits in front of has no revocation mechanism. Once a malicious MCP server is
published and installed, nothing tells you later that it turned out to be malicious. This directory
is that missing piece, and it is deliberately the least impressive infrastructure in the project: a
signed JSON file in a git repository.

- **`entries.json`** — the source of truth. Hand-edited. This is the file you change.
- **`revocations.json`** — generated. Signed by `scripts/sign-feed.ts` in CI and committed by it.
  Never edit it directly; it carries a signature over exact bytes, and any manual change
  invalidates it for every client.

Clients read `revocations.json` straight from `raw.githubusercontent.com`. There is no API, no
domain, and no account that can lapse. The signature is what makes that safe: the bytes are
verified against a public key pinned in the binary, so the host is untrusted by construction.
GitHub can withhold the feed — which the staleness check surfaces — but cannot forge one.

## Publishing a revocation

1. Add an entry to `entries.json`:

   ```json
   {
     "id": "AGR-2026-0001",
     "purl_pattern": "pkg:npm/example-malicious",
     "versions": "<=1.0.16",
     "reason": "credential-exfiltration",
     "severity": "critical",
     "refs": ["https://github.com/advisories/GHSA-..."],
     "added_at": "2026-07-30T12:00:00Z"
   }
   ```

   `critical` and `high` block an `agora acquire`. `advisory` is reported and does not block.
   Omitting `versions` covers every version of the package.

2. Commit and push to `main`. `.github/workflows/publish-feed.yml` signs the feed, bumps
   `feed_version`, and commits the result. That is the entire publishing act.

`feed_version` is strictly monotonic and clients refuse any feed that is not newer than the one
they hold, so an attacker who can serve traffic cannot roll a user back past the entry naming
their package.

## Do I need a signing key?

**No.** Revocations apply today, unsigned. The integrity comes from two places instead:

1. **The bundled copy.** `revocations.json` ships inside the npm package, so it is covered by that
   package's own provenance attestation. Nothing extra to sign.
2. **Monotonic merge.** A copy fetched over the network may *add* entries and may never *remove*
   one (`src/revocation/merge.ts`). So the attack that actually matters — an entry quietly going
   missing so a user installs something known-malicious — is impossible regardless of who controls
   the host.

A signature was the original design and it bought less than it cost: the key would have lived as a
secret in this same repository, so anyone able to rewrite the feed could usually sign it too.

The one thing a signature *would* buy is the ability to **withdraw** an entry between releases —
useful if an advisory is retracted. Today a withdrawal waits for the next release, which is
fail-closed and fine. The ed25519 path stays implemented and tested for when that changes:

```
bun scripts/generate-feed-key.ts
```

1. **Public half** → `PINNED_FEED_KEYS` in `src/revocation/feed.ts`. Ships in the next release.
   Clients trust exactly what is pinned in the binary they installed, so rotating the key requires
   cutting a release. That is the design, not a wart.
2. **Private half** → the `AGORA_FEED_SIGNING_KEY` repository secret. It must never exist anywhere
   a person can copy it from, including your shell history.
3. Optionally set the `AGORA_FEED_KEY_ID` repository *variable* to match the key id you chose;
   it defaults to `agora-feed-<year>-a`.

Rotation: add the new key alongside the old one, release, wait for clients to update, then drop
the old entry in the release after.

A signed feed becomes *authoritative* rather than additive — it may remove entries as well as add
them. That is the whole difference.

## Where the entries come from

Nobody writes them. `scripts/sync-feed.ts` queries [OSV.dev](https://osv.dev) for every MCP server
in the catalog and rewrites `entries.json`; `.github/workflows/sync-feed.yml` runs it daily. OSV
is free, needs no API key, and is keyed by purl — the identifier Agora already uses.

This covers a surface nothing else does: MCP servers are spawned commands in host configs, never
declared dependencies, so `npm audit`, Dependabot and Snyk cannot see them at all.

An empty result is still reported as "nothing published", never as "safe" — and an unreachable OSV
never empties the feed, because entries for packages that could not be checked are carried over.
