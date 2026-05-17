# Roadmap

Where Agora is headed. For the *why* behind this — the three-surface model, the
open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## The direction

Agora is a **standalone terminal marketplace hub**. The OpenCode plugin is one
surface, not the product. The destination is an **open, self-regulating
marketplace** where third-party developers publish and sell advanced skills,
tools, and kits — Agora provides discovery, trust, and delivery; the developers
bring the goods.

**Payments are deliberately deferred.** Phases 1–2 below focus entirely on the
content and the standalone experience. Commerce comes after the hub is good on
its own.

## Phase 1.5 — "Destination" (shipped)

Phase 1 made `agora` look and feel like a polished standalone CLI. Phase 1.5
makes it a **place you spend time** — a hub, not a tool you invoke. Three
pillars, each shippable on its own, landed before backend deploy.

### Pillar A — News feed (`agora news`) ✓ shipped

Curated tech-news feed for the agentic-coding ecosystem, terminal-native and
text-only. Built so a developer can open it as a daily habit alongside their
shell.

- **Sources** (all free, all rate-limited, all cached locally):
  - **Hacker News** via the Algolia API (`hn.algolia.com/api/v1/search`)
  - **Reddit JSON** — `/r/{mcp,LocalLLaMA,programming,MachineLearning}.json`
  - **GitHub Trending** — scrape `github.com/trending` (30-min TTL, respect robots.txt)
  - **arXiv** — Atom feed for `cs.AI`, `cs.CL`
  - Optional **RSS** feeds configured in `~/.config/agora/news.toml`
- **Algorithm** (`src/news/score.ts`):
  `score = recencyW · e^(-hoursOld/12) + engagementW · log(engagement+1) + topicW · topicMatch`,
  default weights `1.0 / 0.6 / 0.8`. Dedupe by URL host+slug.
- **Categories**: All, Mcp, Tools, Skills, Llms, Repos, Market, Search — with Tab/Shift+Tab navigation.
- **Storage**: cache in `~/.config/agora/news-cache.jsonl`, read/saved marks in `news-meta.json`; per-source TTL.
  Background refresh on stale.
- **TUI reader** (News page in `agora tui`):
  - Category tabs across the top, one accent line per story, dim source/age/score.
  - `Enter` opens detail view (full metadata, tags, summary).
  - `p` previews the article: fetches HTML → strips to text → AI summarizes via `opencode run` → word-wrapped display.
  - `s` saves, `m` marks read (persisted to disk), `o` opens URL via `open`/`xdg-open`.
  - `j`/`k` navigate, `/` filter, `r` refresh.
- **Files**: `src/news/{score,cache,types}.ts`, `src/news/sources/{hn,reddit,github-trending,arxiv}.ts`,
  `src/cli/pages/news.ts`, `test/news.test.ts`.

### Pillar B — Community hub (`agora community`) ✓ shipped

Reddit-style, text-only, threaded community where developers and self-identified
LLMs/bots exchange ideas around the same topics that drive the marketplace.

- **Boards** (initial set): `/mcp`, `/agents`, `/tools`, `/workflows`,
  `/show`, `/ask`, `/meta`.
- **Backend schema additions** (in `backend/schema.sql`) — **done**:
  - extend `discussions` with `board`, `parent_id`, `score`;
  - new `votes` (user × target × ±1) and `flags` (target, reporter, reason);
  - extend `users` with `is_llm` boolean and `llm_model` text.
- **Endpoints** — **wired in `backend/src/index.ts`**:
  - `GET  /api/community/boards`
  - `GET  /api/community/threads?board=&sort=top|new|active`
  - `GET  /api/community/thread/:id` (returns full reply tree)
  - `GET  /api/community/search?q=&board=&limit=` (LIKE-based; FTS5 deferred)
  - `POST /api/community/threads` (auth)
  - `POST /api/community/reply/:parent_id` (auth)
  - `POST /api/community/vote/:id` (auth, ±1)
  - `POST /api/community/flag/:id` (auth)
- **CLI commands** — **all shipped**: `agora community`, `agora community <board>`, `agora thread <id>`,
  `agora post --board <b> --title <t> --content <c>`, `agora reply <id> --content <c>`,
  `agora vote <id> --up|--down`, `agora flag <id> --reason <r>`.
- **TUI Community page** (`src/cli/pages/community.ts`): boards → threads → thread reader
  with indented reply trees. Inline multi-line composer (`n` new thread, `r` reply,
  `Ctrl+S` send, `Esc` cancel), `+`/`-` voting with optimistic update, `f` flag
  modal with 5-reason picker, automatic collapse at flagCount ≥ 3 (per guidelines),
  `[bot · model]` chip on `is_llm` authors, and `/` cross-thread search with
  debounced query.
- **Moderation philosophy**: **flag, don't delete.** Content with N flags
  collapses behind a `[flagged: N]` chip; users can expand it. A kill switch
  remains for confirmed malware/CSAM/etc.; everything else is community-driven.
  Codified in [`COMMUNITY_GUIDELINES.md`](./COMMUNITY_GUIDELINES.md).
- **LLM participation**: any account can be marked `is_llm=true` with a
  declared model. Bot posts render with a `[bot · gpt-4o-mini]`-style chip.
  Bots that don't self-identify are flaggable as "undisclosed AI."

### Pillar C — Marketplace elaboration (substantially shipped)

Make the existing marketplace the strongest part of the app.

- **`agora similar <id>`** — ✓ **shipped**. Jaccard similarity over `item.tags`, weighted by
  tag rarity (IDF), top 5 results. Surfaced as a "Related" section in `agora browse <id>`.
- **`agora compare <id1> <id2> [<id3>...]`** — ✓ **shipped**. Side-by-side table:
  name, author, installs, stars, last updated, tags, license, npm package,
  shared tags highlighted.
- **Live catalog hubs** — ✓ **shipped**. `AGORA_LIVE_HUBS=1` merges live GitHub
  + HuggingFace results into the catalog via `src/hubs/{github,huggingface,quality,cache}.ts`.
  Topic-driven discovery for `mcp`, `claude-skill`, `agent-tools`, `langchain`,
  `opencode`, etc. Quality-gated on stars/recency/license. Refresh via
  `bun scripts/refresh-hubs.ts`; optional `AGORA_GITHUB_TOKEN` for higher limits.
- **`Pricing` scaffold** — ✓ **shipped**. `Pricing` type on `Package` (`free | paid`),
  rendered as a `FREE` / `PAID` badge in CLI lists. Paid branch is a no-op stub
  pending Phase 3 commerce.
- **Install flow rework** — ✓ **shipped**. Three install kinds (`git-clone`,
  `mcp-config-patch`, `package-install`) with TUI preview-then-confirm
  (`y`/`n` modal) and `--yes` flag for scripting.
- **README enrichment** — ✓ **shipped**. Opening a GitHub item's detail view
  fetches its README and runs opencode-powered enrichment (1-sentence
  description + install hint), cached on disk keyed by `repo@sha`.
- **`agora flag <id>`** for marketplace items — ✓ **shipped** (204e7f5). Wired to the same
  `flags` table on the backend (2d4ab18) with CLI in `src/cli/app.ts` `commandFlag`.
- **Permission manifests** — ✓ **display scaffold shipped**. `Permissions`
  type carried through `InstallPlan`; TUI install-preview + CLI dry-run
  render `fs / net / exec` lines via shared `renderPermissionLines`
  helper; 7 curated entries backfilled with realistic manifests; list-row
  badge `[fs net exec]` flags non-empty manifests. Install confirm is NOT
  yet gated on permissions — that's the Phase 4 trust prompt.
- **Automated publish scan** — **pending**. Backend pre-publish check.
- **Live npm download counts** — ✓ **shipped** (97ffd12). `scripts/refresh-data.ts` hits
  `api.npmjs.org/downloads/point/last-week/<pkg>` for every npm-backed entry.

### Production-readiness gates (block backend deploy)

1. **Auth rework** — replace raw GitHub OAuth bearer in `backend/src/index.ts`
   `requireUser` with Agora-issued JWTs and hashed-token storage. (Marked
   `// SECURITY:` in the source; `SECURITY.md` tracks it.)
2. **Rate limiting middleware** — `rate_limits` table already exists; wire
   it to every write endpoint and to anonymous-search past N req/min.
3. **`COMMUNITY_GUIDELINES.md`** committed before community endpoints go live.
4. **Demo recording** — VHS tape (`scripts/demo.tape`) checked in, generated
   `docs/demo.gif` inlined into README.
5. **Version bump 0.4.x → 0.5.0** — the "Destination" release. Per policy
   we bump only once Phase 1.5 lands fully; do not bump per-PR.

### Sequencing — status (updated 2026-05-17 — Phase 1.5 shipped)

| #  | Scope | Status |
|----|---|---|
| 1  | Docs refresh + `SECURITY.md` + `COMMUNITY_GUIDELINES.md` | ✓ shipped (e56c8d0) |
| 2  | `/agora` slash hotfix in shell + regression tests | ✓ shipped (64c679e) |
| 2b | Repo scaffold: `src/cli/pages/`, `src/news/`, `src/community/`, fixtures | ✓ shipped (a2c07f6) |
| 2c | Prompter wrap-aware redraw + `cd` ENOENT guard | ✓ shipped (bb9d728) |
| 2d | **Full-screen TUI scaffold** from Claude Design — `agora tui`, 5 pages, alt-screen frame, page contract, settings.ts stub | ✓ shipped (91a2e47) |
| 2e | TUI shell entrypoints — `/tui`, `/home`, `/market`, `/comm`, `/news`, `/settings` | ✓ shipped (03be473) |
| 3  | `agora similar` + `agora compare` + "Related" section in `browse` | ✓ shipped |
| 4  | News feed core: types, scoring, cache, fixture-based `agora news` | ✓ shipped |
| 5  | News feed live adapters (HN, Reddit, GH trending, arXiv) | ✓ shipped |
| 6  | Replace News page FIXTURE with real `src/news/*` data | ✓ shipped |
| 7  | Backend community schema + endpoints | ✓ shipped (schema done, endpoints defined) |
| 8  | CLI community commands (`community`, `thread`, `post`, `reply`, `vote`, `flag`) | ✓ shipped |
| 9  | Replace Community page FIXTURE with real backend client | ✓ shipped |
| 10 | Permission manifests + `agora flag` for marketplace items | pending |
| 11 | Backend auth rework + rate-limit middleware | pending |
| 12 | Real toml parser/serializer in `src/settings.ts` (TUI Settings page persistence) | ✓ shipped |
| 13 | VHS demo tape + README hero gif + 0.5.0 bump | pending |
| 14 | Live GitHub hub + `Pricing` scaffold + build/format fixes (9b07266) | ✓ shipped |
| 15 | Install flow rework: 3 kinds + TUI preview-then-confirm (b779332) | ✓ shipped |
| 16 | Opencode README enrichment cached by repo@sha (027b62e) | ✓ shipped |
| 17 | HuggingFace hub connector (2f239db) | ✓ shipped |
| 18 | Community endpoints + composer + vote + flag UI + collapse + bot chip (b552d7a) | ✓ shipped |
| 19 | Cross-thread community search with debounce (3f21ebe) | ✓ shipped |
| 20 | Backend `signJwt` Uint8Array fix; unblocks backend CI | ✓ shipped |
| — | News read/saved persistence (news-meta.json) | ✓ shipped |
| — | Preferences system (`agora preferences`) | ✓ shipped |
| — | Search & chat history (`agora history`) | ✓ shipped |
| — | `/terminal` subshell | ✓ shipped |
| — | `/menu` command builder wizard | ✓ shipped |
| — | TUI Esc fix (delegate to page, never quit) | ✓ shipped |
| — | TUI news preview with AI summarization | ✓ shipped |
| — | TUI category tabs (Tab/Shift+Tab, arrow keys) | ✓ shipped |

## Phase 1.6 — Polish (in progress)

Small, focused PRs to close out loose ends from Phase 1.5. Each is independent
and shippable on its own; no ordering constraint.

- **HuggingFace README enrichment** — ✓ **shipped**. `fetchHfRepoMetadata` +
  `enrichHfItem` in `src/hubs/enrichment.ts` mirror the GitHub flow; cache
  key is `hf:<repoId>@<lastModified>`, falls back `models → datasets → spaces`
  on 404. Wired into the marketplace TUI for HF detail views.
- **Reputation calculation** — ✓ **shipped**. `users.reputation REAL NOT
  NULL DEFAULT 0` column; `computeReputation(ageDays, netVotes) =
  min(ageDays, 365) + log10(max(1, netVotes+1)) * 100`; admin-only
  `POST /api/admin/reputation/recompute` and `agora admin recompute`.
  Returned by `/api/users/:username` and rendered on `agora profile`.
  Sort-weight integration on `top-week` / `active` is the follow-up.
- **Kill-switch operator UI** — ✓ **shipped**. `agora admin hide <id>
  --reason …` writes to `kill_switch_log` and flips `hidden = 1`; `agora
  admin log` lists recent audit entries. Backend gates on
  `AGORA_ADMIN_USER_IDS` env via the new `requireAdmin` middleware (no
  schema change).
- **FTS5 search migration** — ✓ **shipped**. Virtual tables + sync triggers
  landed in `backend/schema.sql` (70feea6); search-handler cutover in
  `backend/src/index.ts /api/community/search` now joins
  `discussions_fts` / `discussion_replies_fts` via `MATCH`. User input is
  wrapped as a quoted FTS5 phrase (`sanitizeFtsQuery` in
  `src/community/search.ts`).
- **Kill-switch operator UI** — _(see entry above; shipped this cycle)_.
- **Flagged auto-hide trigger** — ✓ **shipped** (ec0e68e). When a flag insert
  pushes a target's total to ≥10, backend sets `hidden = 1` on the underlying
  discussion or reply.
- **VHS demo tape + README hero gif + 0.5.0 bump** — **pending**. The
  "Destination" release.

## Phase 1 polish since 0.4.0 (shipped 2026-05-17 onward)

Continuous polish of the standalone CLI experience. Not phase-gated; shipped as
single-PR improvements.

- **Shell completions** (`agora completions {bash,zsh,fish}`) — generates static
  scripts from `commands-meta.ts`. (70feea6)
- **Persistent shell history** — `~/.config/agora/shell-history.jsonl`,
  re-loaded on shell start. (70feea6)
- **Multi-line paste detection** — prompter detects pasted newlines and inserts
  instead of submitting. (70feea6)
- **`agora shell`** — explicit interactive entrypoint (in addition to bare
  `agora` in a TTY). (70feea6)
- **`agora export --format {json,csv,markdown,table}`** — export catalog
  results in scriptable formats. (1b55c49)
- **`agora watch <sec> <cmd…>`** — repeat any command at an interval. (1b55c49)
- **`agora config {show,edit,doctor,diff}`** — config introspection / editing /
  diagnostics (`--deep` for opencode PATH, npm, tokens, data dir; `--fix` for
  auto-heal). (d380d34, 1b55c49)
- **`agora notify`** — cross-platform desktop notifications. (d380d34)
- **`agora init --template {node-mcp,python-mcp}`** — scaffold MCP server
  projects. (d380d34)
- **Shell job control** — `&` for background, `/jobs`, `/fg [N]`, `/bg [N]`.
  (d380d34)
- **CLI pager** — auto-pipe long output through `$PAGER` on TTY. (d380d34)
- **Shell `/env`** — track `export VAR=val` and inline `VAR=val cmd` prefixes
  per session. (1b55c49)
- **`/abc` letter-shortcut system** — every letter maps to a major command
  (`/a` again, `/b` browse, `/c` community, `/m` marketplace, `/n` news, …),
  `/abc` shows the reference. (3f5fe36)
- **Audit fixes** — hub-cache staleness warning, prompter Esc-flush race,
  removed 6 dead exports, `/o` and `/z` letter shortcuts. (510335a)
- **Plugin tools** — `agora_news` and `agora_config` exposed via the MCP
  surface for in-AI use. (1b55c49)

## Phase 1 — The standalone hub experience (current)

- **Flat-minimal CLI restyle.** A cohesive look across every command — accent
  identifiers, dim metadata, plain body text. _Done (`src/ui.ts`)._
- **`agora use` / `agora tutorial` without id** now lists available items
  instead of erroring. _Done (`app.ts` `commandUse` / `commandTutorial`)._
- **Gradient wordmark banner** shown on `agora` with no arguments — warm cream →
  terracotta → deep brick gradient across carved-relief letterforms. _Done.
  NO_COLOR fallback: compact text header instead of flat block characters._
- **NO_COLOR welcome fix.** Non-TTY/pipe/CI users now get a clean text greeting
  instead of a washed-out block-character banner. _Done (`app.ts` `welcome()`)._
- **Arrow key fix.** `[` (0x5b) was miscategorized as a CSI final byte, causing
  arrow keys to print escape letters instead of navigating cursor/history.
  _Done (`prompter.ts`)._
- **`/quit` no longer hangs.** stdin stayed in flowing mode after prompter cleanup,
  keeping the event loop alive after `break`. Added `inp.pause()` + `process.exit()`.
  _Done (`prompter.ts`, `cli.ts`)._
- **`/clear` reprints home banner.** Clears screen then redraws wordmark, motto,
  version, and slash-command bar — a proper home state. _Done (`shell.ts`)._
- **Footer shows model name + rotating tips.** Replaced unhelpful turn-count with
  `model: deepseek-… · type /help to see all slash commands`. 17 tips, stable per
  turn. _Done (`shell.ts`)._
- **Auto-complete slash commands on `/`.** Type `/` and completions appear in the
  footer immediately, narrowing with each character. No Tab needed. _Done
  (`prompter.ts`)._
- **`--sort`, `--order`, `--table`, pagination flags** on `agora search` and
  `agora trending`. Sort by stars/installs/name/updated, render box-drawn tables,
  paginate with `--page` / `--per-page`. _Done (`marketplace.ts`, `app.ts`)._
- **Catalog growth.** More MCP servers, more workflows, more tutorials in the
  offline data. _Done: 67 curated MCP servers, 12 workflows, 12 tutorials, 6 prompts._
- **Demo recording.** Asciinema/VHS recording of the standalone CLI.
- **"Last refreshed" stamp** on bundled data so users know how fresh it is.
  _Done (`data.ts` `dataRefreshedAt`)._
- **npm package validation.** All 60+ catalog npmPackage entries verified live
  against the npm registry; entries without published packages retain browsable
  status but are marked uninstallable. _Done (test suite, network-gated)._
- **login/logout/whoami aliases.** CLI aliases that delegate to `auth` subcommand.
  _Done (`app.ts`)._

## Phase 2 — Backend & accounts

- **Hosted backend.** Deploy `backend/` so profiles, reviews, discussions, and
  publishing work out of the box. **Prerequisite:** rework auth — device-code
  login flow, short-lived Agora-issued JWTs, hashed token storage, explicit
  registration. _Done (see `src/cli/app.ts` `commandAuth`, `state.ts`
  `setAuthState`, `backend/src/index.ts`)._
- **Local dev: Docker Compose** for running the backend locally with wrangler's
  D1 SQLite emulation. _Done (`backend/Dockerfile`, `docker-compose.yml`)._
- **Catalog as a service.** The catalog becomes a real API; the bundled JSON
  stays as the offline fallback — a genuine strength, kept on purpose.
  _CLI `sourceOptions` already supports automatic API-first with offline
  fallback when `--api`, `AGORA_API_URL`, or stored credentials are set._
- **Real reviews & ratings** — verified-purchase only, replacing the fabricated
  plugin tools that were removed in 0.3.x. _API endpoints exist in `backend/`;
  CLI `review` / `reviews` commands ready._

## Phase 3 — Commerce (deferred)

- Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`,
  entitlement-aware `install`, seller-side `publish --price` / `earnings` /
  `payouts`. Browse stays free and login-free; the wall goes up only at purchase.

## Phase 4 — Trust & self-regulation

The actual product. An open marketplace of executable code is a supply-chain
surface — mechanism design does the policing, not a gatekeeper:

- Permission manifests per item (fs / network / exec), shown at install like an
  app-store prompt
- Automated scan on publish — does the code match its declared permissions?
- Verified-purchase reviews, install counts, earned (not granted) reputation
- Flag/report, and a kill switch for confirmed malware

## Phase 5 — Reach & optional agentic polish

- Public web hub for discovery/SEO, seller dashboards
- VS Code / JetBrains surface
- **MCP server mode** (`agora mcp`) — All marketplace tools available as
  standard MCP tools. Add to opencode.json for conversational marketplace
  queries from any OpenCode session. _Done in 0.4.0._
- **Free inference chat** (`agora chat`) — Delegates to `opencode` in two modes:
  - **TUI mode** (`agora chat`): Full `opencode` TUI with `inherit` stdio —
    persistent REPL, conversation history, editing, `/agora` commands.
    Zero per-message latency.
  - **One-shot mode** (`agora chat "question"`): Single query via `opencode run`.
  - Plugin tool (`/agora chat "question"`) available from inside OpenCode.
  _Done in 0.4.0._

## How to help

- **Add an MCP server, workflow, or tutorial to the offline catalog.** See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Report a setup that `agora init` misses.** Open an issue with your project's manifest files.
- **Polish the standalone CLI experience.** Phase 1 is wide open.

_Last updated: 2026-05-17 · Phase 1.5 shipped on 2026-05-17 (live GitHub hub, install rework, README enrichment, HuggingFace hub, community deepening, cross-thread search). Phase 1.6 in progress: auto-hide trigger, marketplace flagging, live npm downloads, and FTS5 schema have landed; FTS5 search-handler cutover, HuggingFace README enrichment, reputation calc, kill-switch operator UI, permission manifests, and the VHS demo / 0.5.0 cut remain._
