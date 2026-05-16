# Agora — The Developer's Terminal Marketplace

<p align="center">
  <strong>A standalone terminal hub for discovering, installing, and (soon) trading agent tooling.</strong>
</p>

<p align="center">
  Project scanner, MCP marketplace, and workflow manager — a standalone CLI, with a thin OpenCode plugin as one of its surfaces.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-agora"><img src="https://img.shields.io/npm/v/opencode-agora" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/issues"><img src="https://img.shields.io/github/issues/IrgenSlj/agora" alt="issues"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/opencode-agora" alt="license"></a>
  <a href="https://github.com/IrgenSlj/agora/actions"><img src="https://img.shields.io/github/actions/workflow/status/IrgenSlj/agora/ci.yml?branch=main" alt="CI"></a>
</p>

---

## Demo

_A terminal recording is in the works — see ROADMAP.md._

## What is Agora?

Agora is a **standalone terminal marketplace** for the agentic-coding ecosystem — MCP servers, workflows, and tutorials, browsable and installable from your shell with no login and no backend. Run `npx opencode-agora init` in any project and it scans your stack, generates the right `opencode.json`, and installs matched MCP servers.

It bundles **62 MCP servers**, **12 production workflows**, **12 tutorials**, and **6 prompts**, all usable offline.

**Where it's headed:** Agora is evolving into an **open, self-regulating marketplace** where third-party developers publish and sell advanced skills, tools, and kits — with Agora providing the square and the rules (discovery, trust, delivery), not the goods. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the direction and [`ROADMAP.md`](./ROADMAP.md) for the plan.

### Surfaces

Agora is one core marketplace engine behind three surfaces:

- **`agora` CLI** — the primary, standalone experience. Browse, install, manage from any terminal.
- **OpenCode plugin** — a thin bridge that surfaces the catalog *inside* OpenCode and installs into the current project. ([details](#opencode-plugin-commands))
- **`hub/`** — an optional local web console for browsing.

## Features

### Interactive shell — `agora` in a TTY
Run `agora` with no arguments in an interactive terminal and you drop into
the agora shell: a persistent REPL with mixed bash/chat dispatch.

- Type a shell command (`ls`, `git status`, `npm test`) and it runs.
- Type a question or sentence and it routes to `opencode` for a free
  inference chat — markdown formatting, live duration counter, ionic
  mascot while thinking.
- `!cmd` forces bash, `?msg` forces chat, `/help` lists meta commands
  (`/menu` `/terminal` `/transcript` `/clear` `/verbose` `/quiet` `/medium` `/last`
  `/again` `/quit`).
- Tab completion, auto-complete on `/`, ctrl-r reverse history search, ghost-text suggestions.
- Per-cwd transcripts under `~/.config/agora/transcripts/` so each
  project keeps its own session and chat thread isolated.
- `/terminal` spawns a bash subshell from anywhere.
- Orange-accented home screen with model name, `/terminal`, and page shortcuts.

### `agora init` — One-Command Setup
- Scans your project for `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `Dockerfile`, and more
- Detects frameworks (React, Next.js, Django, Rails, Spring, Vue)
- Generates the optimal `opencode.json` with stack-matched MCP servers
- Automatically installs npm packages and registers the `opencode-agora` plugin
- Ready in seconds — run once, done

### `agora use` — Apply Workflows as Skills
- Browse 10+ production-tested workflows (TDD, security audit, API design, refactoring, etc.)
- `agora use wf-tdd-cycle` creates an OpenCode skill file and registers it
- No manual copy-pasting — one command and the workflow is live

### Rich Offline Marketplace
- **62 MCP servers** across 12 categories (filesystem, databases, cloud, browser automation, monitoring, etc.) — every `npmPackage` is verified against the live npm registry
- All official `@modelcontextprotocol/*` servers plus top community servers
- Fully functional offline — no backend required
- Search, browse, trending — all work with bundled data
- Sort by stars/installs/name with `--sort`, render tables with `--table`, paginate with `--page` / `--per-page`

### Config-Aware Installs
- `agora install mcp-github --write` installs the npm package **and** writes to config
- Detects OpenCode config path automatically
- Merge MCP servers into existing config
- Inspect config health with `agora config doctor`

### `agora mcp` — Marketplace as an MCP Server
- Exposes all marketplace tools (search, browse, trending, install) as standard MCP tools
- Add to `opencode.json` for conversational queries: "find a postgres MCP server"
- Also usable from any MCP client — Claude Desktop, Cursor, etc.
- Register with `agora init --mcp` to auto-add to your OpenCode config

### `agora chat` — Free AI + TUI
- **TUI mode** (`agora chat`): Launches the full `opencode` TUI with your chosen model.
  Zero per-message latency, conversation history, editing, and `/agora` commands.
- **One-shot mode** (`agora chat "question"`): Single query via `opencode run`,
  streams the response, persists session for `--continue`.
- **Plugin tool** (`/agora chat "question"`): Chat from inside OpenCode using the
  `agora_chat` plugin tool — no separate API key needed.

### Community (CLI + backend)
- Profiles, reviews, discussions, and publishing live in the `agora` CLI
- These need a connected backend — the bundled offline build does not ship community data
- The OpenCode plugin deliberately ships only the offline-capable marketplace tools

### OpenCode Plugin
- Search, browse, trending, install-preview, and tutorial tools from inside OpenCode
- Uses the same marketplace core as the CLI — fully offline, no login required

### Local Hub
- Optional browser console for browsing the marketplace
- Runs locally with `bun run hub:dev`

### Learn
- 12 interactive tutorials on MCP, auth, catalog-contrib, backend deploy, and more

### Phase 1.5: "Destination" — substantially shipped

The three pillars are now built into the CLI. See [`ROADMAP.md`](./ROADMAP.md) for remaining items (backend deploy, demo recording):

- **`agora news`** — curated tech news feed (HN, Reddit, GitHub Trending, arXiv, RSS) with scoring, caching, category tabs (All/Mcp/Tools/Skills/Llms/Repos/Market/Search), detail view, and AI-powered article summarization via `opencode run`. TUI reader with scrollable preview.
- **`agora community` / `agora thread` / `agora post` / `agora reply` / `agora vote` / `agora flag`** — Reddit-style community hub with boards, threaded replies, votes, and flag-don't-delete moderation. CLI commands exist; needs a deployed backend.
- **`agora similar <id>` / `agora compare <id1> <id2>`** — discovery polish: Jaccard similarity and side-by-side comparison tables. Both shipped.
- **`agora preferences` / `agora history`** — local persistence for settings, search history, and chat history (no account required).
- **Full-screen TUI** — 5 pages (Home, Marketplace, Community, News, Settings) with alt-screen frame, key dispatch, scrollbar, status toasts, help panel, and `agora tui` entrypoint.
- **`/menu` command builder** — interactive wizard that walks through positional args, flags, and value flags, then opens a pre-filled readline prompt for editing.

## Quick Start

The fastest way to get started — works in any project directory:

```bash
# One command: scan project, set up OpenCode, install MCP servers, register plugin
npx opencode-agora init
```

For a persistent command:

```bash
npm install -g opencode-agora
agora init
```

### Install from source

Until the package is published to npm, or if you prefer to run from source:

```bash
git clone https://github.com/IrgenSlj/agora.git && cd agora && bun install && bun run build && bun link
```

The package exposes two binary names:

```bash
agora --help
opencode-agora --help
```

## Live mode / hosted backend

> **Note:** Browse, search, and all read-only commands work fully offline using bundled data — no backend required. Features that write data (publish, reviews, discussions, auth login) and the `--api` flag require a live backend. A hosted instance is not yet deployed. Until then, self-host via the `backend/` directory and set `AGORA_API_URL` to your instance URL before using `--api` or any write commands.

## Usage

### Setup

```bash
# Scan project and generate optimal OpenCode config
agora init
agora init --dry-run    # Preview without writing

# Apply a workflow as an OpenCode skill
agora use wf-tdd-cycle
agora use wf-security-audit
```

### Marketplace

```bash
# Search and browse
agora search filesystem
agora search database --category mcp
agora search mcp --sort stars                  # sort by stars
agora search mcp --sort name --order asc       # alphabetical
agora search mcp --table                       # box-drawn table
agora search mcp --per-page 5 --page 2         # paginated
AGORA_API_URL=https://agora.example.com agora search github --api
agora browse mcp-postgres
agora trending
agora trending --table

# Install MCP servers
agora install mcp-github           # preview only
agora install mcp-github --write   # install npm package + write config

# Save/bookmark items
agora save wf-security-audit
agora saved
agora remove wf-security-audit
```

### Workflows

```bash
agora workflows
agora workflows security
```

### News

```bash
agora news                              # ranked feed, top stories
agora news --source hn                  # filter by source
agora news --limit 30
agora news --json                       # JSON output
```

In the TUI (agora tui → News page): category tabs, detail view, AI summarization, scrollable preview.

### Discovery

```bash
agora similar mcp-postgres              # Jaccard-similar items
agora compare mcp-postgres mcp-supabase # side-by-side comparison table
```

### Preferences & History

```bash
agora preferences                       # view local preferences
agora preferences theme light           # set theme (dark|light|auto)
agora preferences verbosity quiet       # set verbosity
agora preferences username "Jane"       # set local display name
agora history                           # view recent searches & chats
agora history --limit 10
agora history --clear                   # erase all history
```

### Community & Auth

```bash
agora discussions mcp --category question
agora discuss --title "MCP question" --content "How are you composing servers?" --category question
agora auth login --token $AGORA_TOKEN --api-url https://agora.example.com
agora auth status
agora publish package --name @you/server --description "MCP server" --npm @you/server
agora publish workflow --name "Security Audit" --description "Audit workflow" --prompt-file ./prompt.md
agora review mcp-github --rating 5 --content "Works well"
agora reviews mcp-github --api
agora profile alice
```

### MCP Server & AI Chat

```bash
# Run the MCP server (add to opencode.json MCP config)
agora mcp

# Auto-register the MCP server in your OpenCode config
agora init --mcp

# Free AI chat — TUI mode (persistent REPL, zero per-message latency)
agora chat

# Free AI chat — one-shot mode (scriptable)
agora chat "what MCP servers are available for postgres?"
agora chat -m deepseek-v4-flash-free "find me a web search MCP server"

# Continue the last conversation
agora chat --continue "follow up question"
```

Add to `opencode.json`:
```json
{
  "mcp": {
    "agora": {
      "type": "local",
      "command": ["agora", "mcp"]
    }
  }
}
```

### Diagnostics

```bash
agora config doctor
agora config doctor --json
```

`agora install <id>` is preview-only by default. Add `--write` to install the npm package and update config. Pass `--config ./opencode.json` for an explicit target.

Saved items and optional auth credentials are stored in `~/.config/agora/state.json` by default. Use `AGORA_HOME=/path/to/agora` or `--data-dir /path/to/agora` to override.

The CLI uses bundled offline marketplace data (62 MCP servers, 12 workflows) by default. Add `--api`, `--live`, `AGORA_USE_API=true`, or `AGORA_API_URL` to use the live backend. Falls back to offline data if the API is unavailable.

### OpenCode Plugin Commands

The plugin itself registers **tools** (`agora_search`, `agora_browse`, `agora_install`, …) that the OpenCode assistant calls — OpenCode plugins cannot register slash commands directly.

To get a typed `/agora` slash command, `agora init` also writes `.opencode/command/agora.md` into your project. That command forwards whatever you type to the matching tool, so these all work inside OpenCode:

| Command | Description |
|---|---|
| `/agora search <query> [category]` | Search marketplace |
| `/agora browse <id>` | View package or workflow details |
| `/agora browse_category <category>` | Browse a category |
| `/agora trending [type]` | See trending |
| `/agora install <id>` | Install steps / config for a package |
| `/agora tutorial <id> [step]` | Interactive tutorials |
| `/agora chat <message>` | Free AI chat via opencode run |
| `/agora info` | Plugin help |
| `/agora mcp` | Run MCP server (CLI only) |

Community features — profiles, reviews, discussions, publishing — are **CLI-only** (`agora profile`, `agora reviews`, `agora discuss`, `agora publish`) and need a connected backend. The plugin deliberately ships only the offline-capable marketplace tools.

If you didn't run `agora init`, copy `.opencode/command/agora.md` from this repo into your project's (or `~/.config/opencode/command/agora.md` for a global command). Without the command file the `agora_*` tools still work — just ask the assistant in chat.

**Categories:** mcp, prompt, workflow, skill `|` **Data sources:** offline (default), `--api`

### Registering the plugin manually

If you did not run `agora init`, register the plugin by hand:

1. Install the package globally:
   ```bash
   npm install -g opencode-agora
   ```
2. Add `"opencode-agora"` to the `plugins` array in `~/.config/opencode/opencode.json` (or your project-local `opencode.json`):
   ```json
   {
     "plugins": ["opencode-agora"]
   }
   ```

## Development

```bash
# Typecheck
bun run typecheck

# Build package output
bun run build

# Run tests
bun test

# Try the CLI from source
bun src/cli.ts search filesystem

# Install locally to OpenCode
bun run dev

# Run the optional local Hub
bun run hub:dev
```

## Project Structure

```
agora/
├── src/              # CLI, plugin, and shared marketplace core
├── backend/          # Cloudflare Workers API
├── hub/              # Optional local web Hub
├── test/             # Tests (~500, 20 files)
├── dist/             # Built output
└── docs/             # Architecture, roadmap, design docs
```

## Architecture

```
agora/
├── src/
│   ├── cli.ts            # CLI entrypoint
│   ├── cli/app.ts        # CLI command parser (~30+ handlers)
│   ├── cli/shell.ts      # Interactive shell (agora in TTY)
│   ├── cli/prompter.ts   # Raw-mode line editor with auto-complete
│   ├── cli/completions.ts # Completion providers (slash, path, marketplace ids)
│   ├── cli/tui.ts        # Full-screen TUI frame renderer + key dispatch
│   ├── cli/mcp-server.ts # MCP server (agora mcp)
│   ├── cli/menu.ts       # Interactive command builder wizard
│   ├── cli/commands-meta.ts # Command metadata for help + menu
│   ├── cli/chat-renderer.ts # Chat response formatting
│   ├── cli/pages/        # TUI page implementations (5 pages)
│   │   ├── types.ts      # Page / KeyEvent / PageAction / PageContext contract
│   │   ├── helpers.ts    # Shared TUI helpers (frame, scrollbar, sep, etc.)
│   │   ├── home.ts       # Home dashboard
│   │   ├── marketplace.ts# Package list + drill-in
│   │   ├── community.ts  # Community boards → threads
│   │   ├── news.ts       # Ranked news feed + TUI reader + AI summarization
│   │   └── settings.ts   # Settings form
│   ├── news/             # News feed core
│   │   ├── types.ts      # NewsItem, ScoredNewsItem, NewsConfig
│   │   ├── score.ts      # scoreItem, rankItems
│   │   ├── cache.ts      # readCache, writeCache, isStale, readNewsMeta
│   │   └── sources/      # Source adapters (hn, reddit, github-trending, arxiv)
│   ├── community/        # Community hub core
│   │   ├── types.ts      # Thread, Reply, Vote, Flag, Board
│   │   └── client.ts     # Community API source helpers
│   ├── init.ts           # Project scanner + init plan generator
│   ├── live.ts           # Live API source with offline fallback
│   ├── marketplace.ts    # Shared search, sort, browse, trending, install-plan core
│   ├── config-files.ts   # OpenCode config detection, doctor, and write helpers
│   ├── settings.ts       # Settings persistence (toml)
│   ├── preferences.ts    # Local preferences (theme, verbosity, username, etc.)
│   ├── history.ts        # Search + chat history (JSONL append log)
│   ├── transcript.ts     # Per-cwd chat transcripts
│   ├── state.ts          # Local Agora saved-item state + auth
│   ├── index.ts          # OpenCode plugin
│   ├── ui.ts             # Terminal styling: styler, gradient banner, header frame
│   ├── format.ts         # Count formatting helpers
│   ├── config.ts         # MCP config generation
│   ├── data.ts           # 62 MCP servers, 12 workflows, 12 tutorials, 6 prompts
│   ├── commands.ts       # OpenCode /agora slash command installer
│   └── types.ts          # Shared TypeScript types
│
├── backend/              # Cloudflare Workers API
│   ├── src/index.ts      # Hono server + routes
│   ├── schema.sql        # D1 database schema (including community tables)
│   └── services/          # npm + GitHub API clients
│
├── hub/                  # Local Hub app
│
├── test/                 # ~500 tests across 20 files
│   ├── cli.test.ts       # CLI integration tests
│   ├── news.test.ts      # News scoring, cache, sources
│   ├── history.test.ts   # History persistence tests
│   ├── preferences.test.ts # Preferences persistence tests
│   └── ...
│
└── docs/                  # Architecture, roadmap, design docs
```

## Project Status

| Component | Status | Notes |
|-----------|--------|-------|
| Interactive shell (`agora`) | Ready | Persistent REPL, bash/chat dispatch, auto-complete, per-cwd transcripts, `/terminal` subshell |
| `agora init` | Ready | Project scanning, config generation, auto-install, plugin registration |
| `agora use` | Ready | Apply workflows as OpenCode skills in one command |
| `agora install --write` | Ready | Auto-installs npm packages and writes config |
| `agora mcp` | Ready | Marketplace exposed as a Model Context Protocol server |
| `agora chat` | Ready | TUI + one-shot inference via `opencode run` |
| Full-screen TUI | Ready | 5 pages (Home, Marketplace, Community, News, Settings), alt-screen frame, scrollbar, tabs |
| CLI | Ready | 30+ commands: `search`, `browse`, `trending`, `workflows`, `similar`, `compare`, `news`, `install`, `save`, `saved`, `remove`, `preferences`, `history`, `init`, `use`, `menu`, `tui`, `chat`, `mcp`, `community`, `discussions`, `discuss`, `thread`, `post`, `reply`, `vote`, `flag`, `auth`, `login`, `logout`, `whoami`, `profile`, `publish`, `review`, `reviews`, `config doctor` |
| Offline data | Ready | 62 MCP servers, 12 workflows, 12 tutorials, 6 prompts (npm-validated) |
| Live API mode | Ready | Opt-in via `--api`, `AGORA_API_URL`; falls back offline |
| Shared core | Ready | CLI and plugin share marketplace logic |
| Local state | Ready | Saved items, auth tokens, preferences, history under `~/.config/agora` |
| Plugin (offline) | Ready | Works with bundled data |
| News feed (`agora news`) | Ready | HN + Reddit + GitHub Trending + arXiv + RSS, scoring, caching, category tabs, TUI reader, AI summarization |
| Community hub (`agora community`) | Ready (CLI) | Boards, threads, votes, flag-don't-delete, LLM participants — needs deployed backend |
| Discovery (`similar`/`compare`) | Ready | Jaccard similarity, side-by-side comparison tables |
| Preferences & History | Ready | `agora preferences` (theme, verbosity, username), `agora history` (search/chat log) — local, no account needed |
| Backend | 🚧 Not deployed — self-host required (see backend/) | Cloudflare Workers + D1 ready for deployment; auth rework blocks public deploy |
| Local Hub | Ready | Static web app served by Bun |
| CI | Ready | Typecheck + lint + tests on push/PR |
| Publish CI | Ready | Auto-publish to npm on release |

## Testing

```bash
bun test
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for upcoming work and ways to contribute.

## License

MIT

---

<p align="center">
  Built for the developer community
</p>
