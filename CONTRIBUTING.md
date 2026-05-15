# Contributing to Agora

Thank you for your interest in contributing to Agora! We welcome contributions from everyone.

Agora is a **standalone terminal marketplace** — the `agora` CLI is the product; the OpenCode plugin is a thin bridge. Most contribution lands in the CLI or the offline catalog. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the direction and [`ROADMAP.md`](./ROADMAP.md) for what's next.

## How to Contribute

### Reporting Bugs

1. Check the [issue tracker](https://github.com/IrgenSlj/agora/issues) to see if the bug has already been reported
2. If not, [open a new issue](https://github.com/IrgenSlj/agora/issues/new) with:
   - A clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Bun version, terminal)

### Suggesting Features

Open an issue with the "enhancement" label describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `bun test`
5. Run typecheck: `bun run typecheck`
6. Run linting: `bun run lint`
7. Check formatting: `bun run format:check` (or auto-fix with `bun run format`)
8. Commit using conventional commits (see below)
9. Push and open a Pull Request

### Commit Convention

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add search filtering by category
fix: handle missing config file gracefully
docs: update installation instructions
refactor: extract formatting utilities
test: add CLI integration tests
chore: update dependencies
```

### Pull Request Process

1. Ensure your PR passes all CI checks (typecheck + tests)
2. Update documentation if needed (README, CLI help text)
3. Add tests for new functionality
4. Keep PRs focused — one feature/fix per PR

## Development Setup

```bash
git clone https://github.com/IrgenSlj/agora.git
cd agora
bun install
bun run build
bun test
```

Try new commands from source:

```bash
bun src/cli.ts init --dry-run     # Preview init without writing
bun src/cli.ts use wf-tdd-cycle    # Apply workflow as skill
bun src/cli.ts search database     # Search rich offline data
```

## Project Structure

```
src/
├── cli.ts              # CLI entrypoint
├── cli/app.ts          # CLI command parser and handlers (the standalone hub)
├── cli/shell.ts        # Interactive REPL — bash/chat dispatch, slash meta commands
├── cli/prompter.ts     # Raw-mode line editor — auto-complete, history, ghost text
├── cli/completions.ts  # Completion providers (slash, path, marketplace ids)
├── cli/menu.ts         # @clack/prompts interactive command browser
├── cli/commands-meta.ts # Command catalog (groups, summaries, manual rendering)
├── cli/mcp-server.ts   # MCP server mode (`agora mcp`)
├── cli/chat-renderer.ts # Markdown chat formatter + live thinking line
├── ui.ts               # Terminal styling: styler, gradient banner, colour detection
├── init.ts             # Project scanner + init plan generator
├── marketplace.ts      # Search, browse, trending, install logic
├── config-files.ts     # OpenCode config detection and writes
├── commands.ts         # /agora slash-command template installed by `agora init`
├── live.ts             # API client with offline fallback (api-or-offline source layer)
├── state.ts            # Local saved-item and auth state
├── transcript.ts       # Per-cwd shell transcripts + session metadata
├── index.ts            # OpenCode plugin — thin bridge, 7 offline marketplace tools
├── data.ts             # 61 MCP servers, 12 workflows, 12 tutorials, 6 prompts
├── types.ts            # TypeScript types
├── config.ts           # Config generation helpers
└── format.ts           # Count formatting helpers (formatStars, formatInstalls)
backend/   # Cloudflare Workers API (Hono + D1)
hub/       # Optional local web Hub
docs/      # ARCHITECTURE.md and design briefs
test/      # 16 test files, ~440 tests
```

## Key Files for New Contributors

| File | What to know |
|---|---|
| `src/data.ts` | The offline marketplace data — add MCP servers, workflows, tutorials here |
| `src/init.ts` | Project scanning and config generation logic |
| `src/cli/app.ts` | All CLI commands live here — easy to add new ones |
| `src/marketplace.ts` | Core search, browse, install-plan logic |
| `src/state.ts` | Local persistence for saved items and auth tokens |

## Adding an MCP server to the offline marketplace

1. Open `src/data.ts` — the offline marketplace data lives there.
2. Find the array of MCP servers. Each entry has a clear shape: `id`, `name`, `description`, `category`, and the npm package name (plus optional fields). Use an existing entry in the same category as a template.
3. Add your entry alphabetically within its category.
4. Run `bun test && bun run typecheck` before opening your PR.

## Code Style

- TypeScript strict mode
- **Prettier** for formatting: 2-space indentation, single quotes, semicolons, 100-char line width
- **ESLint** with `typescript-eslint` recommended rules for static analysis
- Descriptive variable names
- No unused imports or variables (enforced by tsconfig `noUnusedLocals`/`noUnusedParameters`)

Run `bun run format` to auto-format all files. Run `bun run lint` to check for lint errors.
