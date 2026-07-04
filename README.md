# agora

> **The system manager for your agentic stack** — one local-first terminal app that *manages* what your agents can do (MCP servers, skills, instruction files), *watches* what the ecosystem is doing (a federated crossroads feed), and *gates* what gets in (the trust/customs layer).

<p>
  <a href="https://www.npmjs.com/package/agora-hub"><img src="https://img.shields.io/npm/v/agora-hub" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/agora-hub" alt="MIT"></a>
  <a href="https://github.com/IrgenSlj/agora/actions"><img src="https://img.shields.io/github/actions/workflow/status/IrgenSlj/agora/ci.yml?branch=main" alt="CI"></a>
</p>

`agora` is a package manager for the MCP ecosystem — think **apt / Homebrew / Terraform for your
agent stack**. It manages the MCP servers, skills, and instruction files across **OpenCode, Claude
Code, Cursor, and Windsurf** from one place; it federates every upstream registry (the official MCP
Registry, Smithery, Glama, GitHub, …) so its effective catalog is the union of all of them; and it
runs a **customs gate** on everything before it enters a config. Local-first, no hosted backend, and
operable *by* agents as a first-class citizen (`--json` on every command, plan/apply separation).

## Install

```bash
# fastest path — no install, runs from npx
npx -y agora-hub doctor

# or install once, use anywhere
npm i -g agora-hub
agora
```

**OpenCode plugin** — add the entry package to your `opencode.json` (`plugin` loads npm package
names and auto-installs them):

```jsonc
{ "plugin": ["opencode-agora"] }
```

**Any MCP client** (Claude Code, Cursor, Windsurf, Gemini/Codex CLI, Zed, …) — register `agora mcp`
as an MCP server; the zero-install command is `npx -y agora-hub mcp`.

From source (requires [bun](https://bun.sh)): `git clone` · `bun install` · `bun run build` · `bun link`.

## What it does — the three rings

**Ring 1 — Manage & Gate** (the core):

```bash
agora doctor                     # one table of every MCP server across all your harnesses + health
agora doctor --probe             # + live tool-schema probe and description-drift ("rug-pull") detection
agora search postgres            # federated catalog search across upstream registries
agora acquire mcp-postgres       # resolve → scan-gate → write config (the customs office)
agora acquire "query a database" --dry-run   # resolve by capability query, preview only
agora plan                       # Terraform-style diff of your stack vs. agora.toml (no writes)
agora apply                      # reconcile config to match the profile
agora sync --from <git-url>      # clone someone's whole agent setup — every entry runs the gate
```

`agora.toml` is a portable, declarative **profile** of your whole installation — commit it to a repo
and anyone reproduces your setup with `agora sync --from <url>`. Writes are **surgical**: adapters
preserve every unrelated key and write atomically. No credentials ever live in `agora.toml`.

**Ring 2 — Surfaces:** the CLI/TUI, `agora mcp` (Agora operable by agents), thin plugins for OpenCode
and Claude Code, and a provider abstraction over inference (OpenCode default · Claude · Ollama).

**Ring 3 — Plaza:** a federated feed reader across HN, Lobsters, arXiv, GitHub, Bluesky, Mastodon,
Discourse — each item labelled by origin — plus a composer for the write-capable protocols.

## The customs gate (and its honest limits)

`agora acquire` never writes anything to a config without passing the gate first:

```
resolve → install plan → scan gate (pass / warn / fail) → config write
```

- `fail` blocks the write and exits non-zero — nothing is written.
- `warn` requires an explicit `--accept-warnings` to proceed.
- `--dry-run` previews the whole flow without writing.

The gate composes static heuristics (injection-pattern checks, permission-manifest diffs, registry
status, tool-annotation-hint checks) with live-probe diffing (tool-schema drift, observed-vs-declared
permissions). **It is not a sandbox and does not execute or formally verify server code.** "Passed the
gate" means *no known red flags* — not "safe." That distinction is deliberate and appears everywhere
the verdict is shown, including `agora acquire --help` and `agora scan --help`.

## Positioning

- **A package manager, not a registry.** Agora never competes on catalog size; it federates existing
  registries, so its effective catalog is everyone's combined.
- **Local-first, no hosted backend.** Every core feature works offline against an on-disk cache —
  degraded, never broken. If a source is unreachable, it says so; it never fabricates counts.
- **Owns no inference.** It routes to OpenCode (default, free, zero login), a connected Claude API
  key (advanced), or a local Ollama endpoint (experimental).
- **Agent-operable.** `--json` on every command, idempotent semantics, plan/apply separation, and
  stable exit codes (`0` ok · `1` error · `2` plan-has-changes · `3` scan-fail).

## Harness integration

| Harness | Mechanism |
|---|---|
| Any MCP client (Claude Code, Cursor, Windsurf, Gemini/Codex CLI, Zed) | Register `agora mcp` — `npx -y agora-hub mcp` |
| OpenCode | Native plugin: `"plugin": ["opencode-agora"]` (tools **+ hooks**) |
| Claude Code | `/plugin marketplace add IrgenSlj/agora` → `/plugin install agora` (tools + `/agora` + skill) |

`agora integrate [harness|--all]` installs Agora into each harness using its own stack-manager
machinery — the first thing the stack manager manages is Agora itself.

## Architecture

```
src/stack/            cross-harness stack manager — adapters, manifest, plan/apply, doctor, probe
src/federation/       federated catalog clients (official registry, Smithery, Glama, GitHub, …)
src/acquire.ts        capability-acquisition gateway (resolve → scan-gate → write)
src/scan.ts           the trust gate — injection/permission/drift heuristics
src/search/           offline BM25 catalog index over federated results
src/inference/        provider abstraction (OpenCode · Claude · Ollama)
src/news/             the plaza — federated feed sources + ranking
src/cli/              command handlers, dispatch, shell, prompter, TUI pages
src/plugin/           OpenCode plugin (tools, hooks, SDK-preferring chat)
packages/opencode-agora/  thin npm entry re-exporting agora-hub/opencode
```

> This repository is mid-pivot from "terminal marketplace" to "agentic stack manager." See
> [`AGORA_BRIEF.md` direction](./ROADMAP.md) and [`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md)
> for what's landing when. `backend/`, `hub/`, and the community boards are frozen.

## Development

```bash
bun test            # hermetic, no network
bun run typecheck   # tsc
bun run build       # tsc + copy catalog + chmod +x dist/cli.js
bun src/cli.ts <cmd>  # run from source without building
```

PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — © IrgenSlj.
