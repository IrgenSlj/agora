# Changelog

## [0.4.1] - 2026-05-15

The "marketplace UX" release. Search and browse now support sorting,
table rendering, and pagination. The shell got auto-complete on `/`,
a useful footer (model + rotating tips), and fixes for arrow keys and
`/quit` hang. npm packages fully validated against the registry.

### Added

- **`--sort stars|installs|name|updated|relevance`** flag on `agora search`
  and `agora trending`. Sort results by any dimension, with `--order asc|desc`.
- **`--table`** flag on `agora search` and `agora trending`. Renders a
  box-drawn table (┌ ┐ └ ┘ │ ─) with id, name, stars, and installs columns.
- **Pagination:** `--page N --per-page N` on `agora search`. Non-overlapping
  pages with a navigation hint footer.
- **Auto-complete slash commands on `/`.** As soon as you type `/`, matching
  slash commands appear in the footer — narrowed with each character,
  re-shown on backspace. No Tab needed.
- **Model name + rotating tips footer.** Replaced the unhelpful turn-count
  display with `model: deepseek-… · type /help to see all slash commands`.
  17 tips, stable per turn.
- **`login` / `logout` / `whoami` CLI aliases.** Delegate to `auth login`,
  `auth logout`, `auth status --json` respectively.
- **login/whoami tests.** Integration tests verify login writes state and
  whoami reads it back.
- **npm validation tests (network-gated).** 20 npmPackage entries verified
  live against the registry; 15 fixed (13 removed, 2 corrected).

### Fixed

- **Arrow keys in shell.** `[` (0x5b) was treated as a CSI final byte,
  causing `\x1b[` to be silently dropped and `A`/`B`/`C`/`D` to arrive as
  printable characters. Auto-complete now works with up/down history navigation.
- **`/quit` hangs the shell.** stdin stayed in flowing mode after the prompter
  cleaned up, keeping the event loop alive. Added `inp.pause()` in cleanup
  and `process.exit()` in the entrypoint.
- **`/clear` now reprints home banner.** Clears screen then redraws the
  full home state — wordmark, motto, version line, slash commands.
- **`searchMarketplaceItems` sort was inverted.** `compareByPopularity`
  returned descending but was negated again for `desc` order, producing
  ascending results. All comparators normalized to ascending order.
- **`getTrendingItems` sort reference.** Was calling `.sort(compareByPopularity)`
  directly; switched to inline arrow function for clarity.
- **Data tests assumed every MCP package must have npmPackage.** Updated to
  allow browsable-only entries (no npmPackage) while still validating
  installable ones.

## [0.4.0] - 2026-05-15

The "interactive shell" release. Running `agora` with no arguments in a TTY
now drops you into a live, persistent shell with bash/chat dispatch, a
designed look, and live status. Adds an `agora chat` free-inference path and
an MCP server mode.

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
  tools (search, browse, trending, install-preview, save, list-saved,
  workflow-use) exposed as standard MCP tools. Add to `opencode.json` or
  any MCP client for conversational catalog queries. `agora init --mcp`
  auto-registers it.
- **Carved-relief wordmark.** New `AGORA_WORDMARK_RELIEF` — a single set
  of letterforms with an algorithmic top-highlight / bottom-shadow pass
  that reads as carved stone under the gradient. Replaces the four
  earlier wordmark variants (solid / outline / shaded / textured).
- **Greek-key meander frieze.** Three-row architectural ribbon under
  the banner: solid top bar, zigzag teeth (`▀▀▄▄` × 13), solid bottom
  bar. Also doubles as the determinate progress bar during installs
  (single-line in that mode so it can redraw in place).
- **Live thinking line + ionic mascot.** While the model is generating,
  the chat renderer prints a live duration counter with an animated
  4-frame ionic-column glyph (`╭⊙─⊙╮` swaying). TTY-only, gated on
  ≥50 cols so narrow terminals stay quiet.
- **Live status footer.** A single dim line under the prompt input
  (cwd · model · verbosity · turns · cost), repainted on every
  keystroke and cleared on submit so output flows from a fresh line.
- **Markdown chat output.** Streamed chat responses are now formatted
  inline: `**bold**` → ANSI bold, `` `code` `` → accent, `- bullet` →
  `·` in accent, `#/##/###` headers → accent. Fenced ``` ``` ``` code
  blocks pass through untouched (with dim fences).
- **`/agora` slash command** inside OpenCode. Plugins can only register
  tools, so `agora init` also writes `.opencode/command/agora.md` to
  forward your input to the matching `agora_*` tool.
- **`docs/ARCHITECTURE.md`** — the three-surface model, the
  open-marketplace direction, and the inference question, written down.

### Changed

- README and the `agora_info` tool now explain the
  tool-vs-slash-command distinction instead of implying the plugin
  registers `/agora` itself.

### Removed

- **Dropped the fabricated plugin tools.** `agora_review`,
  `agora_discussions`, and `agora_profile` returned hardcoded or
  fake-success data with nothing behind them. The plugin now ships
  only the seven offline-capable marketplace tools. Profiles, reviews,
  discussions, and publishing remain in the `agora` CLI, which is
  backend-backed.

### Fixed

- **Trending no longer ties on stars.** Every package in the
  modelcontextprotocol/servers monorepo shares one repo-level star
  count, so trending and empty-query search now rank by `installs`
  (npm downloads) — a real per-package signal. `agora_trending` shows
  install counts for packages.
- Plugin tool output now formats counts (`264.2K` instead of `264237`),
  leads with installs, shows item ids for `browse`/`install`, and the
  `install` command's fenced config blocks are no longer mis-indented.

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
