# Agora roadmap

**Direction: LOCKED** by `AGORA_BRIEF.md` (2026-07). Agora is **the system manager for your agentic
stack** — a local-first package manager that *manages* (stack + instruction files), *watches* (a
federated plaza feed), and *gates* (the trust/customs layer) your MCP ecosystem. It federates upstream
registries rather than growing its own catalog; owns no inference; has no hosted backend.

This file supersedes the pre-pivot roadmap. Verified external-API corrections live in
[`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md); shipped work is in [`CHANGELOG.md`](./CHANGELOG.md).

## Status at a glance

| Track | State |
|---|---|
| **P0** rename/repackage/reposition (`agora-hub`) | ✅ shipped |
| **Contracts** federation · instructions · inference · IR | ✅ shipped |
| **P-freeze** remove community/backend/hub/Reddit | ✅ shipped |
| **Repo cleanup** delete frozen dirs + stale docs | ✅ shipped |
| **TUI-0** theme `drift` token + trust component grammar | ✅ shipped |
| **P1** federated catalog (official + local sources) | ✅ shipped |
| **P2** trust gate over federation | ✅ shipped |
| **P3** stack instructions + plan/apply | ✅ shipped |
| **🎉 RING 1 (manage · watch · gate)** | ✅ **complete** |
| **P6** harness integration matrix | 🔜 next (needs P2 gate) |
| **P1+** follow-on sources (smithery/glama/github/hf) | ⏳ breadth |
| **P4** inference providers (opencode/claude/ollama) | ⏳ Ring 2 |
| **P5** plaza read/write sources | ⏳ Ring 3 |
| **TUI-1/2/3** Stack · Acquire · Search · Item · Plaza · Home · Settings | ⏳ tracks the pages onto the backends |

## The three rings (what gates a release)

- **Ring 1 — Manage & Gate** (must be excellent; blocks releases): stack manager, federated catalog,
  trust gate. This is what Agora *is*.
- **Ring 2 — Surfaces** (invisible + fast): CLI/TUI, `agora mcp`, thin plugins, inference tiers.
- **Ring 3 — Plaza & conveniences** (allowed to be imperfect): federated feed + composer, tutorials, recall.

## Remaining work packages

### P1 — Federated catalog *(next; Ring 1 core)*
`src/federation/` clients behind the authored `RegistrySource`/`FederatedItem` contract.
- **Core (first):** `official` (registry.modelcontextprotocol.io — required, no-auth reads, cursor
  pagination, `updated_since` incremental refresh) + `local` (bundled `data.ts`/offline cache) sources;
  `federatedSearch` with dedupe/canonicalization (reverse-DNS name | repo URL | npm package); `agora
  search --source --json` + `agora refresh`; hermetic fixture tests.
- **Follow-on sources:** `smithery` (the reliable tool-schema source), `glama` (no tool schemas — only
  `official`/`hosting` attributes), `github`/`huggingface` (reuse `src/hubs/`). PulseMCP/mcp.so dropped
  (no self-serve API — see OQ-3).
- Index federated results through the existing BM25 `catalog-index.ts` with provenance boosts.

### P2 — Trust gate over federation *(after P1; Ring 1 core)*
`acquire` resolves against federation. Gate inputs: official `status` (`deleted`→fail, `deprecated`→warn);
MCP annotation hints (`destructiveHint`/`openWorldHint`/missing `readOnlyHint`, from Smithery/probe →
warn). Observed-permissions probe diffs `mcp-probe` schemas vs the declared manifest. Store Agora trust
data under a namespaced `_meta` key. Honest-limits copy in README + `scan --help` (already in README).

### P3 — Stack manager expansion *(parallel-able; Ring 1)*
Implement the authored `instructions` manifest table + `readInstructions`/`writeInstructions` adapters
(CLAUDE.md, AGENTS.md, `.cursor/rules`, OpenCode instructions). Split `agora plan` (diff, exit-code
drift) / `agora apply`; `sync` = `plan && apply`. `agora sync --from <git|gist>` runs the gate on every
executable entry (flagship demo). Ring 1.5 IR (`src/stack/ir.ts`) stays types-only until Ring 1 is solid.

### P4 — Inference providers *(parallel-able; Ring 2)*
`src/inference/` implementing the authored `Provider` interface: `opencode` (wrap `opencode-exec`),
`claude` (Agent SDK via **`ANTHROPIC_API_KEY`** — subscription auth unavailable, OQ-1), `ollama`
(OpenAI-compatible). `agora connect claude|ollama|status` in settings (never `agora.toml`). Route
acquire-suggestions, feed summarization, `agora ask` through it.

### P5 — Federated plaza *(parallel-able; Ring 3)*
Add read adapters (Lobsters, Bluesky, Mastodon, GitHub Discussions, Discourse) reusing the ranking +
cache; write adapters where protocols are open (Bluesky, Mastodon, Discourse, GitHub Discussions) with
`canWrite`; `agora post`/`reply`. Honest-output: label unverifiable posts. (Reddit already removed.)

### P6 — Harness integration matrix *(after P2)*
`agora integrate [harness|--all]` installs Agora into each harness via its own `ToolAdapter` machinery
(dogfood). In-repo `.claude-plugin/` (`marketplace.json` + `agora` plugin: `.mcp.json` npx launcher,
`commands/agora.md`, skill). Agora Agent Skill `skills/agora/SKILL.md`. `gemini-extension.json`. Keep
`agora mcp` ≤ 8 tools. (Formats verified — OQ-2.)

### TUI-1/2/3 — the redesign surfaces *(track the pages onto the backends)*
Per the Claude Design engineering handoff (foundations shipped in TUI-0):
- **TUI-1:** `PageId` rename (marketplace→search, news→plaza, +item/acquire/learn) + `PageAction`
  plan/gate kinds; **Stack** page (grouping toggle, drift column, plan sub-view); **Acquire** page
  (RESOLVE→PLAN→GATE→APPLY + verdict banner + exit codes 0/2/3).
- **TUI-2:** **Search** (rename marketplace page, progressive per-source results + provenance badges) +
  **Item** (trust panel centerpiece). Wires onto P1/P2.
- **TUI-3:** **Plaza** (origin chips + composer) + **Home** (four modules) + **Settings** (tiers /
  sources / integrations) + **Learn** restyle.

## Execution conventions

- One long-lived branch `feat/agora-hub`; push often; `main` stays releasable.
- Contract-first: load-bearing interfaces authored centrally; implementations fan out to agents.
- Every package ends with `bun run typecheck:cli` clean, `bun test` green, a CHANGELOG entry.
- Non-negotiables (brief §6): local-first, honest output, agent-operable (`--json`, plan/apply, exit
  codes `0/1/2/3`), surgical config writes, thin plugins, terminal degradation, no creds in `agora.toml`.

## Acceptance demos (each end-to-end, ~30s, recordable)

1. `agora doctor` — one table of every MCP server across OpenCode/Claude Code/Cursor/Windsurf + drift.
2. `agora sync --from <repo>` — clone a setup; the gate blocks one poisoned entry (`fail`, exit 3).
3. Agent self-provisioning inside OpenCode: gap → `agora_acquire` → warn → accept → written.
4. `agora search postgres --json` — merged results, ≥2 provenances, dedupe working.
5. `agora integrate --all` — Agora's tools live in OpenCode + Claude Code + Cursor from one command.
