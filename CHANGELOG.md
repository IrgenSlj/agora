# Changelog

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
