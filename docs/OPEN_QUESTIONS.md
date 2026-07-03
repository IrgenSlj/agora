# Open Questions

Log of decisions the AGORA_BRIEF.md locks in *direction* but where the load-bearing
third-party reality diverged from the brief's assumptions at build time (per brief §10).
Direction stays locked; these record the smallest-change adaptation.

## OQ-1 — Claude inference tier (P4/D7): subscription auth is NOT available to third parties

**Brief assumed:** Tier 1 = Claude subscription via the Claude Agent SDK, where "post-2026-06-15,
third-party Agent SDK use draws from the user's dedicated Agent SDK credit pool."

**Verified 2026-07-03 against live docs:**
- Third-party Agent SDK apps **cannot** use claude.ai / subscription login. Docs: "Unless previously
  approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits …
  Please use the API key authentication methods." (code.claude.com/docs/en/agent-sdk/overview)
- The dedicated "Agent SDK credit pool" (announced ~2026-06-15) was **paused** before implementation;
  usage still draws from the subscription's regular limits. (support.claude.com article 15036540)
- The SDK does **not** pick up auth from the bundled Claude Code CLI login token. It reads
  `ANTHROPIC_API_KEY` (or Bedrock/Vertex/Foundry env switches).

**Adaptation (smallest change, direction intact):** Tier 1 `claude` provider authenticates via a
user-supplied `ANTHROPIC_API_KEY` (`agora connect claude` stores it in settings, never in `agora.toml`).
Framed in UI as "Claude (advanced — bring your own API key)", not "connect your subscription." Keep the
`Provider` interface identical so the auth mechanism can swap to subscription later if Anthropic opens it.
Current model IDs: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5`.

## OQ-3 — Federation sources (P1): PulseMCP dropped, Glama has no tool schemas

Verified live 2026-07-03 against each API.

- **Official MCP Registry** — matches the brief. `https://registry.modelcontextprotocol.io`,
  `GET /v0.1/servers` (`limit` default 30 / max 100, `search`, `updated_since`, `version=latest`,
  `include_deleted`). Cursor is `metadata.nextCursor` (opaque — pass back, don't parse). Status in
  `_meta["io.modelcontextprotocol.registry/official"]`. `packages[]` registryType now includes
  `cargo`; schema dated 2025-12-11. Gotcha: `updated_since` auto-sets `include_deleted=true` (tombstones
  arrive unasked — exactly what we want for prune-on-refresh). **Required source; the only one Ring 1 depends on.**
- **Smithery** — `https://api.smithery.ai`, `GET /servers` (`q`,`page`,`pageSize`≤100), `GET /servers/{qualifiedName}`
  returns `tools[]`/`resources[]`/`prompts[]` + `security.scanPassed`. Auth nominally Bearer but keyless
  works today (don't rely on it persisting). Pagination caps ~500 results/query — enumerate by filter fan-out.
  **This is the reliable per-server tool-schema source.**
- **Glama** — `https://glama.ai/api/mcp/v1/servers` (`after` cursor, `first`, `query`), detail
  `/v1/servers/{namespace}/{slug}`, no auth. **CORRECTION to brief: `tools[]` is empty in practice and there
  are NO `readOnlyHint`/`destructiveHint`/`idempotentHint` fields.** Do not source annotation hints from Glama.
  What it does give: `official` via attribute `author:official`, remote-capable via `hosting:*` attribute.
- **PulseMCP** — **CORRECTION to brief: no self-serve public API.** Legacy `v0beta` is mid-sunset (returns
  410 for ~50% of calls now, 100% dead Sept 2026); new `v0.1` is partner-gated (`X-API-Key` + `X-Tenant-ID`,
  no signup). Drop from the self-serve federation path. (It only wraps the official registry anyway.)
- **mcp.so** — confirmed no public API (brief agreed). Skip.

**Adaptation:** P1 sources = `official` (required) · `smithery` · `glama` · `github` (reuse `src/hubs/github.ts`) ·
`huggingface` (reuse) · `local` (bundled `data.ts` cache). Annotation hints for the gate come from the
**Smithery detail endpoint + live probe**, never Glama. `RegistrySource.id` union drops `pulsemcp`.

## OQ-2 — Claude Code plugin/marketplace format (P6): confirmed

Verified 2026-07-03. `.claude-plugin/plugin.json` (name+description required) and
`.claude-plugin/marketplace.json` (name+owner+plugins) as the brief describes. `.mcp.json` at plugin
root auto-loads; `{ "command": "npx", "args": ["-y", "agora-hub", "mcp"] }` is valid. MCP tools gate on
first-use permission (no special plugin dialog). SKILL.md follows the agentskills.io standard — full
support in Claude Code + Agent SDK; portable but not yet universally read by Codex/Gemini. No change to
brief direction.
