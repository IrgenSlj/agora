# Architecture

This document captures *what Agora is* and the reasoning behind the shape of the code. For the
locked specification, see [`../AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md); for the phase-by-phase
execution plan and current status, see [`V2_EXECUTION_PLAN.md`](./V2_EXECUTION_PLAN.md) and
[`../ROADMAP.md`](../ROADMAP.md); for open external-API questions, see
[`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).

## What Agora is

`agora` is **the trust plane for agentic tooling** — it verifies where MCP servers and Agent
Skills come from, observes what they actually do, enforces user-defined policy over both, and
manages them across every host (OpenCode, Claude Code, Cursor, Windsurf).

It is a **customs office over federated registries**, never a competing catalog: it does not grow
its own catalog, it federates upstream registries (the official MCP Registry as canonical, then
Glama, PulseMCP, + skills sources) so its effective catalog is the union of all of them. It deals
in **evidence** — verifiable, inspectable attestations — never opaque numeric "trust scores." It
is host-neutral (OpenCode is one integration among four, not the identity) and local-first with no
hosted backend it depends on.

## The four planes

Everything in the codebase serves one of four planes:

### Federate (`src/federation/`) — live

Adapters behind a `RegistrySource`/`FederatedItem` contract normalize results from upstream
registries (the official MCP Registry, Glama, GitHub, HuggingFace, …), deduped and merged into one
search. `agora search`/`refresh` read from this. Target shape (brief §4): `src/federation/adapters/`
with per-source files plus `sync.ts` doing dedupe-by-purl and precedence — today's
`src/federation/sources/` + `index.ts` are the pre-migration form of this.

### Verify — evidence (`src/evidence/`) — planned, heuristic precursor live today

Not yet built: provenance verification (Sigstore / npm & GitHub attestations), schema/description
hashing with rug-pull drift detection, a sandboxed `vet` recording what a server actually
reads/writes/contacts, canary-token exfiltration detection — all emitted as in-toto/DSSE
attestations (brief §6). Today, `src/scan.ts` implements a heuristic precursor: injection-pattern
checks, permission-manifest diffs, and live-probe tool-schema drift, without sandboxing or signed
attestations.

### Gate — policy (`src/policy/`) — planned, heuristic gate live today

Not yet built: a real Cedar policy engine evaluated over evidence, plus a signed revocation feed
with anti-rollback (brief §7). Today, `agora acquire` (`src/acquire.ts`) is the safe
capability-acquisition gateway: `resolve → install plan → scan gate → config write`. `fail` blocks
the write and exits non-zero; `warn` requires `--accept-warnings`; `--dry-run` previews without
writing. **It is not a sandbox and does not execute or formally verify server code** — "passed the
gate" means *no known red flags*, not "safe," and that distinction is deliberate everywhere the
verdict is shown. This is what Agora *is*; this plane's code gets the most scrutiny.

### Manage (`src/stack/`) — live

One `ToolAdapter` per agent tool (opencode, Claude Code, Cursor, Windsurf) normalizes its MCP
config into a single `ConfiguredServer` shape. `agora installed` / `doctor [--probe]` read across
all of them; `agora.toml` is the portable, declarative profile; `plan`/`apply` (`sync` =
`plan && apply`) reconcile it into real config files surgically — every unrelated key is
preserved, writes are atomic (`src/atomic-write.ts`). S1 adds a committed `agora.lock` schema as
machine truth (brief §5.5) and a manifest-backed `agora lock verify`; planned: the full drift
producer in S3 and `agora serve` exposing Agora itself as an MCP server (brief §8).

## Supporting surfaces

- **CLI/TUI** (`src/cli/`) — command dispatch, the interactive shell, the prompter, and the
  full-screen TUI pages. The primary, standalone experience.
- **`agora mcp`** (`src/cli/mcp-server.ts`) — exposes the stack manager and catalog as MCP tools,
  so any MCP-capable harness can call Agora directly. Planned: `src/serve/`, the brief §8
  agent-facing server with policy-filtered discovery tools (`search_tools`, `get_evidence`,
  `check_policy`, `request_install`).
- **Thin plugins** (`src/plugin/`) — the OpenCode/Claude Code plugin registers explicit named
  tools (`agora_search`, `agora_acquire`, `agora_config`, …) plus lifecycle hooks
  (`tool.execute.before` for opt-in capability-gap suggestions, `experimental.session.compacting`
  for stack-aware context). The plugin never owns a write that bypasses the gate.
- **News** (`src/news/`) — a federated feed reader (HN, GitHub Trending, arXiv today), retained
  read-only with zero new investment (brief §3), surfaced via `agora today`.

## Design principles

- **Local-first, no hosted backend.** Every core feature works offline against an on-disk cache —
  degraded, never broken. If a source is unreachable, it says so; it never fabricates counts.
- **A customs office, not a registry.** Agora never competes on catalog size; federating existing
  registries means its effective catalog is everyone's combined.
- **Evidence, not scores.** Every verdict is policy evaluated over verifiable attestations — no
  opaque numeric trust score exists anywhere in the product.
- **Agent-operable.** `--json` on every command and stable exit codes (brief §9, supersedes the
  old `0/1/2/3` plan/scan mapping): `0` ok · `1` policy forbid / drift / revocation hit · `2`
  usage · `3` network · `4` sandbox unavailable — Agora is meant to be driven by agents as a
  first-class citizen, not just humans.
- **The plugin stays thin.** No gate-bypassing write inside an LLM tool call.
- **Graceful terminal degradation.** Colour, gradients, and the banner degrade cleanly under
  `NO_COLOR`, `TERM=dumb`, non-TTY pipes, and narrow terminals.

## The algorithms (fast, offline, original)

- **BM25 capability/catalog search** (`src/search/catalog-index.ts`) — a no-dependency inverted
  index with field weighting and query-side synonym expansion, so search stays fast as the
  federated catalog grows.
- **Description-drift detection** — `descriptionDigest` (canonical SHA-256 of sorted tool names +
  descriptions + input schemas) computed per server on probe; re-probe detects drift with a
  per-tool diff, persisted in `agora.toml` for cross-session comparison. Precursor to the brief §5.5
  drift rule and §6.1 provenance cross-check.
- **Description-injection heuristic scan** (`src/scan.ts`) — checks tool descriptions against
  patterns for imperative markers, secret exfiltration, instruction override, and runtime command
  injection. Status `warn` to avoid false positives. Precursor to the brief §6.3 deterministic
  description-poisoning checks.

## Repository layout (today → target)

```
src/stack/            cross-harness stack manager — adapters, manifest, plan/apply, doctor, probe
                      → target: src/hosts/ (brief §4)
src/model/            v2 zod schemas, purl helpers, JCS/SHA-256 hashing
schemas/              generated JSON Schema output from src/model/
src/store/            SQLite store + content-addressed blob cache
src/federation/       federated catalog clients (official registry, Glama, GitHub, …)
                      → target: src/federation/adapters/ + sync.ts
src/acquire.ts        capability-acquisition gateway (resolve → scan-gate → write)
src/scan.ts           the heuristic gate — injection/permission/drift heuristics
                      → target: src/evidence/ + src/policy/ (brief §6, §7)
src/search/           offline BM25 catalog index over federated results
src/news/             federated feed sources + ranking (read-only, frozen)
src/cli/              command handlers, dispatch, shell, prompter, TUI pages
src/plugin/           OpenCode plugin (tools, hooks, SDK-preferring chat)
src/hubs/             GitHub + HuggingFace connectors + AI README enrichment
                      → repurposed: src/evidence/enrich.ts (brief §3)
src/data.ts           curated MCP servers, workflows, tutorials — the offline-cache fallback
packages/opencode-agora/  thin npm entry re-exporting agora-hub/opencode
```

Not yet present, per the brief §4 target tree: `src/evidence/`, `src/policy/`, `src/serve/`, and
`workers/api/` (Cloudflare Worker). `src/model/`, `src/store/`, and `schemas/` now exist as S1
foundations but still need integration hardening before the S1 gate is complete — see
[`V2_EXECUTION_PLAN.md`](./V2_EXECUTION_PLAN.md).
