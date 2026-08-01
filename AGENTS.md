# Agora agent instructions

`agora` is **the trust plane for agentic tooling** — it verifies where MCP servers and Agent
Skills come from, observes what they actually do, enforces user-defined policy over both, and
manages them across every host (OpenCode, Claude Code, Cursor, Windsurf). See
[`README.md`](./README.md) for the pitch, [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md) for the
locked specification, and [`docs/NEXT.md`](./docs/NEXT.md) for the
phase-by-phase build plan — read all three before making structural changes.

## The four planes

- **Federate** (`src/federation/`) — one search across multi-source upstream registries (official
  MCP Registry as canonical, then Glama, GitHub, + skills sources). Agora never competes on
  catalog size; its effective catalog is everyone's, deduped by purl.
- **Verify** (`src/evidence/`) — live Sigstore provenance verification (Fulcio + CT + Rekor, with
  the signing certificate's identity bound to the claimed repository), schema/description hashing
  with rug-pull drift detection, and description-poisoning heuristics.
- **Observe** (`src/observe/`) — `agora run -- <cmd>` supervises an MCP server during real use and
  records what it did. Replaced the brief's Docker sandbox; same evidence model.
- **Gate** (`src/policy/` + `src/revocation/` + `src/osv/`) — a real Cedar engine evaluated over
  that evidence, plus a revocation feed generated from OSV.dev daily with no human curation. The
  feed ships bundled in the package and a fetched copy is merged *monotonically* — it may add
  revocations, never remove one — which is why it needs no signing key. This is what Agora *is*; it gets the
  most scrutiny.
- **Manage** (`src/stack/`) — the stack manager: `agora.toml` profile, `agora.lock` machine
  truth, per-host adapters, `plan`/`apply`.

Partly built: `src/serve/` — the install-intent record and `agora approve` exist; the MCP server
hosting `search_tools` / `get_evidence` / `check_policy` / `request_install` does not. The rule it
enforces: **an agent may ask, only a human may install.** Not built: a pre-install sandbox
backend. See
[`ROADMAP.md`](./ROADMAP.md), which is the authority on what is live.

## Non-negotiables

- **Local-first.** Every core feature works offline against an on-disk cache. Agora has no hosted
  backend — don't add one, and don't make a feature depend on one being reachable.
- **Honest output.** No fabricated data, no invented counts. If a source is unreachable, say so.
  "Passed the gate" means *no known red flags*, not "safe" — never blur that line. This is
  enforced, not aspirational: the bundled `workflow` catalog items were deleted precisely because
  they carried invented star and fork counts with no upstream to refresh them. Absent evidence is
  never rendered as a negative finding — an unobserved server is not a well-behaved one, an
  unknown revocation status is not "clean", and an unsampled network is not "contacted nothing".
- **Agent-operable.** Every new command should support `--json`, use plan/apply separation where
  it writes anything, and return stable exit codes (brief §9, supersedes the old
  `2=plan-changes/3=scan-fail`): `0` ok · `1` policy forbid / drift / revocation hit · `2` usage ·
  `3` network · `4` sandbox unavailable.
- **A removal is a promise broken; say so.** When retiring a command, add it to
  `src/cli/retired.ts` so it names the version that removed it, why, and the replacement — or
  states plainly that there is none. `Unknown command` reads as a broken install.
  `test/cli/no-dangling-commands.test.ts` and `test/cli/retired-commands.test.ts` enforce this.
- **Surgical writes.** Config-writing code (stack adapters, `agora.toml`) must preserve every
  unrelated key and write atomically (see `src/atomic-write.ts`). Never credential-stuff
  `agora.toml` — secrets belong in settings/state, not the portable manifest.
- **Thin plugins.** The OpenCode/Claude Code plugin surfaces tools and hooks; it never owns a
  write that bypasses the gate.
- **Graceful terminal degradation.** Colour, gradients, and the banner degrade cleanly under
  `NO_COLOR`, `TERM=dumb`, non-TTY pipes, and narrow terminals.

## Build & test

```bash
bun install
bun run test        # vitest, hermetic (no network)
bun run lint        # biome
bun run typecheck   # tsc
bun run build       # tsc + copy catalog + chmod +x dist/cli.js
bun src/cli.ts <cmd> # run from source, no build needed
```

Run `bun run test && bun run typecheck && bun run build` clean before any PR.

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
the original path (pattern used for `shell`, `commands-meta`, `stack`):

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
3. **Quality gates** — `bun run typecheck && bun run lint && bun run build && bun run test`.
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
