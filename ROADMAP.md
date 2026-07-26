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
- **Multi-source search** — offline-first catalog search (`agora search`), deduped by purl, with
  honest per-source status. Eight adapters exist; **four query by default** (official MCP Registry,
  Glama, GitHub, skills-github) alongside the bundled local catalog. PulseMCP is disabled (no
  self-serve API — see `docs/OPEN_QUESTIONS.md` OQ-3); Smithery and Hugging Face are non-canonical
  and opt-in behind `AGORA_ENABLE_NONCANONICAL_SOURCES`. A source that cannot answer reports
  `unreachable` with a reason and falls back to its cache — it never reports an empty result as
  success. Glama's upstream endpoint currently 504s.
- **Verify** — schema hashing (`evidence/schemahash.ts`), schema drift (`evidence/diff.ts`),
  tool-description poisoning checks (`evidence/enrich.ts`), and **live Sigstore provenance**
  (`evidence/sigstore.ts`): Fulcio chain, CT log and Rekor inclusion, with the signing
  certificate's identity bound to the repository the provenance claims. `agora scan
  mcp-filesystem` reports `✓ Signed provenance — signed by modelcontextprotocol/servers`.
  Requires Node (the shipped runtime); under `bun run` it degrades to "could not check" rather
  than reporting a false failure.
- **Gate** — the heuristic customs gate on `agora acquire` (injection-pattern, drift, permission,
  poisoning checks) **plus** a real Cedar policy evaluated over that evidence. `agora policy
  init|check|test`, `[policy] files` in `agora.toml`, and a shipped baseline that forbids only
  what is known-bad. `check` lints before evaluating, because a Cedar rule reading a missing
  attribute is silently skipped and returns permissive. `acquire` refuses on deny **and** on
  inconclusive — an allow reached with rules switched off is not an allow.
- **Revocation (client half)** — ed25519-signed feed with monotonic anti-rollback, offline
  lookups, `acquire` refusing critical/high matches before any write, `doctor` showing `REVOKED`.
  **No key is pinned yet, so no revocations currently apply** — see the owner-gated table.
- **Integration** — `agora mcp` (MCP server exposing the stack + catalog as tools),
  `agora integrate --all` (installs Agora into every host via its own stack machinery).
- **Surface** — the v1 catalog commands (`auth`, `curate`, `chat`, `trending`, `workflows`,
  `tutorials`, `save`/`saved`/`bookmarks`, `similar`, `compare`, `share`, `author`, `use`, `menu`)
  were removed in v0.6.2 along with `src/auth/` and `src/curator/`. There are no accounts and no
  stored credentials anywhere in the product.

Not yet live: the sandboxed `vet` (S6), the agent-facing `agora serve` discovery tools (S7), and
the revocation feed's *publishing* half — see the plan below.

## Phase status

| Phase | Name | Status |
|-------|------|--------|
| S0 | Hygiene & identity | ✅ Complete |
| S1 | Data model & lockfile | ✅ Complete |
| S2 | Multi-source search | ✅ Complete |
| S3 | Provenance & drift | ✅ Complete — live Sigstore verification wired |
| S4 | Revocation | 🔄 Client complete — needs a pinned key + publishing endpoint |
| S5 | Policy (Cedar) | ✅ Complete — engine, `agora policy`, acquire gate |
| S6 | Vet (sandbox) | ⬜ Not started |
| S7 | Serve (agent-facing) | ⬜ Not started |
| S8 | Launch hardening | ⬜ Not started |

## Remaining plan

Ordered by dependency, not ambition. Everything above the line is code; below it is
work only the owner can do.

### Now — S6 Vet (2 wk, must follow S5)

The last plane with no implementation, and the one that turns the rest honest. Until a
sandbox observes what a server *actually does*, `divergence_max` is derived from the
heuristic scan — so the policy plane is still partly grading the thing it replaced — and
`canary_triggered` is an attribute nothing can ever set.

- `src/vet/sandbox.ts` — Docker backend (L0/L1 isolation)
- `src/vet/observer.ts` — record filesystem, network and process activity
- `src/vet/canary.ts` — mint tokens, inject into env, detect exfiltration
- `src/vet/profile.ts` — raw logs → `ObservedProfile` (`src/model/observed.ts` already
  defines the shape)
- `agora vet <purl>` → observation attestation in the CAS
- Feeds `observed_*` attributes into the policy entity model, replacing the scan-derived
  `divergence_max` with real evidence

### Next — retire the legacy catalog path (~2,100 lines)

`src/live/` (619) + `src/hubs/` (719) + `src/marketplace.ts` (745) are a pre-federation
stack still on the install route, in parallel with `src/federation/` (2,433). Brief DA-5
says it dies; only the account layer went so far. `findMarketplaceSource` /
`searchMarketplaceSource` are still used by `install`, `browse`, `export`, `live.ts` and
`live/search.ts`.

**This changes `agora install` behaviour** — it currently resolves through the old client
with a bundled offline fallback, and federation fails differently. Owner sign-off before
starting.

### Then — S7 Serve (1 wk)

`src/serve/` — the agent-facing MCP server. `search_tools`, `get_evidence`,
`check_policy`, `request_install`, with results filtered to `permit` only. Depends on S5
(done) and is much more useful after S6.

### Finally — S8 Launch hardening (1 wk)

`PRIVACY.md`, a comprehensive `agora doctor`, docs site, and the 2.0.0 release. The
unreleased breaking changes (17 retired commands) land here.

---

### Owner-gated — none of this is blocked on code

| | What | Why it is blocking |
|---|---|---|
| 1 | Mint the revocation feed key (`bun scripts/generate-feed-key.ts`) | Until a public key is pinned, every feed is `unverifiable` and **no revocations apply**. S4's client half is inert without it. |
| 2 | Register `agora-hub.dev` (~$12/yr) | The feed endpoint, canary callbacks, and attestation predicate URLs all hardcode it. Blocks S4's publishing half and S6's canaries. |
| 3 | Cloudflare Worker + D1 + KV ($5/mo), `wrangler` token in CI | `workers/api/` is a scaffold with no deploy path. Hosts `/v1/revocations`. |
| 4 | Upload `docs/assets/social-preview.png` | Settings → Social preview. The API cannot set it. |
| 5 | Commission the five diagrams | `docs/DIAGRAM_BRIEF.md` is written and ready to hand over. |
| 6 | Decide the release story | 17 removed commands are breaking for anyone on 0.6.1. Either 0.7.0 with a loud note, or sit unreleased until 2.0.0. Nothing is urgent for existing users. |

## Execution conventions

- Everything lands on `main`, pushed often (owner directive) — phase gates are readiness
  checkpoints, not branch boundaries; `main` stays green at every push.
- Contract-first: load-bearing interfaces authored centrally; mechanical/parallelizable work fans
  out to sonnet implementer agents.
- Non-negotiables (see `AGENTS.md`): local-first, honest output, agent-operable (`--json`, stable
  exit codes per brief §9), surgical config writes, thin plugins, terminal degradation, no creds
  in `agora.toml`.
