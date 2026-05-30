# Roadmap

Where `agora` is headed. For the *why* — the three-surface model, the open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). For what's already shipped, see [`CHANGELOG.md`](./CHANGELOG.md).

## Direction

`agora` is a **standalone terminal marketplace hub** for the agentic-coding ecosystem. The OpenCode plugin is one surface, not the product. The destination is an **open, self-regulating marketplace** where third-party developers publish (and later sell) skills, tools, and kits — `agora` provides discovery, trust, and delivery; the developers bring the goods.

Three pillars are live end-to-end — a curated + live **marketplace**, a ranked **news feed**, and a threaded **community** — plus a real trust layer (permission manifests, pre-install scan gate, flag/kill-switch, earned reputation), an MCP server mode, and a hybrid bash/chat shell. The next step is **reach and depth**: make `agora` a place developers passively receive value and that grows itself, and turn its informational trust layer into something closer to enforcement.

**The wedge.** `agora` is the only marketplace in this space that lives *in the terminal where agentic coding happens* and is *itself consumable by an agent* (the `agora mcp` server). The website competitors can't install a capability for a running agent mid-task; `agora` can — behind its scan gate. So beyond the three content pillars, `agora` is evolving into two things they can't be: the **agent stack manager** (a cross-tool package-manager for the MCP servers / skills / workflows your agent uses daily) and the **safe capability-acquisition gateway** an autonomous agent calls when it hits a capability gap. These *amplify* the marketplace and community — they do not replace them. Discovery still happens in the marketplace; conversation still happens in the community; the stack manager is simply the daily-use loop that connects discover → install → manage → publish → discuss.

## Status: 0.4.5 — the safe capability-acquisition gateway, trust depth & deeper plugin integration

**0.4.5 (in-progress).** Builds on the **0.4.4** foundation with four major additions from the [improvement plan](./docs/archive/improvement-plan.md):

- **`agora acquire`** — the capability-acquisition gateway: match → scan-gate → write-to-config in one agent-callable action. Exposed as `agora acquire` (CLI), `acquire` (MCP tool), and `agora_acquire` (plugin preview). The scan gate enforces: `fail` blocks, `warn` requires `--accept-warnings`, `dry_run` previews everything. This is the academically-correct RAG-MCP shape: agents retrieve the relevant server and activate it on demand, gated by trust.
- **OpenCode plugin hooks** — `tool.execute.before` capability-gap detection (opt-in via `suggestAcquire`) recommends `agora_acquire` when the agent reaches for a missing server; `experimental.session.compacting` injects current stack + capabilities into the continuation context so the agent remembers its tools across compaction (`stackMemory`, on by default). Chat runs through the OpenCode server API (`client.session.prompt`) when available, falling back to the fixed CLI path.
- **Trust depth: rug-pull / description-drift detector** — `agora doctor --probe` now computes and stores a canonical `descriptionDigest` of each server's tool set; re-probing detects DRIFT (added/removed/changed tools with per-tool diff). `scanItem` checks for suspicious description-injection patterns (imperative markers, secret exfiltration, instruction override). The approved digest is persisted in `agora.toml` for drift comparison across sessions.
- **Offline/open-code binary resolution (Windows fix)** — unified `resolveOpencode`/`spawnOpencode` in `src/opencode-exec.ts` with proper `PATHEXT`-aware resolution; all four spawn sites route through it. No `which` dependency; proper `.cmd`/`.bat` spawning via `cmd.exe` on win32.

See [CHANGELOG](./CHANGELOG.md). Per release policy we sculpt heavily and bump once per landed cut, not per PR.

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
- ✓ **Monorepo star ranking** — shared-repo stars (e.g. `modelcontextprotocol/servers`) are detected and dampened in scoring. Default sort uses installs as the primary popularity signal, with shared-repo star counts visually labeled.
- ✓ **Windows binary resolution** — `src/opencode-exec.ts` unifies `resolveOpencode`/`spawnOpencode` across all four spawn sites with proper `PATHEXT`-aware resolution, `.cmd`/`.bat` spawning via `cmd.exe` on win32, and per-arg quoting for safety.
- ✓ **`agora acquire` CLI + MCP tool** — the capability-acquisition gateway: resolve by id or query, create install plan, run the scan gate, write config on pass. Three status branches: `fail` blocks (non-zero exit), `warn` requires `--accept-warnings`, `dry-run` previews everything. CLI: `agora acquire <id|query> [--dry-run] [--accept-warnings] [--save]`. MCP: `acquire` with structured input/output for agent use.
- ✓ **Plugin depth: hooks + SDK chat** — `tool.execute.before` gap detection (opt-in), `experimental.session.compacting` stack memory (on by default), and chat via the OpenCode server API first with CLI fallback. Explicitly named tools for `agora_today`, `agora_scan`, `agora_acquire`, `agora_config`, `agora_news`, `agora_info` — fixing the brittle catch-all routing.
- ✓ **Rug-pull / description-drift detector** — `descriptionDigest` (canonical SHA-256 of tool names, descriptions, and input schemas) stored on probe; re-probe detects DRIFT with per-tool diff (added/removed/changed). `scanItem` flags suspicious description-injection patterns (imperative markers, secret exfiltration, instruction override). Live digest recorded separately from approved baseline for comparison.

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
- ✓ **`agora doctor` for installed MCP servers** *(shipped 0.4.3)* — checks each configured server (command resolvable, conflicting definitions) and, with `--probe`, actually starts it and runs the MCP handshake.
- ✓ **Description-drift detection** *(shipped 0.4.5)* — canonical `descriptionDigest` computed per server on probe; re-probing detects DRIFT (added/removed/changed tools with per-tool diff). Approved digest persisted in `agora.toml` for cross-session comparison. Drift surfaced in `doctor --probe` output and the TUI Home "your stack" opportunities band.
- ✓ **Description-injection scan** *(shipped 0.4.5)* — `scanItem` checks MCP server descriptions against heuristics for imperative markers, secret exfiltration patterns, instruction overrides, and runtime command injection. Status `warn` (not auto-`fail`) to avoid false positives.
- ✓ **`agora acquire` scan gate** *(shipped 0.4.5)* — fail blocks write, warn requires `--accept-warnings`, clean proceeds. The policy checkpoint for agent-driven installation.
- ☐ **Signed, distributable binary** — code-sign + notarize the `build:binary` output, a Homebrew tap, and GitHub-release automation so `brew install` / `curl | sh` work alongside `npm`.

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

### Thread C — Self-curation flywheel *(partly shipped; needs Wave 2 backend for telemetry)*

Make the catalog and news self/LLM-curated with zero human labor by *composing* the engines that already exist:

- ✓ **Description-drift / rug-pull detection** *(shipped 0.4.5)* — `agora doctor --probe` computes a canonical SHA-256 `descriptionDigest` over each server's tool schemas; re-probing detects DRIFT with per-tool diff. Live digest recorded separately from the approved baseline for cross-session comparison. Paired with description-injection heuristic scanning in `scanItem`.
- **Structured-rubric LLM curation** — upgrade the curator's single genuineness verdict into independent axes (genuine / maintained / documented / safe) with self-consistency; verdicts cached keyed by commit SHA so the weekly cron is near-free (the hardened curator already stores `version=commitSha`).
- **Composed trust score** — Bayesian combination of (a) the AI verdict, (b) mechanical quality signals (`src/hubs/quality.ts`: log-stars + recency + maintenance gate; monorepo shared-repo stars already dampened), and (c) **opt-in install-retention telemetry** — items people install *and keep* rank up; install-then-remove ranks down. Earned reputation applied to the catalog itself; the signal no website competitor can capture, because they don't sit at the install point.
- **News self-curation** — extend the existing scorer (`recency·e^(-h/12) + engagement·log + topic`) with LLM clustering/dedup (one card per story across HN/Reddit/GH), a one-line "why it matters," and a bandit that learns topic weights from what users open.

### Thread D — Reach: digest bot *(Wave 3 above)*

The Discord/Telegram digest + query bot — passive distribution where agent devs already are. Tracked in Wave 3.

---

## The 0.4.6 horizon (beyond the 0.4.5 cut)

The far-horizon work — a long way ahead of the next milestone.

### Phase 3 — Commerce (deferred until trust lands)

Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`, entitlement-aware `install`, seller-side `publish --price` / `earnings` / `payouts`. Browse stays free and login-free; the wall goes up only at purchase. The `Pricing` type on `Package` is already scaffolded so commerce can drop in without a model change.

### Phase 4 (continued) — Runtime sandbox enforcement

Health checks, description-drift detection, and description-injection scanning are shipped (0.4.5). The remaining trust work: declared-vs-observed permission diff (does the running server's tool set match its manifest?), and the end state of spawning installed MCP servers under fs / net / exec restrictions matching what they declared. Shape undecided (Linux namespaces? isolates? npm policies?) — an interesting unscoped problem.

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
- **Try `agora acquire`** — test the capability-acquisition gateway and report edge cases: config paths, scan gates, Windows behavior.

_Last updated: 2026-05-30. See [CHANGELOG.md](./CHANGELOG.md) for the shipped history._
