# Agora agent instructions

`agora` is **the system manager for your agentic stack** — a local-first terminal app that
*manages* what your agents can do (MCP servers, skills, instruction files), *watches* what the
ecosystem is doing (a federated crossroads feed, the "plaza"), and *gates* what gets in (the
trust/customs layer). See [`README.md`](./README.md) for the pitch and [`ROADMAP.md`](./ROADMAP.md)
for the sequenced plan — read both before making structural changes.

## The three rings

- **Ring 1 — Manage & Gate** (must be excellent; blocks releases): the stack manager
  (`src/stack/`), the federated catalog (`src/federation/`), the trust gate (`src/scan.ts`,
  `src/acquire.ts`). This is what Agora *is*.
- **Ring 2 — Surfaces** (invisible + fast): the CLI/TUI (`src/cli/`), `agora mcp`, thin plugins
  (`src/plugin/`), the inference-provider abstraction (`src/inference/`).
- **Ring 3 — Plaza & conveniences** (allowed to be imperfect): the federated feed reader
  (`src/news/`), tutorials, recall.

Ring 1 code gets the most scrutiny — correctness and honest failure modes there matter more than
polish elsewhere.

## Non-negotiables

- **Local-first.** Every core feature works offline against an on-disk cache. Agora has no hosted
  backend — don't add one, and don't make a feature depend on one being reachable.
- **Honest output.** No fabricated data, no invented counts. If a source is unreachable, say so.
  "Passed the gate" means *no known red flags*, not "safe" — never blur that line.
- **Agent-operable.** Every new command should support `--json`, use plan/apply separation where
  it writes anything, and return stable exit codes: `0` ok · `1` error · `2` plan-has-changes ·
  `3` scan-fail.
- **Surgical writes.** Config-writing code (stack adapters, `agora.toml`) must preserve every
  unrelated key and write atomically (see `src/atomic-write.ts`). Never credential-stuff
  `agora.toml` — secrets belong in settings/state, not the portable manifest.
- **Thin plugins.** The OpenCode/Claude Code plugin surfaces tools and hooks; it never owns a
  payment flow or a write that bypasses the scan gate.
- **Graceful terminal degradation.** Colour, gradients, and the banner degrade cleanly under
  `NO_COLOR`, `TERM=dumb`, non-TTY pipes, and narrow terminals.

## Build & test

```bash
bun install
bun test              # hermetic, no network
bun run typecheck      # alias for typecheck:cli
bun run typecheck:cli  # tsc -p tsconfig.check.json
bun run build           # tsc + copy catalog.json + chmod +x dist/cli.js — gates on noUnusedLocals
bun run lint
bun src/cli.ts <cmd>    # run from source, no build needed
```

Run `bun test && bun run typecheck && bun run build` clean before any PR.

## Plugin tool design (`src/plugin/`)

The OpenCode/Claude Code plugin registers explicit named tools (`agora_search`, `agora_acquire`,
`agora_config`, …) read directly by the model — treat their descriptions as an API contract:

- **Every tool needs a crisp `description`** starting with a verb: "Search…", "Acquire…".
- **Parameter names should be obvious from the tool name** — the model guesses arguments from
  names, not docs.
- **Use `describe()` on every schema field**, even optional ones.
- **Return flat strings, not objects.** Tool output becomes part of the model's message history —
  return a ready-to-render string, not JSON the model has to re-parse.
- **Error messages say what happened AND what to do next**, e.g. `Item "x" not found. Run
  \`agora_search <query>\` to find packages.`

The `/agora` slash command template (built by `agora init`) is a thin router: one sentence, no
preamble, `$ARGUMENTS` used exactly once. The model already has full tool descriptions from plugin
registration — don't re-list them there.

## Module splitting

Large files (>500 lines) split into per-domain modules under a subdirectory, with a barrel file at
the original path (pattern used for `marketplace`, `live`, `shell`, `commands-meta`, `stack`):

1. Create `src/module/` with `types.ts`, domain files, and `index.ts` (barrel).
2. Rewrite the original file as a thin re-export barrel: `export { X } from './module/index.js'`.
3. Keep existing import paths working — never break `from './original.js'`.
4. Run typecheck + tests before committing.

## Pre-commit checks

- `bun run typecheck` — must pass
- `bun run lint` — must pass
- `bun run build` — must produce a working `dist/` (noUnusedLocals catches dead leftovers)
- If you touched `src/plugin/` or `src/commands.ts`, re-read them: are the AI-facing strings still
  crisp and accurate?

## Publishing to npm

The release process is driven by GitHub Releases — `.github/workflows/publish.yml` auto-publishes
when a release is created.

1. **Bump the version** in `package.json` (check `CHANGELOG.md`'s `## Unreleased` section to decide
   the scope).
2. **Finalize the changelog** — rename `## Unreleased` to `## [<version>] - <YYYY-MM-DD>`.
3. **Quality gates** — `bun run typecheck && bun run lint && bun run build && bun test`.
4. **Commit and push:** `git add -A && git commit -m "Release v<version>" && git push origin main`.
5. **Tag the release:** `git tag v<version> && git push origin v<version>`.
6. **Create the GitHub Release**, using the changelog section as the body — this triggers
   `publish.yml`.
7. **Verify:** check the Actions run, `npm view agora-hub version`, and smoke-test
   `npx -y agora-hub --version`.

### Rollback (if needed)

```
npm unpublish agora-hub@<version>
git tag -d v<version> && git push origin :refs/tags/v<version>
```

Only unpublish within the first 72 hours. After that, publish a patch bump instead.

### Version bump rules

| Change scope | Bump | Example |
|---|---|---|
| Breaking API/CLI change | minor | `0.3.0` → `0.4.0` |
| New feature (backward-compatible) | minor | `0.3.0` → `0.4.0` |
| Bug fix / documentation | patch | `0.3.0` → `0.3.1` |
| Changelog policy | — | Never bump for changelog-only changes; do it in the next feature/fix release. |
