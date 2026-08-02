# Capability status

Last reviewed: 2026-08-02.

This is the authority on what the current source tree can prove. The locked product intent lives in
[`AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md), the strategic sequence in
[`ROADMAP.md`](../ROADMAP.md), and the actionable backlog in [`NEXT.md`](./NEXT.md).

State labels are deliberately strict:

- **Live** — wired into a user-facing path and covered by focused tests.
- **Partial** — useful implementation exists, but the full product guarantee is not enforced.
- **Planned** — design or scaffolding exists; users must not be told it works.
- **Retired** — intentionally removed and represented in `src/cli/retired.ts`.

## Current capabilities

| Plane or surface | State | What is true now | What remains |
|---|---|---|---|
| Federated search | Live | Multi-source adapters, purl-aware dedupe, offline cache, honest source status | Unify the older catalog/hub types around one artifact model; repair automated catalog refresh |
| Provenance | Live | Sigstore verification checks Fulcio, CT, Rekor, subject digest, and repository identity | Persist the result as part of one acquisition transaction |
| Schema and description drift | Live | Capability hashing, comparison, quarantine, and poisoning heuristics exist | Route every mutation through the same drift decision |
| Runtime observation | Live with limits | Byte-transparent MCP supervision records tool names/counts and sampled direct-process network peers; arguments/results are excluded | Descendant-process coverage and stronger platform backends; sampled data must never be described as complete behavior |
| Cedar policy and mutation gate | Live with limits | Engine, linting, CLI, baseline, complete mutation inventory, typed scan/revocation/Cedar/identity adapters, and central authorization on every artifact-installing command; no bypass flag remains | Give provenance/drift independent signals beyond their aggregate scan state |
| Revocation and OSV audit | Partial | Bundled OSV-derived feed and additive monotonic merge work; `audit` covers configured MCP packages | Preserve feed origin/freshness in verdicts and independently validate network-added hard blocks |
| Stack management | Live with limits | Host adapters, plan/apply, atomic host-config writes, freeze, sync, drift and quarantine work, and every apply/sync/update write passes the shared gate | Round-trip-preserving edits of existing `agora.toml` |
| Portable environment configuration | Live | `freeze` emits `env_from` references, never copied host environment values; plan/apply resolve locally and fail before writing when missing | Secret scanning for manually authored literal values and sensitive command/URL material |
| Lockfile and evidence store | Partial | Models, SQLite/CAS primitives, lock verification, and schema generation exist | Acquisition does not yet create/update `agora.lock` or persist the complete evidence chain |
| Evidence export | Partial | Bundle/envelope generation and explicit `not_established` reporting exist | Resolve subjects from the lock/store and validate each predicate payload against its named schema |
| Agent-facing MCP | Live with limits | `agora mcp` exposes search, status, plan, and acquire preview; confirmation creates only an evidence-bearing install intent and returns an approval command | Add first-class evidence/policy tools and a human-consent boundary an agent with shell access cannot self-assert |
| Serve | Partial | Install-intent records, the request service, and `agora approve` exist; agent requests cannot mutate the stack | Unified policy-filtered MCP surface and a strong out-of-band/host-native approval boundary |
| Shell, TUI, today/news, inference | Live | Retained product surfaces; inference is spawned locally | Keep functional and align trust-plane views; do not remove solely to reduce code size |
| OpenCode/Claude integrations | Partial | Adapters, plugin code, MCP registration, and integration command exist | Test the packed plugin path in real hosts and keep all agent-facing writes behind the gate |
| Pre-install sandbox backend | Planned | Runtime observation replaced it for current use; model leaves room for a future backend | Build only when a concrete policy need justifies it |

## Security invariants currently enforced

- Generated `agora.toml` files do not contain copied environment values.
- A missing `env_from` value fails before host configuration is changed.
- `lsof` sampling intersects PID and network filters with `-a`.
- A missing or failed sampler is recorded as unavailable, not as sampled with zero peers.
- Observation never persists MCP tool arguments, results, prompt text, or file contents.
- Unknown evidence remains unknown; absence is not rendered as a negative finding.
- Every active CLI, MCP, and plugin entry point has a mutation/effect/consent declaration checked
  against the actual registered surfaces.
- The shared authorization kernel denies agent-authorized host/project/manifest writes and treats
  missing required evidence as inconclusive.
- Human acquire consumes typed scan, revocation, and Cedar signals before its write.
- Agent-facing acquire confirmation writes only a pending intent. Failed or inconclusive required
  evidence writes no intent; no agent parameter can write host config or `agora.toml`.
- Approving a request installs only the reviewed artifact: resolution is by exact id, and a changed
  package or version fails a required identity signal instead of installing.
- The approval path evaluates the project's Cedar policy files, exactly as a direct acquire does.
- No flag skips the gate. `--skip-scan` records an explicit unknown; only `--accept-risk` clears it,
  and never a deny — a revocation or a policy rule cannot be waived from the command line.
- An agent cannot accept risk on a human's behalf, and no plugin tool can write host configuration.
- A refused install or try-run leaves the filesystem byte-identical, including the `--save` case
  where two files would have been written.
- Every mutation that proceeded on an accepted unknown is recorded in `gate-audit.jsonl` (a local
  accountability log, not signed evidence).
- `apply`/`sync` evaluate revocation and Cedar for every manifest entry, local or remote, and match
  a revocation against the exact version pinned in the launch command.
- `update` evaluates the version it is moving to, not the one already installed.
- `integrate` holds Agora's own package to the same gate before installing it into a harness.
- Quarantining a drifted server is never blocked by the gate: disabling is the fail-safe direction.

## Known high-priority gaps

1. Terminal `agora approve` is not a strong consent boundary when an agent also has shell access.
2. Acquire does not atomically produce the artifact digest, evidence records, and lockfile entry.
3. Export predicates are not yet checked against their predicate-specific schemas.
4. Existing `agora.toml` files are parsed and reconstructed rather than edited with full
   comment/unknown-key preservation.
5. Release CI does not yet build, pack, install, and smoke-test the exact published artifact on all
   supported platforms.

## Verification snapshot

After the third 2026-08-02 hardening session, typecheck, lint, build, and the full suite pass: 1,775
tests passed with one skipped. Each development session must refresh this snapshot in
[`DEVELOPMENT.md`](./DEVELOPMENT.md) after running the applicable gates.
