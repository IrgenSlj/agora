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
- `agora.toml` — portable human intent; generated manifests use `env_from` references and never copy
  host environment values.
- `agora.lock` — intended committed machine truth. Verification exists; automatic creation/update
  from acquisition is still partial and tracked in `docs/NEXT.md`.
- Legacy `~/.config/agora/*` state files may still exist while S1/S2 retire pre-v2 surfaces.

Config and state writes must be surgical and atomic via `src/atomic-write.ts`. Secrets belong in
the local process environment, settings/state, or host-native secret stores. `env_from` resolves
names locally during plan/apply and fails before writing when a value is missing. Manually authored
literal environment values remain backward-readable but must not contain credentials.

## Gate Semantics

Today's gate combines heuristics, Sigstore evidence, revocation checks, and Cedar on the primary
acquire path. Not every mutation command uses the full combination yet; central gate unification is
a current security task, so local `apply`/`sync`/`update` must not be described as fully governed.
It is not a sandbox and does not formally verify code.

**"Passed the gate" means "no known red flags," not "safe."**

The v2 build is integrating these into one mandatory authorization service:

- S1: zod schemas, JSON Schema export, purl handling, SQLite/CAS, `agora lock verify`.
- S3/S6: provenance, schema/description hashing, runtime observation (which replaced the
  sandboxed `vet`), and exportable DSSE attestations.
- S4/S5: revocation feed (OSV-generated, bundled, monotonic) and Cedar policy enforcement.

## Execution Safety

- Every config-writing command must support preview/plan separation or an explicit dry run.
- The intended boundary is request-only agent access and human-authorized writes. Current MCP/plugin
  confirmation paths are transitional and must be treated as security-sensitive until AGENT-001/002
  in `docs/NEXT.md` are complete.
- Network failures must degrade honestly; do not fabricate source counts or trust results.
- Runtime observation records MCP tool names/counts and sampled network peers only. Sampling is
  direct-process, polling-based, and fallible; unavailable or unsampled is never “contacted nothing.”
- Exit codes follow the v2 contract: `0` ok, `1` policy forbid / drift / revocation hit, `2`
  usage, `3` network, `4` sandbox unavailable.

## Known Transitional Risks

The v1 catalog surface (19 commands including auth, community, and account features) was removed in
v0.7.0. Legacy `~/.config/agora/*` state files may still exist and can be safely deleted.

The remaining high-priority risks are maintained in [`docs/STATUS.md`](./docs/STATUS.md): incomplete
gate coverage, agent-callable confirmation, a partial acquire/lock transaction, predicate/schema
mismatch, and non-round-trip `agora.toml` rewriting.
