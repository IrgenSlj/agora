# The agent-tooling revocation feed — v1

**A list of agent-tooling artifacts that are known to be bad, in a shape any tool can consume.**

Machine-readable schema: [`schemas/revocation-feed.v1.json`](../schemas/revocation-feed.v1.json).
Live feed: `https://raw.githubusercontent.com/IrgenSlj/agora/main/feed/revocations.json`.

This document is for people building something else — a gateway, a drift detector, a client, a
registry. Nothing here requires Agora. The feed is a JSON file over HTTP with a published schema,
and it is meant to be read by tools that have no relationship with the project that publishes it.

## Why this exists

The MCP ecosystem now has detectors and gateways in reasonable supply. Several projects fingerprint
tool definitions and alert when they change; several proxies enforce policy at call time. All of
them eventually reach the same question, and none of them can answer it:

> This artifact changed, or is about to be installed. **Is it known to be bad?**

There is no CVE-equivalent for agent tooling. OSV covers vulnerable *code* in package ecosystems,
which is necessary and not sufficient: MCP servers are spawned from host configuration and appear in
no `package.json`, so nothing that walks a dependency tree sees them at all. And the failure modes
that matter most here are not code vulnerabilities. A tool description rewritten to exfiltrate, a
repository handed to a new owner, a name one character from a popular one — none of those are CVEs
and all of them are the thing you needed to know.

This feed is an attempt at that missing list.

## What an entry means, and what it does not

An entry is a claim that a specific artifact, at specific versions, is known to be bad, with
references so the claim can be checked rather than taken on faith.

**Presence means known-bad. Absence means nothing at all.** This is the single most important
property to preserve when you build on it. An artifact not in the feed has not been cleared — it has
not been reported. A consumer that renders "not in the feed" as "safe", "clean", or a green check is
misrepresenting the data, and will eventually tell someone an unreported malicious package is fine.
Render absence as *unknown*.

## Shape

```json
{
  "feed_version": 12,
  "generated_at": "2026-09-06T11:23:14.757Z",
  "key_id": "agora-feed-2026",
  "signature": "base64…",
  "entries": [
    {
      "id": "GHSA-4xqg-gf5c-ghwq",
      "purl_pattern": "pkg:npm/%40modelcontextprotocol/server-filesystem",
      "versions": "<=0.6.2",
      "reason": "path-traversal",
      "summary": "@modelcontextprotocol/server-filesystem vulnerability allows for path traversal",
      "severity": "high",
      "refs": ["https://osv.dev/vulnerability/GHSA-4xqg-gf5c-ghwq"],
      "added_at": "2026-08-02T06:15:00.000Z"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `feed_version` | yes | Strictly monotonic counter. Never decreases. See *Rollback* below. |
| `generated_at` | yes | RFC 3339. When this document was produced, not when its newest entry was added. |
| `key_id` | no | Which key signed it, when signed. |
| `signature` | no | Base64 ed25519 over `JCS(feed without signature)` — RFC 8785 canonicalization. |
| `entries` | yes | The list. May be empty; an empty list is a valid feed and still means "nothing reported". |

### Entry fields

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable identifier. Upstream ids are reused where they exist (`GHSA-…`, `MAL-…`, `CVE-…`); entries originating here use `AGR-YYYY-NNNN`. |
| `purl_pattern` | yes | [package-url](https://github.com/package-url/purl-spec) identifying the artifact. Percent-encoded scope, no version. |
| `versions` | no | Range the claim applies to (`<=1.0.16`, `>=2.0.0 <2.4.0`). **Absent means every version.** |
| `reason` | yes | Machine-readable slug, not prose. See below. |
| `summary` | no | One-line human description from the upstream advisory, where it has one. Absent, never empty. |
| `severity` | yes | `critical`, `high`, or `advisory`. |
| `refs` | yes | URLs a human can follow to check the claim. Never empty. |
| `added_at` | yes | RFC 3339. When this entry entered the feed. |

Absent `versions` meaning *all versions* rather than *no versions* is deliberate and worth
implementing carefully: a malicious package is malicious in every version it was published under,
and defaulting the other way would silently un-revoke exactly the entries that matter most.

### Severity

Three levels, because the decision they drive has three answers.

- **`critical`** — the artifact is hostile, not merely flawed. Malware, credential exfiltration, a
  backdoor. Consumers should block.
- **`high`** — a serious vulnerability in an otherwise honest artifact. Consumers should block by
  default and allow an explicit, recorded override.
- **`advisory`** — report it, do not block. Lower-severity and unlabelled upstream advisories land
  here.

Unlabelled upstream data becomes `advisory`, never `high`. An over-broad advisory should cost
someone a warning; an over-narrow critical costs them a compromise, so the asymmetry runs that way
on purpose.

### `reason`

A slug, so consumers can branch on it without parsing English. Values currently emitted:

`malicious-package` · `credential-exfiltration` · `command-injection` · `path-traversal` ·
`prompt-injection` · `tool-poisoning` · `typosquat` · `sql-injection` · `ssrf` ·
`access-control` · `vulnerability`

`vulnerability` is the general case, and it is where every advisory that cannot be placed more
precisely lands. Classification is keyword matching over the upstream advisory text, which is crude
on purpose: a vague label misleads nobody, and a confident wrong one misleads a consumer that
branches on it.

Reserved but **not yet emitted**, listed so the vocabulary is stable when they arrive:
`rug-pull` · `ownership-transfer` · `abandoned`. These are the MCP-native classes that no
vulnerability database models, and they need an evidence pipeline that does not exist yet. Nothing
in the feed carries them today; a consumer should not wait for them.

The list grows. Treat an unrecognised `reason` as `vulnerability` rather than discarding the entry —
a consumer that drops entries it does not recognise fails open, which is the wrong direction for
this data.

## The merge rule

Consumers are expected to hold a **bundled baseline** (shipped with your artifact, covered by
whatever provenance your artifact has) and to fetch updates over the network. Merge them
**monotonically and additively**:

- A fetched feed **may add** entries.
- A fetched feed **may not remove** an entry present in the baseline.
- A fetched feed **may not weaken** an entry — `critical` cannot become `advisory`, and a version
  range cannot narrow.

This is what makes an unsigned feed over an untrusted transport safe to use at all. An attacker who
can rewrite what you fetch can add noise or a false block — annoying, visible, and recoverable. They
cannot suppress a revocation you already had, which is the attack that would actually hurt.

The corollary: **withdrawing an entry requires a signature.** If you accept withdrawals from an
unsigned feed you have given up the only property the merge rule was protecting.

### Rollback

`feed_version` is strictly monotonic. Reject a fetched feed whose `feed_version` is lower than the
one you already hold — that is a rollback attempt, replaying an older document to un-revoke
something. Compare versions, not timestamps; `generated_at` is informational.

## Freshness

Poll no more than every six hours. Advisories are published on human timescales, and a feed polled
every minute produces load rather than safety. Reference clients poll every 6h.

**Stale is not empty.** If the fetch fails, keep using the copy you have and surface its age. A
consumer that treats an unreachable feed as an empty one publishes a clean bill of health for every
artifact at the exact moment it can least justify one. Show the age; let the user decide.

## Coverage, honestly

The artifact universe is the official MCP registry, walked in full — roughly 13,000 servers, of
which about 3,300 ship an npm package that can be matched to advisory data. Servers that expose only
a remote endpoint, or that ship through a non-npm registry, are counted but cannot currently be
matched, and that gap is real.

Advisory data is derived from OSV, plus entries originating here for the MCP-native classes OSV does
not model. Where a walk or a lookup fails, existing entries are carried forward and the publishing
job fails loudly rather than shipping a shorter feed: an artifact that was never asked about is not
an artifact that came back clean.

## Reporting an artifact

Open an issue at <https://github.com/IrgenSlj/agora/issues> with the purl, the affected versions,
and a reference. Claims need evidence someone else can check — an entry whose `refs` nobody can
follow is an accusation, not a data point.

## Compatibility

`v1` is this document. Fields may be **added** without a version bump, so parse permissively and
ignore what you do not recognise. Removing a field, or changing what one means, requires `v2` at a
separate URL, with `v1` served unchanged for at least six months after.

## Licence

The feed data is MIT-licensed along with the rest of the repository. Redistribute it, mirror it,
embed it. If you mirror it, please preserve `generated_at` and `feed_version` so downstream
consumers can still tell how old their copy is and still detect a rollback.
