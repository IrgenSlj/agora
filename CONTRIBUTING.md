# Contributing

`agora` is the local-first trust plane for agentic tooling. It searches multiple upstream registries,
collects evidence, gates installs through policy, and manages MCP servers and Agent Skills across
OpenCode, Claude Code, Cursor, and Windsurf. There is no hosted backend dependency in the core.

Before structural changes, read [`README.md`](./README.md), [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md),
and [`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md).

## Quick Start

```bash
git clone https://github.com/IrgenSlj/agora.git
cd agora
bun install
bun run test        # vitest, hermetic / no network
bun run lint        # biome
bun run typecheck   # tsc
bun run build       # tsc + catalog copy + executable dist/cli.js
bun src/cli.ts <cmd>
```

Run `bun run test && bun run typecheck && bun run build` before opening a PR. The release gate also
requires `bun run lint`.

## Workflow

External contributions should use focused branches and PRs. The owner execution plan currently lands
coherent chunks directly on `main`; phase gates in `docs/V2_EXECUTION_PLAN.md` still decide when the
project is ready to move forward.

For every behavior change:

1. Keep the edit scoped to the owning module.
2. Add focused tests proportional to the blast radius.
3. Preserve `--json` and stable exit codes on new commands.
4. Use plan/apply or dry-run separation for writes.
5. Keep terminal output honest: unreachable sources and unknown evidence must be reported as such.

## Code Style

- TypeScript strict mode, ESM, Node >= 20.
- Tests use Vitest, lint/format use Biome.
- Prefer repo-local helper APIs and existing module patterns.
- Do not add hosted-backend dependencies to core flows.
- Do not put credentials in `agora.toml`.
- Use `src/atomic-write.ts` for config/state writes that touch user files.
- No opaque numeric trust scores. Verdicts come from evidence and policy.

## Project Layout

```text
src/model/           v2 zod wire/disk schemas, purl helpers, JCS/SHA-256 hashing
schemas/             generated JSON Schema artifacts
src/store/           SQLite store + CAS blob cache
src/federation/      federated catalog sources; target is adapters + sync by purl
src/stack/           stack manager: agora.toml, plan/apply, host adapters, doctor
src/scan.ts          live heuristic gate, being replaced by evidence + Cedar
src/acquire.ts       resolve -> gate -> write acquisition path
src/cli/             CLI, shell, TUI, command metadata
src/plugin/          thin OpenCode / Claude Code plugin tools and hooks
src/news/            read-only news feed, frozen except maintenance
src/marketplace.ts   legacy catalog/install-planner barrel, superseded by S1/S2
test/                Vitest suite
```

## Adding Commands

1. Add `src/cli/commands/<name>.ts`.
2. Wire dispatch in `src/cli/app.ts`.
3. Add command metadata under `src/cli/commands-meta/`.
4. Support `--json`.
5. Return v2 exit codes: `0` ok, `1` policy forbid / drift / revocation hit, `2` usage, `3`
   network, `4` sandbox unavailable.
6. Add tests.

If the command writes anything, preserve unrelated keys and write atomically.

## Help Wanted

The current scheduled work is S1/S2 from [`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md):
finish the lockfile/store contract, complete schema snapshots, migrate federation to purl-first
adapters, and continue retiring legacy account/catalog-era surfaces.
