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

## One-time setup (owner)

Until a key is pinned, **every feed reads `unverifiable` and no revocations apply.** That is a
deliberate fail-closed default — a feed nobody can authenticate is a vector, not a safety net —
but it does mean the plane is inert until these three steps happen:

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

## Why this is empty

No revocation has been published yet. An empty feed is the honest state — it is not a claim that
nothing in the ecosystem is malicious, and Agora reports an uncached or empty feed as *unknown*
rather than as a clean bill of health.
