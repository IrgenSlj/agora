# agora

> A terminal hub for the agentic-coding ecosystem — discover MCP servers, follow the news, join the conversation, install with consent.

<p>
  <a href="https://www.npmjs.com/package/opencode-agora"><img src="https://img.shields.io/npm/v/opencode-agora" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/opencode-agora" alt="MIT"></a>
  <a href="https://github.com/IrgenSlj/agora/actions"><img src="https://img.shields.io/github/actions/workflow/status/IrgenSlj/agora/ci.yml?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/tests-768%20passing-success" alt="tests">
</p>

`agora` is a standalone CLI that puts everything a developer building with LLMs cares about in one terminal: a **curated + live marketplace** of MCP servers and agent tooling, a **threaded community** with reputation-weighted sort, a **ranked news feed** with on-cache AI summarization, and **first-class install consent** for declared permissions. Works offline by default; opt into the backend with `agora auth login`.

## Install

```bash
# fastest path — runs in your current project
npx opencode-agora init

# or install once, use anywhere
npm i -g opencode-agora
agora welcome
```

From source (requires [bun](https://bun.sh)):

```bash
git clone https://github.com/IrgenSlj/agora.git
cd agora && bun install && bun run build && bun link
```

The binary is published as both `agora` and `opencode-agora`.

## Try it

```bash
agora welcome                          # guided tour, adapts when signed in
agora today                            # last 24h: news + community + trending
agora search mcp                       # 67 curated + live GitHub/HF results
agora install mcp-github --write --yes # install + write opencode.json
agora tui                              # 5-page full-screen interface
```

The default `agora` in a TTY drops you into a **persistent shell** that mixes bash dispatch (`ls`, `git status`) with free LLM chat (`why is this slow?`). `/help` lists the slash commands; `/abc` shows the single-letter shortcuts.

## Commands

Run `agora help` for the grouped list, or `agora help <command>` for any of these:

| Group | Commands |
|---|---|
| **Daily** | `welcome` · `today` · `bookmarks` · `share` · `open` · `author` |
| **Marketplace** | `search` · `browse` · `trending` · `similar` · `compare` · `install` · `workflows` |
| **News** | `news` (CLI) · TUI reader with AI summarization |
| **Community** | `community` · `thread` · `post` · `reply` · `vote` · `flag` · `discuss` |
| **Account** | `auth login` · `auth status` · `profile` · `review` · `reviews` · `publish` |
| **Moderation** | `admin hide` · `admin log` · `admin recompute` _(operator-only)_ |
| **Setup** | `init` · `use` · `config show/edit/doctor` · `notify` · `completions` · `ping` |
| **Utility** | `export` · `watch` · `chat` · `mcp` · `tui` · `menu` · `preferences` · `history` |

Every command supports `--json` for scripting and `--help` for inline manual.

## Install consent

`agora install <id>` is preview-only by default. With `--write`, items that declare a permissions manifest require an explicit `--yes`:

```
$ agora install mcp-filesystem --write
Permissions
  fs    ./**/*

This package declares permissions. Re-run with --yes to grant and install.
$ echo $?
1
```

The TUI install preview flips its footer to `g grant + install   d details   n cancel` when permissions are present. The list shows a dim `[fs net exec]` badge on any item with a non-empty manifest.

## Configuration

| Env | Meaning |
|---|---|
| `AGORA_HOME` | Override the data dir (default `~/.config/agora`) |
| `AGORA_API_URL` | Backend URL for `--api` reads, all writes, and `agora ping` |
| `AGORA_TOKEN` | Bearer token (alternatively persisted by `agora auth login`) |
| `AGORA_LIVE_HUBS` | `1` to merge live GitHub + HuggingFace into the marketplace |
| `AGORA_GITHUB_TOKEN` | Raises the unauth 60 req/hr GitHub limit to 5000 |
| `AGORA_ADMIN_USER_IDS` | Comma-separated user ids granted moderator commands |
| `EDITOR` / `VISUAL` | Used by `agora config edit` |
| `NO_COLOR` | Respect standard no-color convention |

Per-user state lives under `~/.config/agora/` — `state.json` (saves + auth), `settings.toml` (preferences), `news-cache.jsonl`, `news-meta.json` (bookmarks), `hubs-cache.jsonl`. All files holding user data are written `0o600` and atomically (`.tmp` + rename) so a crash mid-flush leaves the previous version intact.

## OpenCode plugin

`agora init` also registers the package as an OpenCode plugin and drops a `.opencode/command/agora.md` slash command so the LLM can call:

```
/agora search <query>
/agora browse <id>
/agora install <id>
/agora chat <message>
```

`agora_*` tools are also reachable from any MCP client via `agora mcp` — add `{"mcp": {"agora": {"command": ["agora", "mcp"]}}}` to your `opencode.json`.

## Architecture

```
src/cli/              command handlers, dispatch, shell, prompter, TUI
src/cli/pages/        five full-screen TUI pages (home, marketplace,
                      community, news, settings) + shared helpers
src/marketplace.ts    curated catalog + live hub merge + install planner
src/hubs/             GitHub + HuggingFace connectors + AI enrichment
src/community/        backend client + types
src/news/             scoring, cache, per-source adapters
src/state.ts          local state, saves, auth (atomic 0o600 writes)
backend/src/index.ts  Cloudflare Workers + D1 (Hono router)
test/                 768 tests, 34 files
```

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the why-this-shape writeup and [`ROADMAP.md`](./ROADMAP.md) for what's next.

## Development

```bash
bun test            # 768 cases, ~3.5s
bun run typecheck   # tsc -p tsconfig.check.json
bun run build       # tsc + chmod +x dist/cli.js
bun src/cli.ts <cmd>  # run from source without building

cd backend && bun run dev          # local backend on wrangler
cd backend && bun run typecheck    # backend has its own tsconfig
```

PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`COMMUNITY_GUIDELINES.md`](./COMMUNITY_GUIDELINES.md). The catalog accepts entries via PR; see `src/data.ts` for the shape.

## License

[MIT](./LICENSE) — © contributors.
