<p align="center">
  <img src="./docs/assets/banner.svg" alt="Agora — a written limit for every coding agent, a receipt for every change" width="100%">
</p>

> **Agora gives every coding agent a written limit and every agent-made change a receipt.**
> Local-first, open source, no account.

<p>
  <a href="https://www.npmjs.com/package/agora-hub"><img src="https://img.shields.io/npm/v/agora-hub" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/agora-hub" alt="MIT"></a>
  <a href="https://github.com/IrgenSlj/agora/actions"><img src="https://img.shields.io/github/actions/workflow/status/IrgenSlj/agora/ci.yml?branch=main" alt="CI"></a>
</p>

Coding agents now run for minutes or hours at a stretch. Nobody clicks through every approval
prompt for that long, so people either babysit the agent or switch the prompts off. Neither gives
you what you need: a limit you set up front, and proof afterwards that the agent stayed inside it.

Agora is that layer, and it works across hosts. You keep one policy file, `agora.cedar`, in the
repository. Agora will:

- **learn** a minimal policy from what your agents actually do in this repo,
- **compile** it into each host's own permission, sandbox and hook settings, and list every rule a
  host cannot enforce rather than dropping it quietly,
- **sign a receipt** for each agent session, attached to the commits it produced, so a reviewer
  can ask "was this change made within policy?" and CI can answer.

> **Status: this is a rebuild in progress.** Agora 0.9 is the cleared foundation. Learn, compile
> and receipts are the plan, not the product yet. The table below says what works today, and it is
> kept honest against the code.

## Status

| Capability | State |
|---|---|
| `agora hook` — a Claude Code `PreToolUse` hook that denies calls to revoked MCP servers | **Works** |
| `agora run` / `agora observe` — record MCP tool calls and sampled network peers, never arguments or results | **Works** |
| `agora audit` — look up every configured MCP server in OSV.dev | **Works** |
| `agora ci` and the GitHub Action — fail a build on a blocking advisory | **Works** |
| `agora policy` — lint and test `agora.cedar` with a real Cedar engine | **Works** (artifact-level rules only) |
| `agora doctor` — what Agora can see and enforce on this machine | **Works** |
| Hash-chained session log (phase 1) | Planned |
| Signed receipts in git notes, verified in CI (phase 2) | Planned |
| `agora learn`, `agora plan` / `apply` as a policy compiler, `agora replay` (phase 3) | Planned |
| OpenCode support and canary files (phase 4) | Planned |
| Runner-signed receipts and the evidence report (phase 5, release 2.0.0) | Planned |

The full plan, with a runnable gate for each phase, is in [`docs/PLAN.md`](./docs/PLAN.md).

## Try it

```console
$ npx -y agora-hub doctor

Hosts
  ✓ Claude Code · 3 MCP servers
  ✓ Cursor · 1 MCP server
  · VS Code · not found

Enforcement
  ⚠ Claude Code hook not installed · run `agora hook install`
  ⚠ no agora.cedar · run `agora policy init`

Revocations
  ✓ no configured server is on the revocation list (4 checked)
```

```bash
agora hook install     # deny revoked MCP servers at the moment they are called
agora policy init      # scaffold agora.cedar at the repository root
agora audit            # look every configured server up in OSV.dev
```

Every command takes `--json` and uses the same exit codes: `0` clean, `1` policy failure, `2` usage,
`3` could not check.

## Put it in CI

```yaml
- uses: IrgenSlj/agora@v0
  with:
    fail-on-unknown: false
```

Today this fails the build when an MCP server the repository configures has a malware, critical or
high advisory. A server it cannot identify is reported as unchecked, never as clean. When receipts
land, the same step will verify them for every commit in the pull request.

## What Agora will never do

- **Grant a permission.** The hook can deny or stay silent. It never says "allow", because that
  would skip a prompt the user would otherwise have seen.
- **Block your agent because Agora broke.** Hooks fail open and say so on stderr. CI fails closed.
- **Record what your agent read or wrote.** Events hold tool names, paths, commands and peers, never
  arguments, results, prompts or file contents.
- **Turn unknown into clean.** A check that did not run is reported as not established.
- **Score anything, or call it safe.** Agora states what it checked and what it could not.

## Upgrading from 0.8

0.9 removed everything outside this plan: search, install and acquire, the `agora.toml` stack
manager and lockfile, the pre-install scan, the daily digest and the agent-facing MCP server. Each
removed command still runs and tells you what happened:

```
$ agora search filesystem
`agora search` was removed in v0.9.0.
  Agora 0.9 narrowed to one job: a written limit for coding agents and a receipt for what
  they did. Finding and installing tools is left to the hosts and registries.
```

`plan` and `apply` come back in a later release with a new meaning: compiling `agora.cedar` into
host permissions. See [`CHANGELOG.md`](./CHANGELOG.md) for the full list.

## Development

```bash
bun install
bun run typecheck && bun run lint && bun run test && bun run verify:package
bun src/cli.ts <cmd>   # run from source
```

Node ≥ 22.22.2, ESM only. Read [`AGENTS.md`](./AGENTS.md) for the rules, [`docs/PLAN.md`](./docs/PLAN.md)
for the plan and [`docs/STATUS.md`](./docs/STATUS.md) for what is built. Pull requests welcome; see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — © IrgenSlj.
