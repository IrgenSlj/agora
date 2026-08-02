# Open Questions

Log of decisions where the locked v2 direction in [`AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md)
meets third-party reality. Direction stays locked; these record the smallest-change adaptation.
Current implementation status belongs in [`STATUS.md`](./STATUS.md), not in historical resolution
notes here.

## OQ-4 — What counts as human approval for an agent-requested install?

**Open as of 2026-08-02.** A second MCP/plugin call containing `confirm: true` is not human
authorization: the model can supply that boolean. Likewise, “run `agora approve` in a terminal” is
not a security boundary when the same coding agent has shell access.

The required behavior is clear even though the portable mechanism is not:

- Agent surfaces may search, inspect evidence, check policy, plan, and create an install intent.
- Human CLI acquisition remains supported.
- An agent-callable tool may not turn its own intent into a stack mutation.
- Approval must be explicit, reviewable, bound to the exact artifact/digest/target/decision, and
  expire or become invalid when any of those inputs change.

Candidate boundaries are host-native user-consent UI, a separate local approval socket owned by an
interactive user process, or an out-of-band signed approval record. TTY detection alone improves
accidental safety but is not a strong boundary. `AGENT-001/002` in [`NEXT.md`](./NEXT.md) tracks the
implementation; documentation must describe the current MCP confirmation flow as transitional until
one candidate is proven across supported hosts.

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

### SUPERSEDED 2026-07-27 — build an exec shim, not an SDK integration

**Do not build `agora connect claude` or any API-key flow.** The adaptation above is correct
for the *Agent SDK* — a library you import, which reads `ANTHROPIC_API_KEY` and cannot see
Claude Code's login. But Agora does not use an SDK for inference. `src/opencode-exec.ts`
**spawns a binary**, and that is a different auth story entirely.

Verified 2026-07-27 against the installed `claude` CLI. Its `--bare` flag is documented as:

> Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings
> (**OAuth and keychain are never read**).

That describes what `--bare` *removes* — so without it, OAuth and keychain **are** read.
Spawning `claude -p` therefore uses whatever auth the developer's Claude Code already has,
**Pro/Max subscription included**. Agora never sees, stores, or transmits a credential, which
is the only version consistent with the non-negotiable that Agora stores no credentials.
Headless `-p`/`--print` is a documented, supported mode, so this is sanctioned use, not a
workaround.

**Revised adaptation:** extract a `Provider` interface from `src/opencode-exec.ts`; ship
`providers/opencode.ts` (zero-cost default, so the shell works with no key on first run) and
`providers/claude.ts`, detected by PATH. Flag mapping:

| opencode | claude |
|---|---|
| `run --format json` | `-p --output-format json` |
| `--model opencode/<id>` | `--model <alias>` |
| `--session <id>` | `--resume <id>` |
| `--continue` | `-c` |

**Use model aliases (`opus`, `sonnet`, `haiku`, `fable`), not pinned IDs.** The pinned list
above is already stale — `claude-opus-4-8` is now `claude-opus-5`. Aliases do not rot.

### RESOLVED 2026-07-28 — shipped as `src/inference/`

`InferenceProvider` (`src/inference/types.ts`) with `opencode` and `claude` implementations,
selected by `selectProvider()`. The free provider is first in `PROVIDERS` order and wins by
default, so Agora never silently spends a user's Claude quota because the binary happens to be
installed; `AGORA_INFERENCE=claude` opts in. An explicitly requested provider that is missing is
*reported*, never substituted.

Two things learned by running the real binary rather than reading docs:

- **`--verbose` is required** alongside `-p --output-format stream-json`. Without it the stream
  carries only the final result, so an incremental renderer draws nothing until the very end.
- **Claude splits a tool call from its result** — the call arrives on an `assistant` message, the
  result on the following `user` message. The renderer only prints tools that reached a terminal
  status, so the translator holds the call and emits one paired event when the result lands. This
  is why `StreamTranslator` is created per run (stateful) rather than being a pure function.

Verified end to end against a live `claude` process: prompt in, text out, plus session id, token
count and cost, with no API key present. Event shapes in `test/inference.test.ts` are captured
from real output, so an upstream change surfaces as a test failure rather than a silent blank.

## OQ-3 — Federation sources (P1 / P1+): PulseMCP gated, Glama has no tool schemas

Verified live 2026-07-03 against each API; re-verified live 2026-07-04 while building the P1+
`RegistrySource` implementations (`src/federation/adapters/{smithery,glama,github,huggingface}.ts`) —
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
  flows through the moment upstream starts setting it, without depending on it today. S2 keeps it as
  a non-canonical opt-in source (`AGORA_ENABLE_SMITHERY=1`, `AGORA_ENABLE_NONCANONICAL_SOURCES=1`, or
  `AGORA_NONCANONICAL_SOURCES=smithery`), so default federation stays aligned to the brief's canonical
  registry set.
- **Glama** — `https://glama.ai/api/mcp/v1/servers` (`after` cursor, `first`, `query`,
  `attributes[]=<value>` — note the array-bracket param name; a bare `attributes=` silently no-ops),
  detail `/v1/servers/{namespace}/{slug}`, no auth. Re-confirmed 2026-07-04: **`tools[]` is `[]` on every
  sampled server, including the detail endpoint** — do not source tool schemas/annotation hints from
  Glama. `attributes[]=author:official` **is a real, working filter** (verified live — matched items
  carry the literal string `'author:official'` in their `attributes` array, e.g.
  `scavio-ai/arcade-scavio`); `hosting:remote-capable` / `hosting:local-only` / `hosting:hybrid` is
  present on nearly every server. Neither attribute has a dedicated field on `MarketplaceItem` — folded
  into `Provenance.verified` (official) and `tags` (hosting) respectively.
- **PulseMCP** — **CORRECTION to brief: no self-serve public API, but a documented partner API exists.**
  Re-verified 2026-07-22: `https://www.pulsemcp.com/api/docs/v0.1` documents `GET /v0.1/servers`
  and detail endpoints, but the integration is private/B2B and requires `X-API-Key` + `X-Tenant-ID`;
  an unauthenticated live call to `https://api.pulsemcp.com/v0.1/servers?limit=1` returns HTTP 401
  `{"code":"unauthorized","details":{"header":"X-API-Key"}}`. Ship it as an optional, env-keyed
  source (`AGORA_PULSEMCP_API_KEY`/`PULSEMCP_API_KEY` plus
  `AGORA_PULSEMCP_TENANT_ID`/`PULSEMCP_TENANT_ID`), disabled by default and never in the critical path.
- **mcp.so** — confirmed no public API (brief agreed). Skip.
- **GitHub / Hugging Face** — no new API surface: `src/federation/adapters/github.ts` and
  `huggingface.ts` wrap the already-shipped `src/hubs/github.ts` (`searchGithub`) and
  `src/hubs/huggingface.ts` (`searchHuggingFace`) 1:1 into `FederatedItem`. Neither underlying function
  takes a free-text query (they always crawl a fixed topic/category list) — the federation wrapper
  applies the query as a client-side name/description/tag filter. Operational gotcha inherited, not
  introduced: both retry each of their several sequential sub-requests with a real, non-signal-aware
  backoff (`maxRetries: 2`, ~1s base delay) — a fully-down network rides the federation engine's own
  per-source timeout ceiling (`DEFAULT_TIMEOUT_MS` = 5000) rather than failing fast. `fetchItem()` for
  both does one dedicated single-item GET (`GET /repos/{owner}/{repo}` for GitHub, tries
  `models`/`datasets`/`spaces` in order for Hugging Face) rather than reusing the crawl. Hugging Face
  is non-canonical in S2 and requires `AGORA_ENABLE_HUGGINGFACE=1`,
  `AGORA_ENABLE_NONCANONICAL_SOURCES=1`, or `AGORA_NONCANONICAL_SOURCES=huggingface`.

**Adaptation:** P1 shipped `official` + `local`; P1+ added `smithery` · `glama` · `github`
(reuse `src/hubs/github.ts`) · `huggingface` (reuse `src/hubs/huggingface.ts`). S2 adds optional
`pulsemcp` with credential gating and `skills-github` as a GitHub-topic skill source. S2 also resolves
the Smithery/Hugging Face question: both are non-canonical and opt-in, not part of default federation.
`SOURCES` preference order (`src/federation/index.ts`) remains
`official, glama, pulsemcp, skills-github, smithery, github, huggingface, local`; disabled sources report
`offline` and use cache fallback instead of contacting the network. Annotation hints for the gate come
from the **Smithery detail endpoint** when upstream populates them (mapped defensively; not observed
live as of 2026-07-04 — see correction above), never Glama.

## OQ-2 — Claude Code plugin/marketplace format (P6): confirmed

Verified 2026-07-03. `.claude-plugin/plugin.json` (name+description required) and
`.claude-plugin/marketplace.json` (name+owner+plugins) as the brief describes. `.mcp.json` at plugin
root auto-loads; `{ "command": "npx", "args": ["-y", "agora-hub", "mcp"] }` is valid. MCP tools gate on
first-use permission (no special plugin dialog). SKILL.md follows the agentskills.io standard — full
support in Claude Code + Agent SDK; portable but not yet universally read by Codex/Gemini. No change to
brief direction.
