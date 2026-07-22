# Agora roadmap

**Direction: LOCKED** by [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md) — Agora is **the trust plane
for agentic tooling**. Phase-by-phase execution lives in
[`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md); that document is the *how*, the brief
is the *what*. **Current phase: S1 (data model & lockfile).**

Verified external-API corrections live in [`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md);
shipped work is in [`CHANGELOG.md`](./CHANGELOG.md).

## What's live today

- **Manage** — stack manager (`src/stack/`): `agora.toml` profile, per-host adapters (OpenCode,
  Claude Code, Cursor, Windsurf), `plan`/`apply`, `sync --from <url>`, `doctor` with drift.
- **Federate** — federated, offline-first catalog search (`agora search`) across the official MCP
  Registry + follow-on sources, deduped, with honest per-source status.
- **Gate** — heuristic customs gate on `agora acquire` (injection-pattern, drift, and permission
  checks) — being replaced by the evidence + Cedar policy plane (S3–S5).
- **Integration** — `agora mcp` (MCP server exposing the stack + catalog as tools),
  `agora integrate --all` (installs Agora into every host via its own stack machinery).

Not yet live: Sigstore provenance verification, sandboxed `vet`, signed revocation feed, the Cedar
policy engine, and the agent-facing `agora serve` discovery tools — see the phases below.

## Phases ahead

- **S0** — ✅ Hygiene & identity: rename to `agora-hub`, README/docs rewrite, strip
  commerce/account framing, toolchain to vitest+biome, CI matrix. Legacy account/catalog code is
  retired with S1/S2 replacements per DA-5.
- **S1** — 🔄 Data model & lockfile: zod schemas + JSON Schema export, purl handling, JCS/SHA-256
  hashing, CAS + SQLite store, `agora lock verify`, and the brief §9 exit-code contract.
- **S2** — Federation: official/Glama/PulseMCP adapters, dedupe-by-purl, worker `/v1/catalog`.
- **S3** — Provenance & drift: Sigstore verification, schema/description hashing, rug-pull
  drift rule wired into `sync`/`update`/`doctor`.
- **S4** — Revocation: signed feed, anti-rollback client, quarantine semantics.
- **S5** — Policy: Cedar engine, baseline policy, `policy init/check/test`, enforcement points.
- **S6** — Vet: Docker sandbox (L0/L1), canary tokens, `ObservedProfile`, attestation emission.
- **S7** — Serve: agent-facing MCP server (`search_tools`, `get_evidence`, `check_policy`,
  `request_install`), local embeddings, policy-filtered discovery.
- **S8** — Launch hardening: docs site, `PRIVACY.md`, `agora doctor` polish, v2.0.0 release.

## Execution conventions

- Everything lands on `main`, pushed often (owner directive) — phase gates are readiness
  checkpoints, not branch boundaries; `main` stays green at every push.
- Contract-first: load-bearing interfaces authored centrally; mechanical/parallelizable work fans
  out to sonnet implementer agents.
- Non-negotiables (see `AGENTS.md`): local-first, honest output, agent-operable (`--json`, stable
  exit codes per brief §9), surgical config writes, thin plugins, terminal degradation, no creds
  in `agora.toml`.
