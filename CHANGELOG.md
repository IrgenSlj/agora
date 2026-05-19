# Changelog

All notable changes to `agora`. Format inspired by [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- **`agora scan <id>`** — pre-install safety scan. Runs six checks (permissions declared, permission/install-kind consistency, repo reachable, npm package exists, recently active, flag count below auto-hide threshold) and reports pass / warn / fail with a summary. Exits 1 only on failures; warnings are informational. `--json` available; reads `AGORA_GITHUB_TOKEN` to raise GitHub's unauth rate cap. This is Phase 4 trust as a client-side check first; the same logic will move server-side at publish time when the hosted backend lands.
- **`agora outdated`** — reads opencode.json, fetches the npm registry for each declared MCP package, and reports `latest` + `time.modified` age per row. Marks anything not published in the last 365 days as stale. Strictly informational: no exit-code failure, no "is this installed locally" detection (opencode.json doesn't pin versions; `npm list -g` is unreliable). `--json` and `--config <path>` available.

### Fixed
- News preview article fetch was using a hardcoded `Agora/0.4.1` User-Agent; switched to the shared `agoraUserAgent` constant so the UA tracks `package.json`.
- Auth device-code / token-poll / logout fetches gained 5–10s `AbortSignal.timeout` — the CLI no longer hangs forever if the backend stalls.
- `fg` / `bg` shell builtins now print "No background jobs." for an empty job set and reject non-numeric job ids cleanly (was "Job NaN/-Infinity not found").
- `doctor --deep`'s `npm view` existence check uses `execFileSync` (was `execSync` with template-string interpolation).
- `searchApi` uses `Promise.allSettled` so a single source erroring doesn't tank the whole search; total failure still throws to keep the existing offline fallback.
- Whitespace-only notes on community flag submit are now treated as no notes (was passed through as a blank string).
- OAuth `state` cookie's `sameSite` normalized to lower-case `'lax'` to match the access/refresh cookies set in the same file.

### Refactored
- Backend D1 row reads: dropped all 28 `as any` casts via inline row types (`UserRow`, `PackageRow`, `WorkflowRow`, `DiscussionRow`, `DiscussionReplyRow`, `RefreshTokenRow`, `DeviceCodeRow`, `KillSwitchRow`, `BoardStatsRow`) plus typed shapes on the GitHub OAuth fetch responses. Joined SELECTs use inline intersection types.
- `rateLimit(c: Context<Env>)` in backend now uses Hono's `Context` type instead of `any`.
- Dropped the wrong `@deprecated` markers on `formatStars` / `formatInstalls` — both aliases are still in active use.

### Internal
- 793 pass / 1 skip / 0 fail across 35 test files (was 768 across 34 at 0.4.1).
- 2 new enrichment tests (sha-changed and opencode-null paths) close the remaining coverage gap on the hub enrichment cache.

## [0.4.1] - 2026-05-18 — CLI enrichment

The "destination + trust" cycle on top of 0.4.0. Phase 1.5 pillars
(news / community / live marketplace hubs) shipped end-to-end; the
Phase 1.6 polish list is closed; Phase 4 trust gating took its first
step with declared install permissions.

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

### Refactored
- `pageSourceOptions` shared helper (community + home pages were carrying drifted copies)
- `Package.source` / `pushedAt` typed (was `(as any)` × 12)
- `getMarketplaceItems` 30s memo + parallel news source fetch
- `src/` `(as any)` count: 35 → 15 (remaining are stdin raw-mode probes)

### Internal
- 768 pass / 1 skip / 0 fail across 34 test files (was 509 across 22 at 0.4.0)

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
- Backend `requireUser` flagged `// SECURITY:` — used the raw GitHub OAuth token as the API bearer credential. Deployment was deferred until the auth rework that landed in the [Unreleased] cycle.

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
