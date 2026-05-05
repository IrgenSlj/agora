# Agora - The Developer's Terminal Marketplace & Community

<p align="center">
  <strong>Where developers trade tools, ideas, and workflows</strong>
</p>

<p align="center">
  A CLI-first marketplace for discovering and installing OpenCode tools, workflows, prompts, and MCP servers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencode-agora"><img src="https://img.shields.io/npm/v/opencode-agora" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/issues"><img src="https://img.shields.io/github/issues/IrgenSlj/agora" alt="issues"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/opencode-agora" alt="license"></a>
</p>

---

## What is Agora?

Agora is a terminal marketplace for OpenCode. The standalone `agora` CLI is the primary interface, and the OpenCode plugin exposes the same marketplace inside OpenCode sessions.

Use it to:

- Discover MCP servers, prompts, skills, and workflows
- Preview install plans before touching local config
- Safely write MCP server entries to `opencode.json`
- Browse discussions and workflow patterns from the terminal
- Keep the plugin and CLI behavior aligned through shared core modules

## Features

### CLI Marketplace
- Browse curated MCP servers and plugins
- Search by category, language, or use case
- Use bundled offline data or opt into the live Agora API
- Output human-readable results or `--json` for scripts
- Preview install plans before writing files

### Config-Aware Installs
- Detect an OpenCode config path automatically
- Use `--config path` for explicit writes
- Merge MCP servers into existing config
- Inspect config health with `agora config doctor`

### Workflows
- Share your agentic workflows
- Import battle-tested patterns from others
- Version control your prompts and workflows
- Fork and improve community workflows

### Community
- Discussion threads on tools and patterns
- Trending prompts and workflows
- Expert AMAs and knowledge sharing

### OpenCode Plugin
- Search, browse, install-preview, review, profile, discussion, and tutorial tools from inside OpenCode
- Uses the same marketplace core as the CLI for core discovery flows

### Local Hub
- Optional browser console for browsing the marketplace and assembling install plans
- Runs locally with `bun run hub:dev`

### Learn
- Interactive tutorials on MCP
- AI development best practices
- Terminal productivity tips

## Installation

```bash
npx opencode-agora search filesystem
```

For a persistent command:

```bash
npm install -g opencode-agora
```

The package exposes two binary names:

```bash
agora --help
opencode-agora --help
```

To use the OpenCode plugin, add it to `opencode.json`:

```json
{
  "plugins": ["opencode-agora"]
}
```

## Usage

CLI commands:

```bash
agora search filesystem
agora search filesystem --api
AGORA_API_URL=https://agora.example.com agora search github --api
agora search github --category mcp --json
agora browse mcp-github
agora trending workflows --limit 5
agora workflows security
agora discussions mcp --category question
agora install mcp-github
agora install mcp-github --write
agora save wf-security-audit
agora saved
agora remove wf-security-audit
agora publish package --name @you/server --description "MCP server" --npm @you/server --api --token $AGORA_TOKEN
agora publish workflow --name "Security Audit" --description "Audit workflow" --prompt-file ./prompt.md --api --token $AGORA_TOKEN
agora review mcp-github --rating 5 --content "Works well" --api --token $AGORA_TOKEN
agora reviews mcp-github --api
agora config doctor
```

`agora install <id>` is preview-only by default. Add `--write` to update the detected OpenCode config, or pass `--config ./opencode.json` for an explicit target.

Saved items are stored in `~/.config/agora/state.json` by default. Use `AGORA_HOME=/path/to/agora` or `--data-dir /path/to/agora` to override that location.

The CLI uses bundled offline marketplace data by default. Add `--api`, `--live`, `AGORA_USE_API=true`, or `AGORA_API_URL=https://...` to use the live backend. If the API request fails, Agora falls back to offline data and writes a warning to stderr. Use `--offline` to force local data.

Publishing and review writes require the live backend plus an API token. Pass `--token`, `AGORA_TOKEN`, or `AGORA_API_TOKEN`. The backend accepts the same GitHub token used by OAuth and resolves the author from GitHub.

OpenCode plugin commands:

- `/agora search <query> [category]` - Search marketplace
- `/agora browse_category <category>` - Browse by category (mcp, workflow, prompt)
- `/agora browse <id>` - View package details
- `/agora trending [type]` - See trending packages/workflows
- `/agora install <id> [--write]` - Install to config
- `/agora review [action] [--id] [--rating] [--content]` - Reviews/ratings
- `/agora discussions [action] [--id] [--title] [--content]` - Community
- `/agora profile [action] [--username]` - User profiles
- `/agora tutorial [id] [step]` - Interactive tutorials
- `/agora info` - This help

**Categories:** mcp, prompt, workflow, skill

## Quick Start

```bash
# Clone and install
git clone https://github.com/IrgenSlj/agora.git
cd agora
bun install

# Build
bun run build

# Test
bun test
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
│   ├── live.ts       # Live API source with offline fallback
│   ├── marketplace.ts # Shared search, browse, trending, install-plan core
│   ├── config-files.ts # OpenCode config detection, doctor, and write helpers
│   ├── state.ts      # Local Agora saved-item state
│   ├── index.ts      # OpenCode plugin
│   ├── api.ts        # API client with fallback
│   ├── format.ts     # Output formatting
│   ├── config.ts     # MCP config generation
│   ├── data.ts       # Sample data
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
| CLI | Ready | `search`, `browse`, `trending`, `workflows`, `discussions`, `install`, `save`, `saved`, `remove`, `publish`, `review`, `reviews`, `config doctor` |
| Live API mode | Ready | Opt-in via `--api`, `--live`, `AGORA_USE_API`, or `AGORA_API_URL`; falls back offline |
| Shared core | Ready | CLI and plugin share marketplace discovery/install-plan logic |
| Local state | Ready | Saved items under `~/.config/agora` |
| Plugin (offline) | ✅ Ready | Works with sample data |
| API Client | ✅ Built | Connects to backend |
| Backend | ⚠️ Ready | Needs deployment |
| Local Hub | Ready | Static local app served by Bun |

## Next Steps (TODO)

- [ ] Deploy backend to Cloudflare Workers
- [ ] Set up GitHub OAuth for backend
- [ ] Publish plugin to npm

## Testing

```bash
bun test
```

## License

MIT

---

<p align="center">
  Built for the developer community
</p>
