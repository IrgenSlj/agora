# Changelog

All notable changes to `agora`. Format inspired by [Keep a Changelog](https://keepachangelog.com).

## [Unreleased] — the pivot: from terminal marketplace to agentic stack manager

Repositioning per `AGORA_BRIEF.md` (direction LOCKED): Agora becomes **the system manager for your
agentic stack** — a local-first package manager that *manages* (stack + instruction files), *watches*
(a federated plaza feed), and *gates* (the trust/customs layer) your MCP ecosystem. It federates
upstream registries rather than growing its own catalog; owns no inference; has no hosted backend.

### P0 — rename, repackage, reposition
- **Renamed npm package `opencode-agora` → `agora-hub`** (binary stays `agora`). One codebase, one
  core package. Added subpath exports (`.` = library surface, `./opencode` = OpenCode plugin).
- **New `packages/opencode-agora/`** — a thin plugin-only entry that re-exports `agora-hub/opencode`
  and pins `agora-hub` to the exact version, so existing `"plugin": ["opencode-agora"]` configs keep
  working unchanged (OpenCode auto-installs it and its `agora-hub` dependency at startup).
- `src/index.ts` is now a clean library barrel (stack + gate types/functions) with **no plugin default
  export** — plugin-loaders never scan non-plugin functions off the package root.
- CI publishes both packages on release (core first, then the pinned plugin entry, both with `--provenance`).
- README rewritten around the identity sentence and the three rings; honest gate-limits copy.
- Logged load-bearing API corrections in `docs/OPEN_QUESTIONS.md`: Claude Agent SDK subscription auth
  is not available to third parties (use `ANTHROPIC_API_KEY`); PulseMCP has no self-serve API; Glama
  returns no tool schemas/annotation hints.

### P-freeze — execute the freeze

Surgically removed the frozen surface named in `AGORA_BRIEF.md` D3/D4/D5/D6/D11: our own community
boards, account-write commands, and Reddit as a news source. `backend/` and `hub/` stay in the repo
(zero TypeScript importers already) but are now excluded from the default typecheck and documented as
frozen. `news` survives as the Ring-3 "plaza" reader, decoupled from the boards it used to share a file
with.

- **Removed commands** — `community`, `thread`, `post`, `reply`, `vote`, `flag`, `admin`, `discussions`,
  `discuss` (own community boards, brief D4), `publish`, `review`, `reviews`, `profile` (account writes,
  brief D4/D6), and `ping` (backend health check, brief D3). Dropped from the runtime dispatch table,
  the `commands-meta` help/manual registry, and shell completions/letter-shortcuts.
- **Extracted `news`** — `src/cli/commands/news.ts` is a new module carrying `commandNews` (and its
  news-source wiring) out of the now-deleted `src/cli/commands/community.ts`, so the plaza reader
  survives the boards it used to live beside.
- **Removed Reddit as a news source** — closed OAuth + killed endpoints (brief D5). Deleted
  `src/news/sources/reddit.ts`; purged the `'reddit'` literal from `NewsSource`, `DEFAULT_NEWS_CONFIG`,
  source labels, completions, settings, and the TUI news page/home strip.
- **Removed the community TUI page** — deleted `src/cli/pages/community.ts`; `home`'s "Community" strip
  and `today`'s Community section are gone (both only ever read `communityThreadsSource` + `Thread`).
  The TUI is now four pages (Home · Marketplace · News · Settings) instead of five.
- **Removed the live write/community sources** — deleted `src/live/sources.ts` (publish/review/profile/
  flag writes) and `src/live/community.ts` (discussion read+write); `src/live.ts` no longer re-exports
  either. `src/live/search.ts` and `src/live/tutorials.ts` are untouched — search still reads the API
  when configured and degrades to offline.
- **Documented the freeze** — `docs/frozen/README.md` records that `backend/` (Cloudflare Worker),
  `hub/` (web app), and the community boards are frozen per D3/D4/D11: kept in the repo, excluded from
  the default typecheck (`bun run typecheck:backend` still exists, just unreferenced) and builds, not
  the pitch.
- **Fixed dangling references** to removed commands in onboarding (`agora welcome`) and the shell's
  slash/letter shortcuts, so nothing still points users at a command that no longer exists.

### TUI redesign — foundations (theme tokens + trust grammar)

Implements the Claude Design "Agora TUI — engineering handoff" §2–4, additively (existing tones,
glyphs, and every current caller's output are byte-identical).

- **New `drift` design token** in `cli/theme.ts` — a soft-orchid tone (`#A98BD0` / xterm 140) and a
  `≠`/`~` glyph. Drift means "investigate," not "malicious"; orchid never collides with the terra
  `error` hue under deuteran/protan simulation.
- **Trust component grammar** in `cli/pages/components.ts` — six pure-string, ANSI-aware,
  NO_COLOR-safe components reused identically everywhere a trust signal appears: `statusTriad`
  (`✓ pass · [official] · no drift`), `verdictBanner` (the one weighty element — FAIL is the only place
  the `═` double rule appears and is final, no re-run hint), `trustPanel` (scan · declared→observed
  permissions · drift), `provenanceBadges`/`provenanceBadge`/`originChip` (official always first +
  reverse-video), `planDiff` (Terraform-style, `apply? [y/N]` footer), and `driftChip`. Provenance is
  typed to the federation `SourceId` so badges map to real sources, never invented ones.
- Golden tests cover NO_COLOR legibility, verdict integrity (double-rule + no-hint-on-fail),
  provenance ordering/dedup, and the plan-diff tally.

### Repo cleanup — delete the frozen dirs and stale docs

Follow-on to P-freeze: the previous pass excluded `backend/`/`hub/` from the build and removed the
community commands from the dispatch table, but left the frozen directories, dead settings/
completions code, and stale docs on disk. This pass deletes what's actually dead.

- **Deleted `backend/`** (Cloudflare Worker, ~207MB incl. `node_modules`/`dist`) and **`hub/`**
  (web app) — both frozen per brief D3/D11, zero remaining TypeScript importers. Recoverable from
  git history.
- **Deleted `docker-compose.yml`** — only orchestrated the now-removed backend+hub.
- **Deleted `src/community/`** (`client.ts`, `search.ts`, `types.ts`) — dead once the community
  commands were removed; confirmed zero remaining `.ts` importers before deleting.
- **Deleted stale docs** — `COMMUNITY_GUIDELINES.md`, `docs/TUI_DESIGN.md` (superseded by the
  Claude Design engineering handoff), `docs/demo.gif` (old "bazaar" demo, unreferenced),
  `docs/archive/` (superseded design briefs + the old Phase 1.5 plan).
- **`package.json`** — removed the dangling `typecheck:backend` and `hub:dev` scripts.
- **Dead-code sweep** — deleted `commands-meta/community.ts`, moving its still-live `auth` entry
  into `commands-meta/setup.ts`; `CommandGroup` no longer has a `'Community'` member.
  `AppState.unread` dropped the dead `community` counter (news-only now). Removed the inert
  `community` settings section (`default_board`, `collapse_flag_threshold`) and the never-wired
  `account.backend` field from `src/settings.ts` and the settings TUI page. Shell completions
  (`src/cli/completions.ts`, `completions-gen.ts`) no longer offer board-name/flag/reason/
  community completers or flags for the removed `post`/`reply`/`vote`/`publish`/`discuss`/`review`
  commands. Cleaned stale "community hub" tagline copy and dead command mentions out of
  `format.ts`, `shell/main.ts`, `welcome.ts`, and the OpenCode plugin's `agora_info` tool text.
- **CI/lint** — removed the `backend` typecheck job from `.github/workflows/ci.yml`;
  `eslint.config.js` no longer globs `backend/`/`hub/`.
- **Rewrote for the current direction** — `AGENTS.md`, `docs/ARCHITECTURE.md`,
  `CONTRIBUTING.md`, and `docs/frozen/README.md` now describe the three-ring system-manager
  architecture instead of the old open-marketplace/hosted-backend/community-hub framing.

### P1 — federated catalog (core)

The flip from "own catalog" to "federated crossroads" (`src/federation/types.ts` is the load-bearing
contract): Agora's catalog is now the deduped union of upstream registries, not a bundled dataset.
Ships the `official` (required) + `local` (offline fallback) sources; smithery/glama/github/
huggingface are a clean `RegistrySource` seam away, not built here.

- **`src/federation/sources/official.ts`** — client for the official MCP Registry
  (`registry.modelcontextprotocol.io`, no auth for reads). Maps `GET /v0.1/servers` entries to
  `FederatedItem`s (reverse-DNS id, namespace-derived author, `official` provenance with a
  `/versions` detail URL, lifecycle `officialStatus` from `_meta`, a projected `serverJson`).
  `search()` never throws — resolves to `[]` on any HTTP/network failure. `isEnabled()` honors an
  `AGORA_OFFLINE=1` opt-out.
- **`src/federation/sources/local.ts`** — wraps the bundled/offline catalog
  (`searchMarketplaceItems`/`findMarketplaceItem`) as a `RegistrySource`; always enabled, never
  touches the network — the source every other source degrades to.
- **`src/federation/index.ts`** — `federatedSearch()` fans out to every enabled source in parallel
  under a per-source timeout (default 5000ms), dedupes/merges results by reverse-DNS name |
  normalized repo URL | npm package (a merged item keeps every provenance, official metadata wins),
  and reports an honest per-source `SourceStatus` (`ok` / `unreachable` / `offline` — never a
  fabricated count). A source's own on-disk cache backstops a live failure before falling through to
  `local`. `SOURCES = [official, local]` is the registered seam for follow-on sources.
  `federatedFetchItem()` resolves a single ref the same way.
- **`src/federation/cache.ts`** — content-addressed JSONL cache per source under
  `${AGORA_HOME}/federation/` (mirrors `src/hubs/cache.ts`). `refreshOfficialCache()` does a bounded
  bootstrap crawl on first run, then incremental `updated_since` syncs that upsert changes and prune
  registry-tombstoned `deleted` entries.
- **`agora search`** now federates by default — merged results with provenance, honest per-source
  status chrome, `--source official|local|all` to restrict. The legacy `--api`/self-hosted-backend
  path is untouched (orthogonal to federation). **`agora refresh`** runs the official incremental
  sync (`--json` for counts); wired into both the runtime dispatch table and the command-meta/help
  registry.
- **`src/cli/mcp-server.ts`** — the `search` tool now returns federated results (`readOnlyHint: true`)
  and notes when a source was unreachable.
- Hermetic tests under `test/federation/` with a DI fetcher and recorded/modeled registry fixtures in
  `test/fixtures/federation/` — no network in the suite.

## [0.4.5] - 2026-05-30 — the safe capability-acquisition gateway & trust depth

`agora` now closes the loop from discovery to installation via a single agent-callable `acquire` command, deepened OpenCode plugin integration, added description-drift detection for MCP servers, and flattened the monorepo-star-ranking problem. Windows users no longer hit "opencode binary not found." The marketplace, news, and community pillars remain the core.

### Added — capability acquisition gateway
- **`agora acquire <id|query>`** — resolve a marketplace item by id or capability query, create an install plan, run the scan gate, and write config in one action. Three gate outcomes: `fail` blocks (non-zero exit), `warn` requires `--accept-warnings`, clean proceeds. `--dry-run` previews everything. CLI: `agora acquire mcp-postgres --dry-run`. MCP tool: `acquire` with structured input/output for agent use. Plugin: `agora_acquire` (preview-only, dry-run).
- **`src/acquire.ts`** — new module exporting `acquire(input): Promise<AcquireResult>` and `renderAcquireResult()`. Composes `findMarketplaceItem`/`searchMarketplaceItems`, `createInstallPlan`, `scanItem`, and the stack adapter's `writeServers` into one pipeline. Preserves unrelated config keys on write.

### Added — OpenCode plugin depth
- **Lifecycle hooks** — `tool.execute.before` (opt-in `suggestAcquire`) detects capability gaps when the agent runs a tool for a missing server and surfaces a non-intrusive `agora_acquire` suggestion via `client.app.log()` and `client.session.prompt()`. `experimental.session.compacting` (on by default `stackMemory`) injects the current MCP stack + discovered capabilities into the continuation context so the agent remembers its tools across compaction.
- **SDK-preferring chat** — `agora_chat` uses `client.session.prompt()` when available (no per-message process spawn), falling back to the CLI `spawnOpencode` path. The TUI shell also routes through `spawnOpencode`.
- **12 explicit named tools** — `agora_search`, `agora_today`, `agora_browse`, `agora_browse_category`, `agora_install`, `agora_scan`, `agora_acquire`, `agora_trending`, `agora_tutorial`, `agora_chat`, `agora_config`, `agora_news`, `agora_info` individually registered with clear descriptions. Fixes the brittle catch-all routing.

### Added — trust depth
- **Description-drift / rug-pull detection** — `agora doctor --probe` computes a canonical SHA-256 `descriptionDigest` over each server's tool names, descriptions, and input schemas (sorted keys, normalized whitespace). Re-probing detects DRIFT: added/removed/changed tools with per-tool diff. Approved digest persisted in `agora.toml` for cross-session comparison. Live digest recorded separately from baseline.
- **Description-injection scan** — `scanItem` checks MCP server descriptions against heuristics for imperative markers (`IMPORTANT:`), secret exfiltration patterns (`~/.ssh`, `process.env`), instruction overrides (`ignore previous instructions`), and runtime command injection (`run cat`). Status `warn` (not auto-`fail`) to avoid false positives.
- **`src/stack/capability-cache.ts`** — extended with `descriptionDigest`, `descriptionDigestAt`, `liveDescriptionDigest`, `liveTools`, `driftDetectedAt`, `diffToolDescriptions()`, `formatToolDrift()`, `canonicalJson()` for deterministic hashing.

### Added — Windows compatibility
- **`src/opencode-exec.ts`** — unified `resolveOpencode`/`spawnOpencode`/`isOpencodeAvailable` with proper `PATHEXT`-aware resolution via the existing `resolveOnPath`. `spawnOpencode` spawns `.cmd`/`.bat` through `cmd.exe` with `windowsVerbatimArguments`, per-arg quoting via `quoteWinArg` for shell metacharacters.
- All four spawn sites (`bash.ts`, `shell/main.ts`, `hubs/enrichment.ts`, `plugin/runtime-tools.ts`) route through `spawnOpencode`. No `which` dependency.

### Added — data-quality
- **Monorepo star ranking** — `src/hubs/quality.ts`: `SHARED_REPO_STAR_WEIGHT = 0.25` dampens stars for repos detected as monorepo (`modelcontextprotocol/servers`, `monorepo` topic). `src/marketplace.ts`: `hasSharedRepositoryStars()`, `starCountLabel("shared repo ★")`, `compareByPopularity()` sorts by installs first, breaking ties with stars.

### Refactored
- **`commands-meta.ts` split** — the 1,137-line command registry (`src/cli/commands-meta.ts`) split into nine files under `src/cli/commands-meta/`: `types.ts` (CommandGroup, CommandMeta, renderManual), six per-group command files (marketplace 18, setup 12, library 4, learn 2, community 14, stack 6), and `index.ts` as barrel. The original `commands-meta.ts` is now a 2-line re-export barrel, preserving all import paths.
- **CVE overrides** — added `package.json` overrides for `qs` 6.15.2 and `uuid` 13.0.1; `bun audit` now shows 0 vulnerabilities.
- **TOML parser replacement** — replaced custom inline TOML parser (~80 lines) with `smol-toml` 1.6.1 in `src/settings.ts`.
- **`data.ts` → JSON lazy-load** — extracted the 700 KB bundled catalog into `src/catalog.json`; `src/data.ts` now loads it from disk via `readFileSync()` at first access.
- **`marketplace.ts` split** — extracted types into `src/marketplace/types.ts`, permission helpers into `src/marketplace/permissions.ts`; `src/marketplace.ts` remains as a barrel.
- **`live.ts` split** — 887-line file split into `src/live/types.ts`, `internal.ts`, `search.ts`, `community.ts`, `tutorials.ts`, `sources.ts`; barrel `src/live.ts` re-exports all public types and 13 domain functions.
- **CLI arg parser** — `src/cli/flags.ts` rewired to use `yargs 18` internally while keeping the same `ParsedArgs` / `CliIo` / `normalizeFlag` exports.
- **`shell.ts` split** — 1,327-line file split into `src/cli/shell/types.ts`, `input.ts`, `bash.ts`, `history.ts`, `main.ts`; barrel `src/cli/shell.ts` re-exports `runShell`, `classifyInput`, `looksLikeQuestion`.
- **`src/retry.ts`** — new shared utility with `withRetry()` (exponential backoff + jitter + AbortSignal) and `fetchWithRetry()` (auto-retry on 5xx/429), applied to 8 network-facing modules.

### Changed
- **Source maps** — removed `declarationMap` from `tsconfig.json` (reduces npm publish size).
- **Deps bumped** — `@opencode-ai/plugin` 1.15.9→1.15.11, `typescript-eslint` 8.59.4→8.60.0.
- **Lint rules** — re-enabled `@typescript-eslint/no-unused-vars` as warning (24 pre-existing test file warnings, 0 errors).

## [0.4.4] - 2026-05-25 — the living home & one cohesive look

`agora` now greets you with a home page that knows your stack, ranks the *fastest-growing* servers rather than just the most-starred, and wears a single, coherent visual identity end to end — the Claude Design "Agora TUI System" now drives both the full-screen TUI and the one-shot CLI. No new backend dependency; everything here works offline. The marketplace, news, and community pillars remain the core.

### Added — a living home page
- **"Your stack" band** — the home page now opens with a personal summary of your MCP stack (servers · tools · advertised capabilities · `✓ ⚠ ✗` health) drawn from the agent stack manager, fully offline.
- **Opportunities feed** — up to three ranked, actionable suggestions with the exact command to run: fix unhealthy servers (`doctor`), capture an untracked stack (`freeze`), reconcile `agora.toml` drift (`sync`), or install a velocity-trending server you don't have yet (`scan`).
- **"Hot in the ecosystem" repos** — the fastest-growing GitHub repos (the trending-page "stars today" velocity already captured by the news source) surfaced as a third trending lens.
- **"Since you last looked"** — a delta line showing new items + stack changes since your previous visit (persisted via a `home` marker in state).

### Added — design system (Claude Design "Agora TUI System")
- **Semantic theme** (`src/cli/theme.ts`) — a `Theme` over the existing `Styler` with `success`/`warning`/`error`/`info`/`muted`/`fg` tones (24-bit, 256-color, and `NO_COLOR` identity), a colorblind-tuned palette, and `glyph()` with unicode→ASCII degradation. `liftStyler()` wraps the existing styler preserving the four legacy methods bit-for-bit.
- **Component vocabulary** (`src/cli/pages/components.ts`) — pure, ANSI-aware string components: `pageHeader` (title + breadcrumbs + right cluster), `keyHintBar`, `statusLine`, `status`, `pill`, `tagList`, `kvRow`, `rule`, `rail`, `healthStripe`, `sparkline`, `progress`, `spinner`, `tableRow`, responsive `bp()`.

### Changed
- **Velocity-aware trending** — `agora`'s "trending" sorted by absolute stars (so it really meant "most popular, ever"). Added a real velocity score (`trendScore` = stars + stars/age + recency) and a **Hot** (velocity) vs **Top** (all-time) lens; the home trending column cycles **Hot → Top → Repos** with `t`. `getHotItems` is the new Hot lens; `getTrendingItems` stays as Top.
- **TUI restyled onto the design system** — the chrome (header tabs, footer hotkeys, status line) and all six pages (home, stack, marketplace, community, news, settings) now render through the theme tokens + component vocabulary, with `status()` health glyphs that stay meaningful under `NO_COLOR`. Densities follow the design's recommendation (home/marketplace calm; community/news/settings dense). All existing functionality preserved.
- **One-shot CLI restyled to match** — the non-interactive commands now share the same theme + components as the TUI, so `agora` looks cohesive whether you're in the full-screen TUI or piping a single command. Marketplace listings/details use `pill` badges and `kvRow`/`tagList` metadata; the stack/health commands (`doctor`, `scan`, `outdated`, `try`, `installed`, `capabilities`, `sync`, `freeze`, `today`) render `✓ ⚠ ✗` through the semantic `status()` glyphs (sage/amber/terra, ASCII-degrading under `NO_COLOR`). New `cliTheme(style, io)` lifts the one-shot styler into the full theme. Exit codes, `--json` output, and the scan-gate are unchanged.

## [0.4.3] - 2026-05-23 — the agent stack manager

The headline of this cut turns `agora` from a marketplace you *visit* into a daily driver you *live in*: a cross-tool **agent stack manager** — a package-manager for the MCP servers, skills, and workflows your agent uses, across opencode / Claude Code / Cursor / Windsurf. The marketplace, news, and community pillars remain the core; the stack manager is the loop that connects discover → install → manage → share → publish.

Alongside it: the local slice of **capability search** (search the tools your servers actually expose), a hardened **AI curator** that can run unattended, an offline **BM25 catalog index**, and cross-session shell memory. Everything works offline with zero AI; the backend-dependent threads (self-curation flywheel, catalog-wide capability search, chat bots) are the next horizon — see [`ROADMAP.md`](./ROADMAP.md).

### Added — agent stack manager
A cross-tool package-manager for your agentic dev environment. New `src/stack/`, mirroring `src/hubs/` — one `ToolAdapter` per tool (opencode / Claude Code / Cursor / Windsurf) normalizing each config into one `ConfiguredServer` shape.
- **`agora installed`** — unified view of every configured MCP server across all detected tools, grouped by name with transport + per-tool scope (and a tool count from the capability cache when available).
- **`agora doctor`** — health report per server (command resolvable on `PATH`, valid remote url, disabled, conflicting definitions across tools); `--probe` performs a real MCP `initialize` + `tools/list` handshake; `--strict` exits non-zero on errors for CI.
- **`agora.toml` + `agora freeze` + `agora sync`** — `freeze` snapshots the configured stack into a declarative `agora.toml` (self-contained, dependency-free TOML reader/writer); `sync` reconciles each tool's real config to it, dry-run diff by default and writes gated behind `--write --yes`, preserving every unrelated config key (Claude's `projects` map, opencode `$schema`/`theme`, …). `--scope project|user`, `--prune`. `sync --from <url|path>` applies a *shared* manifest — clone someone's agent setup — with a remote-source trust note.
- **`agora install --save`** — records the installed server into the project `agora.toml`, so the manifest is built by installing rather than hand-editing (failure-isolated; never breaks the install).
- **`agora try <id>`** — ephemeral MCP test-drive: runs the scan gate, spawns the server, does the MCP handshake, reports its advertised tools, then kills it and writes nothing.
- **`agora capabilities [query]`** — searches the MCP *tools* discovered across your servers ("which of my servers can do X"), reusing the offline BM25 engine. Tool schemas are discovered by `doctor --probe` / `try` and persisted to a local capability cache (`src/stack/capability-cache.ts`).
- **TUI Stack page** — `installed` + `doctor` + `capabilities` as a full-screen page (3rd tab), with probe-on-keypress and a per-server detail view.
- **Stack introspection via `agora mcp`** — three read-only MCP tools (`stack_installed`, `stack_doctor`, `stack_capabilities`) let an agent see the user's configured servers, their static health, and the tools they expose, so an agent can reason about the stack it's running in. Mutating config still goes only through the gated CLI.
- **`src/stack/mcp-probe.ts`** — a minimal, standalone MCP stdio client (newline-delimited JSON-RPC `initialize` + `tools/list`) with strict process cleanup and stderr-captured failure diagnostics; groundwork for catalog-wide capability search.

### Added — command excellence & search
- **Cross-session shell memory** — `/recall <query>` searches every past per-cwd transcript and shows matching exchanges (cwd · timestamp · snippet); `/sessions` lists recent sessions with turn counts and last activity. Built on the existing transcript store: `src/transcript.ts` gains `listSessions(dataDir)` and `searchTranscripts(dataDir, query)`. Brings Hermes-style "it remembers me" recall to the interactive shell.
- **`build:binary` script** — `bun build src/cli.ts --compile --outfile dist/agora` produces a self-contained executable (no Node/bun needed at run-time). The compile works today; a *signed, notarized, Homebrew-distributable* binary is tracked for a later distribution cut (unsigned arm64 macOS binaries are killed on launch), so `npm`/`npx` stays the supported install path for now.
- **Indexed + semantic catalog search** — new `src/search/catalog-index.ts`: a no-dependency, offline **BM25 inverted index** with field weighting (name ×3, tags/id ×2, description/author/category ×1), a tokenizer that strips stopwords *and* intent words so "find a tool that does X" reduces to its content terms, and query-side dev-term synonym expansion (db→database, k8s→kubernetes, pg→postgresql, …). `searchMarketplaceItems` now ranks by BM25 relevance when a query is present (filtering to scored matches, so nonsense queries still return empty), keeping search fast and well-ranked as the curated catalog grows past a hand-scannable size. The index is memoized alongside `getMarketplaceItems` and cleared by `clearMarketplaceItemsCache`.

### Changed
- **Never-dead daily surface** — `agora today` and the TUI Home news column no longer dead-end on an empty cache. When nothing is fresh in the last 24h they fall back to the most-recent cached items (flagged ` · recent`); when the cache is genuinely empty they show an actionable `run agora news --refresh` hint instead of "Nothing in the last 24h." Trending always renders. `--json` output is unchanged (still the 24h window) so scripts are unaffected.
- **Hardened AI curator for unattended runs** — `src/curator/` is now robust enough to run on a schedule. A bounded-concurrency worker pool (`--concurrency`, default 4) replaces the fully sequential verify loop, with per-item `try/catch` so one bad repo never aborts the batch. Three modes: incremental (default, new items only), `--refresh` (re-verify cached items older than `--stale-days`, default 30 — the scheduled-cron mode), and `--force`. Incremental cache writes make an interrupted run resumable. Dedupe now runs against the bundled catalog *and* the cache. `processCandidate` returns a discriminated outcome so fetch-failed / ai-unavailable / rejected are counted separately instead of three silent nulls; stats are persisted to `curation-state.json` and surfaced by a richer `agora curate --status`. Fixes latent flag bugs (`--limit` was read as `typeof === 'number'`, always false and silently ignored; `-n`/`-c` short forms mapped to keys the command never read).

### Internal
- Repo-wide `prettier --write` pass and a lint-clean sweep so all CI gates (`format:check` → `lint` → `typecheck` → `test`) are green; merged the Dependabot bumps (#23–#30) and resolved the `main` divergence.
- **1155 pass / 1 skip / 0 fail across 51 test files** (was 827 across 36). New tests cover the BM25 index, the curator hardening, the stack adapter layer + doctor, the `agora.toml` parser round-trip, `sync` config-preservation, the MCP stdio probe (against a fake-server fixture), the capability cache, the TUI Stack page, and the new commands.

## [0.4.2] - 2026-05-20

### Changed
- Demo tape rewritten: walks TUI (home → marketplace item → news article preview) then CLI commands (today → search → scan → install). Timing is faster (~16s vs ~23s sleep). `docs/demo.gif` is now tracked in git and embedded inline in the README.

## [0.4.1] - 2026-05-20 — CLI enrichment

The "destination + trust" cycle on top of 0.4.0. Phase 1.5 pillars
(news / community / live marketplace hubs) shipped end-to-end; the
Phase 1.6 polish list is closed; Phase 4 trust gating took its first
step with declared install permissions.

### Added
- **`agora scan <id>`** — pre-install safety scan. Runs seven checks (permissions declared, permission/install-kind consistency, repo reachable, **license declared**, npm package exists, recently active, flag count below auto-hide threshold) and reports pass / warn / fail with a summary. The license check is parsed from the same GitHub repos API response as the reachability check (no extra request) and is advisory — a missing license warns, never fails. Exits 1 only on failures; warnings are informational. `--json` available; reads `AGORA_GITHUB_TOKEN` to raise GitHub's unauth rate cap. This is Phase 4 trust as a client-side check first; the same logic will move server-side at publish time when the hosted backend lands.
- **`agora outdated`** — reads opencode.json, fetches the npm registry for each declared MCP package, and reports `latest` + `time.modified` age per row. Marks anything not published in the last 365 days as stale. Strictly informational: no exit-code failure, no "is this installed locally" detection (opencode.json doesn't pin versions; `npm list -g` is unreliable). `--json` and `--config <path>` available.
- **`scripts/demo.tape`** — VHS scaffold for the README hero gif. Walks the three pillars in ~60s (welcome → today → search → scan → install). `docs/demo.gif` is regenerated on demand (`vhs scripts/demo.tape`) and gitignored.
- **MCP server tools**: `agora mcp` now exposes `scan` and `outdated` (7th + 8th tools) so LLM clients can run pre-install safety checks and registry freshness checks through the MCP transport (alongside `search` / `browse` / `trending` / `install_plan` / `tutorials` / `tutorial`). The server version stamp now reads from `package.json` instead of being hardcoded.
- **Scan gate on install**: `agora install <id> --write` now runs the scan first and refuses to apply if any check returns `fail` (e.g. an item flagged ≥10 times, or a repo/npm package that 404s). `--skip-scan` bypasses the gate. Preview mode (no `--write`) stays scan-free so it works offline; `--json` output includes the full scan result.
- **TUI scan view**: press `S` in the marketplace page to scan the selected item — async with a "Scanning…" state, then the per-check report and summary, `esc` to go back. Completes the scan feature across all three surfaces (CLI · MCP · TUI).
- **Backend publish scan**: `POST /api/packages` now runs `runPublishScan` before accepting a publish — verifies the declared npm package exists, a github `repository` is reachable, and (advisory) whether the repo declares a license. A definitive 404 is rejected with `422` + the failing checks; transient/network problems and a missing license never block (status `unknown`). Admins can bypass with `skipScan` for npm registry-propagation lag on a fresh package. On success the response now carries the full `scan` check list so a publisher sees any warnings.

### Added — daily-use surface
- **`agora today`** — last-24h digest (news + community + trending) with `--section`/`--json` flags
- **`agora welcome`** — adaptive first-run tour (six sections, flips when signed in)
- **`agora open <id>`** — platform browser open; `--print` to print URL only
- **`agora author <name>`** — items by author, exact-then-substring
- **`agora bookmarks`** — unified view across marketplace saves + news bookmarks
- **`agora share <id>`** — paste-ready markdown blurb for a catalog item
- **`agora ping`** — backend reachability check; `agora config doctor --deep` gained matching auth / news / hub-cache rollups
- **Unknown-command suggestion** — `agora serch` → "Did you mean: search?"

### Added — Phase 1.5 + 1.6 (the "Destination" pillars)
- **News feed** (`agora news` + TUI reader) — HN, Reddit, GitHub Trending, arXiv, RSS; on-cache AI summarization via `opencode run`; category tabs; saved/unread filters; parallel source fetch
- **Community hub** (`agora community` + TUI) — 7 boards, nested replies, inline composer, ±1 voting with your-vote glyphs, flag-with-reason auto-collapse, `[bot · model]` chip, cross-thread FTS5 search, sort cycle (top/new/active)
- **Live marketplace hubs** — `AGORA_LIVE_HUBS=1` merges GitHub + HuggingFace results; AI-enriched description + install hint cached by `repo@sha` / `hf:<repoId>@<lastModified>`; quality gate on stars/recency/license
- **Reputation** — `users.reputation` + admin recompute + `top`/`active` thread sort weighting via `weightedThreadScore(base, rep)`
- **Permission manifests** — `Permissions` type carried through `InstallPlan`; TUI install preview + CLI dry-run render `fs / net / exec` lines; install confirm requires `--yes` when declared; 7 curated entries backfilled
- **Kill-switch operator UI** — `agora admin hide / log / recompute`; `requireAdmin` middleware gated on `AGORA_ADMIN_USER_IDS`; public `kill_switch_log` audit trail
- **TUI home page** with live data: top news, top `/mcp` threads, trending items; two-column at ≥100 cols; `j/k` focus indicator; `n/c/m` jump
- **Full-screen marketplace detail view** with source/pricing badges, AI description, permissions, related items, footer actions

### Fixed — security
- Shell-injection × 3 hardening: `$EDITOR` (`execFileSync` + args array), `verificationUri` (`URL` validate + `spawnSync`), `git clone <repo>` (URL allowlist refusal at plan-build time)
- arxiv source switched from `http://` to `https://`
- News cache + meta atomic writes via centralized `atomicWriteFile` (5 sites collapsed); all user-data writes `0o600`
- Backend length caps on `POST /api/packages|workflows|discussions`; sort allowlist on `/api/community/threads`; OAuth device-code + token responses narrowly typed

### Fixed
- Backend: `requireUser` was typed `c: any`, which let a `.first<UserRow>()` type-argument call slip past the root typecheck (which doesn't cover `backend/`). Typed it `Context<Env>` so `cd backend && bun run typecheck` is clean again.

### Refactored
- `pageSourceOptions` shared helper (community + home pages were carrying drifted copies)
- `Package.source` / `pushedAt` typed (was `(as any)` × 12)
- `getMarketplaceItems` 30s memo + parallel news source fetch
- `src/` `(as any)` count: 35 → 15 (remaining are stdin raw-mode probes)
- Backend D1 row reads: dropped all 28 `as any` casts via inline row types (`UserRow`, `PackageRow`, `WorkflowRow`, `DiscussionRow`, `DiscussionReplyRow`, `RefreshTokenRow`, `DeviceCodeRow`, `KillSwitchRow`, `BoardStatsRow`) plus typed shapes on the GitHub OAuth fetch responses. Joined SELECTs use inline intersection types.
- `rateLimit(c: Context<Env>)` in backend now uses Hono's `Context` type instead of `any`.
- Dropped the wrong `@deprecated` markers on `formatStars` / `formatInstalls` — both aliases are still in active use.

### Internal
- 793 pass / 1 skip / 0 fail across 35 test files (was 768 across 34 at 0.4.1).
- 2 new enrichment tests (sha-changed and opencode-null paths) close the remaining coverage gap on the hub enrichment cache.
- `bun run typecheck` now runs both the CLI (`typecheck:cli`) and the backend (`typecheck:backend`) so local typechecks match CI coverage — the latent backend error above had slipped through because the root script was CLI-only. CI's `check` job and `publish.yml` stay on `typecheck:cli` (they don't install backend deps); the dedicated CI `backend` job still typechecks `backend/`.
- News preview article fetch was using a hardcoded `Agora/0.4.1` User-Agent; switched to the shared `agoraUserAgent` constant so the UA tracks `package.json`.
- Auth device-code / token-poll / logout fetches gained 5–10s `AbortSignal.timeout` — the CLI no longer hangs forever if the backend stalls.
- `fg` / `bg` shell builtins now print "No background jobs." for an empty job set and reject non-numeric job ids cleanly (was "Job NaN/-Infinity not found").
- `doctor --deep`'s `npm view` existence check uses `execFileSync` (was `execSync` with template-string interpolation).
- `searchApi` uses `Promise.allSettled` so a single source erroring doesn't tank the whole search; total failure still throws to keep the existing offline fallback.
- Whitespace-only notes on community flag submit are now treated as no notes (was passed through as a blank string).
- OAuth `state` cookie's `sameSite` normalized to lower-case `'lax'` to match the access/refresh cookies set in the same file.

## [0.4.0] - 2026-05-16

The "interactive shell + destination scaffold" release. `agora` in a
TTY becomes a persistent bash/chat REPL; the full-screen TUI ships
as a 5-page scaffold; search + browse gain sorting / tables /
pagination. ~17K new lines across 97 files.

### Added
- **Interactive shell** — bash/chat dispatch (`ls` runs, `why is this slow?` chats), Tab completion, ctrl-r reverse search, ghost-text suggestions, `/menu /transcript /clear /verbose /quiet /help /quit /last /again` meta commands, `!cmd` forces bash, `?msg` forces chat, per-cwd transcripts under `~/.config/agora/transcripts/<hash>.jsonl`
- **`agora chat`** — free inference via `opencode`. TUI mode launches `opencode` with `inherit` stdio; one-shot mode streams JSON
- **`agora mcp`** — marketplace exposed as standard MCP tools; `agora init --mcp` auto-registers
- **`agora tui`** — 5-page full-screen interface (Home · Marketplace · Community · News · Settings), `1`–`5` page switch, `?` help overlay, `q` quit, clean alt-screen entry/exit
- **`--sort`, `--order`, `--table`, `--page`, `--per-page`** on `agora search` and `agora trending`
- **Markdown chat output** in shell (`**bold**`, `code`, lists, headers); fenced code passes through
- **`COMMUNITY_GUIDELINES.md`** — flag-don't-delete, kill-switch criteria, bot self-id, earned reputation
- **`AGENTS.md`** + `docs/ARCHITECTURE.md` + `docs/TUI_DESIGN.md`

### Changed
- `/agora` slash-command template compressed from 33 lines to a single routing rule (tool descriptions are already registered)
- Trending ranked by npm downloads, not stars (the `modelcontextprotocol/servers` monorepo collapsed every package to one star count)
- Deps bumped: TypeScript 5→6, ESLint 9→10, zod 3→4, `@types/node` 22→25

### Removed
- Fabricated plugin tools (`agora_review`, `agora_discussions`, `agora_profile`); profiles / reviews / discussions stay CLI-only and need a backend
- Dead modules: `src/api.ts`, `src/logger.ts`

### Fixed
- Arrow keys in the shell (`[` 0x5b was treated as a CSI final byte, dropping history navigation)
- `/quit` hung the event loop (stdin left in flowing mode)
- `/clear` reprints the home banner
- `cd <nonexistent>` no longer corrupts `currentCwd`
- `searchMarketplaceItems` desc sort was double-negated

## [0.3.0] - 2026-05-14

Production-hardening release.

### Added
- ESLint + Prettier + full-tree typecheck (`src` + `scripts` + `test` + `backend`)
- Contract test suite: 98 → 229 cases
- Dependabot weekly updates

### Changed
- **Marketplace data is now real**: the fictional set was replaced with verified MCP servers — every `npmPackage` resolves on the registry
- `agora init` / `agora use` fall back to project-local `opencode.json` instead of silently writing the user's global config

### Fixed
- **Generated configs use OpenCode's real schema** (`mcp` / `plugin` keys with `{ type: "local", command: [...] }` entries); the previous `mcpServers`/`plugins` shape was silently ignored
- `agora init` no longer crashes on unrecognized project types
- `runCommands` uses `execFileSync` (no shell injection)
- Atomic writes for `state.json` and `opencode.json`
- Backend: input validation, guarded JSON parsing, no internal error leakage

### Security
- Backend `requireUser` flagged `// SECURITY:` — used the raw GitHub OAuth token as the API bearer credential. Deployment was deferred until the auth rework that landed in the [0.4.1] cycle.

## [0.2.0] - 2026-05-11

First substantial release — the standalone CLI starts to feel real.

- **`agora init`** — project scanner: stack detection (Node / Python / Rust / Go / Ruby / Java), framework detection (React / Next.js / Django / Rails / Spring / Vue), Docker + CI + database deps. Generates a stack-matched `opencode.json`, auto-installs npm packages, and registers the plugin
- **`agora use <workflow-id>`** — writes a workflow as an OpenCode skill file under `.opencode/skills/` and registers it
- **`agora install --write`** actually runs `npm install -g` instead of just printing instructions
- Offline data expanded from 5 → 36 MCP servers, 10 workflows, 6 tutorials
- npm publish CI

_0.2.1 and 0.2.2 were patches to make `npm publish` parse the manifest; nothing user-facing._

## [0.1.0] - 2025-01-01

Initial release. CLI marketplace + OpenCode plugin + bundled offline data + Cloudflare Workers backend + local web hub.
