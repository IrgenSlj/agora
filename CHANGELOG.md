# Changelog

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
