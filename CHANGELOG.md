# Changelog

## [Unreleased]

The "live hubs & community deepening" cycle that began on 2026-05-17, followed
by a second wave of shell / CLI polish. The catalog is now curated + live; the
community hub is end-to-end usable with auto-moderation; the standalone shell
gained completions, history, job control, a letter-shortcut surface, and a
broad new command surface (`export`, `watch`, `notify`, `config doctor`, …).
No version bump yet — sculpting toward the 0.5.0 "Destination" cut.

### Changed — marketplace TUI detail view

- Detail view is now a proper full-screen page instead of a five-line
  block: header (source badge + name + PAID badge + author + version),
  AI-enriched description (`(ai)` tag) with `(enriching…)` indicator,
  stats line (installs · stars · updated age), tags, repo URL,
  permissions section (only when declared, using the same
  `renderPermissionLines` layout as the install preview), and a
  related-items block with name + installs + description.
- Footer pinned to the bottom: `i install   s save   o open repo   Esc back`.
  `s` writes directly into `state.json` `savedItems` via
  `saveItemToState`. `o` in detail mode opens the item's
  `repository` URL via the existing `open-url` page action; in list
  mode it still cycles the sort.

### Added — `agora today`

- **`agora today`** — one-shot daily digest. Reads the local news cache
  (no network) for stories from the last 24h, the `mcp` community board
  for active threads (auth-gated; dim hint when not signed in), and
  `getTrendingItems()` for top marketplace items — top 3 per section.
  Flags: `--section news|community|market|all` (default all), `--json`.
  Empty sections render a single dim line, not blank. New
  `src/cli/commands/today.ts`; 5 test cases in `test/today.test.ts`.

### Added — `agora open / author / bookmarks`

- **`agora open <id>`** opens a marketplace item's repository (or its
  npm page if no repository is set) in the platform browser. Accepts
  raw URLs too. `--print` writes the resolved URL instead of spawning
  the browser; `--json` returns `{ id, url, opened }`. Implementation
  is `child_process.spawn` against `open` / `xdg-open` / `start ""`.
- **`agora author <name>`** lists marketplace items by author. Exact
  match first; falls back to substring if exact returns nothing.
  Sorted by installs desc, paginated via `--limit` / `--page`,
  with `--json` mode.
- **`agora bookmarks`** is the unified view across marketplace saves
  (from `state.json` `savedItems`) and news saves (from `news-meta.json`
  cross-referenced with the cached news items). `--kind {all,marketplace,news}`
  filters; `--json` returns `{ marketplace, news }`.
- 8 new test cases in `test/cli.test.ts` cover the happy paths,
  unknown-id error surfacing, and `--json` shapes.

### Added — install permission acknowledgment + reputation sort + live home

- **Install permission prompt** (Phase 4 trust step 1). When an item
  declares non-empty permissions, the TUI install-preview footer flips
  from `y confirm` to `g grant + install   d details   n/Esc cancel`
  (`y` still works as an alias). A new `install-perm-details` view
  enumerates each fs / net / exec entry with a one-line annotation
  (`*` → unrestricted, `./**/*` → current working directory, agora
  config path → agora-only). The CLI install `--write` path refuses
  without `--yes` when permissions are declared, prints the manifest,
  and exits with `Re-run with --yes to grant and install.`; with
  `--yes`, prints `Granted permissions:` before any exec.
- **Reputation-weighted thread sort.** The `top` and `active` sort
  orders on `/api/community/threads` now factor the author's
  `users.reputation` via a `weightedThreadScore` helper
  (`base + log10(max(1, rep + 1)) * 5`). `new` stays purely
  chronological. Implementation pre-fetches 200 rows and re-sorts in
  JS to avoid D1 SQL-side `log10` portability concerns.
- **Home page live data.** The TUI home is now a real landing
  experience: top news stories (from the local cache), top community
  threads on `/mcp` (best-effort fetched on mount, gated on
  auth), and trending marketplace items. Two-column layout at ≥100
  cols, stacked otherwise. New hotkeys: `n` / `c` / `m` jump to news
  / community / marketplace; `r` refreshes; `Enter` opens the focused
  section. The old static "Recommended for you" + "Why" block was
  removed.

### Added — shell & CLI polish (2026-05-17 onward)

- **Shell completions** (`agora completions {bash,zsh,fish}`). Generates static
  scripts from `src/cli/commands-meta.ts`. (70feea6)
- **Persistent shell history** at `~/.config/agora/shell-history.jsonl`, replayed
  on shell start. (70feea6)
- **Multi-line paste detection** in the prompter — pasted newlines insert
  instead of submitting. (70feea6)
- **`agora shell`** explicit interactive entrypoint. (70feea6)
- **`agora export --format {json,csv,markdown,table}`** for scriptable catalog
  output. (1b55c49)
- **`agora watch <sec> <cmd…>`** — repeat any command at an interval. (1b55c49)
- **`agora config show / edit / diff / doctor [--deep|--fix]`** — config
  introspection, in-`$EDITOR` editing, two-config diff, deep diagnostics
  (opencode PATH, npm, tokens, data dir), and auto-heal mode. (d380d34, 1b55c49)
- **`agora notify`** — cross-platform desktop notifications (macOS / Linux /
  Windows). (d380d34)
- **`agora init --template {node-mcp,python-mcp}`** — scaffolded MCP server
  starters. (d380d34)
- **Shell job control** — trailing `&` for background, `/jobs`, `/fg [N]`,
  `/bg [N]`. (d380d34)
- **CLI pager** — auto-pipes long output through `$PAGER` (less) on TTY.
  (d380d34)
- **Shell `/env`** — tracks `export VAR=val` and inline `VAR=val cmd` prefixes
  per session. (1b55c49)
- **`/abc` letter-shortcut system** — every letter maps to a major command
  (`/a` again, `/b` browse, `/c` community, `/m` marketplace, `/n` news, …);
  `/abc` shows the full reference. `/o` and `/z` added later. (3f5fe36, 510335a)
- **`agora_news` and `agora_config` plugin tools** exposed via the MCP surface
  so opencode sessions can pull news + config in-context. (1b55c49)
- **Top-level aliases** `agora show` and `agora edit` for `config show`/`edit`.
  (d380d34)

### Fixed — shell & CLI polish

- **Hub stale-cache warning** when `AGORA_LIVE_HUBS=1` but the cache is empty or
  past TTL — was silent before. (510335a, H1)
- **Prompter Esc-flush race** discards partial CSI sequences instead of
  dispatching them as a bare `Esc`. (510335a, H2)
- **`/fg` no longer calls `stdin.resume()` unnecessarily**. (510335a, H3)
- **Removed 6 dead exports** (`rssSource`, `validatePackageName`,
  `writeWithPager`, `shouldPage`, `box`, newsletter adapter) and the blocking
  spawnSync-based pager (was never wired). (510335a, M1–M8)
- **Hub cache staleness check** now wired into `getMarketplaceItems()`.
  (510335a, M9)
- **`looksLikeQuestion`** correctly classifies env-prefixed (`FOO=bar cmd`)
  commands as shell, not chat. (70feea6)
- **Boolean flag set** widened with `clear / down / fix / once / sound`;
  `notify --once`, `config doctor --fix`, etc. now parse without erroring on
  missing values. (4c78bea)
- **Shell SIGINT handler** no longer calls `process.exit()` mid-prompt; Ctrl+C
  just cancels the current line. (4c78bea)
- **`warnFallback` output formatting** fixed for the doctor/notify test
  expectations. (4c78bea)

### Added — community moderation

- **Flag auto-hide trigger** in the backend. When a flag insert pushes a
  target's total to ≥10, the underlying `discussions` or `discussion_replies`
  row gets `hidden = 1`; the existing read endpoints already filter
  `hidden = 0`, so the item drops out of default views. Maintainers retain
  access via the `kill_switch_log` audit table. Adds the previously missing
  `hidden` column to `discussion_replies`. (ec0e68e)
- **FTS5 virtual tables + sync triggers** on `discussions` and
  `discussion_replies` (`backend/schema.sql`, 70feea6) plus
  **search-handler cutover** in `backend/src/index.ts`: `/api/community/search`
  now joins `discussions_fts` / `discussion_replies_fts` via `MATCH`. User
  input is wrapped as a quoted FTS5 phrase (`'"' + q.replace(/"/g, '""') + '"'`)
  so query operators are treated as literals; `sanitizeFtsQuery` lives in
  `src/community/search.ts` for unit-testing. Board filter, `hidden`
  exclusion (both reply and parent), pagination, and the wire response
  shape are unchanged.

### Added — HuggingFace README enrichment

- **HF model-card + README fetch** in `src/hubs/enrichment.ts`
  (`fetchHfRepoMetadata`). Pulls `lastModified` from
  `https://huggingface.co/api/<endpoint>/<repoId>` and the raw README from
  `https://huggingface.co/[datasets/|spaces/]<repoId>/raw/main/README.md`,
  falling back `models → datasets → spaces` on 404.
- **`enrichHfItem`** mirrors `enrichItem` with cache key `hf:<repoId>@<lastModified>`,
  reusing the same on-disk `EnrichmentStore` and the same `generateDescription` /
  `generateInstallHint` opencode pipeline. Wired into the marketplace TUI
  (`src/cli/pages/marketplace.ts`) so HF detail views get the same AI
  description + install-hint badge that GitHub items have had.
- **Test seam**: `generateDescription`, `generateInstallHint`, `enrichItem`,
  and `enrichHfItem` now accept an optional `opencode?: (prompt) => Promise<string|null>`
  override so tests can stub out the subprocess.

### Added — kill-switch operator UI

- **`POST /api/admin/hide`** and **`GET /api/admin/log`** on the backend.
  Gated by a new `requireAdmin` middleware that checks the caller's user
  id against the comma-separated `AGORA_ADMIN_USER_IDS` env (no schema
  change). `hide` inserts into `kill_switch_log` and flips `hidden = 1`
  on the target; `log` returns the most recent audit entries joined
  against `users` for operator usernames.
- **`agora admin hide <id> --reason <r> [--type discussion|reply]`** and
  **`agora admin log [--limit 50]`** in `src/cli/commands/community.ts`,
  wired through `app.ts` and registered in `commands-meta.ts`.
- **`adminHideSource` / `adminLogSource`** in `src/community/client.ts`
  match the existing `flagSource` / `voteSource` shape. 11 new tests in
  `test/community/admin.test.ts` cover the happy path, 403 surfacing,
  and the log renderer.

### Added — reputation calculation

- **`users.reputation REAL NOT NULL DEFAULT 0`** column on the backend.
  Migration comment in `backend/schema.sql` for existing D1 instances.
- **`computeReputation(accountAgeDays, netVotes)`** in
  `backend/src/index.ts` — `min(ageDays, 365) + log10(max(1, netVotes+1)) * 100`,
  rounded to one decimal. Exported and unit-tested
  (`test/community/reputation.test.ts`, 5 boundary cases).
- **`POST /api/admin/reputation/recompute`** (admin-only via
  `requireAdmin`). Sums signed votes across each user's discussions +
  replies in a single UNION-ALL query, then `DB.batch()`-updates the
  `reputation` column. Returns `{ recomputed, durationMs }`.
- **`/api/users/:username`** now includes `reputation` in the response.
- **`agora admin recompute`** subcommand and `adminRecomputeSource`
  helper. `formatProfileDetail` renders a `Reputation` line.
- Per the guidelines, reputation does NOT gate participation; it's a
  display field today and will weight the `top-week` / `active`
  community sort in a follow-up.

### Added — permission manifests (display scaffold)

- **`InstallPlan.permissions`** carried through `createInstallPlan` from
  the existing `Package.permissions` field (`src/marketplace.ts`).
- **`renderPermissionLines(perms)`** shared helper renders
  `fs / net / exec` rows (or a `none declared` line when absent), used
  by both the TUI install-preview and the CLI install dry-run.
- **TUI list-row badge** `[fs net exec]` (only present categories) on
  any item with a non-empty manifest — gives the dangerous-side
  discoverability without clutter.
- **Catalog backfill** on 7 representative entries: `mcp-filesystem`,
  `mcp-openai`, `mcp-brave-search`, `mcp-firecrawl`, `mcp-docker`,
  `mcp-kubernetes`, `mcp-obsidian`.
- Install confirm is NOT gated on permissions yet — that's Phase 4
  trust work. This change is declaration + display only.

### Added — TUI page UX

- **Marketplace**: `[gh]` / `[hf]` / `[c]` source badge on every row,
  `PAID` badge in accent when an item's pricing isn't free, new `t`
  source-filter cycle (`all → curated → github → hf`) and `p` pricing-filter
  cycle (`all → free → paid`), source breakdown in the header (`12 curated
  · 8 gh · 3 hf`), and a one-line `AGORA_LIVE_HUBS=1` hint on the empty
  state when hubs are disabled. The stub `s save` hotkey was removed.
- **Community**: `o` cycles thread sort (`top → new → active`) and re-fetches
  via `communityThreadsSource`; vote arrows render `▲` / `▼` in accent
  when you've voted, dim `↑` otherwise (uses `voteGlyph()` helper); `g` /
  `G` jumps to first / last in any view; reader keeps the thread title +
  separator pinned while replies scroll.
- **News**: `S` cycles the source filter (`all → hn → reddit →
  github-trending → arxiv → rss`), `b` toggles saved-only, `u` toggles
  unread-only (the two AND together when both on), `g` / `G` jumps;
  `visible()` was refactored to a pure helper accepting state for unit
  tests.
- **Settings**: 5 new news-source toggle fields (one per `news.sources` key)
  added via a generator helper, inline dim help line under the selected
  field (`FIELD_HELP` map), `r` reverts unsaved changes back to disk, `?`
  toggles a full-screen help overlay listing hotkeys + descriptions,
  blank-line spacing between sections.

### Added — live hubs & community deepening (initial 2026-05-17 wave)

- **Live marketplace hubs** (`AGORA_LIVE_HUBS=1`). New `src/hubs/` module with
  GitHub Search REST and HuggingFace API connectors, a shared quality gate
  (stars × recency × license × topic match), and a single on-disk cache at
  `~/.config/agora/hubs-cache.jsonl`. Topic seeds: `mcp`, `claude-skill`,
  `agent-tools`, `langchain`, `opencode`, and more. Optional
  `AGORA_GITHUB_TOKEN` raises the unauth 60 req/hr limit to 5000. Refresh via
  `bun scripts/refresh-hubs.ts`.
- **`Pricing` scaffold on `Package`** (`{ kind: 'free' } | { kind: 'paid', … }`).
  All 67 curated entries and all live items backfilled to free; CLI renders a
  dim `FREE` / accent `PAID` badge next to item names. Paid branch is a typed
  no-op pending Phase 3 commerce — no payment SDKs in the dep tree.
- **Install flow rework**. Three install kinds (`git-clone`, `mcp-config-patch`,
  `package-install`) replace the single-branch `'mcp'` handler. TUI marketplace
  page gets preview-then-confirm (`y`/`n`) before any execution; CLI gains a
  `--yes` flag for scripting. `extractPostInstallHint()` parses README headings
  to surface a one-liner in the preview.
- **Opencode-powered README enrichment** for GitHub hub items. On detail-view
  open, fetches the README, runs two opencode calls in parallel (1-sentence
  description + install hint), and renders the AI description with an `(ai)`
  tag. Cached on disk in `~/.config/agora/hubs-enrichment.json` keyed by
  `<repoId>@<commit-sha>` — re-opens are instant; re-runs only after the repo
  is updated.
- **HuggingFace hub** mirroring the GitHub pattern. Pulls top models,
  datasets, and spaces matching the agentic-coding audience
  (`text-generation`, `feature-extraction`, `text2text-generation`,
  `instruction-tuning`, `chatbot`). Auth-free, single-cache shared with
  GitHub items.
- **Community endpoints on the backend** (`backend/src/index.ts`).
  Implemented the six community endpoints the client expected but the
  backend didn't have: `GET /api/community/boards`, `GET /threads` (paginated,
  sortable), `GET /thread/:id` (with nested replies), `POST /threads`,
  `POST /reply/:parentId`, `POST /vote/:targetId`. All mutations require
  Bearer auth and atomically bump score / reply_count.
- **Cross-thread community search** (`GET /api/community/search?q=&board=&limit=`).
  LIKE-based for v1 with a TODO to migrate to FTS5; returns matched threads
  and replies with content snippets where matches are wrapped in
  `[brackets]` for the TUI to highlight.
- **Community TUI deepening** in `src/cli/pages/community.ts`:
  - Inline multi-line composer (`n` new thread, `r` reply, `Ctrl+S` send,
    `Esc` cancel).
  - `+` / `-` voting with optimistic update.
  - `f` flag modal with 5-reason picker (matches the guidelines).
  - Automatic collapse rendering at `flagCount >= 3`, per
    `COMMUNITY_GUIDELINES.md`. `X` to expand a collapsed item.
  - `[bot · <model>]` chip on `authorIsLLM` posts.
  - `/` opens a search view from any community sub-view; query is debounced
    400ms, `Tab` toggles scope between "current board" and "all".
- **`agora community search …` CLI** parity to the TUI search.
- **Schema additions** to `backend/schema.sql`: `discussions.hidden`,
  `discussions.author_is_llm`, `discussions.author_model`. Manual `ALTER
  TABLE` statements appended for existing D1 instances.

### Fixed

- **Backend `signJwt` TS errors** at `backend/src/index.ts:296-297`
  (`Uint8Array` not assignable to `ArrayBuffer`). Widened `base64Url` to
  accept both. Unblocks the `backend` CI job that has been red since 2026-05-16.
- **Eight pre-existing `noUnusedLocals` / `noUnusedParameters` build errors**
  across `src/cli/commands/{chat,init,learn,marketplace,operations}.ts` that
  blocked `bun run build`. The CI `check` job passes again.
- **Prettier debt** across 52 files; `bun run format:check` is now green.

### Changed

- `Package` interface gains optional `pricing?: Pricing`.
- `InstallPlan` gains `kind`, `cloneTarget`, `postInstallHint` fields.
- `getInstallKind()` renamed branch `'mcp'` → `'mcp-config-patch'`.
- `getMarketplaceItems()` merges live hub items when `AGORA_LIVE_HUBS=1` and
  the cache has data.

### Internal

- 95 new tests on 2026-05-17; an additional 324-line `test/app.test.ts`
  added 2026-05-19 to cover the new shell / config / notify surface.
- Commits on `main` since 0.4.0: live-hubs / community wave `9b07266`,
  `b779332`, `027b62e`, `2f239db`, `b552d7a`, `3f21ebe`; backend CI unblock
  `c5599df`; moderation `ec0e68e`; shell / CLI polish `70feea6`, `1b55c49`,
  `d380d34`, `3f5fe36`, `510335a`, `4c78bea`.

## [0.4.0] - 2026-05-16

The "interactive shell & destination scaffold" release — the largest in Agora's
history. Running `agora` in a TTY now drops you into a live, persistent shell
with bash/chat dispatch, a designed look, and live status. The full-screen TUI
ships as a working scaffold with five pages and two density variants. Search and
browse gained sorting, table rendering, and pagination. Every AI-facing string
in the plugin was audited and optimized. 17K new lines across 97 files.

### Added

- **Interactive shell** (`agora` in a TTY). A persistent REPL with mixed
  bash/chat dispatch — type a real shell command and it runs; type a
  question and it routes to `opencode`. Tab completion, ctrl-r reverse
  search, ghost-text suggestions from history, `/menu` `/transcript`
  `/clear` `/verbose` `/quiet` `/medium` `/help` `/quit` meta commands,
  `!` to force bash and `?` to force chat, `/last` and `/again` to re-run
  the previous bash or chat turn. Per-cwd transcripts under
  `~/.config/agora/transcripts/<hash>.jsonl` and per-cwd `opencode`
  sessions so unrelated projects can't bleed context.
- **`agora chat`** — free inference via `opencode`. TUI mode (`agora chat`)
  launches the full `opencode` TUI with `inherit` stdio. One-shot mode
  (`agora chat "question"`) streams a JSON response and persists the
  session. Plugin tool (`/agora chat "..."`) makes the same available
  inside OpenCode.
- **`agora mcp`** — marketplace as an MCP server. All seven marketplace
  tools exposed as standard MCP tools. `agora init --mcp` auto-registers it.
- **`agora tui`** — the full-screen Agora TUI. Top-tabs frame, five pages
  (Home · Marketplace · Community · News · Settings), `1`-`5` page
  switch, `Tab`/`Shift-Tab` cycle, `j/k` nav, `Enter` drill-in,
  `?` overlay help, `q` quit, `Ctrl-L` redraw. Alt-screen entry/exit
  is clean; `NO_COLOR` and narrow-terminal (< 80 cols) fallbacks both
  work. Each page ships in two density variants (calm + dense).
- **TUI shell entrypoints** — `/tui`, `/home`, `/market`, `/marketplace`,
  `/comm`, `/community`, `/news`, `/settings` open the TUI on that page.
- **`--sort stars|installs|name|updated|relevance`** flag on `agora search`
  and `agora trending`, with `--order asc|desc`.
- **`--table`** flag on `agora search` and `agora trending` — box-drawn table
  rendering with id, name, stars, and installs columns.
- **Pagination:** `--page N --per-page N` on `agora search`.
- **Auto-complete slash commands on `/`.** Matching commands appear in the
  footer as you type, narrowed with each character, re-shown on backspace.
- **Model name + rotating tips footer.** Replaced turn-count display with
  `model: deepseek-… · type /help to see all slash commands`. 17 tips.
- **Carved-relief wordmark.** Algorithmic top-highlight / bottom-shadow pass
  that reads as carved stone under the gradient.
- **Greek-key meander frieze.** Three-row architectural ribbon under the
  banner; doubles as the determinate progress bar during installs.
- **Live thinking line + ionic mascot** — animated 4-frame ionic-column glyph
  while the model is generating. TTY-only, gated on ≥50 cols.
- **Live status footer** under the prompt (cwd · model · verbosity · turns ·
  cost), repainted on every keystroke.
- **Markdown chat output** — `**bold**` `code` `- bullet` `# headers` rendered
  inline with ANSI; fenced code blocks pass through untouched.
- **`/agora` slash command** — `.opencode/command/agora.md` written by
  `agora init`, forwarding input to the matching `agora_*` tool.
- **`login` / `logout` / `whoami` CLI aliases** — delegate to `auth login`,
  `auth logout`, `auth status --json`.
- **`COMMUNITY_GUIDELINES.md`** — flag-don't-delete, kill-switch criteria,
  LLM/bot self-identification, earned-not-granted reputation.
- **`AGENTS.md`** — developer prompt for AI-efficient tool design, output
  formatting, slash command routing, and pre-commit checks.
- **`docs/ARCHITECTURE.md`**, `docs/TUI_DESIGN.md`, `docs/PHASE_1_5_PLAN.md`,
  `docs/claude-design-brief-tui.md` — architecture, design rationale, and
  Phase 1.5 implementation plan.
- **`src/settings.ts`** — `AgoraSettings` + `loadSettings`/`writeSettings`
  stubs for TOML persistence.
- **Phase 1.5 directory scaffolds** — `src/cli/pages/`, `src/news/`,
  `src/news/sources/`, `src/community/`, `test/fixtures/news/`,
  `test/fixtures/community/`.
- **npm validation tests (network-gated)** — 20 npmPackage entries verified
  live against the registry; 15 fixed, 2 corrected.

### Changed

- **Optimized `/agora` slash command prompt** — reduced from 33 lines of
  preamble, tool re-listing, and background to a single routing rule. The
  model already sees tool descriptions from plugin registration; repeating
  them wasted tokens on every invocation.
- **Trending ranked by installs, not stars** — modelcontextprotocol/servers
  monorepo packages shared one star count; now uses npm download counts.
- **Plugin tool output reformatted** — counts shown as `264.2K`, ids
  displayed for `browse`/`install`, config blocks no longer mis-indented.
- README/`agora_info` explain the tool-vs-slash-command distinction instead
  of implying the plugin registers `/agora` itself.
- Deps bumped: TypeScript 5→6, ESLint 9→10, zod 3→4, `@types/node` 22→25.

### Removed

- **Fabricated plugin tools.** `agora_review`, `agora_discussions`, and
  `agora_profile` returned hardcoded data. Profiles, reviews, discussions,
  and publishing remain in the CLI (backend-backed).
- Dead modules: `src/api.ts`, `src/logger.ts`.

### Fixed

- **Arrow keys in shell** — `[` (0x5b) was treated as a CSI final byte,
  dropping escape sequences. Auto-complete now works with up/down history.
- **`/quit` hanging** — stdin stayed in flowing mode after prompter cleanup.
  Added `inp.pause()` and `process.exit()`.
- **`/clear` now reprints home banner** — wordmark, motto, version, commands.
- **`/agora`-prefixed slash inputs** fell through to bash because
  `isExecutable('/agora')` resolved against PATH. Rejected if name contains `/`.
- **Prompt-line duplication on narrow terminals** — rewrote `renderPromptFrame`
  with terminal width awareness and `\x1b[J` erase from the top of the frame.
  +5 tests.
- **`cd <nonexistent>`** updated `currentCwd` without verifying the target.
  Now stat-checks before assigning.
- **`searchMarketplaceItems` sort inverted** — `compareByPopularity` was
  double-negated for `desc` order. All comparators normalized to ascending.
- **Data tests assumed every MCP package must have `npmPackage`** — updated to
  allow browsable-only entries.

## [0.3.0] - 2026-05-14

A production-hardening release. The marketplace data is now real, the
codebase has quality gates, and the headline bugs are fixed.

### Added

- ESLint + Prettier with a one-time format pass; `lint`/`format` scripts
- Full-tree typecheck (`src` + `scripts` + `test` + `backend`) and an
  expanded CI workflow (format:check + lint + typecheck + test + backend)
- Contract test suite — 98 → 229 tests exercising the real functions
- `.github/dependabot.yml` for weekly dependency updates

### Changed

- **Marketplace data is now real.** The fictional package set was
  replaced with 31 verified MCP servers — every `npmPackage` resolves on
  the registry, with real version/repository/author/downloads/stars
- `agora init` / `agora use` now fall back to a project-local
  `opencode.json` instead of silently writing the user's global config
- Discussions are backend-only — the offline build no longer ships
  fabricated community activity

### Fixed

- **Generated configs now use OpenCode's real schema.** Agora was writing
  `mcpServers`/`plugins` with the wrong MCP entry shape — OpenCode's
  schema uses `mcp`/`plugin` with `{ type: "local", command: [...] }`
  entries, so `init`/`use`/`install --write` output was silently ignored
- `agora init` crashed on unrecognized project types
- `runCommands` validated install commands and switched to `execFileSync`
  (no shell injection); `init` reports real install success/failure
- Non-Node framework/database detection in `init` (was dead code)
- Atomic writes for `state.json` and `opencode.json` (temp + rename)
- `agora use` no longer overwrites an unparseable config
- `parseArgs` accepts negative-number flag values
- `findMarketplaceItem` no longer silently resolves the wrong package
- Backend: input validation, no internal error leakage, guarded JSON
  parsing; plugin reads its version from `package.json`

### Security

- Backend `requireUser` flagged (`// SECURITY:`) — uses the raw GitHub
  OAuth token as the API bearer credential. Backend deployment is
  deferred until this is reworked; see ROADMAP.md.

## [0.2.2] - 2026-05-13

### Fixed

- Invalid `package.json` (trailing comma after `devDependencies` left by the 0.2.1 cleanup) that prevented `npm publish` from parsing the manifest. 0.2.1 was tagged but never published; 0.2.2 is the first publishable release.

## [0.2.1] - 2026-05-13

### Fixed

- Version drift: `agora --version` now reflects the version in package.json
- Removed placeholder backend URL; `--api` now requires an explicit `AGORA_API_URL` environment variable
- Removed duplicate `test` key in package.json

### Added

- ROADMAP.md outlining upcoming work and contribution areas
- Dependabot config for weekly dependency updates

### Docs

- Clarified backend self-host requirement; hosted instance not yet deployed
- Added manual plugin registration guide to README

## [0.2.0] - 2026-05-11

### Added

- `agora init` — project scanner that detects stack (Node, Python, Rust, Go, Ruby, Java),
  frameworks (React, Next.js, Django, Rails, Spring, Vue), Docker, CI, and database
  dependencies, then generates the optimal opencode.json with stack-matched MCP servers,
  auto-installs npm packages, and registers the opencode-agora plugin
- `agora use <workflow-id>` — applies a workflow as an OpenCode skill file in
  `.opencode/skills/` and registers it in opencode.json
- Auto-install: `agora install --write` now runs `npm install -g` automatically
  instead of just printing instructions
- Plugin auto-registration: `agora init` adds `opencode-agora` to plugins array
- Rich offline data: expanded from 5 to **36 MCP servers** across 12 categories
  (filesystem, databases, cloud, browser automation, monitoring, etc.),
  **10 production workflows** (TDD, security audit, API design, refactoring, etc.),
  **7 community discussions**, and **6 tutorials**
- npm publish CI workflow (typecheck + test + build + publish on release)

### Changed

- `install --write` now auto-runs package install commands
- Updated CLI help text with `init` and `use` commands
- All documentation updated to reflect new commands and data

## [0.1.0] - 2025-01-01

### Added

- Initial release of Agora
- CLI marketplace with search, browse, trending, install, and config management
- OpenCode plugin with 10 tools
- Bundled offline marketplace data with automatic fallback
- Live API mode with Cloudflare Workers backend
- Local web Hub for visual browsing
- State management (saved items, auth tokens)
- Config detection, doctor, and safe write operations
- Community discussions, reviews, and user profiles
- Interactive tutorials on MCP and AI development
- Comprehensive test suite
