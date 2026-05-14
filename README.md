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

It bundles **36+ MCP servers**, **10 production workflows**, and **6 tutorials**, all usable offline.

**Where it's headed:** Agora is evolving into an **open, self-regulating marketplace** where third-party developers publish and sell advanced skills, tools, and kits — with Agora providing the square and the rules (discovery, trust, delivery), not the goods. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the direction and [`ROADMAP.md`](./ROADMAP.md) for the plan.

### Surfaces

Agora is one core marketplace engine behind three surfaces:

- **`agora` CLI** — the primary, standalone experience. Browse, install, manage from any terminal.
- **OpenCode plugin** — a thin bridge that surfaces the catalog *inside* OpenCode and installs into the current project. ([details](#opencode-plugin-commands))
- **`hub/`** — an optional local web console for browsing.

## Features

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
- **36+ MCP servers** across 12 categories (filesystem, databases, cloud, browser automation, monitoring, etc.)
- All official `@modelcontextprotocol/*` servers plus top community servers
- Fully functional offline — no backend required
- Search, browse, trending — all work with bundled data

### Config-Aware Installs
- `agora install mcp-github --write` installs the npm package **and** writes to config
- Detects OpenCode config path automatically
- Merge MCP servers into existing config
- Inspect config health with `agora config doctor`

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
- 6 interactive tutorials on MCP, OpenCode agents, security auditing, and more

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
AGORA_API_URL=https://agora.example.com agora search github --api
agora browse mcp-postgres
agora trending

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

### Diagnostics

```bash
agora config doctor
agora config doctor --json
```

`agora install <id>` is preview-only by default. Add `--write` to install the npm package and update config. Pass `--config ./opencode.json` for an explicit target.

Saved items and optional auth credentials are stored in `~/.config/agora/state.json` by default. Use `AGORA_HOME=/path/to/agora` or `--data-dir /path/to/agora` to override.

The CLI uses bundled offline marketplace data (36+ MCP servers, 10 workflows) by default. Add `--api`, `--live`, `AGORA_USE_API=true`, or `AGORA_API_URL` to use the live backend. Falls back to offline data if the API is unavailable.

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
| `/agora info` | Help |

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
├── test/             # Tests
├── dist/             # Built output
└── README.md
```

## Architecture

```
agora/
├── src/
│   ├── cli.ts        # CLI entrypoint
│   ├── cli/app.ts    # CLI command parser and handlers
│   ├── init.ts       # Project scanner + init plan generator
│   ├── live.ts       # Live API source with offline fallback
│   ├── marketplace.ts # Shared search, browse, trending, install-plan core
│   ├── config-files.ts # OpenCode config detection, doctor, and write helpers
│   ├── state.ts      # Local Agora saved-item state
│   ├── index.ts      # OpenCode plugin
│   ├── api.ts        # API client with fallback
│   ├── format.ts     # Output formatting
│   ├── config.ts     # MCP config generation
│   ├── data.ts       # 36+ MCP servers, 10 workflows, 6 tutorials
│   └── types.ts      # TypeScript types
│
├── backend/          # Cloudflare Workers API
│   ├── src/index.ts  # Hono server + routes
│   ├── schema.sql    # D1 database schema
│   └── services/      # npm + GitHub API clients
│
├── hub/              # Local Hub app
│
├── test/             # Unit and CLI tests
└── dist/             # Built output
```

## Project Status

| Component | Status | Notes |
|-----------|--------|-------|
| `agora init` | ✅ **New** | Project scanning, config generation, auto-install, plugin registration |
| `agora use` | ✅ **New** | Apply workflows as OpenCode skills in one command |
| `agora install --write` | ✅ **Improved** | Now auto-installs npm packages |
| CLI | Ready | 20 commands: `init`, `use`, `search`, `browse`, `trending`, `workflows`, `tutorials`, `tutorial`, `discussions`, `discuss`, `install`, `save`, `saved`, `remove`, `auth`, `publish`, `review`, `reviews`, `profile`, `config doctor` |
| Offline data | ✅ **Expanded** | 36 MCP servers, 10 workflows, 7 discussions, 6 tutorials |
| Live API mode | Ready | Opt-in via `--api`, `AGORA_API_URL`; falls back offline |
| Shared core | Ready | CLI and plugin share marketplace logic |
| Local state | Ready | Saved items and auth tokens under `~/.config/agora` |
| Plugin (offline) | Ready | Works with bundled data |
| Backend | 🚧 Not deployed — self-host required (see backend/) | Cloudflare Workers + D1 ready for deployment |
| Local Hub | Ready | Static web app served by Bun |
| CI | Ready | Typecheck + tests on push/PR |
| Publish CI | ✅ **New** | Auto-publish to npm on release |

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
