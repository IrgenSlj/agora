# AGORA_BRIEF v2.0 — The Trust Plane for Agentic Tooling

**Status:** LOCKED for implementation · Supersedes AGORA_BRIEF v1.2 entirely
**Date:** 2026-07-06
**Owner:** Irgen Salianji (github.com/irgenslj)
**Executor:** Claude Code
**Repo:** github.com/IrgenSlj/agora · **npm:** `agora-hub` · **binary:** `agora`

---

## 0. How to read this brief

This is a full rewrite, not a patch of v1.2. Where v1.2 described a marketplace with a
trust layer, v2.0 describes a **trust plane** with a catalog attached. Any conflict
between this document and existing code, README copy, or v1.2 is resolved in favor of
this document. Sections 1–3 are strategy context (read once). Sections 4–12 are
normative specification (implement exactly; deviations require a logged Decision
Amendment at the bottom of this file). Section 13 is the phase plan with acceptance
gates. Claude Code should work phase by phase, opening one PR per phase, and must not
begin a phase before the previous phase's acceptance criteria pass in CI.

---

## 1. Mission and thesis

**One-sentence product:** Agora is the evidence-based trust and stack-management plane
for agent tooling — it verifies where MCP servers and Agent Skills come from, observes
what they actually do, enforces user-defined policy over both, and manages them across
every host (OpenCode, Claude Code, Cursor, Windsurf).

**The thesis (validated by the 2025–2026 incident record):** the agent-tooling
ecosystem has ~20k+ published MCP servers and a fast-growing skills ecosystem, near-zero
signing/provenance discipline, confirmed supply-chain attacks (typosquatted servers,
rug-pulls, description poisoning, credential exfiltration), and **no revocation
mechanism whatsoever**. Registries answer "what exists." Nobody answers, at the point
of installation and execution, "should THIS artifact be trusted, by THIS project,
under THIS policy — and what happens when that answer changes tomorrow?"

**Positioning rules (apply to all copy, docs, README):**
- We are a *customs office over federated registries*, never a competing catalog.
- We deal in **evidence** (verifiable attestations), never in opaque numeric
  "trust scores."
- We are host-neutral: OpenCode is one integration among four, not the identity.
- No commerce language anywhere. No "marketplace," no "trading."

---

## 2. Locked decisions (D-register)

| # | Decision | Rationale (short) |
|---|----------|-------------------|
| D1 | Single name: npm package `agora-hub`, binary `agora`, repo tagline "the trust plane for agentic tooling." `opencode-agora` is deprecated with an npm deprecation notice pointing to `agora-hub`. | Ends the three-name split. |
| D2 | **Evidence over scores.** No numeric trust score exists anywhere in the product. All verdicts are the output of policy evaluation over attestations. | Scores are gameable and commodity; evidence is defensible. |
| D3 | Attestation format: **in-toto Statements** wrapped in **DSSE envelopes**. Agora-issued signatures use **Sigstore keyless** (Fulcio + Rekor) when online, ed25519 local key fallback when offline. | Interop with the existing supply-chain ecosystem; nothing proprietary. |
| D4 | Policy engine: **Cedar** via `@cedar-policy/cedar-wasm`. Policies live in-project as `.cedar` files referenced from `agora.toml`. | Real policy language, WASM-embeddable, no server needed. |
| D5 | Revocation: signed JSON feed (ed25519, key pinned in the binary), monotonic version counter, TUF-style anti-rollback on the client. Hosted on the Cloudflare worker. | The ecosystem's most glaring absence; days of work; makes Agora infrastructure. |
| D6 | Community backend (profiles, reviews, discussions) is **deleted**, not frozen. News feed is retained read-only with zero new investment. | Scope discipline; moderation liability; retention telemetry beats reviews. |
| D7 | Sourcing = **federation adapters** (official MCP registry as canonical, then Glama, then PulseMCP). The AI curator is repurposed: it never *discovers*, it only *verifies/enriches*. | Catalog maintenance drops to ~0; breadth becomes maximal. |
| D8 | Two first-class artifact kinds: `mcp-server` and `agent-skill`. All schemas, policies, and commands treat both uniformly via the `Artifact` model. | Skills have the same trust gap and are cheaper to analyze. |
| D9 | Sandbox for `agora vet`: **Docker backend is the default and the only Phase-1 backend.** Backend interface is pluggable; `bubblewrap` (Linux) and `sandbox-exec` (macOS) are Phase-2; eBPF via integration with existing OSS (not authored in-house) is Phase-3. Unvetted artifacts are **never** executed on the host during vet. | Achievable now; leaves the SOTA door open. |
| D10 | `agora serve` exposes Agora itself as an MCP server (stdio + Streamable HTTP), implementing query-filtered `tools/list` in the spirit of SEP-1821, plus policy-filtered capability search. | The agent is the second user. Standards adjacency. |
| D11 | Backend stays slim: Cloudflare Worker + D1 + KV + cron. **No auth, no user accounts, no sessions** in this brief's scope. | Kills the auth/OAuth tarpit that blocked v1.x deploys. |
| D12 | Every wire/disk schema is defined in **zod**, with JSON Schema exported to `/schemas` at build time and versioned (`.../v1`). | Machine-checkable contracts; enables third-party consumers. |
| D13 | Local state: SQLite via `better-sqlite3` at `~/.agora/agora.db`; content-addressed blob cache at `~/.agora/cas/<sha256>`. | Fast, dependency-light, offline-first. |
| D14 | `agora.toml` = human intent (what I want). `agora.lock` = machine truth (exactly what is installed, hashed, verified). Lock is committed to VCS. | Reproducibility; the lockfile is the rug-pull tripwire. |
| D15 | Canonicalization for all hashing of JSON structures: **RFC 8785 (JCS)** via the `canonicalize` package, then SHA-256. | Deterministic hashes across platforms. |
| D16 | Artifact identity: **purl** (package-url) strings, e.g. `pkg:npm/@org/server@1.2.3`, `pkg:github/owner/repo@<commit>` for skills. | Ecosystem-standard identity; joins cleanly with vuln/provenance data. |
| D17 | TypeScript strict, Node ≥ 20, ESM only. Test runner: vitest. Lint: biome. CI: GitHub Actions (lint, typecheck, unit, integration-with-docker matrix on ubuntu + macos). | Baseline hygiene. |
| D18 | Telemetry/evidence-pool contribution is **opt-in, off by default**, anonymized, and documented in `PRIVACY.md`. Phase-1 ships only the local plumbing + a stubbed endpoint. | Trust product must be trustworthy. |

---

## 3. What is kept, killed, and migrated from the current codebase

**Keep (refactor in place):**
- CLI framework, command routing, config loading.
- `src/hubs/` pluggable-source pattern → becomes `src/federation/adapters/`.
- Multi-host config writers (OpenCode / Claude Code / Cursor / Windsurf) → `src/hosts/`.
- Stack manager (`agora.toml`, add/remove/sync) — this is the daily-driver surface.
- SQLite cache layer.

**Kill (delete code + docs + copy):**
- Community backend (accounts, reviews, discussions, profiles) and all auth code.
- Commerce/"trading" copy and any stubbed payment code paths.
- Curator-as-discovery cron jobs (GitHub/HF crawling for *finding* servers).

**Migrate/repurpose:**
- Curator LLM pipeline → `src/verify/enrich.ts`: given an artifact already known via
  federation, extract/normalize its declared capability manifest from README + code,
  flag description-poisoning patterns (imperative instructions to the model inside
  tool descriptions, e.g. "ignore previous", "do not tell the user", hidden HTML).
- News feed → static fetch in `agora today`, no server component.

---

## 4. Architecture overview

```
                        ┌─────────────────────────────────────────────┐
   upstream sources     │  FEDERATION  src/federation/                │
   official registry ──▶│  adapters: official / glama / pulsemcp      │
   glama / pulsemcp  ──▶│  sync → normalized Artifact records         │
   skills sources    ──▶│                                             │
                        └───────────────┬─────────────────────────────┘
                                        ▼
                        ┌─────────────────────────────────────────────┐
                        │  EVIDENCE    src/evidence/                  │
                        │  provenance verify (sigstore)               │
                        │  schema/description hash + diff             │
                        │  vet: sandboxed run → ObservedProfile       │
                        │  canary tokens                              │
                        │  output: in-toto/DSSE attestations          │
                        └───────────────┬─────────────────────────────┘
                                        ▼
                        ┌─────────────────────────────────────────────┐
                        │  POLICY      src/policy/                    │
                        │  Cedar engine (cedar-wasm)                  │
                        │  revocation feed client + quarantine        │
                        │  enforcement points: add / sync / serve     │
                        └───────────────┬─────────────────────────────┘
                                        ▼
                        ┌─────────────────────────────────────────────┐
                        │  SURFACES                                   │
                        │  CLI (src/cli/)                             │
                        │  agora serve — MCP server (src/serve/)      │
                        │  hosts writers (src/hosts/)                 │
                        └─────────────────────────────────────────────┘

   Cloudflare Worker (workers/):  /v1/catalog  /v1/revocations
                                  /v1/canary/:token  cron: federation sync
```

Module map (target tree):

```
src/
  cli/                 command implementations, one file per command
  model/               zod schemas: artifact, manifest, profile, attestation,
                       lockfile, revocation, policy-entities  (Section 5)
  federation/
    adapters/          official.ts glama.ts pulsemcp.ts skills-github.ts
    sync.ts            dedupe (by purl), precedence, incremental sync
  evidence/
    provenance.ts      sigstore verification of npm provenance / gh attestations
    schemahash.ts      JCS+sha256 of tools/list, description extraction
    diff.ts            manifest & schema drift detection (rug-pull tripwire)
    vet/
      index.ts         orchestrator
      backends/        docker.ts (P1), bwrap.ts sandbox-exec.ts (P2)
      canary.ts        token mint + env injection + worker callback contract
      extract.ts       raw logs → ObservedProfile
    attest.ts          in-toto Statement builder + DSSE signing (sigstore/ed25519)
    enrich.ts          LLM manifest extraction + description-poisoning heuristics
  policy/
    engine.ts          cedar-wasm wrapper, entity construction from evidence
    revocation.ts      feed client, signature verify, anti-rollback, quarantine
    defaults/          baseline.cedar (shipped default policy)
  hosts/               opencode.ts claudecode.ts cursor.ts windsurf.ts
  serve/               MCP server: tools, embeddings search, policy filter
  store/               sqlite + CAS blob cache
workers/
  api/                 hono app: catalog, revocations, canary, health
schemas/               generated JSON Schema output (build artifact)
```

---

## 5. Data model (normative — src/model/)

All types below are zod schemas first; TS types are inferred. JSON Schema is exported
at build to `schemas/<name>.v1.json`. Field names are wire-format (snake_case on wire,
camelCase in TS via transform).

### 5.1 Artifact identity

```ts
// purl is the primary key everywhere. Examples:
//   pkg:npm/@modelcontextprotocol/server-filesystem@2026.1.0
//   pkg:npm/agora-hub@2.0.0
//   pkg:github/owner/skill-repo@3f9c2e1   (agent-skill pinned to commit)
export const ArtifactKind = z.enum(["mcp-server", "agent-skill"]);

export const ArtifactRef = z.object({
  purl: z.string(),                  // package-url, validated by packageurl-js
  kind: ArtifactKind,
  display_name: z.string(),
  publisher: z.object({
    namespace: z.string(),           // e.g. reverse-DNS from official registry,
                                     // npm scope, or github owner
    identity_verified: z.boolean(),  // provenance chain ties publisher to source
  }),
  sources: z.array(z.object({        // which upstream registries know it
    adapter: z.enum(["official", "glama", "pulsemcp", "skills-github", "manual"]),
    upstream_id: z.string(),
    url: z.string().url(),
    first_seen: z.string().datetime(),
  })),
});
```

### 5.2 Declared capability manifest (what the artifact claims)

Built from three inputs, recorded with their provenance: (a) `server.json` /
registry metadata, (b) `tools/list` handshake output, (c) `enrich.ts` LLM extraction
from README/code. Each field carries `source: "registry" | "handshake" | "inferred"`.

```ts
export const DeclaredManifest = z.object({
  purl: z.string(),
  version: z.string(),
  transports: z.array(z.enum(["stdio", "streamable-http"])),
  auth_model: z.enum(["none", "static-key", "oauth2.1", "oidc", "unknown"]),
  tools: z.array(z.object({
    name: z.string(),
    description_sha256: z.string(),      // hash of raw description text
    input_schema_sha256: z.string(),     // JCS hash of the JSON schema
    annotations: z.record(z.unknown()).optional(),
  })),
  declared_capabilities: z.object({      // coarse, policy-addressable buckets
    fs_read: z.boolean(), fs_write: z.boolean(),
    net_egress: z.array(z.string()),     // hostnames or ["*"]
    exec: z.boolean(),                   // spawns processes
    credentials: z.array(z.string()),    // env var names it asks for
  }),
  manifest_sha256: z.string(),           // JCS hash of everything above
});
```

### 5.3 Observed profile (what the artifact actually did — output of `agora vet`)

```ts
export const ObservedProfile = z.object({
  purl: z.string(),
  version: z.string(),
  vet_level: z.enum(["L0-offline", "L1-proxied-net"]),
  backend: z.enum(["docker", "bwrap", "sandbox-exec"]),
  duration_ms: z.number(),
  handshake_ok: z.boolean(),
  tools_listed: z.number(),
  observed: z.object({
    files_read: z.array(z.string()),     // normalized paths, capped at 200
    files_written: z.array(z.string()),
    hosts_contacted: z.array(z.object({
      host: z.string(), port: z.number(), during: z.enum(["startup","handshake","tool-call"]),
    })),
    processes_spawned: z.array(z.string()),  // argv[0] only
    env_read: z.array(z.string()),           // env var names accessed (best effort)
    canary_triggered: z.boolean(),           // ANY use of injected canary creds
  }),
  divergence: z.array(z.object({         // computed declared-vs-observed diff
    kind: z.enum(["undeclared-egress","undeclared-fs-write","undeclared-exec",
                  "undeclared-credential-use","canary-exfiltration"]),
    detail: z.string(),
    severity: z.enum(["info", "warn", "critical"]),
  })),
});
```

### 5.4 Attestation envelope

Every evidence product (provenance verification result, manifest hash, observed
profile) is emitted as an **in-toto Statement** inside a **DSSE envelope**:

```
Statement._type = "https://in-toto.io/Statement/v1"
subject          = [{ name: <purl>, digest: { sha256: <artifact hash> } }]
predicateType    = one of:
  "https://agora-hub.dev/attestations/declared-manifest/v1"
  "https://agora-hub.dev/attestations/observed-profile/v1"
  "https://agora-hub.dev/attestations/provenance-verification/v1"
predicate        = the zod-validated object (5.2 / 5.3 / provenance result)
```

Signing: `sigstore` npm package, keyless (OIDC via GitHub Action for CI-issued
attestations; interactive OAuth for maintainer-issued). Offline/local fallback:
ed25519 key at `~/.agora/keys/local.key`, envelope marked `"tier": "local"`.
Verification helpers in `attest.ts` must verify BOTH tiers and surface the tier
to policy (Cedar attribute `attestation_tier`).

### 5.5 Lockfile — `agora.lock` (committed to VCS)

```jsonc
{
  "lockfile_version": 1,
  "generated_by": "agora-hub@2.0.0",
  "artifacts": [{
    "purl": "pkg:npm/@modelcontextprotocol/server-filesystem@2026.1.0",
    "kind": "mcp-server",
    "integrity": { "tarball_sha256": "...", "manifest_sha256": "..." },
    "provenance": { "verified": true, "builder": "github-actions",
                    "source_repo": "github.com/...", "rekor_log_index": 12345678 },
    "tools": [{ "name": "read_file",
                "description_sha256": "...", "input_schema_sha256": "..." }],
    "policy_verdict": { "decision": "allow", "policy_sha256": "...",
                        "evaluated_at": "2026-07-06T12:00:00Z" },
    "hosts": ["claudecode", "cursor"]        // where it is synced
  }]
}
```

**Drift rule (the rug-pull tripwire):** on every `agora sync`, `agora update`, and
`agora doctor`, recompute `manifest_sha256` and per-tool hashes from the installed
artifact. ANY mismatch with the lockfile → the artifact is moved to `quarantined`
state, hosts configs are rewritten without it, and the diff is printed. Description
text changes are always at least `warn`; capability-expanding changes are `critical`.

### 5.6 Revocation feed

```jsonc
// GET https://api.agora-hub.dev/v1/revocations   (also mirrored to GitHub raw)
{
  "feed_version": 42,                    // strictly monotonic
  "generated_at": "2026-07-06T00:00:00Z",
  "key_id": "agora-feed-2026-a",
  "entries": [{
    "id": "AGR-2026-0007",
    "purl_pattern": "pkg:npm/postmark-mcp",   // matches all versions unless range set
    "versions": "<=1.0.16",
    "reason": "credential-exfiltration",
    "severity": "critical",                    // critical | high | advisory
    "refs": ["https://..."],
    "added_at": "2026-07-01T00:00:00Z"
  }],
  "signature": "base64(ed25519 over JCS(feed sans signature))"
}
```

Client behavior (`policy/revocation.ts`): public key pinned as a constant in the
binary (with a documented key-rotation procedure requiring a new release);
verify signature; reject any feed whose `feed_version` ≤ cached version
(anti-rollback); on match against installed artifacts: `critical|high` →
immediate quarantine + host config rewrite + non-zero exit in CI mode;
`advisory` → warn. Poll on every network-touching command and at most every 6h
via a jittered check; never block CLI startup on network.

---

## 6. Evidence plane details

### 6.1 Provenance verification (`evidence/provenance.ts`)
- For npm artifacts: fetch provenance attestation via the npm registry API; verify
  with `sigstore` against the public good instance (Fulcio/Rekor). Extract: builder
  identity, source repo, commit. Record `provenance-verification/v1` attestation.
- For GitHub-hosted skills: verify GitHub artifact attestations when present
  (`gh attestation` API equivalent via REST); else record `verified:false` with
  reason `no-provenance` (policy decides what that means — we do not hard-fail).
- Cross-check: registry namespace vs. provenance source repo owner. Mismatch →
  divergence `publisher-mismatch`, severity `critical` (typosquat signature).

### 6.2 Vet pipeline (`evidence/vet/`)
Docker backend, Phase 1, two levels:
- **L0-offline:** `docker run --rm --network=none`, artifact installed into the
  image at build time from the CAS-cached tarball (never `npx` straight from the
  registry inside vet). Perform MCP initialize + `tools/list` + one inert call per
  tool where the input schema permits a safe no-op construction (all-optional or
  string-only params get placeholder values; anything else is skipped and noted).
- **L1-proxied-net:** same, but `--network` on a dedicated bridge whose only route
  is a logging forward proxy container (mitmproxy in transparent mode, TLS
  passthrough — we log SNI/host:port, we do NOT decrypt). Every contacted host is
  recorded with its phase (startup/handshake/tool-call).
- File/process observation Phase 1 = `strace -f -e trace=%file,%process` inside the
  container (acceptable overhead for one-shot vet; eBPF comes later via backend
  plugin). Raw logs → `extract.ts` → `ObservedProfile`.
- **Canary tokens (`canary.ts`):** before the run, mint token id `t`; inject env
  `AWS_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN` etc. with values that
  embed `t` and resolve only against `https://api.agora-hub.dev/v1/canary/t`.
  Worker records any hit (timestamp, source IP hash, header fingerprint) →
  `canary_triggered:true` on next feed sync → automatic candidate for the
  revocation feed. This detects exfiltration that static analysis cannot.

### 6.3 Enrichment & description-poisoning heuristics (`evidence/enrich.ts`)
Deterministic checks first (regex/AST, no LLM): imperative-to-model phrases in tool
descriptions ("ignore previous", "do not mention", "you must always"), zero-width
unicode, HTML comments, base64 blobs > 128 chars, instructions referencing other
tools by name (cross-tool shadowing signature). LLM pass (optional, keyed) only to
normalize declared capabilities from README. All findings land in the manifest
attestation, never in a hidden database.

---

## 7. Policy plane details

### 7.1 Cedar integration (`policy/engine.ts`)
Entity model (Cedar schema shipped in `policy/defaults/agora.cedarschema`):

```
entity Project;
entity Publisher = { namespace: String, identity_verified: Bool };
entity Artifact = {
  kind: String, publisher: Publisher,
  provenance_verified: Bool, attestation_tier: String,   // "sigstore" | "local" | "none"
  revoked: Bool, canary_triggered: Bool,
  fs_read: Bool, fs_write: Bool, exec: Bool,
  net_hosts: Set<String>,
  divergence_max: String,        // "none" | "info" | "warn" | "critical"
};
action Install, Sync, Serve appliesTo { principal: Project, resource: Artifact };
```

Default shipped policy (`baseline.cedar`) — permissive but safe:

```cedar
forbid (principal, action, resource) when { resource.revoked };
forbid (principal, action, resource) when { resource.canary_triggered };
forbid (principal, action == Action::"Install", resource)
  when { resource.divergence_max == "critical" };
permit (principal, action, resource);
```

Projects override via `agora.toml → policy.files = ["policies/team.cedar"]`.
`agora policy check` evaluates every installed artifact and prints a table of
decisions with the determining policy line. `agora policy test` runs Cedar's own
test format against fixture entities (CI-able governance).

**Enforcement points (exhaustive):** `add/install`, `update`, `sync` (before
writing any host config), `serve` (search results filtered to `permit` only),
`doctor` (report-only), and CI mode `agora policy check --ci` (exit 1 on any
forbid affecting the lockfile).

### 7.2 Quarantine semantics
Quarantined = present in `~/.agora/cas` but removed from all host configs and
flagged in lockfile `state:"quarantined"`. Reversible via explicit
`agora unquarantine <purl> --accept-risk` which records an override attestation
(auditable consent, satisfies SEP-1024's consent-and-visibility spirit).

---

## 8. `agora serve` — the agent-facing MCP server (`src/serve/`)

Transports: stdio (default) + Streamable HTTP (`--http :7777`, localhost-bound).
Protocol: 2025-11-25. Tools exposed:

| tool | behavior |
|---|---|
| `search_tools(query, k=5)` | Embedding search over the federated catalog's tool descriptions; results filtered through Cedar (`Serve` action); each hit returns purl, tool name, declared caps, evidence summary (provenance ✓/✗, vet ✓/✗, divergences). |
| `get_evidence(purl)` | Returns the DSSE attestation bundle for an artifact. |
| `check_policy(purl)` | Cedar decision + determining policy for the current project. |
| `request_install(purl)` | Does NOT install. Writes an install-intent record and prints an approval command for the human (`agora approve <id>`). Agents never mutate the stack directly. |

Embeddings: `@xenova/transformers` with `all-MiniLM-L6-v2` (local, no key) into
`sqlite-vec`; index rebuilt incrementally on sync. Also honor query-filtered
`tools/list` (SEP-1821 pattern) so hosts that adopt it get filtering for free.
`tools/list_changed` notification fires when policy or catalog changes alter the
permitted set.

---

## 9. CLI contract (v2 surface)

```
agora search <query> [--kind mcp-server|agent-skill] [--json]
agora info <purl>                      # evidence summary, human-readable
agora add <purl|name> [--host all|...] # federate→verify→policy→install→lock→sync
agora remove <purl>
agora update [purl]                    # drift diff shown BEFORE applying; policy re-eval
agora sync                             # lockfile → host configs; enforcement point
agora vet <purl|path> [--level L0|L1] [--json]
agora verify <purl>                    # provenance + hashes only (no sandbox)
agora doctor                           # env, hosts, secrets-in-config scan, drift, feed age
agora policy init|check [--ci]|test
agora quarantine list / agora unquarantine <purl> --accept-risk
agora lock verify                      # CI: recompute all hashes, exit 1 on drift
agora export --attestations [-o file]  # DSSE bundle for compliance/audit
agora serve [--http :7777]
agora today                            # news, unchanged, zero investment
```

Exit codes: 0 ok · 1 policy forbid / drift / revocation hit · 2 usage · 3 network ·
4 sandbox unavailable. All commands support `--json` (stable, schema-versioned).
`agora doctor` includes the config secrets scan: plaintext keys in host config
files → warn with the exact file:line and a `keychain`/env-ref remediation hint.

---

## 10. Cloudflare worker (`workers/api/`, hono + D1 + KV)

Endpoints (all public-read, no auth):
- `GET /v1/catalog?cursor=` — normalized artifact records (federation output),
  paginated; served from D1, refreshed by cron every 6h.
- `GET /v1/revocations` — the signed feed (KV-cached; source of truth is a signed
  JSON file in the repo, deployed via CI so every feed change is a reviewed PR).
- `POST /v1/canary/:token` — records hits; rate-limited; returns 200 always.
- `GET /v1/health`.
Cron: federation sync (official → glama → pulsemcp), dedupe by purl, upsert D1.
Budget guard: stay within Workers paid tier ($5/mo); no Durable Objects.

---

## 11. Testing strategy

- **Fixture servers** in `test/fixtures/`: `benign-echo` (declares/does nothing),
  `greedy-fs` (undeclared file writes), `phone-home` (undeclared egress),
  `exfiltrator` (reads env, posts canary creds), `rug-pull` (v1 benign, v2 changes
  a tool description + adds egress). Each is a tiny stdio MCP server.
- Golden attestations: vet each fixture in CI (ubuntu runner with Docker), snapshot
  the ObservedProfile minus timing fields, assert divergences match expectations —
  `exfiltrator` MUST produce `canary-exfiltration/critical`; `rug-pull` v1→v2 MUST
  trip the lockfile drift rule.
- Policy suite: `agora policy test` fixtures covering every baseline rule.
- Revocation client: feed-rollback attack test (older version replay must be
  rejected), bad-signature test, quarantine-then-unquarantine round trip.
- Adapter contract tests against recorded upstream responses (no live calls in CI).

## 12. Non-goals (this brief)

No hosting of third-party servers · no commerce · no reviews/accounts · no
in-house eBPF or WASM runtime · no Windows sandbox backend (vet degrades to
`verify` + explicit notice on Windows) · no crowdsourced evidence pool beyond the
opt-in local plumbing and stub endpoint (that is the v2.1 north star, and nothing
in the data model may preclude it — which is why attestations are self-contained
DSSE bundles keyed by purl+digest).

---

## 13. Phase plan (one PR per phase; gate = all criteria green in CI)

**S0 — Hygiene & identity (0.5 wk).** Rename to `agora-hub` (npm deprecate old),
README rewrite per Section 1 positioning, delete community/commerce code (D6),
CI matrix up, publish Agora to the official MCP registry.
*Gate:* fresh `npm i -g agora-hub && agora --help` works on macOS+Linux; repo
contains zero occurrences of "marketplace/trading"; CI green.

**S1 — Data model & lockfile (1 wk).** All Section-5 zod schemas + JSON Schema
export; purl handling; CAS store; `agora lock verify`.
*Gate:* schema snapshot tests; lockfile round-trips byte-identical.

**S2 — Federation (1 wk).** Official-registry adapter (canonical), Glama +
PulseMCP adapters, dedupe/precedence, `agora search/info` from local sync;
worker `/v1/catalog` + cron.
*Gate:* `agora search filesystem` returns merged, deduped results offline after
one sync; adapter contract tests green.

**S3 — Provenance & drift (1 wk).** sigstore verification, schema/description
hashing, drift rule wired into `sync/update/doctor`; description-poisoning
deterministic checks.
*Gate:* `rug-pull` fixture v1→v2 quarantines automatically with a printed diff.

**S4 — Revocation (0.5 wk).** Feed format, signing CI job, worker endpoint,
client with anti-rollback, quarantine semantics.
*Gate:* revoking `phone-home` in the feed quarantines it on next `agora sync`;
rollback replay rejected.

**S5 — Policy (1 wk).** cedar-wasm engine, entity construction, baseline policy,
`policy init/check/test`, all enforcement points, `--ci` mode.
*Gate:* policy test suite green; forbidding `fs_write` blocks `greedy-fs` install.

**S6 — Vet (2 wk).** Docker backend L0+L1, strace extraction, canary mint +
worker callback, ObservedProfile, attestation emission (sigstore keyless in CI,
ed25519 local), `agora vet` + `agora export --attestations`.
*Gate:* golden attestations for all five fixtures; `exfiltrator` flagged via a
real canary round-trip against a local worker (miniflare).

**S7 — Serve (1 wk).** MCP server with the four tools, local embeddings +
sqlite-vec, policy-filtered results, install-intent flow, SEP-1821-style
query-filtered tools/list.
*Gate:* Claude Code connected to `agora serve` can discover a tool by capability
and receives evidence summaries; `request_install` never mutates state.

**S8 — Launch hardening (1 wk).** Docs site (evidence format spec published as
its own page — the spec IS the marketing), PRIVACY.md, benchmark note reproducing
the fixture methodology, `agora doctor` polish, v2.0.0 release.
*Gate:* clean-machine install-to-vet walkthrough recorded; all schemas published.

Total: ~8–9 weeks of focused part-time work. S4 and S5 may run in parallel with
S3 if desired; S6 must follow S5 (attestations feed policy entities).

---

## 14. Decision amendments log

*(Claude Code: append dated entries here when implementation forces a deviation;
never silently diverge.)*

**Execution plan:** `docs/V2_EXECUTION_PLAN.md` (the *how* for §13). Owner directive 2026-07-06:
plan the whole build first, prepare the repo, then implement — **everything on `main`, push often,
delegate where possible.**

- **DA-1 (2026-07-06) — "marketplace/trading" gate reinterpreted.** The §13 S0 literal "zero
  occurrences of marketplace" is impossible without breaking Claude Code plugin support
  (`/plugin marketplace add`, `.claude-plugin/marketplace.json` are host-technical terms). Adopted:
  zero *commerce-framed* marketplace/trading language in user-facing copy; host-technical usages kept.
- **DA-2 (2026-07-06) — toolchain keeps bun as installer/runtime.** D17's vitest + biome are adopted
  in S0; the package manager is **not** switched (bun stays), to honor D17's named tools with minimal
  churn. `engines.node` bumped to `>=20`.
- **DA-3 (2026-07-06) — exit-code contract migration (§9).** The pre-v2 `2=plan-changes /
  3=scan-fail` codes are remapped to §9's `1/2/3/4` during S1; the mapping is documented for agent
  integrations. Implementation note (2026-07-22): core CLI command paths now use the shared
  `ExitCode` constants for policy/drift, usage, network, and sandbox categories.
- **DA-4 (2026-07-06) — everything on `main`, push often** (owner directive) overrides the brief's
  one-PR-per-phase process (§0/§13). Phase gates remain as readiness checkpoints; `main` is kept green
  at every push.
- **DA-5 (2026-07-06) — S0 kills framing + `src/auth/` only; legacy commerce _data model_ retired in
  S1/S2.** The pre-pivot `Pricing`/`MarketplaceItem`/`Discussion` model is *superseded* by the
  `Artifact` model (S1) and federation catalog (S2) rather than hand-deleted in S0, to avoid throwaway
  churn. See `docs/V2_EXECUTION_PLAN.md` §7.

— END OF BRIEF —
