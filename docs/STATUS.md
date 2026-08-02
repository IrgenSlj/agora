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
| Cedar policy | Partial | Engine, linting, CLI, baseline, and acquire integration exist | One mandatory authorization service for acquire/install/apply/sync/update/approve and plugin paths |
| Revocation and OSV audit | Partial | Bundled OSV-derived feed and additive monotonic merge work; `audit` covers configured MCP packages | Preserve feed origin/freshness in verdicts and independently validate network-added hard blocks |
| Stack management | Live with limits | Host adapters, plan/apply, atomic host-config writes, freeze, sync, drift and quarantine work | Round-trip-preserving edits of existing `agora.toml`; central gate for every write |
| Portable environment configuration | Live | `freeze` emits `env_from` references, never copied host environment values; plan/apply resolve locally and fail before writing when missing | Secret scanning for manually authored literal values and sensitive command/URL material |
| Lockfile and evidence store | Partial | Models, SQLite/CAS primitives, lock verification, and schema generation exist | Acquisition does not yet create/update `agora.lock` or persist the complete evidence chain |
| Evidence export | Partial | Bundle/envelope generation and explicit `not_established` reporting exist | Resolve subjects from the lock/store and validate each predicate payload against its named schema |
| Agent-facing MCP | Transitional | `agora mcp` exposes search, status, plan, and a gated acquire tool | Replace agent-controlled writes with `request_install`; make approval cross a real human-consent boundary |
| Serve | Planned/partial | Install-intent records and `agora approve` exist | Unified policy-filtered MCP surface: search, evidence, policy check, install request |
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

## Known high-priority gaps

1. Mutation commands do not yet share one mandatory gate.
2. Agent MCP calls can still reach a write path by supplying confirmation flags.
3. Acquire does not atomically produce the artifact digest, evidence records, and lockfile entry.
4. Export predicates are not yet checked against their predicate-specific schemas.
5. Existing `agora.toml` files are parsed and reconstructed rather than edited with full
   comment/unknown-key preservation.
6. Release CI does not yet build, pack, install, and smoke-test the exact published artifact on all
   supported platforms.

## Verification snapshot

After the 2026-08-02 hardening session, typecheck, lint, build, and the full suite pass: 1,723 tests
passed with one skipped. Each development session must refresh this snapshot in
[`DEVELOPMENT.md`](./DEVELOPMENT.md) after running the applicable gates.
