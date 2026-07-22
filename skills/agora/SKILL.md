---
name: agora
description: Operate the agora CLI (npm agora-hub) — the local-first trust plane for MCP servers, Agent Skills, and agent-tool stack management. Use this skill whenever a task needs to search or browse MCP servers, inspect or reconcile a user's MCP configuration across hosts (OpenCode, Claude Code, Cursor, Windsurf), or safely acquire a capability the current agent is missing. Works in any harness with the agora binary on PATH, or via `npx -y agora-hub` when it isn't installed.
license: MIT
---

# Operating Agora

Agora is a trust plane and stack manager, not a chat assistant — every command is
scriptable, every write is gated, and every important command supports `--json` for machine
consumption. Treat it the way you'd treat `git` or `npm`: read state, plan a change, apply it,
check the exit code.

If `agora` isn't on `PATH`, run it as `npx -y agora-hub <command>` — no local install required.

## The four rules

1. **Always pass `--json` when you intend to parse the output.** Every command in this skill has
   a stable, documented JSON shape. Never scrape the human-readable text output.
2. **Plan before you apply.** Commands that write configuration (`sync`, `apply`, `acquire`) have a
   read-only counterpart or dry-run mode that shows exactly what would change. Run that first,
   especially the first time you touch a machine you don't have full context on.
3. **Read the exit code, not just stdout.** Agora's exit codes are part of its contract — a non-zero
   code means "stop and look," not "something silently succeeded."
4. **A clean scan means "no known red flags," not "safe."** The trust gate is static heuristics
   plus live-probe diffing (permission checks, registry status, description-injection patterns,
   annotation-hint checks) — never a sandbox, never a formal verification. Don't tell a user
   something "passed" is guaranteed safe.

## Exit codes (the agent-operable contract)

Most Agora commands that read or write state share one exit-code contract:

| Code | Meaning | Seen on |
|---|---|---|
| `0` | Ok — no changes needed / gate passed / write succeeded | all commands |
| `1` | Policy forbid / drift / revocation hit | gated writes, `scan`, `lock verify` |
| `2` | Usage error | all commands |
| `3` | Network error | federation / refresh commands |
| `4` | Sandbox unavailable | `vet` once S6 lands |

A few commands intentionally don't use the full range: `agora doctor` is informational (exit `0`
unless `--strict` is passed, then `1` on any server error) and `agora integrate` is `0`/`1` today
(there's no trust gate to warn or fail — it writes the Agora launcher entry through the stack manager).

## Everyday commands

```bash
agora search <query> [--source official|local] [--json]     # federated catalog search
agora browse <id> [--json]                                    # full item detail
agora doctor [--tool <id>] [--probe] [--strict] [--json]       # health-check the configured stack
agora capabilities [query] [--json]                            # search tools your servers expose
```

`search`/`browse` results are deduped across upstream registries (official MCP Registry today;
more sources land over time) — the same server found in two registries collapses to one item with
multiple `provenance` entries, never a duplicate.

## Plan-before-apply discipline

Agora's stack manager follows Terraform semantics: **`plan` never writes, `apply` always writes
exactly what `plan` showed.**

```bash
agora plan   [--tool <id>] [--scope project|user] [--prune] [--json]   # read-only diff, exits 0; output shows changes
agora apply  [--tool <id>] [--scope project|user] [--prune] [--json]   # executes the plan, exit 0 on success
agora sync   [--write --yes] ...                                        # continuity alias: plan && apply
```

Both compare `agora.toml` (the declarative profile: MCP servers + managed instruction files like
`CLAUDE.md`/`AGENTS.md`/`.cursor/rules`) against the real config files of every detected harness.
Practical rule: **run `agora plan --json` first, inspect `tools`/`instructions` in the result, and
only run `agora apply` (or `agora sync --write --yes`) once you understand what will change** —
especially before touching a shared or production machine.

`--from <git-url|gist|path>` previews or applies *someone else's* profile. Every entry in a remote
profile runs through the same trust gate `acquire` uses before anything is written — a hard `fail`
exits `1` with nothing written, no exceptions.

## When to reach for `acquire`: the gap → acquire → gate → confirm loop

Use `agora acquire` when the current agent is missing a capability (an MCP server it needs isn't
configured yet). It is the single command that goes from "I need X" to "X is configured and
gated," and it is intentionally a two-step confirmation flow — never a one-shot write:

```bash
# Step 1 — resolve + gate, write nothing (this is the default; --dry-run makes it explicit)
agora acquire <id|query> [--tool opencode|claude-code|cursor|windsurf] --dry-run --json

# Step 2 — after inspecting the verdict, actually write
agora acquire <id|query> [--accept-warnings] --json
```

Read the JSON result's `status` field to decide what to do next:

- `"dry_run"` — preview only; `scan` shows the verdict, nothing was written. Inspect it, then
  decide whether to proceed.
- `"needs_confirmation"` — the gate found warnings but no failures. Re-run with
  `--accept-warnings` only if the warnings are acceptable for this context (read them — they're in
  `scan.checks`, e.g. undeclared `exec` permission, a missing license, a deprecated registry
  status). Never blindly retry with `--accept-warnings` without reading `scan.checks` first.
- `"blocked"` with `scan.summary.fail > 0` — hard failure (e.g. official registry marked the
  server `deleted`, or a description-injection pattern was detected). Do not retry. Do not look
  for a bypass flag — there isn't one, by design.
- `"installed"` — written. `written.configPath` says where; `nextSteps` lists what the human still
  needs to do (usually: restart the harness so the new MCP server loads).
- `"not_found"` — nothing matched; try `agora search <query>` first to find the right id.

The MCP tool surface (`agora mcp`, exposed as `agora_acquire`) encodes the identical two-step
shape: the first call omits `confirm` (always a dry run — plan + verdict, nothing written); only a
second call with `confirm: true` can write, and even then the gate still decides — a `fail`
verdict is never bypassable, and a `warn` verdict additionally requires `acceptWarnings: true` on
that same confirming call.

## Making Agora available in a harness

```bash
agora integrate <harness>|--all [--json]
```

Installs Agora itself as an MCP server (`npx -y agora-hub mcp`) into a harness's own config — the
same surgical, atomic write path `agora sync` uses, so it never disturbs anything else already
configured there. Idempotent: re-running reports `updated: []` / `added: []` when there's nothing
new to write.

## Honest-output reminders

- If a network source is unreachable, Agora says so (`statuses` in search results, `fallbackReason`
  elsewhere) instead of silently returning fewer results.
- `doctor` without `--probe` only checks static config (command resolvable, valid URL, disabled,
  conflicts) — it does not start servers. `--probe` briefly starts local servers to verify they run
  and is the only path that can detect description drift.
- Never report a scan/gate result as "safe" — report it as what it literally says: pass/warn/fail
  against a fixed set of heuristic checks.
