# Agora roadmap

**Direction: LOCKED** by [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md) — Agora is **the trust plane
for agentic tooling**. Phase-by-phase execution lives in
[`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md); that document is the *how*, the brief
is the *what*.

Verified external-API corrections live in [`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md);
shipped work is in [`CHANGELOG.md`](./CHANGELOG.md).

## What's live today (v0.6.1)

- **Manage** — stack manager (`src/stack/`): `agora.toml` profile, per-host adapters (OpenCode,
  Claude Code, Cursor, Windsurf), `plan`/`apply`, `sync --from <url>`, `doctor` with drift,
  quarantine system for drifted/quarantined servers.
- **Multi-source search** — offline-first catalog search (`agora search`) across 8 upstream
  registries (official MCP Registry, Glama, PulseMCP, Smithery, GitHub, Hugging Face, skills-github,
  local), deduped, with honest per-source status.
- **Gate** — heuristic customs gate on `agora acquire` (injection-pattern, drift, permission,
  poisoning checks) — being replaced by the evidence + Cedar policy plane (S3–S5).
- **Evidence (S3 partial)** — schema hashing (`evidence/schemahash.ts`), schema drift
  (`evidence/diff.ts`), tool-description poisoning checks (`evidence/enrich.ts`), provenance
  verification scaffold (`evidence/provenance.ts`).
- **Integration** — `agora mcp` (MCP server exposing the stack + catalog as tools),
  `agora integrate --all` (installs Agora into every host via its own stack machinery).

Not yet live: live Sigstore verification, sandboxed `vet`, signed revocation feed, the Cedar
policy engine, and the agent-facing `agora serve` discovery tools — see the phases below.

## Phase status

| Phase | Name | Status |
|-------|------|--------|
| S0 | Hygiene & identity | ✅ Complete |
| S1 | Data model & lockfile | ✅ Complete |
| S2 | Multi-source search | ✅ Complete |
| S3 | Provenance & drift | 🔄 Partial — modules exist, needs live Sigstore |
| S4 | Revocation | ⬜ Not started |
| S5 | Policy (Cedar) | ⬜ Not started |
| S6 | Vet (sandbox) | ⬜ Not started |
| S7 | Serve (agent-facing) | ⬜ Not started |
| S8 | Launch hardening | ⬜ Not started |

## Next sessions plan

### Session 1 — S3 completion: live Sigstore provenance verification

The `evidence/provenance.ts` module exists with in-toto/DSSE parsing, but the actual Sigstore
online verification (Fulcio + Reko) is not wired. This session makes the trust plane's core
promise real: "this server was signed by its author" or "this server has no attestation."

**Deliverables:**
- Wire Fulcio (certificate issuance) + Rekor (transparency log) into `provenance.ts`
- `agora scan` surfaces provenance verdict: `verified`, `unsigned`, `invalid`, `expired`
- Trust panel in TUI shows provenance badge per item
- `--json` output includes `provenanceVerification` field
- Hermetic tests with recorded Sigstore fixtures (no live network in test suite)
- Gate check `registry_provenance` added to `scan.ts`

### Session 2 — S4: signed revocation feed

When a server gets flagged, every Agora user needs to know within hours. This is what
makes Agora infrastructure.

**Deliverables:**
- `src/revocation/feed.ts` — signed JSON feed (ed25519, key pinned in binary)
- Monotonic version counter, TUF-style anti-rollback on client
- `src/revocation/client.ts` — fetch + verify + cache the feed
- `agora doctor` checks revocation status for installed servers
- Cloudflare Worker endpoint for feed hosting (`/v1/revocation`)
- `agora acquire` blocks on revoked servers (exit 1)
- Tests with recorded feed fixtures

### Session 3 — S5: Cedar policy engine

Replace the heuristic gate with real policy evaluation over evidence. Users write `.cedar`
policy files; Agora evaluates them against the evidence collected in S3/S4.

**Deliverables:**
- `src/policy/engine.ts` — Cedar WASM integration (`@cedar-policy/cedar-wasm`)
- `src/policy/builtin.ts` — baseline policy (require provenance, no revoked, no drift)
- `agora policy init` — scaffold `.cedar` files + `agora.toml` policy section
- `agora policy check` — evaluate policy against current evidence
- `agora policy test` — run policy test cases
- Gate integration: `scan.ts` evaluates Cedar policy as final step
- Tests with Cedar policy fixtures

### Session 4 — S6: sandboxed vet

The "what does this server actually do" layer. Run untrusted servers in Docker, record
their behavior, emit attestations.

**Deliverables:**
- `src/vet/sandbox.ts` — Docker backend (L0/L1 isolation)
- `src/vet/observer.ts` — record syscalls, network, filesystem access
- `src/vet/canary.ts` — canary token exfiltration detection
- `src/vet/profile.ts` — `ObservedProfile` (what the server actually touched)
- `agora vet <purl>` — run server in sandbox, emit observation attestation
- Attestation stored in CAS, surfaced in trust panel
- Tests with Docker mock fixtures

### Session 5 — S7: agent-facing serve

Make Agora discoverable by agents at runtime. `agora serve` exposes tools that let agents
search, verify, and request installation of capabilities — all filtered through Cedar policy.

**Deliverables:**
- `src/serve/index.ts` — MCP server with agent-facing tools
- `search_tools(query, k)` — embedding search over catalog tool descriptions
- `get_evidence(purl)` — return provenance + vet + drift evidence
- `check_policy(purl)` — evaluate Cedar policy, return verdict
- `request_install(purl)` — dry-run acquire, return plan for agent to confirm
- Policy-filtered: `search_tools` only returns items that pass the active policy
- Tests with DI dependencies

### Session 6 — S8: launch hardening

Final pass before v2.0.0: docs site, privacy, polish.

**Deliverables:**
- `PRIVACY.md` — what Agora collects (nothing by default, optional telemetry)
- `agora doctor` polish — comprehensive health report
- Docs site scaffold (mdx or similar)
- v2.0.0 release (minor bump from current v0.6.x)

## Execution conventions

- Everything lands on `main`, pushed often (owner directive) — phase gates are readiness
  checkpoints, not branch boundaries; `main` stays green at every push.
- Contract-first: load-bearing interfaces authored centrally; mechanical/parallelizable work fans
  out to sonnet implementer agents.
- Non-negotiables (see `AGENTS.md`): local-first, honest output, agent-operable (`--json`, stable
  exit codes per brief §9), surgical config writes, thin plugins, terminal degradation, no creds
  in `agora.toml`.
