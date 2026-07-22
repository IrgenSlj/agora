# Open Questions

Log of decisions where the locked v2 direction in [`AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md)
meets third-party reality. Direction stays locked; these record the smallest-change adaptation.

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

## OQ-3 — Federation sources (P1 / P1+): PulseMCP dropped, Glama has no tool schemas

Verified live 2026-07-03 against each API; re-verified live 2026-07-04 while building the P1+
`RegistrySource` implementations (`src/federation/sources/{smithery,glama,github,huggingface}.ts`) —
every shape below was hit with real `curl` requests immediately before writing its mapper, same
discipline as the official source.

- **Official MCP Registry** — matches the brief. `https://registry.modelcontextprotocol.io`,
  `GET /v0.1/servers` (`limit` default 30 / max 100, `search`, `updated_since`, `version=latest`,
  `include_deleted`). Cursor is `metadata.nextCursor` (opaque — pass back, don't parse). Status in
  `_meta["io.modelcontextprotocol.registry/official"]`. `packages[]` registryType now includes
  `cargo`; schema dated 2025-12-11. Gotcha: `updated_since` auto-sets `include_deleted=true` (tombstones
  arrive unasked — exactly what we want for prune-on-refresh). **Required source for federation.**
- **Smithery** — `https://registry.smithery.ai` (`api.smithery.ai` resolves to byte-identical
  responses in testing; the client uses `registry.smithery.ai`). `GET /servers` (`q`, `pageSize`≤100 —
  over 100 gets a structured HTTP 400, not a clamp), `GET /servers/{qualifiedName}` (qualifiedName may
  itself contain a `/`, e.g. `thinair/data` — both raw and %2F-encoded slashes route correctly) returns
  `tools[]`/`resources[]`/`prompts[]` + `security`. Keyless reads confirmed working 2026-07-04. 404 body
  is `{"error":"Namespace not found"}`. **CORRECTION to the 2026-07-03 note:** in a live sample of ~15
  varied servers (including `composio`, 79 tools) **every `security` was `null` and no tool ever carried
  an `annotations` object** — `security.scanPassed` and `tools[].annotations` exist in the response shape
  but were not observed populated in practice. Still THE reliable per-server tool-*schema* source
  (`name`/`description`/`inputSchema` are populated on every sampled server) — mapped so `annotations`
  flows through the moment upstream starts setting it, without depending on it today.
- **Glama** — `https://glama.ai/api/mcp/v1/servers` (`after` cursor, `first`, `query`,
  `attributes[]=<value>` — note the array-bracket param name; a bare `attributes=` silently no-ops),
  detail `/v1/servers/{namespace}/{slug}`, no auth. Re-confirmed 2026-07-04: **`tools[]` is `[]` on every
  sampled server, including the detail endpoint** — do not source tool schemas/annotation hints from
  Glama. `attributes[]=author:official` **is a real, working filter** (verified live — matched items
  carry the literal string `'author:official'` in their `attributes` array, e.g.
  `scavio-ai/arcade-scavio`); `hosting:remote-capable` / `hosting:local-only` / `hosting:hybrid` is
  present on nearly every server. Neither attribute has a dedicated field on `MarketplaceItem` — folded
  into `Provenance.verified` (official) and `tags` (hosting) respectively.
- **PulseMCP** — **CORRECTION to brief: no self-serve public API.** Legacy `v0beta` is mid-sunset (returns
  410 for ~50% of calls now, 100% dead Sept 2026); new `v0.1` is partner-gated (`X-API-Key` + `X-Tenant-ID`,
  no signup). Drop from the self-serve federation path. (It only wraps the official registry anyway.)
- **mcp.so** — confirmed no public API (brief agreed). Skip.
- **GitHub / Hugging Face** — no new API surface: `src/federation/sources/github.ts` and
  `huggingface.ts` wrap the already-shipped `src/hubs/github.ts` (`searchGithub`) and
  `src/hubs/huggingface.ts` (`searchHuggingFace`) 1:1 into `FederatedItem`. Neither underlying function
  takes a free-text query (they always crawl a fixed topic/category list) — the federation wrapper
  applies the query as a client-side name/description/tag filter. Operational gotcha inherited, not
  introduced: both retry each of their several sequential sub-requests with a real, non-signal-aware
  backoff (`maxRetries: 2`, ~1s base delay) — a fully-down network rides the federation engine's own
  per-source timeout ceiling (`DEFAULT_TIMEOUT_MS` = 5000) rather than failing fast. `fetchItem()` for
  both does one dedicated single-item GET (`GET /repos/{owner}/{repo}` for GitHub, tries
  `models`/`datasets`/`spaces` in order for Hugging Face) rather than reusing the crawl.

**Adaptation:** P1 shipped `official` + `local`; P1+ (this pass) adds `smithery` · `glama` · `github`
(reuse `src/hubs/github.ts`) · `huggingface` (reuse `src/hubs/huggingface.ts`) — all four landed, none
were skipped. `SOURCES` preference order (`src/federation/index.ts`):
`official, smithery, glama, github, huggingface, local`. Annotation hints for the gate come from the
**Smithery detail endpoint** when upstream populates them (mapped defensively; not observed live as of
2026-07-04 — see correction above), never Glama.

## OQ-2 — Claude Code plugin/marketplace format (P6): confirmed

Verified 2026-07-03. `.claude-plugin/plugin.json` (name+description required) and
`.claude-plugin/marketplace.json` (name+owner+plugins) as the brief describes. `.mcp.json` at plugin
root auto-loads; `{ "command": "npx", "args": ["-y", "agora-hub", "mcp"] }` is valid. MCP tools gate on
first-use permission (no special plugin dialog). SKILL.md follows the agentskills.io standard — full
support in Claude Code + Agent SDK; portable but not yet universally read by Codex/Gemini. No change to
brief direction.
