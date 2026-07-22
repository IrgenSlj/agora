# agora

> **The trust plane for agentic tooling.** Agora verifies where your MCP servers and Agent Skills
> come from, watches what they actually do, enforces *your* policy over both, and manages them across
> every host — OpenCode, Claude Code, Cursor, Windsurf.

<p>
  <a href="https://www.npmjs.com/package/agora-hub"><img src="https://img.shields.io/npm/v/agora-hub" alt="npm"></a>
  <a href="https://github.com/IrgenSlj/agora/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/agora-hub" alt="MIT"></a>
  <a href="https://github.com/IrgenSlj/agora/actions"><img src="https://img.shields.io/github/actions/workflow/status/IrgenSlj/agora/ci.yml?branch=main" alt="CI"></a>
</p>

Registries answer *what exists*. Nobody answers, at the moment you install and run an agent tool, the
only question that matters: **should THIS artifact be trusted, by THIS project, under THIS policy —
and what happens when that answer changes tomorrow?** That is Agora.

Agora is a **customs office over multi-source registries**, not a competing catalog. It deals in
**evidence** — verifiable, inspectable attestations — never opaque numeric "trust scores." It is
host-neutral and local-first: no accounts, no hosted backend you depend on, `--json` on every command.

## Why this exists

The agent-tooling ecosystem has 20k+ published MCP servers and a fast-growing skills ecosystem,
near-zero signing/provenance discipline, a documented 2025–2026 record of supply-chain attacks
(typosquatted servers, rug-pulls, description poisoning, credential exfiltration) — and **no
revocation mechanism at all**. Agora is the layer that verifies provenance, observes behaviour in a
sandbox, enforces policy over evidence, and can actually revoke — at the point of install and run.

## Install

```bash
npx -y agora-hub doctor      # zero-install: audit every MCP server across your hosts
npm i -g agora-hub && agora  # or install once
```

Register `agora` with any MCP client (Claude Code, Cursor, Windsurf, Gemini/Codex CLI, Zed) as an MCP
server — zero-install command `npx -y agora-hub mcp`. From source (requires [bun](https://bun.sh)):
`git clone` · `bun install` · `bun run build` · `bun link`.

## The four planes

Agora is organized as four planes over your agent stack (see [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md)
for the full specification):

- **Federate** — one search across multi-source upstream registries (the official MCP Registry as
  canonical, then Glama, PulseMCP, + skills). Agora never competes on catalog size; its effective
  catalog is everyone's, deduped by [purl](https://github.com/package-url/purl-spec). Smithery and
  Hugging Face are available as non-canonical opt-in research sources.
- **Verify (evidence)** — provenance verification (Sigstore / npm & GitHub attestations),
  schema-and-description hashing with rug-pull **drift** detection, a sandboxed `vet` that records what
  a server actually reads / writes / contacts, and canary-token exfiltration detection — all emitted as
  standard **in-toto / DSSE attestations** you can inspect and export.
- **Gate (policy)** — a real policy engine ([Cedar](https://www.cedarpolicy.com/)): your `.cedar` rules
  decide what may be installed, synced, or served, evaluated over evidence, per project — plus a signed
  **revocation feed** with anti-rollback (the ecosystem's most glaring absence).
- **Manage** — a portable `agora.toml` profile and a committed `agora.lock` (machine truth: exactly
  what's installed, hashed, verified); surgical, atomic writes into each host's config; `agora serve`
  exposes Agora *itself* to agents as an MCP server, so the agent is a first-class second user.

## Status — honestly

Agora is mid-build against the v2.0 brief. The plane descriptions above are the **design**; this table
is **what is live today**. The phase-by-phase map is [`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md).

| Capability | State |
|---|---|
| **Manage** — stack manager, multi-host adapters, `plan`/`apply`, `sync --from` | ✅ live |
| **Federate** — federated, offline-first catalog search (`agora search`) | ✅ live |
| **Gate** — heuristic customs gate on `agora acquire` (injection / drift / permission checks) | ✅ live *(being replaced by evidence + Cedar)* |
| **Verify** — Sigstore provenance · drift attestations · sandboxed `vet` · attestation export | 🔜 building (S3, S6) |
| **Gate** — Cedar policy engine · signed revocation feed | 🔜 building (S4, S5) |
| **Serve** — agent-facing MCP server with policy-filtered discovery | 🔜 building (S7) |

**"Passed the gate" means *no known red flags*, never "safe."** That distinction is deliberate and
appears everywhere a verdict is shown. Agora never fabricates data or counts; if a source is
unreachable, it says so.

## What works today

```bash
agora doctor                     # one table of every MCP server across all your hosts + drift
agora search postgres            # multi-source catalog search across upstream registries
agora acquire mcp-postgres       # resolve → gate → write config (the customs office)
agora plan                       # Terraform-style diff of your stack vs. agora.toml (no writes)
agora apply                      # reconcile host configs to match the profile
agora sync --from <git-url>      # clone someone's whole agent setup — every entry runs the gate
agora integrate --all            # install Agora into every host, using its own stack machinery
```

`agora.toml` is a portable, declarative profile of your whole installation — commit it and anyone
reproduces your setup with `agora sync --from <url>`. Writes are **surgical**: adapters preserve every
unrelated key and write atomically. No credentials ever live in `agora.toml`.

## Positioning

- **A customs office, not a registry.** Agora searches existing registries; it never competes on
  catalog size.
- **Evidence, not scores.** Every verdict is policy evaluated over verifiable attestations — no opaque
  numeric trust score exists anywhere in the product.
- **Host-neutral.** OpenCode, Claude Code, Cursor, and Windsurf are four equal integrations, not one
  identity.
- **Local-first, no accounts.** Every core feature works offline against an on-disk cache — degraded,
  never broken. No auth, no sessions, no hosted backend you depend on.

## Host integration

| Host | Mechanism |
|---|---|
| Any MCP client (Claude Code, Cursor, Windsurf, Gemini/Codex CLI, Zed) | Register `agora mcp` — `npx -y agora-hub mcp` |
| OpenCode | Native plugin (tools **+** hooks) |
| Claude Code | `/plugin marketplace add IrgenSlj/agora` → `/plugin install agora` (tools + `/agora` + skill) |

`agora integrate [host|--all]` installs Agora into each host using its own stack-manager machinery —
the first thing the stack manager manages is Agora itself.

## Development

```bash
bun install
bun run test        # vitest, hermetic (no network)
bun run lint        # biome
bun run typecheck   # tsc
bun run build       # tsc + copy catalog + chmod +x dist/cli.js
bun src/cli.ts <cmd> # run from source, no build needed
```

Node ≥ 20, ESM only. Direction is locked by [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md); the execution
plan is [`docs/V2_EXECUTION_PLAN.md`](./docs/V2_EXECUTION_PLAN.md). PRs welcome — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) — © IrgenSlj.
