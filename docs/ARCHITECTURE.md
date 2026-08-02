# Architecture

This document captures *what Agora is* and the reasoning behind the shape of the code. For the
locked specification, see [`../AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md); for current capability
truth see [`STATUS.md`](./STATUS.md), for ordered work see [`NEXT.md`](./NEXT.md), and for
multi-session handoffs see [`DEVELOPMENT.md`](./DEVELOPMENT.md). For open external-API questions, see
[`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md).

`STATUS.md` is the authority on *what is live*. This document describes shape and reasoning; if the
two ever disagree, the status document is right and this file is stale.

## What Agora is

`agora` is **the trust plane for agentic tooling** — it verifies where MCP servers and Agent Skills
come from, records declared capabilities plus sampled runtime evidence, enforces user-defined policy,
and manages them across every host (OpenCode, Claude Code, Cursor, Windsurf).

It is a **customs office over multi-source registries**, never a competing catalog: it does not
grow its own catalog, it searches upstream registries (the official MCP Registry as canonical,
then Glama, GitHub, + skills sources) so its effective catalog is the union of all of them. It
deals in **evidence** — verifiable, inspectable attestations — never opaque numeric "trust
scores." It is host-neutral (OpenCode is one integration among four, not the identity) and
local-first with no hosted backend it depends on.

## The planes

### Federate (`src/federation/`) — live

Adapters behind a `RegistrySource`/`FederatedItem` contract normalize results from upstream
registries, deduped by purl and merged into one search with honest per-source status. `agora
search` / `refresh` read from this. Eight adapters exist; four query by default (official MCP
Registry, Glama, GitHub, skills-github) alongside the bundled local catalog. PulseMCP is disabled
(no self-serve API — OQ-3); Smithery and Hugging Face are non-canonical and opt-in behind
`AGORA_ENABLE_NONCANONICAL_SOURCES`.

A source that cannot answer reports `unreachable` with a reason and falls back to its cache. **It
never reports an empty result as success** — that distinction is the whole point of the plane.

### Verify — evidence (`src/evidence/`) — live

- `schemahash.ts` — canonical SHA-256 over sorted tool names + descriptions + input schemas.
- `diff.ts` — per-tool drift diffing against an approved baseline.
- `enrich.ts` — description-poisoning heuristics (imperative-to-model phrases, zero-width unicode,
  HTML comments, base64-looking blobs, cross-tool shadowing). Status `warn`, to avoid false
  positives.
- `sigstore.ts` + `resolve-provenance.ts` — **live** Sigstore verification: Fulcio chain, CT log
  and Rekor inclusion, with the signing certificate's identity bound to the repository the
  provenance claims. `agora scan mcp-filesystem` reports `✓ Signed provenance — signed by
  modelcontextprotocol/servers`.

Two traps this code exists to avoid, both learned the hard way:

- **Bun cannot verify the Sigstore TUF root** ("root was signed by 0/3 keys"); the same bundle
  verifies under Node, the shipped runtime. `ProvenanceVerifierUnavailable` exists so a runtime
  quirk degrades to "could not check" instead of being reported as tampering — which would
  condemn every correctly-signed package.
- **Scoped npm purls need `%40`.** npm signs `pkg:npm/%40scope/name@v`; hand-concatenating
  `pkg:npm/@scope/name@v` fails the subject match, which made every scoped package (most MCP
  servers) read as `verification-failed`. Always use `buildPurl` with a split namespace.

The gate rule: provenance emits `pass` only when verified *and* identity-bound, `fail` only when a
signature was checked and failed, and **no row at all** when there is simply no attestation.
Most of npm has none, and warning on all of them would drain the meaning from every other warning.
`test/gate/acquire-gate.test.ts` pins that zero-false-positives property.

### Observe (`src/observe/`) — live

`agora run -- <command…>` makes Agora the MCP server's parent process and tees its stdio, so MCP
protocol activity is recorded during real work in the real environment. `agora observe` reports it.
This replaced the brief's Docker sandbox for the current implementation; a future sandbox or OS
backend can add stronger evidence, but it must use its own versioned predicate rather than pretending
sampled runtime sessions satisfy the older sandbox profile.

**Two invariants that must never regress:**

1. **The shim is byte-transparent.** It fronts every MCP server the user runs, so a corrupted byte
   does not degrade observation — it breaks their whole agent setup. Bytes are forwarded verbatim
   in both directions, observation is a tee that can never gate or delay a write, and every
   recorder call site is wrapped in `safely()`. A test drives a deliberately throwing recorder and
   asserts the server still works and the exit code still propagates.
2. **Tool arguments and results are never recorded** — only tool names and counts, advertised
   tools, and sampled peers. This code sits in the path of real work and sees real file contents,
   prompts and secrets. A test pushes a real `.ssh/id_rsa` path through the recorder and asserts
   it appears nowhere on disk.

Connection sampling polls the direct process with `lsof -a -p PID -i -n -P`, so a connection opened
and closed between polls or made only by a descendant can be invisible. Sessions carry both
`networkSampled` and an explicit sampling state; missing/failed `lsof` is `unavailable`, never an
empty successful observation. Trust output describes sampled peers, not complete network behavior.

### Gate — policy (`src/policy/`) and revocation (`src/revocation/`) — live

`src/policy/` is a real Cedar engine (`@cedar-policy/cedar-wasm`, lazily imported — it is 12MB)
evaluated over the evidence above: `agora policy init|check|test`, `[policy] files` in
`agora.toml`, and a shipped baseline that forbids only what is known-bad.

**The Cedar trap this design is built around:** a rule reading a *missing* attribute is silently
skipped, and the decision comes back permissive — so an unguarded `forbid` looks like protection
and is not. Hence every baseline rule guards with `has`; `PolicyDecision` carries `skipped` and
`isConclusive()`; `policy check` lints before evaluating; and `acquire` refuses on inconclusive as
well as on deny, because an allow reached with rules switched off is not an allow. Cedar's own
validator does not catch `resource has typoName` (legal, permanently false), so `engine.ts`
checks referenced attribute names against the schema itself.

**Entity-model rule:** attributes are *omitted* when unobserved, never defaulted to false. Only 7
of 67 catalog packages declare permissions, so `exec: false` would have asserted something untrue
about the other 60.

`src/revocation/` consumes a bundled OSV-derived feed and merges a fetched copy monotonically. The
network copy is unsigned and may add entries but cannot remove, weaken, or outrank bundled entries.
`acquire` refuses confirmed critical/high matches before its write; `doctor` shows `REVOKED`.
Absent coverage reads as `unknown`, never "clean"; servers that are not purl-addressable are "not
checkable". Origin, bundled-feed age, and independent confirmation of network-added hard blocks are
still being hardened.

`src/scan.ts` is the heuristic gate that predates the evidence plane and still runs alongside it:
injection-pattern checks, permission-manifest diffs, live-probe tool-schema drift. **It is not a
sandbox and does not execute or formally verify server code** — "passed the gate" means *no known
red flags*, not "safe," and that distinction is deliberate everywhere a verdict is shown.

### Manage (`src/stack/`) — live

One `ToolAdapter` per agent tool (opencode, Claude Code, Cursor, Windsurf) normalizes its MCP
config into a single `ConfiguredServer` shape. `agora installed` / `doctor [--probe]` read across
all of them; `agora.toml` is the portable, declarative profile; `plan`/`apply` (`sync` =
`plan && apply`) reconcile it into real config files surgically — every unrelated key preserved,
writes atomic (`src/atomic-write.ts`). Generated manifests use `env_from` references so host
environment values are not copied. `agora.lock verify` exists, but acquisition does not yet create
or update complete lock entries; the lock is still a partial implementation of brief §5.5.

## Supporting surfaces

- **CLI** (`src/cli/`) — command dispatch, the interactive shell, the prompter, and the
  full-screen TUI pages. Running `agora` with no arguments in a TTY opens the shell, where a
  terminal command, an `agora` command, or plain text (routed to chat) all work without a mode
  switch. Inference is **spawned, never hosted** (`src/inference/`): providers wrap a coding CLI
  the user already has — `opencode` by default so the zero-cost path works with no key on first
  run, or Claude Code via `AGORA_INFERENCE=claude`. Spawning `claude -p` uses the developer's
  existing login, subscription included, so **no credential ever reaches Agora**. Each provider
  translates its own stream into the renderer's event vocabulary, which is why
  `src/cli/chat-renderer.ts` needs to know nothing about who produced a line.
- **`agora mcp`** (`src/cli/mcp-server.ts`) — exposes the stack manager and catalog as MCP tools,
  so any MCP-capable harness can call Agora directly. Its confirming acquire tool is transitional:
  model-supplied booleans are not human authorization. `src/serve/` has intent records and approval
  scaffolding; the target surface is policy-filtered `search_tools`, `get_evidence`, `check_policy`,
  and request-only `request_install`.
- **Thin plugins** (`src/plugin/`) — the OpenCode/Claude Code plugin registers explicit named
  tools (`agora_search`, `agora_acquire`, `agora_config`, …) plus lifecycle hooks. The plugin
  never owns a write that bypasses the gate.
- **News** (`src/news/`) — a feed reader (HN, GitHub Trending, arXiv), retained read-only with
  zero new investment (brief D6), surfaced via `agora today`.

## Design principles

- **Local-first, no hosted backend.** Every core feature works offline against an on-disk cache —
  degraded, never broken. If a source is unreachable, it says so; it never fabricates counts.
- **A customs office, not a registry.** Agora never competes on catalog size.
- **Evidence, not scores.** Every verdict is policy evaluated over verifiable attestations — no
  opaque numeric trust score exists anywhere in the product.
- **Never fabricate.** This is enforced, not aspirational: the bundled `workflow` items were
  deleted in v0.6.2+ precisely because they carried invented star and fork counts that no upstream
  could refresh. If a number is displayed, it traces to a real source.
- **Agent-operable.** `--json` on every command and stable exit codes (brief §9): `0` ok · `1`
  policy forbid / drift / revocation hit · `2` usage · `3` network · `4` sandbox unavailable.
- **The plugin stays thin.** No gate-bypassing write inside an LLM tool call.
- **Working surfaces are preserved.** Shell, TUI, `today`, inference, federation sources, adapters,
  plugins, and MCP integrations converge on shared services rather than being deleted for size.
- **Graceful terminal degradation** under `NO_COLOR`, `TERM=dumb`, non-TTY pipes, narrow widths.

## The algorithms (fast, offline, original)

- **BM25 capability/catalog search** (`src/search/catalog-index.ts`) — a no-dependency inverted
  index with field weighting and query-side synonym expansion.
- **Description-drift detection** — `descriptionDigest` per server on probe; re-probe detects
  drift with a per-tool diff, preserves the approved baseline, records drift/quarantine metadata,
  and rewrites affected host configs by disabling the drifted entry. `agora sync` consults that
  state before writing, so a quarantined server is never silently reintroduced from `agora.toml`;
  `agora update` uses the same preflight.
- **Description-poisoning heuristics** (`src/evidence/enrich.ts`, surfaced by `src/scan.ts`).

## Repository layout

```
src/model/            v2 zod schemas, purl helpers, JCS/SHA-256 hashing
schemas/              generated JSON Schema output from src/model/
src/store/            SQLite store + content-addressed blob cache
src/federation/       multi-source adapters + dedupe-by-purl sync
src/evidence/         provenance, schema hashing, drift, poisoning heuristics
src/policy/           Cedar engine, entity model, shipped baseline
src/revocation/       bundled/additive feed client, matching, installed-purl resolution
src/observe/          the `agora run` supervising shim + session recording
src/stack/            stack manager — adapters, manifest, plan/apply, doctor, probe
src/catalog/          the bundled offline catalog (bundled.ts, types, permissions)
src/acquire.ts        capability-acquisition gateway (resolve → gate → policy → write)
src/scan.ts           the heuristic gate
src/search/           offline BM25 index
src/news/             feed sources + ranking (read-only, frozen)
src/cli/              command handlers, dispatch, shell, prompter, TUI pages
src/plugin/           OpenCode plugin (tools, hooks)
src/hubs/             GitHub + HuggingFace connectors
src/inference/        inference providers (opencode, claude) — spawned, never hosted
src/fetch.ts          the injectable `FetchLike` every network call takes
feed/                 revocation feed: entries.json (OSV-generated) + revocations.json (bundled)
```

Still incomplete from the brief §4 target: the **agent-facing serve tools and consent boundary** and
a pre-install sandbox/stronger observation backend. See [`STATUS.md`](./STATUS.md) and
[`NEXT.md`](./NEXT.md).
