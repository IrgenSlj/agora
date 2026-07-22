# Agora v2.0 — Execution Plan (all phases)

**Source of truth:** `AGORA_BRIEF_v2.md` (LOCKED 2026-07-06). This document is the *how* —
the brief is the *what*. Where they disagree about intent, the brief wins; where the brief's
third-party assumptions diverge from build-time reality, we log a **Decision Amendment (DA)** in
the brief's §14 and an entry in `docs/OPEN_QUESTIONS.md`, then take the smallest adaptation.

**Status:** S0 complete — toolchain migrated, README/docs rewritten, CI matrix expanded,
user-facing commerce/account framing stripped, biome migrated. S1 (data model & lockfile) in
progress: model schemas, generated schemas, schema freshness tests, purl helpers, JCS/SHA-256
helpers, SQLite/CAS store, manifest-backed `agora lock verify`, byte-identical lockfile
serialization, the brief §9 CLI exit-code remap, and refresh-backed source-item indexing with
store-first offline fallback are present; remaining S1 work is integration hardening across legacy
surfaces.

---

## 0. Operating model

- **Everything on `main`, push often** (owner directive, 2026-07-06 — overrides the brief's
  one-PR-per-phase §0/§13 process, not its content). Land each coherent chunk as its own commit
  directly on `main` and push; keep `main` green (typecheck+lint+build+tests) at every push so it
  stays releasable. Phase *gates* still govern *readiness to move on*, but they are checkpoints, not
  branch boundaries. → **DA-4**.
- **Contract-first, then fan out.** Opus (orchestrator) authors the load-bearing interfaces —
  `src/model/` zod schemas, attestation format, Cedar entity construction, the vet orchestrator
  contract — and reviews every PR. Mechanical / parallelizable work (codemods, adapter
  implementations, fixture servers, per-command wiring) fans out to **sonnet `implementer` agents**
  to preserve the opus rate limit. This matches the repo's existing convention (`AGENTS.md`,
  ROADMAP "implementations fan out to sonnet agents").
- **Every phase ends clean:** `typecheck` + `lint` + `build` + full test suite green, plus a
  `CHANGELOG.md` entry and this file's status table updated. No version bump mid-phase (release is
  S8 only — the founder dislikes churn; sculpt then ship).
- **Honest degradation stays non-negotiable** (`AGENTS.md`): local-first, no fabricated data,
  `--json` + stable exit codes on every command, surgical config writes, no creds in `agora.toml`.

### Exit-code contract (brief §9, supersedes the old 0/1/2/3)

`0` ok · `1` policy forbid / drift / revocation hit · `2` usage · `3` network · `4` sandbox
unavailable. The old `2=plan-has-changes / 3=scan-fail` meanings are remapped in S1 and pinned by
CLI tests — see DA-3 in §7.

---

## 1. Cross-cutting decisions locked for this execution

| ID | Decision | Where |
|----|----------|-------|
| **X1** | **Toolchain migrates in S0** (user directive): adopt **vitest** (test) + **biome** (lint/format), drop eslint/prettier. **Keep bun** as installer/runtime (no package-manager switch — lower churn); run `vitest`/`biome`/`tsc` via bun. Bump `engines.node` to `>=20`. | S0 |
| **X2** | **"marketplace" gate is reinterpreted.** The brief's literal "zero occurrences of marketplace/trading" is impossible without breaking Claude Code plugin support (`/plugin marketplace add`, `.claude-plugin/marketplace.json` are host-technical terms). Resolution: **(a)** delete all *commerce* framing; **(b)** finish the stale `marketplace → catalog/search` **rename** in `src/` (it's leftover vocab, not a store); **(c)** keep host-technical "plugin marketplace" usages. Gate becomes "zero commerce-framed marketplace/trading language." → **DA-1**. | S0 |
| **X3** | **Human-only actions** (I cannot run these; I prepare + hand you exact commands): `npm deprecate opencode-agora`, npm publish, publish to the **official MCP registry**, register the **agora-hub.dev** domain, create the **Cloudflare** account + Worker, set CI secrets (`NPM_TOKEN`, feed-signing key, Cloudflare token). | S0, S2, S4, S8 |
| **X4** | **Cost posture (broke founder).** Only two recurring costs are load-bearing: **agora-hub.dev domain** (~$12/yr — needed for canary/revocation/attestation predicate URLs) and **Cloudflare Workers paid tier** ($5/mo, D5/D10). Everything else (GH Actions on a public repo, local models, Docker locally) is free. LLM-enrich (S3) is **optional/keyed** and off without a key. | global |
| **X5** | **Zod v4 is already installed** — use its native `z.toJSONSchema()` for the `/schemas` export (D12); no extra dep. | S1 |

---

## 2. Phase dependency graph

```
S0 hygiene/identity ─┬─▶ S1 model/lockfile ─┬─▶ S2 federation ──▶ S7 serve
                     │                       ├─▶ S3 provenance/drift ─┐
                     │                       │        │               ├─▶ S6 vet ──▶ S8 launch
                     │                       ├─▶ S4 revocation ───────┤   (needs S5)
                     │                       └─▶ S5 policy ───────────┘
                     └────────────────────────────────────────────────▶ (docs threaded throughout)
```

- **S3, S4, S5 may run in parallel** once S1 lands (brief §13 footer). S4 (revocation) and S5
  (policy) are independent of S3 (drift). Practically: land S3 first (it's the rug-pull demo), then
  S4 ∥ S5.
- **S6 (vet) must follow S5** — observed profiles feed policy entities.
- **S7 (serve)** needs S2 (catalog to search) + S5 (policy filter); evidence summaries improve after S3/S6 but S7 can ship against whatever evidence exists.

---

## 3. Target module tree — current → v2 migration map

| v2 target (brief §4) | Today | Action |
|---|---|---|
| `src/model/` | scattered `src/types.ts`, `src/federation/types.ts`, `src/marketplace/types.ts` | **new** — consolidate into zod schemas (S1) |
| `src/federation/adapters/` | `src/federation/sources/{official,glama,github,huggingface,smithery,local}.ts` | rename `sources→adapters`; **keep** official/glama/local, **add** pulsemcp + skills-github, **retire** smithery/huggingface (or demote to non-canonical) (S2) |
| `src/federation/sync.ts` | `src/federation/index.ts` (`federatedSearch`, dedupe) | refactor: dedupe **by purl**, precedence, incremental sync (S2) |
| `src/evidence/` | `src/scan.ts`, `src/curator/`, `src/hubs/enrichment.ts` | **new plane**; repurpose curator LLM → `evidence/enrich.ts` (S3/S6) |
| `src/policy/` | (none — `src/scan.ts` is heuristic gate) | **new plane**, Cedar (S5) |
| `src/hosts/` | `src/stack/adapters/{opencode,claude-code,cursor,windsurf}.ts` | move `stack/adapters → hosts/` (keep behavior) (S1/S2) |
| `src/serve/` | `src/cli/mcp-server.ts` (5 tools) | **new** MCP server, 4 v2 tools + embeddings + policy filter (S7) |
| `src/store/` | `src/federation/cache.ts`, `src/state.ts`, `src/data.ts` | consolidate → SQLite (`better-sqlite3`) + CAS blob cache (S1) |
| `workers/api/` | (none) | **new** hono worker (S2 catalog, S4 revocations, S6 canary) |
| `schemas/` | (none) | **new** build artifact — zod → JSON Schema (S1) |
| **delete** | `src/auth/`, commerce copy, discovery-crawler framing | S0 |
| **retain read-only** | `src/news/` → `agora today` static fetch | S0 (freeze), no new investment |

The tree move is **incremental** — S0 does identity/kill only; dir moves happen in the phase that
owns each plane, always with a barrel re-export so imports never break mid-phase (`AGENTS.md`
module-splitting rule).

---

## 4. Per-phase plans

Legend: **[opus]** = orchestrator authors/reviews · **[sonnet]** = fan-out implementer agents ·
**[you]** = human action I cannot perform.

### S0 — Hygiene & identity (0.5 wk)

**Objective:** single identity, toolchain on vitest+biome, dead commerce/auth removed, CI matrix,
docs re-pointed at the trust-plane thesis.

**Work items**
1. **[opus]** Rewrite `README.md` to Section-1 positioning: "trust plane for agentic tooling",
   "customs office over federated registries", "evidence not scores", host-neutral (OpenCode = 1 of
   4). Kill commerce/three-rings framing. Keep `AGENTS.md`, `ROADMAP.md`, and
   `docs/ARCHITECTURE.md` aligned to that identity.
2. **[sonnet]** Toolchain migration (X1):
   - Add `vitest` + `vitest.config.ts`; codemod all **71** test files `from 'bun:test'` → `from 'vitest'`;
     verify hermetic/no-network still holds; swap `"test": "vitest run"`.
   - Add `@biomejs/biome` + `biome.json` (port `.prettierrc` + eslint rules); remove
     `eslint.config.js`, `.prettierrc`, `.prettierignore`, eslint/prettier devDeps; swap
     `lint`/`format` scripts.
   - Bump `engines.node` `>=20`; keep `bin`/`type:module`.
3. **[sonnet/opus]** S0 reframe (DA-5): strip commerce **copy/framing** from user-facing strings,
   help text, plugin tool descriptions, and welcome banner (keep host-technical "plugin marketplace").
   `src/auth/` + legacy data model (`MarketplaceItem`, `Pricing`, `Discussion`) are *superseded* by
   S1/S2 work, not hand-deleted in S0 — avoids double churn (DA-5 rationale, see §7).
4. **[opus]** CI: extend `.github/workflows/ci.yml` to a **matrix (ubuntu + macOS)**, node 20, running
   biome + tsc + vitest. Reserve a `docker-integration` job stub (enabled in S6).
5. **[you]** `npm deprecate opencode-agora "renamed → agora-hub; see npm agora-hub"`; keep
   `packages/opencode-agora` as a thin re-export or repoint OpenCode plugin path to `agora-hub`
   (open question OQ below). Publish agora to the **official MCP registry** (I'll prepare the
   `server.json` + submission PR).

**New deps:** `vitest`, `@biomejs/biome` (dev). Remove: eslint*, prettier*.

**Gate (brief S0):** fresh `npm i -g agora-hub && agora --help` on macOS+Linux; **zero
commerce-framed** "marketplace/trading" (X2); CI matrix green.

**Risks:** vitest globals vs bun-test API differences (`mock`, `spyOn`) — codemod must map these;
biome may flag existing style → commit a one-time format. macOS runner + native deps not yet an
issue (no native deps until S1).

---

### S1 — Data model & lockfile (1 wk)

**Objective:** every Section-5 schema as zod, JSON Schema export, purl handling, CAS + SQLite store,
`agora lock verify`.

**Work items**
1. **[opus]** Author `src/model/` zod schemas exactly per §5: `ArtifactRef`, `DeclaredManifest`,
   `ObservedProfile`, attestation envelope (in-toto Statement + DSSE), `agora.lock`, revocation feed,
   Cedar policy-entities. Wire snake_case↔camelCase transforms. These are the load-bearing contracts —
   opus owns them.
2. **[sonnet]** `schemas/` build step: `z.toJSONSchema()` → `schemas/<name>.v1.json` (X5); wire into
   `build`; snapshot-test the output.
3. **[sonnet]** purl via `packageurl-js` (parse/build/validate) — helpers + tests over the §5.1 examples.
4. **[sonnet]** `src/store/`: `better-sqlite3` at `~/.agora/agora.db` (schema migrations), CAS at
   `~/.agora/cas/<sha256>`; `agora refresh` now mirrors official source items into SQLite + CAS,
   and federation fallback reads that source index before falling back to JSONL compatibility files.
   JCS hashing via `canonicalize` + SHA-256 (D15) as a shared util.
5. **[sonnet]** `agora lock verify` (recompute hashes, exit 1 on drift) + byte-identical
   parser/serializer round-trip test.
6. **[sonnet]** Migrate exit-code contract to brief §9 across commands + tests (DA-3) — core CLI
   command paths now use the shared `ExitCode` contract.

**New deps:** `packageurl-js`, `canonicalize`, `better-sqlite3`. **Native-build risk** (better-sqlite3)
on the macOS+Linux matrix — pin a version with prebuilds.

**Gate (brief S1):** schema snapshot tests; lockfile round-trips **byte-identical**.

---

### S2 — Federation (1 wk) — started

**Objective:** official (canonical) + glama + pulsemcp adapters, dedupe-by-purl + precedence,
`agora search/info` from local sync, worker `/v1/catalog` + cron.

**Work items**
1. **[sonnet]** `federation/sources → federation/adapters`; keep official/glama/local; **add**
   `pulsemcp.ts` + `skills-github.ts`; retire smithery/huggingface as non-canonical (behind a flag,
   degrade honestly). Each adapter → normalized `ArtifactRef` (S1 model).
   - ✅ **PulseMCP reality-check** (2026-07-22): v0.1 docs exist, but access is still partner-gated
     (`X-API-Key` + `X-Tenant-ID`; live unauthenticated call returns 401). Shipped as an optional
     env-keyed source, disabled by default and cacheable/offline-first when credentials are present.
   - ✅ **Skills source:** `skills-github` reuses the GitHub repository crawler with skill-focused
     topics and maps results as `category: skill` / `agent-skill` sync candidates.
   - ✅ **Non-canonical sources:** Smithery and Hugging Face remain available for explicit research,
     but no longer participate in default federation unless `AGORA_ENABLE_NONCANONICAL_SOURCES=1`,
     `AGORA_ENABLE_SMITHERY=1`, `AGORA_ENABLE_HUGGINGFACE=1`, or
     `AGORA_NONCANONICAL_SOURCES=smithery,huggingface` is set.
2. **[opus]** `federation/sync.ts`: dedupe **by purl**, precedence official > glama > pulsemcp,
   incremental sync into SQLite.
   - ✅ **Started:** `syncFederationItems()` now persists source items into CAS/SQLite by purl,
     recomputes canonical artifact metadata by source precedence, and falls back to the next source
     when the preferred source is pruned. `refreshOfficialCache()` uses this shared path.
3. **[sonnet]** Rewire `agora search` + new `agora info <purl>` to read from local sync (offline-first).
   - ✅ **Started:** `agora info <purl>` reads the local SQLite/CAS sync store directly and returns
     normalized artifact metadata plus source references/source-item summaries with `--json`.
   - ✅ **Search path:** `agora search --offline` now sets the federation offline gate explicitly and
     reads local sync/cache data, including SQLite/CAS source items when JSONL is absent.
   - ✅ **CLI shape:** `agora search --kind mcp-server|agent-skill` is accepted as the v2 artifact-kind
     filter while preserving the existing `--category` filters.
4. **[opus/you]** `workers/api/` hono app: `GET /v1/catalog?cursor=` from D1, cron sync every 6h,
   `GET /v1/health`. **[you]** create Cloudflare account + `wrangler` project + D1/KV; I author the code
   + `wrangler.toml` and a local `miniflare` test harness.
   - ✅ **Started:** `workers/api/` now has a Hono Worker with `GET /v1/health`, paginated
     `GET /v1/catalog`, D1 schema, Wrangler config placeholder, a 6-hour cron trigger, minimal
     official-registry sync into D1, and a fake-D1 unit test harness.
5. **[sonnet]** Adapter **contract tests** against recorded upstream responses (no live calls in CI).
   - ✅ **Started:** `test/federation/adapter-contract.test.ts` now runs the shared
     `RegistrySource` contract across official, Glama, PulseMCP, skills-github, Smithery, GitHub,
     Hugging Face, and local using recorded or hand-modeled fixture responses only.

**New deps:** `hono`, `wrangler` (dev), `@cloudflare/workers-types` (dev).

**Gate (brief S2):** `agora search filesystem` returns merged/deduped results **offline** after one
sync; adapter contract tests green.

---

### S3 — Provenance & drift (1 wk)

**Objective:** sigstore provenance verify, schema/description hashing, drift rule wired into
`sync/update/doctor`, deterministic description-poisoning checks.

**Work items**
1. **[opus]** `evidence/provenance.ts`: npm provenance via registry API + `sigstore` verify (Fulcio/
   Rekor public-good); extract builder/repo/commit → `provenance-verification/v1` attestation. GitHub
   skill attestations via REST; `verified:false / no-provenance` when absent (policy decides). Publisher
   vs source-repo cross-check → `publisher-mismatch/critical` (typosquat signal, §6.1).
2. **[sonnet]** `evidence/schemahash.ts` (JCS+sha256 of `tools/list`, description extraction) +
   `evidence/diff.ts` (manifest & per-tool drift). Wire the **drift rule** (§5.5) into `sync`,
   `update`, `doctor`: mismatch → `quarantined` state + host-config rewrite + printed diff.
3. **[sonnet]** `evidence/enrich.ts` deterministic poisoning heuristics (regex/AST): imperative-to-model
   phrases, zero-width unicode, HTML comments, base64 >128 chars, cross-tool shadowing. LLM pass
   optional/keyed. (Repurpose `src/curator/` + `src/hubs/enrichment.ts`.)

**New deps:** `sigstore`. **Risk:** sigstore verify needs network (Rekor) — must degrade to
`verified:unknown` offline, never hard-fail; keyless is verify-only here (we don't sign until S6).

**Gate (brief S3):** `rug-pull` fixture v1→v2 auto-quarantines with a printed diff.

---

### S4 — Revocation (0.5 wk) — *parallelizable with S5*

**Objective:** signed feed format, signing CI job, worker endpoint, client with anti-rollback,
quarantine semantics.

**Work items**
1. **[opus]** `policy/revocation.ts`: ed25519 verify (public key **pinned as a constant** in the
   binary), monotonic `feed_version` anti-rollback, match installed artifacts → `critical|high`
   quarantine + host rewrite + non-zero exit in CI mode; `advisory` warns. Poll ≤ every 6h jittered,
   never block startup (§5.6).
2. **[sonnet]** Feed file in repo (signed JSON, deployed via CI so every change is a reviewed PR);
   **[you]** generate the feed-signing keypair, store private key as CI secret, document rotation.
3. **[sonnet]** Worker `GET /v1/revocations` (KV-cached, source-of-truth = repo file).
4. **[sonnet]** Tests: rollback-replay rejected, bad-signature rejected, quarantine↔unquarantine round trip.

**New deps:** none (Node `crypto` ed25519).

**Gate (brief S4):** revoking `phone-home` quarantines it on next `agora sync`; rollback replay rejected.

---

### S5 — Policy (1 wk) — *parallelizable with S4*

**Objective:** Cedar engine, entity construction from evidence, baseline policy, `policy
init/check/test`, all enforcement points, `--ci` mode.

**Work items**
1. **[opus]** `policy/engine.ts`: `@cedar-policy/cedar-wasm` wrapper; construct Cedar entities
   (`Project`, `Publisher`, `Artifact`) from S1/S3 evidence per §7.1 schema. This is load-bearing —
   opus owns the entity mapping.
2. **[sonnet]** `policy/defaults/baseline.cedar` + `agora.cedarschema` (§7.1); `agora.toml →
   policy.files` override loading.
3. **[sonnet]** `agora policy init|check [--ci]|test`; wire **enforcement points** (§7.1): add/install,
   update, sync (before any host write), serve (filter), doctor (report-only), `check --ci` (exit 1
   on forbid affecting lockfile). Quarantine semantics + `agora unquarantine <purl> --accept-risk`
   (override attestation, §7.2).
4. **[sonnet]** `policy test` fixtures covering every baseline rule.

**New deps:** `@cedar-policy/cedar-wasm`. **Risk:** WASM bundle size + ESM interop in Node/bun; verify
it loads under the compiled binary (`bun build --compile`).

**Gate (brief S5):** policy test suite green; forbidding `fs_write` blocks `greedy-fs` install.

---

### S6 — Vet (2 wk) — *must follow S5*

**Objective:** Docker backend L0+L1, strace extraction, canary mint + worker callback, ObservedProfile,
attestation emission (sigstore keyless in CI / ed25519 local), `agora vet` + `agora export
--attestations`.

**Work items**
1. **[opus]** `evidence/vet/index.ts` orchestrator contract + backend interface (pluggable; docker is
   the only P1 backend, D9). **Unvetted artifacts never run on host.**
2. **[sonnet]** `backends/docker.ts`: L0 `--network=none` (artifact installed from CAS tarball at image
   build, never `npx` live); MCP initialize + `tools/list` + one inert call per safely-constructable
   tool. L1 = dedicated bridge → logging forward proxy (mitmproxy transparent, TLS passthrough, log
   SNI/host:port only). `strace -f -e trace=%file,%process` → raw logs.
3. **[sonnet]** `vet/extract.ts` raw logs → `ObservedProfile` (+ divergence computation vs declared).
4. **[opus]** `vet/canary.ts`: mint token `t`, inject fake `AWS_SECRET_ACCESS_KEY`/`OPENAI_API_KEY`/
   `GITHUB_TOKEN` resolving only against `/v1/canary/t`; worker records hits → `canary_triggered`.
5. **[opus]** `evidence/attest.ts`: in-toto Statement + DSSE; sign keyless (sigstore, OIDC in CI) /
   ed25519 local (`~/.agora/keys/local.key`, `tier:"local"`); verify **both** tiers → Cedar
   `attestation_tier`. `agora export --attestations`.
6. **[sonnet]** Five fixture servers in `test/fixtures/`: `benign-echo`, `greedy-fs`, `phone-home`,
   `exfiltrator`, `rug-pull`. Golden `ObservedProfile` snapshots (minus timing).

**New deps:** `sigstore` (from S3), maybe `dockerode` (or shell out to `docker`); `miniflare` (dev, for
canary round-trip test). **Docker required in CI** (ubuntu job) — the macOS matrix job **skips** vet
(Docker-on-macOS-CI is unavailable) and degrades to `verify`.

**Gate (brief S6):** golden attestations for all 5 fixtures; `exfiltrator` flagged via a real canary
round-trip against a local (miniflare) worker.

---

### S7 — Serve (1 wk)

**Objective:** `agora serve` MCP server (stdio + Streamable HTTP), 4 tools, local embeddings +
sqlite-vec, policy-filtered results, install-intent flow, SEP-1821 query-filtered `tools/list`.

**Work items**
1. **[opus]** `src/serve/` MCP server (protocol 2025-11-25): `search_tools`, `get_evidence`,
   `check_policy`, `request_install` (writes intent, prints `agora approve <id>`; **never mutates
   the stack**, §8). Policy-filter all results through Cedar `Serve` action.
2. **[sonnet]** Embeddings: `@xenova/transformers` `all-MiniLM-L6-v2` (local, no key) → `sqlite-vec`;
   incremental index rebuild on sync. Query-filtered `tools/list` + `tools/list_changed` on policy/
   catalog change.

**New deps:** `@xenova/transformers` (~big model download, cached locally — note for offline),
`sqlite-vec`.

**Gate (brief S7):** Claude Code connected to `agora serve` discovers a tool by capability + gets
evidence summaries; `request_install` never mutates state.

---

### S8 — Launch hardening (1 wk)

**Objective:** docs site (evidence-format spec = the marketing), `PRIVACY.md`, benchmark note,
`agora doctor` polish, **v2.0.0 release**.

**Work items**
1. **[opus]** Docs site + published **evidence-format spec** page (the spec IS the marketing, §13).
   Publish all generated `schemas/`.
2. **[sonnet]** `PRIVACY.md` (opt-in telemetry, D18); benchmark note reproducing fixture methodology;
   `agora doctor` polish (secrets-in-config scan with `file:line` + keychain/env remediation, §9).
3. **[you]** Register `agora-hub.dev`; final npm publish `v2.0.0`; clean-machine install-to-vet
   walkthrough recording.

**Gate (brief S8):** clean-machine install-to-vet walkthrough recorded; all schemas published.

---

## 5. Global risk register

| Risk | Phase | Mitigation |
|---|---|---|
| `better-sqlite3` native build on macOS+Linux CI | S1 | pin a prebuild-shipping version; cache; fallback build tools in CI |
| `cedar-wasm` ESM/bundle under `bun --compile` | S5 | spike-test load in the compiled binary early in S5 |
| Docker unavailable on macOS CI runner | S6 | vet runs on ubuntu job only; macOS degrades to `verify` (matches §12 Windows note) |
| sigstore/Rekor needs network | S3/S6 | verify degrades to `unknown` offline; sign only in CI (OIDC) or ed25519 local |
| `@xenova` model size / offline first run | S7 | vendor/cache model; document first-run download; feature works degraded without it |
| Cloudflare $5/mo + domain ~$12/yr | S2/S4/S8 | only load-bearing recurring cost (X4); no Durable Objects (§10 budget guard) |
| Feed private key custody | S4 | CI secret; pinned public key in binary; documented rotation = new release |
| LLM-enrich cost | S3 | deterministic checks are primary; LLM pass optional/keyed, off by default |

---

## 6. Human action checklist (X3)

- [ ] `npm deprecate opencode-agora "..."` (S0) — needs npm auth
- [ ] Publish agora to the **official MCP registry** (S0) — I prepare `server.json`
- [ ] Register **agora-hub.dev** (S2/S4/S8) — predicate/canary/revocation URLs depend on it
- [ ] Cloudflare account + Worker + D1 + KV; set `wrangler` token as CI secret (S2)
- [ ] Generate revocation **feed-signing keypair**; private key → CI secret (S4)
- [ ] Confirm `NPM_TOKEN` secret still valid for publish (S0/S8)
- [ ] (Optional) provide an LLM key if you want enrich's LLM pass on (S3)

## 7. Decision Amendments to log in the brief §14 (on execution)

- **DA-1 — marketplace gate reinterpreted** (X2): purge commerce framing + finish catalog rename;
  keep Claude-Code host-technical "plugin marketplace." Rationale: literal zero breaks host support.
- **DA-2 — toolchain: keep bun as installer** (X1): adopt vitest+biome per D17 but do **not** switch
  package manager; bun stays the runtime. Rationale: honors D17's named tools with minimal churn.
- **DA-3 — exit-code migration** (§9): the old `2=plan-changes / 3=scan-fail` contract is remapped to
  the brief's `1/2/3/4` in S1. Core CLI paths now route policy/drift failures to `1`, usage to `2`,
  network failures to `3`, and sandbox unavailability to `4`.
- **DA-4 — everything on `main`, push often** (owner directive): overrides the brief's
  one-PR-per-phase process. Phase gates remain as readiness checkpoints; `main` stays green per push.
- **DA-5 — S0 reframes the front door; the entangled legacy code-kill (commerce model + auth) folds
  into S1/S2.** The pre-pivot `Pricing`/`MarketplaceItem`/`Discussion` model **and** the auth/account
  layer (`src/auth/refresh.ts`, `commandAuth`, the `AGORA_API` live-source client in
  `helpers.ts`/`live.ts`) are woven through the *same* legacy surfaces — marketplace-era `welcome.ts`
  onboarding, TUI pages, `sourceOptions`. They are *superseded* by the `Artifact` model (S1) and the
  federation/host rework (S2), so hand-extracting auth in S0 would churn files that S1/S2 rewrite
  anyway (and auth is entangled enough that a partial pull leaves half-states, e.g. a login command
  with no refresh client). Rationale: avoid double churn (founder dislikes it). S0 therefore ships
  identity (README/AGENTS/ROADMAP/ARCHITECTURE, `docs/frozen` removed) + the toolchain; the *code* kill
  of commerce+auth lands with its neighbors in S1/S2. The §13 S0 "delete community/commerce+auth (D6)"
  is met for *front-door copy*; internal legacy code is tracked to zero by end of S2.

## 8. Open questions for you

1. **OpenCode plugin path** — if `opencode-agora` is deprecated (D1), should the OpenCode plugin entry
   become `agora-hub` (which exports `./opencode`), or keep `packages/opencode-agora` alive as a thin
   pinned re-export? (Affects README install copy + `publish.yml`.)
2. **`agora today` (news)** — brief §3 keeps it read-only, zero investment. Confirm we keep the
   current news sources as-is (just frozen), not trimmed.

Resolved: Smithery/Hugging Face are retained as non-canonical opt-in sources behind
`AGORA_ENABLE_NONCANONICAL_SOURCES`, per-source env flags, or `AGORA_NONCANONICAL_SOURCES`.
