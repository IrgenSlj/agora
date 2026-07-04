# Contributing

Thanks for thinking about it. `agora` is a standalone local-first CLI — no hosted backend. Most
contributions land in the CLI handlers (`src/cli/commands/*.ts`), the TUI pages
(`src/cli/pages/*.ts`), the stack manager (`src/stack/`), the federated catalog
(`src/federation/`), or the trust gate (`src/scan.ts`, `src/acquire.ts`).

## Quick start

```bash
git clone https://github.com/IrgenSlj/agora.git
cd agora
bun install
bun test            # hermetic, no network
bun run typecheck   # tsc on src + scripts + test
bun run build       # also gates on noUnusedLocals — run before pushing
bun src/cli.ts <cmd>  # run from source, no build needed
```

## Workflow

1. Branch off `main`: `git checkout -b feat/short-name`
2. Make the change. Add tests where behavior is non-trivial.
3. `bun test && bun run typecheck && bun run build` all clean
4. Conventional commits: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`, `chore: …`. PR titles should be the same.
5. Push and open a PR. Keep PRs focused — one feature or fix per PR.

CI runs format-check + lint + typecheck + tests on push and PR.

## Adding an offline-cache catalog entry

`src/data.ts` is the bundled offline cache — the fallback Agora falls back to when a federated
registry source is unreachable or unconfigured, not the primary catalog. Each MCP server entry has
this shape:

```ts
{
  id: 'mcp-foo',
  name: '@vendor/mcp-foo',
  description: 'One-line summary.',
  author: 'Vendor',
  version: '1.0.0',
  category: 'mcp',
  tags: ['foo', 'bar'],
  stars: 0,
  installs: 0,
  npmPackage: '@vendor/mcp-foo',
  repository: 'https://github.com/vendor/mcp-foo',
  createdAt: '2026-05-18',
  permissions: { fs: ['./**/*'], net: ['api.foo.com'] }   // if applicable
}
```

Every `npmPackage` is verified against the live registry by the test suite. Place new entries in
alphabetical order within their category. Run `bun test test/data.test.ts` to confirm.

## Adding a CLI command

1. Create `src/cli/commands/<name>.ts` exporting `commandName: CommandHandler` (see `today.ts` or
   `share.ts` as compact references).
2. Wire dispatch in `src/cli/app.ts` (look for the `cmd` object — alphabetical-ish).
3. Register metadata in `src/cli/commands-meta.ts` so completions, `/abc` shortcuts, and
   `agora help <name>` pick it up. Pick the right `group` (`Marketplace` / `Setup` / `Library` /
   `Learn` / `Stack`).
4. Add tests in `test/cli.test.ts` (or a new `test/<name>.test.ts` if substantial). Use the
   `runCli` + `createIo` harness; pass `fetcher` for HTTP-touching commands.
5. If the command writes to a config file, use the surgical-write pattern (`src/atomic-write.ts`,
   preserve unrelated keys) and support `--json` + a stable exit code.

## Code style

- TypeScript strict mode, ESLint + Prettier (2-space indent, single quotes, semicolons, 100 col)
- No emojis in output. Project policy.
- No superfluous comments. Comment only the *why*, not the *what*. Function names + types do the documentation.
- No defensive `try/catch` around things that can't fail.
- Errors at boundaries (user input, external APIs), not at internal call sites.
- Prefer `--json` output for every new command so scripts and agents can consume it.

## Project layout

```
src/cli/              command dispatch, shell, prompter, TUI runner
src/cli/commands/     one file per top-level CLI command
src/cli/pages/        full-screen TUI pages (home, marketplace, stack, news, settings)
src/stack/            cross-harness stack manager — adapters, manifest, plan/apply, doctor
src/federation/       federated catalog clients (official registry, Smithery, Glama, GitHub, …)
src/marketplace.ts    curated catalog + live hub merge + install planner
src/hubs/             GitHub + HuggingFace connectors + AI README enrichment
src/news/             scoring, cache, per-source adapters (the plaza)
src/scan.ts           the trust gate — injection/permission/drift heuristics
src/state.ts          local state, saves, auth (atomic 0o600 writes)
src/atomic-write.ts   shared atomic + 0o600 file write helper
src/data.ts           offline-cache fallback: curated MCP servers, workflows, tutorials, prompts
src/types.ts          shared types — Package, Workflow, Permissions, Pricing, …
test/                 bun:test suite
```

## Help wanted

See [ROADMAP.md](./ROADMAP.md) for what's open and which work packages are next. Some specific asks:

- Add an offline-cache catalog entry (lowest-friction first PR).
- Wire a runtime sandbox for declared permissions (an open decision — see
  [`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md)).
- Land a federation source adapter (Smithery, Glama, GitHub, HuggingFace) behind the
  `RegistrySource` contract.

Questions? Open an issue with the `question` label.
