# Roadmap

Where `agora` is headed. For the *why* — the three-surface model, the open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). For what's already shipped, see [`CHANGELOG.md`](./CHANGELOG.md).

## Direction

`agora` is a **standalone terminal marketplace hub** for the agentic-coding ecosystem. The OpenCode plugin is one surface, not the product. The destination is an **open, self-regulating marketplace** where third-party developers publish (and later sell) skills, tools, and kits — `agora` provides discovery, trust, and delivery; the developers bring the goods.

Three pillars are live end-to-end — a curated + live **marketplace**, a ranked **news feed**, and a threaded **community** — plus a real trust layer (permission manifests, pre-install scan gate, flag/kill-switch, earned reputation), an MCP server mode, and a hybrid bash/chat shell. The next step is **reach and depth**: make `agora` a place developers passively receive value and that grows itself, and turn its informational trust layer into something closer to enforcement.

**The wedge.** `agora` is the only marketplace in this space that lives *in the terminal where agentic coding happens* and is *itself consumable by an agent* (the `agora mcp` server). The website competitors can't install a capability for a running agent mid-task; `agora` can — behind its scan gate. So beyond the three content pillars, `agora` is evolving into two things they can't be: the **agent stack manager** (a cross-tool package-manager for the MCP servers / skills / workflows your agent uses daily) and the **safe capability-acquisition gateway** an autonomous agent calls when it hits a capability gap. These *amplify* the marketplace and community — they do not replace them. Discovery still happens in the marketplace; conversation still happens in the community; the stack manager is simply the daily-use loop that connects discover → install → manage → publish → discuss.

## Status: 0.4.4 shipped — the agent stack manager, with a living home & one cohesive look

**0.4.4 released 2026-05-25.** Builds on the **0.4.3 "Destination"** cut (2026-05-23: hardened AI curator, offline BM25 search, cross-session shell memory, the full agent stack manager + local capability search). 0.4.4 adds a **living home page** (your-stack band, ranked opportunities, velocity-aware Hot/Top/Repos trending, "since you last looked") and lands the **Claude Design "Agora TUI System"** as one coherent visual identity across both the TUI and the one-shot CLI. See [CHANGELOG](./CHANGELOG.md). Per release policy we sculpt heavily and bump once per landed cut, not per PR. The next milestone is gated on the backend deploy — see [the next era](#the-next-era--agent-stack-manager-capability-search--self-curation) below.

---

## Current track — product first (2026-05)

The near-term focus is **depth over breadth**: make `agora` genuinely good to *live in* before widening it. Three product phases, sequenced so each compounds on the last. Sustainability (sponsorship, then the deferred [commerce](#phase-3--commerce-deferred-until-trust-lands) work) stays in the background — we earn a daily audience with a great product first, and let revenue follow. Legend: ✓ done · ◑ partial · ☐ planned.

### Phase 1 — The first 60 seconds *(in progress)*

A newcomer's first minute is the strongest predictor of whether they return. Make it correct, safe, and inviting.

- ✓ **First-touch safety** — `agora init --template` no longer overwrites existing files (refuses, with `--force` to opt in) and registers a **project-local** `opencode.json` instead of silently mutating the global config; `agora welcome` no longer points at a dead command or a fake backend URL. (PR #38)
- ☐ **Welcome, reordered around what works offline** — lead with the zero-config, zero-account wins (browse · `today` · scaffold); frame sign-in as genuinely optional. *(design-gated — founder sets the shape)*
- ☐ **A landing that delivers in one command** — bare `agora` / `agora today` should show something genuinely useful on first run, with an obvious next step. *(design-gated — founder)*
- ☐ **One obvious "start here"** — clarify `npx opencode-agora` vs `agora init` so there's a single front door.

### Phase 2 — Passive value: the daily digest *(next)*

Turn `agora today` into something worth opening every day — the surface that later carries both reach (the Wave 3 bot) and sustainability.

- ☐ **Digest as a first-class, shareable artifact** — a clean, opinionated daily digest (news + trending + new servers) rendered to terminal *and* markdown/email.
- ☐ **Editorial quality** — a one-line "why it matters" per item and cross-source dedupe (builds on [Thread C](#thread-c--self-curation-flywheel-needs-wave-2-backend) news self-curation).
- ☐ **Distribution groundwork** — a reusable digest formatter the Discord/Telegram bot ([Wave 3](#wave-3--reach-discord--telegram-needs-backend-live--bot-tokens)) and any future newsletter share.

### Phase 3 — The daily habit: stack-manager depth

Deepen the daily-driver loop so `agora` is what you reach for to manage your agent setup.

- ✓ **`agora update`** — bump pinned MCP server versions across tools, dry-run by default. (PR #37)
- ☐ **Drift & health nudges** — proactively surface stack drift and unhealthy servers (the home "opportunities" feed already seeds this).
- ☐ **Stack-sharing polish** — make `freeze` / `sync --from` a frictionless "clone someone's setup."

---

## The "Destination" waves

Sequenced by dependency so each ships value on its own. **Wave 1 shipped in 0.4.3**, along with the [agent stack manager and local capability search](#the-next-era--agent-stack-manager-capability-search--self-curation) (Threads A & B below). Waves 2–4 are the next milestone, gated on the backend deploy. Legend: ✓ done · ◑ partial · ☐ planned.

### Wave 1 — Command excellence & self-growing catalog *(no external accounts required — shipped)*

The local layer: make the tool sharper and the catalog able to grow itself.

- ✓ **Cross-session shell memory** — `/recall <query>` searches every past per-cwd transcript; `/sessions` lists recent sessions with turn counts and last activity. Built on the existing transcript store (`src/transcript.ts` → `listSessions` / `searchTranscripts`).
- ✓ **Never-dead daily surface** — `agora today` and the TUI Home news column fall back to recent cached items when nothing is fresh, and show an actionable `agora news --refresh` hint when the cache is empty — never a bare "Nothing in the last 24h."
- ✓ **Compiled standalone binary (build script)** — `bun run build:binary` (`bun build --compile`) produces `dist/agora`. The compile works today; *signed, notarized, Homebrew-distributable* binaries are deferred to Wave 4 (so `npm`/`npx` stays the supported install path).
- ✓ **Harden the AI curator** — `src/curator/` discovers MCP servers/skills from GitHub + HuggingFace and AI-verifies each, now robust enough to run unattended: bounded concurrency (`--concurrency`), three modes (incremental / `--refresh` re-verifies items older than `--stale-days` for scheduled runs / `--force`), resumable progress via incremental cache writes, dedupe against the bundled catalog *and* the cache, per-failure-class stats with graceful degradation when `opencode` or repo metadata is unavailable, and a clear `agora curate --status` (mode + stats from the persisted run-state).
- ✓ **Indexed + semantic catalog search** — replaced the linear substring scan with a no-dependency, offline **BM25 inverted index** (`src/search/catalog-index.ts`) with field weighting (name ×3, tags/id ×2, description ×1), stopword + intent-phrase stripping so "find something that does X" reduces to its content terms, and query-side dev-term synonym expansion (db→database, k8s→kubernetes, pg→postgresql…). `searchMarketplaceItems` ranks by BM25 when a query is present and stays fast as the curated catalog grows. The index is memoized alongside the item list.

### Wave 2 — Deploy the backend & schedule curation *(needs: Cloudflare account)*

The single roadmap blocker for the social layer. Everything is coded; this is operational.

- ☐ **One-command, non-technical-friendly deploy** — a scripted `wrangler deploy` plus a secret-setup wizard (GitHub OAuth client, `AUTH_SECRET`, admin ids) so the hosted backend (Cloudflare Workers + D1, in `backend/`) goes live without hand-editing TOML. Production `wrangler.toml`, D1 binding, DNS.
- ☐ **Catalog-as-a-service** — server-side curated catalog so every user gets a fat, fresh, AI-verified marketplace without running AI locally; the bundled JSON stays the offline fallback.
- ☐ **Scheduled server-side curation** — a Cloudflare Cron Trigger re-runs curation weekly so the catalog grows and re-verifies itself for everyone.
- ☐ **Real accounts unlocked** — once live, auth / community / reviews / publishing stop being "configure a backend" and become real for users.

### Wave 3 — Reach: Discord & Telegram *(needs: backend live + bot tokens)*

`agora` goes where developers already are. Both bot modes run on the deployed Worker via inbound webhooks — no always-on server to operate.

- ☐ **Digest broadcast bot** — posts the daily news + trending + new-MCP-servers digest (the `agora today` payload) to a Discord/Telegram channel on the Cloudflare cron. The "passive value" hook the architecture doc anticipated.
- ☐ **Query bot** — `/agora search postgres`, `/agora scan <id>`, `/agora trending` answered inline in Discord (interaction webhook) and Telegram (webhook), reusing the marketplace engine.
- ☐ **Channel abstraction** — a small notifier/channel interface so future surfaces (Slack, RSS, webhook) drop in without bespoke code, mirroring the multi-channel gateway pattern from Hermes Agent / OpenClaw.

### Wave 4 — Trust depth & distribution → release

Turn the informational trust layer toward enforcement, then ship.

- ☐ **Declared-vs-observed permission diff** — inspect an item against its declared manifest (does an MCP server's code touch fs/net/exec it didn't declare?). The remaining Phase 4 check.
- ✓ **`agora doctor` for installed MCP servers** *(shipped 0.4.3)* — checks each configured server (command resolvable, conflicting definitions) and, with `--probe`, actually starts it and runs the MCP handshake. Declared-vs-observed *permission* enforcement remains future work.
- ☐ **Signed, distributable binary** — code-sign + notarize the `build:binary` output, a Homebrew tap, and GitHub-release automation so `brew install` / `curl | sh` work alongside `npm`.
- ☐ **0.4.3 version bump + release notes** — finalize the changelog, tag, release.

---

## The next era — agent stack manager, capability search & self-curation

Beyond the 0.4.3 cut, four strategic threads turn `agora` from a tool you *visit* into one you *live in* — without diluting the marketplace / news / community pillars, which remain the core. Sequenced so the local, no-backend work ships first.

### Thread A — Agent stack manager *(local; no backend; shipped)*

A **cross-tool package-manager for your agentic dev environment** — the daily-driver hook. Think `package.json` / Brewfile, but for the MCP servers, skills, and workflows your agent uses. Built in `src/stack/`, mirroring the pluggable `src/hubs/` pattern: one `ToolAdapter` per agent tool (**opencode**, **Claude Code**, **Cursor**, **Windsurf**) normalizing each tool's MCP config into one `ConfiguredServer` shape. Nobody owns this universal config layer today.

- ✓ **Phase 1 — read-only stack view**: the adapter layer + `agora installed` (a unified view of every configured MCP server across all detected tools, grouped by name) + `agora doctor` (health: config parses, command resolvable on `PATH`, conflicting definitions, `--probe` does a real MCP handshake). `doctor` is also the Wave 4 trust item — landed early.
- ✓ **Phase 2 — `agora.toml` + `agora sync`**: `agora freeze` snapshots your stack into a declarative `agora.toml` (a self-contained, no-dep TOML reader/writer); `agora sync` reconciles each tool's real config to it — dry-run diff by default, writes gated behind `--write --yes`, every unrelated config key preserved. Shareable stacks = "clone someone's agent setup."
- ◑ **Phase 3 — close the loop**: ✓ marketplace `install --save` writes the installed server into `agora.toml`; ✓ `agora try <id>` does an ephemeral MCP test-drive (real `initialize` + `tools/list` handshake, nothing persisted). ☐ `agora update` (extends `src/outdated.ts`) to bump installed servers remains.

### Thread B — Capability search *(local slice shipped; catalog-wide needs the backend)*

Index what MCP servers actually **expose** — their tool schemas — and search over *capabilities*, not README prose.

- ✓ **Local slice**: `agora doctor --probe` and `agora try` discover each server's tools via the MCP handshake and persist them to a local capability cache (`src/stack/capability-cache.ts`); `agora capabilities [query]` searches "which of my servers can do X" with the same offline BM25 engine the marketplace uses (`src/search/catalog-index.ts`).
- ☐ **Catalog-wide**: have the server-side curator probe servers and store their tool schemas in the catalog, so `agora find "talk to my postgres db"` ranks the *whole* marketplace by capability overlap, and the agent-facing `agora mcp` `search` tool answers capability queries. Novel and defensible — nobody indexes the tool schemas. Needs Wave 2.

### Thread C — Self-curation flywheel *(needs Wave 2 backend)*

Make the catalog and news self/LLM-curated with zero human labor by *composing* the engines that already exist:

- **Structured-rubric LLM curation** — upgrade the curator's single genuineness verdict into independent axes (genuine / maintained / documented / safe) with self-consistency; verdicts cached keyed by commit SHA so the weekly cron is near-free (the hardened curator already stores `version=commitSha`).
- **Composed trust score** — Bayesian combination of (a) the AI verdict, (b) mechanical quality signals (`src/hubs/quality.ts`: log-stars + recency + maintenance gate), and (c) **opt-in install-retention telemetry** — items people install *and keep* rank up; install-then-remove ranks down. Earned reputation applied to the catalog itself; the signal no website competitor can capture, because they don't sit at the install point.
- **News self-curation** — extend the existing scorer (`recency·e^(-h/12) + engagement·log + topic`) with LLM clustering/dedup (one card per story across HN/Reddit/GH), a one-line "why it matters," and a bandit that learns topic weights from what users open.

### Thread D — Reach: digest bot *(Wave 3 above)*

The Discord/Telegram digest + query bot — passive distribution where agent devs already are. Tracked in Wave 3.

---

## The 0.4.5 horizon (beyond the 0.4.3 cut)

The far-horizon work — a long way ahead of the next milestone.

### Phase 3 — Commerce (deferred until trust lands)

Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`, entitlement-aware `install`, seller-side `publish --price` / `earnings` / `payouts`. Browse stays free and login-free; the wall goes up only at purchase. The `Pricing` type on `Package` is already scaffolded so commerce can drop in without a model change.

### Phase 4 (continued) — Runtime sandbox enforcement

Today the manifest is informational and Wave 4 adds a diff + health check. The end state is spawning installed MCP servers under fs / net / exec restrictions matching what they declared. Shape undecided (Linux namespaces? isolates? npm policies?) — an interesting unscoped problem.

### Phase 5 — Reach & ecosystem

- ☐ **Public web hub** (`hub/`) for discovery / SEO / share links.
- ☐ **VS Code + JetBrains surfaces** consuming the same marketplace core.
- ✓ **MCP server mode** (`agora mcp`) and **free inference chat** (`agora chat`) — shipped 0.4.0.
- ◑ **Multi-channel bots** (Discord / Telegram) — Wave 3 above.

## How to help

- **Add a curated entry to `src/data.ts`** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Every npm entry is verified against the registry.
- **Build a runtime sandbox** for Phase 4 (interesting unscoped problem; tag an issue if you start).
- **Report what `agora init` misses** — open an issue with your project's manifest files.
- **Polish what's there** — there's always a rough edge worth grinding.

_Last updated: 2026-05-26. See [CHANGELOG.md](./CHANGELOG.md) for the shipped history._
