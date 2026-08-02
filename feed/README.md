# The revocation feed

Agora covers a surface ordinary dependency scanners miss: MCP servers are spawned from host
configuration and may appear in no `package.json`. The revocation feed turns published OSV
advisories for those packages into offline, local-first gate evidence.

Current behavior and limitations are tracked in [`../docs/STATUS.md`](../docs/STATUS.md); ordered
hardening work is `REV-001` in [`../docs/NEXT.md`](../docs/NEXT.md).

## Files

- `entries.json` — generated source entries derived from OSV results.
- `revocations.json` — packaged feed consumed by clients. It ships with `agora-hub` and is the
  bundled baseline.

Do not hand-curate advisory counts or findings. `scripts/sync-feed.ts` queries OSV for catalog MCP
package purls and rewrites the source data; `.github/workflows/sync-feed.yml` runs it on schedule.
If an upstream package cannot be checked, previous entries are carried forward rather than erased.

## Trust model

The active feed is not signed.

1. The bundled copy ships inside the npm artifact and is the offline baseline.
2. A fetched copy is merged monotonically by `src/revocation/merge.ts`: it may add entries, but may
   not remove, weaken, or outrank a bundled entry.

This prevents a fetched copy from suppressing a known bundled advisory. It does **not** make every
network-added entry authentic: an attacker able to alter the fetched feed could add noise or a false
hard block. Until network additions are independently confirmed, origin must remain visible in the
verdict. That work is tracked as `REV-001`.

The older ed25519 verification implementation remains in the repository for a future design that
needs authenticated withdrawals between releases. No key should be generated or configured for the
current additive-only design.

## Severity and matching

- `critical` and `high` block acquisition only when the installed/resolved version is confirmed to
  fall in the affected range, or when the entry covers all versions.
- `advisory` is reported and does not block.
- Malware entries without a version range cover every version.
- A package match with an unknown version is a warning/unknown applicability, not a confirmed block.
- No matching published advisory means “no known matching advisory,” never “safe.”
- An unavailable refresh or unaddressable server is unknown/not-checkable, never clean.

## Refresh workflow

```bash
bun scripts/sync-feed.ts
bun run test test/revocation-merge.test.ts test/revocation-client.test.ts
```

The workflow must fail loudly on malformed OSV responses, schema errors, or implausible destructive
changes. It must never replace a usable bundled baseline with an empty feed merely because a network
source failed.

## Future authenticated withdrawals

A signed authoritative feed would be allowed to remove entries as well as add them, which is useful
when an advisory is retracted between package releases. If that becomes necessary, define the key
custody and compromise model first, pin public keys in a release, keep rollback protection, and
document how clients distinguish authoritative withdrawals from additive unsigned updates.
