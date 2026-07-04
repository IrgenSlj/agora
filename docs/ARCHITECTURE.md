# Architecture

This document captures *what Agora is* and the reasoning behind the shape of the code. For the
sequenced plan and current status, see [`../ROADMAP.md`](../ROADMAP.md); for open external-API
questions, see [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).

## What Agora is

`agora` is **the system manager for your agentic stack** — a package manager for the MCP
ecosystem, in the spirit of apt/Homebrew/Terraform, but scoped to what an AI agent can reach:
MCP servers, skills, and instruction files across OpenCode, Claude Code, Cursor, and Windsurf.

It is **local-first with no hosted backend**. It does not grow its own catalog — it federates
upstream registries (the official MCP Registry, Smithery, Glama, GitHub, …) so its effective
catalog is the union of all of them. And it does not let anything into a config file without
passing a **trust gate** first.

## The three rings

Everything in the codebase serves one of three rings, and they carry different bars for quality:

### Ring 1 — Manage & Gate (the core; must be excellent)

- **Stack manager** (`src/stack/`) — one `ToolAdapter` per agent tool (opencode, Claude Code,
  Cursor, Windsurf) normalizes its MCP config into a single `ConfiguredServer` shape.
  `agora installed` / `doctor [--probe]` read across all of them; `agora.toml` is the portable,
  declarative profile; `plan`/`apply` (`sync` = `plan && apply`) reconcile it into real config
  files surgically — every unrelated key is preserved, writes are atomic
  (`src/atomic-write.ts`).
- **Federated catalog** (`src/federation/`) — clients behind a `RegistrySource`/`FederatedItem`
  contract. `official` (registry.modelcontextprotocol.io) is the required no-auth source;
  `local` (`src/data.ts`) is the bundled offline fallback; Smithery/Glama/GitHub/HuggingFace
  (reusing `src/hubs/`) round it out. Results are deduped by reverse-DNS name, repo URL, or npm
  package, then indexed through the offline BM25 index (`src/search/catalog-index.ts`).
- **Trust gate** (`src/scan.ts`, `src/acquire.ts`) — `agora acquire` is the safe
  capability-acquisition gateway: `resolve → install plan → scan gate → config write`. The gate
  composes static heuristics (injection-pattern checks, permission-manifest diffs, registry
  status) with live-probe diffing (tool-schema drift, observed-vs-declared permissions).
  `fail` blocks the write and exits non-zero; `warn` requires `--accept-warnings`; `--dry-run`
  previews without writing. **It is not a sandbox and does not execute or formally verify server
  code** — "passed the gate" means *no known red flags*, not "safe," and that distinction is
  deliberate everywhere the verdict is shown.

### Ring 2 — Surfaces (invisible + fast)

- **CLI/TUI** (`src/cli/`) — command dispatch, the interactive shell, the prompter, and the
  full-screen TUI pages. The primary, standalone experience.
- **`agora mcp`** (`src/cli/mcp-server.ts`) — exposes the stack manager and catalog as MCP tools,
  so any MCP-capable harness can call Agora directly.
- **Thin plugins** (`src/plugin/`) — the OpenCode/Claude Code plugin registers explicit named
  tools (`agora_search`, `agora_acquire`, `agora_config`, …) plus lifecycle hooks
  (`tool.execute.before` for opt-in capability-gap suggestions, `experimental.session.compacting`
  for stack-aware context). The plugin never owns a write that bypasses the scan gate.
- **Inference provider abstraction** (`src/inference/`) — Agora owns no inference of its own. It
  routes to OpenCode (default, free, zero login), a connected Claude API key, or a local Ollama
  endpoint.

### Ring 3 — Plaza & conveniences (allowed to be imperfect)

- **Plaza** (`src/news/`) — a federated feed reader (HN, GitHub Trending, arXiv today; more
  read/write adapters land per the roadmap), ranked by
  `recencyW·e^(-h/12) + engagementW·log(eng+1) + topicW·topicMatch`, cached locally.
- Tutorials, cross-session recall, and other conveniences that make the CLI a daily destination
  without gating a release on their polish.

## Design principles

- **Local-first, no hosted backend.** Every core feature works offline against an on-disk cache —
  degraded, never broken. If a source is unreachable, it says so; it never fabricates counts.
- **A package manager, not a registry.** Agora never competes on catalog size; federating existing
  registries means its effective catalog is everyone's combined.
- **Trust is the product.** Reputation is earned (install counts, registry status, probe
  results), not granted. The gate's honest limits are stated everywhere the verdict is shown.
- **Agent-operable.** `--json` on every command, plan/apply separation, and stable exit codes
  (`0` ok · `1` error · `2` plan-has-changes · `3` scan-fail) — Agora is meant to be driven by
  agents as a first-class citizen, not just humans.
- **The plugin stays thin.** No payment flow, no gate-bypassing write, inside an LLM tool call.
- **Graceful terminal degradation.** Colour, gradients, and the banner degrade cleanly under
  `NO_COLOR`, `TERM=dumb`, non-TTY pipes, and narrow terminals.

## The algorithms (fast, offline, original)

- **BM25 capability/catalog search** (`src/search/catalog-index.ts`) — a no-dependency inverted
  index with field weighting and query-side synonym expansion, so search stays fast as the
  federated catalog grows.
- **SHA-keyed memoized re-curation** (`src/curator/`) — caches AI verdicts against
  `version=commitSha`, so re-verification cost scales with churn, not catalog size.
- **Composed trust score** — a Bayesian blend of curation verdicts, mechanical quality signals
  (`src/hubs/quality.ts`), and opt-in install-retention telemetry.
- **Description-drift detection** — `descriptionDigest` (canonical SHA-256 of sorted tool names +
  descriptions + input schemas) computed per server on probe; re-probe detects drift with a
  per-tool diff, persisted in `agora.toml` for cross-session comparison.
- **Description-injection heuristic scan** (`src/scan.ts`) — checks tool descriptions against
  patterns for imperative markers, secret exfiltration, instruction override, and runtime command
  injection. Status `warn` to avoid false positives.

## Repository layout

```
src/stack/            cross-harness stack manager — adapters, manifest, plan/apply, doctor, probe
src/federation/        federated catalog clients (official registry, Smithery, Glama, GitHub, …)
src/acquire.ts         capability-acquisition gateway (resolve → scan-gate → write)
src/scan.ts            the trust gate — injection/permission/drift heuristics
src/search/             offline BM25 catalog index over federated results
src/inference/          provider abstraction (OpenCode · Claude · Ollama)
src/news/                the plaza — federated feed sources + ranking
src/cli/                 command handlers, dispatch, shell, prompter, TUI pages
src/plugin/               OpenCode plugin (tools, hooks, SDK-preferring chat)
src/hubs/                 GitHub + HuggingFace connectors + AI README enrichment
src/data.ts               curated MCP servers, workflows, tutorials — the offline-cache fallback
packages/opencode-agora/  thin npm entry re-exporting agora-hub/opencode
```

`backend/`, `hub/`, and the community boards that used to live alongside this are frozen and have
been removed from the working tree — see [`frozen/README.md`](./frozen/README.md) if you land here
looking for them.
