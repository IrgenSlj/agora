# Security Policy

## Supported Versions

Agora is pre-1.0 and moving quickly against the locked v2 trust-plane brief.

| Version | Supported |
|---|---|
| 0.7.x | yes |
| 0.6.x | security fixes only when practical |
| < 0.6 | no |

## Reporting A Vulnerability

Do **not** open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/IrgenSlj/agora/security/advisories/new) with
a description, reproduction steps, affected commands, and impact. Expect a response within 48 hours.

## Current Security Model

Agora is local-first and has no hosted auth backend in the v2 direction. Core state is on disk:

- `~/.agora/agora.db` — SQLite evidence/catalog/store state (S1).
- `~/.agora/cas/<sha256>` — content-addressed artifact blobs (S1).
- `agora.toml` — portable human intent; never store credentials here.
- `agora.lock` — committed machine truth: exact artifacts, hashes, policy verdicts.
- Legacy `~/.config/agora/*` state files may still exist while S1/S2 retire pre-v2 surfaces.

Config and state writes must be surgical and atomic via `src/atomic-write.ts`. Secrets belong in
local settings/state or host-native secret stores, never in `agora.toml`.

## Gate Semantics

Today's live gate is heuristic (`src/scan.ts`, `src/acquire.ts`): description-injection checks,
permission/declaration checks, registry status, npm reachability, and tool-schema drift when a probe
baseline exists. It is not a sandbox and does not formally verify code.

**"Passed the gate" means "no known red flags," not "safe."**

The v2 build is replacing this with evidence and policy:

- S1: zod schemas, JSON Schema export, purl handling, SQLite/CAS, `agora lock verify`.
- S3/S6: provenance, schema/description hashing, runtime observation (which replaced the
  sandboxed `vet`), and exportable DSSE attestations.
- S4/S5: revocation feed (OSV-generated, bundled, monotonic) and Cedar policy enforcement.

## Execution Safety

- Every config-writing command must support preview/plan separation or an explicit dry run.
- Agents never get an ungated write path through plugins or MCP tools.
- Network failures must degrade honestly; do not fabricate source counts or trust results.
- Exit codes follow the v2 contract: `0` ok, `1` policy forbid / drift / revocation hit, `2`
  usage, `3` network, `4` sandbox unavailable.

## Known Transitional Risk

The v1 catalog surface (19 commands including auth, community, and account features) was removed in
v0.7.0. Legacy `~/.config/agora/*` state files may still exist and can be safely deleted.
