# Contributing

Agora gives every coding agent a written limit and every agent-made change a receipt. It is
local-first, has no hosted backend and no account.

Before a structural change, read [`docs/PLAN.md`](./docs/PLAN.md) (the one plan),
[`docs/STATUS.md`](./docs/STATUS.md) (what is built) and [`AGENTS.md`](./AGENTS.md) (the rules,
which apply to people as much as to agents).

## Quick start

```bash
git clone https://github.com/IrgenSlj/agora.git
cd agora
bun install
bun run typecheck && bun run lint && bun run test && bun run verify:package
bun src/cli.ts <cmd>
```

## Workflow

- One task from the build plan per change. Maintainers commit straight to `main` and keep it green;
  outside contributors open a pull request. Pick the first unticked box in the current phase.
- Security behaviour gets its failing test first: tamper, deny, unknown.
- New commands support `--json` and the exit codes `0` clean, `1` policy failure, `2` usage, `3`
  could not check.
- Output stays honest: unreachable or unchecked is reported as such, never as clean.
- A new runtime dependency needs a reason in the pull request. No native modules.

## Layout

```
src/cli/            command dispatch, help, retired commands
src/hook/           Claude Code PreToolUse decision and fast-path handler
src/observe/        byte-transparent MCP shim and session recording
src/policy/         Cedar engine, entities, shipped baseline
src/revocation/     bundled revocation list, matching, installed-server purls
src/osv/            OSV.dev client and advisory translation
src/stack/          host adapters (read and surgical write) and registry
src/evidence/       in-toto / DSSE helpers
src/ci/             `agora ci` report, annotations and job summary
```

Report security issues privately; see [`SECURITY.md`](./SECURITY.md).
