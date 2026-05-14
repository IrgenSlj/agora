# Changelog

## [Unreleased]

### Added

- **`/agora` slash command.** OpenCode plugins can only register tools, not
  slash commands — so `agora init` now also writes `.opencode/command/agora.md`,
  a command that forwards your input to the matching `agora_*` tool. Type
  `/agora search ...`, `/agora install ...`, etc. inside OpenCode.

### Changed

- README and the `agora_info` tool now explain the tool-vs-slash-command
  distinction instead of implying the plugin registers `/agora` itself

### Removed

- **Dropped the fabricated plugin tools.** `agora_review`, `agora_discussions`,
  and `agora_profile` returned hardcoded or fake-success data with nothing
  behind them. The plugin now ships only the seven offline-capable marketplace
  tools. Profiles, reviews, discussions, and publishing remain in the `agora`
  CLI, which is backend-backed.

### Fixed

- **Trending no longer ties on stars.** Every package in the
  modelcontextprotocol/servers monorepo shares one repo-level star count, so
  trending and empty-query search now rank by `installs` (npm downloads) — a
  real per-package signal. `agora_trending` shows install counts for packages.
- Plugin tool output now formats counts (`264.2K` instead of `264237`), leads
  with installs, shows item ids for `browse`/`install`, and the `install`
  command's fenced config blocks are no longer mis-indented.

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
