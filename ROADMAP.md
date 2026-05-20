# Roadmap

Where `agora` is headed. For the *why* — the three-surface model, the open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). For what's already shipped, see [`CHANGELOG.md`](./CHANGELOG.md).

## Direction

`agora` is a **standalone terminal marketplace hub** for the agentic-coding ecosystem. The OpenCode plugin is one surface, not the product. The destination is an **open, self-regulating marketplace** where third-party developers publish (and later sell) skills, tools, and kits — `agora` provides discovery, trust, and delivery; the developers bring the goods.

Three pillars are live end-to-end — a curated + live **marketplace**, a ranked **news feed**, and a threaded **community** — plus a real trust layer (permission manifests, pre-install scan gate, flag/kill-switch, earned reputation), an MCP server mode, and a hybrid bash/chat shell. The next step is **reach and depth**: make `agora` a place developers passively receive value and that grows itself, and turn its informational trust layer into something closer to enforcement.

## Status: Phase 1.5 + 1.6 shipped; 0.4.5 "Destination" cut in progress

The "Destination" pillars (news / community / live marketplace hubs) and the Phase 1.6 polish list landed during 2026-05. Work has now begun on the **0.4.5 "Destination"** cut, sequenced into four waves below. Per release policy we sculpt heavily and bump once per landed cut, not per PR.

---

## The 0.4.5 "Destination" cut — detailed plan

Four waves, sequenced by dependency so each ships value on its own and nothing stalls. Legend: ✓ done · ◑ in progress · ☐ planned.

### Wave 1 — Command excellence & self-growing catalog *(no external accounts required)*

The local layer: make the tool sharper and the catalog able to grow itself.

- ✓ **Cross-session shell memory** — `/recall <query>` searches every past per-cwd transcript; `/sessions` lists recent sessions with turn counts and last activity. Built on the existing transcript store (`src/transcript.ts` → `listSessions` / `searchTranscripts`).
- ✓ **Never-dead daily surface** — `agora today` and the TUI Home news column fall back to recent cached items when nothing is fresh, and show an actionable `agora news --refresh` hint when the cache is empty — never a bare "Nothing in the last 24h."
- ◑ **Compiled standalone binary** — `bun run build:binary` (`bun build --compile`) produces `dist/agora`. The compile works today; *distribution* of the binary (code signing for arm64 macOS, notarization, Homebrew) is deferred to Wave 4.
- ☐ **Harden the AI curator** — `src/curator/` discovers MCP servers/skills from GitHub + HuggingFace and AI-verifies each. Make it robust enough to run unattended: bounded concurrency, resumable progress, dedupe against the bundled catalog, graceful degradation when `opencode` is unavailable, and a clear `agora curate --status`.
- ☐ **Indexed + semantic catalog search** — the in-memory scan is fine at ~67 items, not at thousands. Move offline catalog search to an indexed store and add "find something that does X" intent search so a growing curated catalog stays fast and discoverable.

### Wave 2 — Deploy the backend & schedule curation *(needs: Cloudflare account)*

The single roadmap blocker for the social layer. Everything is coded; this is operational.

- ☐ **One-command, non-technical-friendly deploy** — a scripted `wrangler deploy` plus a secret-setup wizard (GitHub OAuth client, `AUTH_SECRET`, admin ids) so the hosted backend (Cloudflare Workers + D1, in `backend/`) goes live without hand-editing TOML. Production `wrangler.toml`, D1 binding, DNS.
- ☐ **Catalog-as-a-service** — server-side curated catalog so every user gets a fat, fresh, AI-verified marketplace without running AI locally; the bundled JSON stays the offline fallback.
- ☐ **Scheduled server-side curation** — a Cloudflare Cron Trigger re-runs curation weekly so the catalog grows and re-verifies itself for everyone.
- ☐ **Real accounts unlocked** — once live, auth / community / reviews / publishing stop being "configure a backend" and become real for users.

### Wave 3 — Reach: Discord & Telegram *(needs: backend live + bot tokens)*

`agora` goes where developers already are. Both bot modes run on the deployed Worker via inbound webhooks — no always-on server to operate.

- ☐ **Digest broadcast bot** — posts the daily news + trending + new-MCP-servers digest (the `agora today` payload) to a Discord/Telegram channel on the Cloudflare cron. The "passive value" hook the architecture doc anticipated.
- ☐ **Query bot** — `/agora search postgres`, `/agora scan <id>`, `/agora trending` answered inline in Discord (interaction webhook) and Telegram (webhook), reusing the marketplace engine.
- ☐ **Channel abstraction** — a small notifier/channel interface so future surfaces (Slack, RSS, webhook) drop in without bespoke code, mirroring the multi-channel gateway pattern from Hermes Agent / OpenClaw.

### Wave 4 — Trust depth & distribution → release

Turn the informational trust layer toward enforcement, then ship.

- ☐ **Declared-vs-observed permission diff** — inspect an item against its declared manifest (does an MCP server's code touch fs/net/exec it didn't declare?). The remaining Phase 4 check.
- ☐ **`agora doctor` for installed MCP servers** — does each configured server actually start? Does it stay within declared permissions? A pragmatic step toward runtime trust short of a full sandbox.
- ☐ **Signed, distributable binary** — code-sign + notarize the `build:binary` output, a Homebrew tap, and GitHub-release automation so `brew install` / `curl | sh` work alongside `npm`.
- ☐ **0.4.5 version bump + release notes** — finalize the changelog, tag, release.

---

## Longer horizon (beyond 0.4.5)

### Phase 3 — Commerce (deferred until trust lands)

Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`, entitlement-aware `install`, seller-side `publish --price` / `earnings` / `payouts`. Browse stays free and login-free; the wall goes up only at purchase. The `Pricing` type on `Package` is already scaffolded so commerce can drop in without a model change.

### Phase 4 (continued) — Runtime sandbox enforcement

Today the manifest is informational and Wave 4 adds a diff + health check. The end state is spawning installed MCP servers under fs / net / exec restrictions matching what they declared. Shape undecided (Linux namespaces? isolates? npm policies?) — an interesting unscoped problem.

### Phase 5 — Reach & ecosystem

- ☐ **Public web hub** (`hub/`) for discovery / SEO / share links.
- ☐ **VS Code + JetBrains surfaces** consuming the same marketplace core.
- ✓ **MCP server mode** (`agora mcp`) and **free inference chat** (`agora chat`) — shipped 0.4.0.
- ◑ **Multi-channel bots** (Discord / Telegram) — Wave 3 above.

## How to help

- **Add a curated entry to `src/data.ts`** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Every npm entry is verified against the registry.
- **Build a runtime sandbox** for Phase 4 (interesting unscoped problem; tag an issue if you start).
- **Report what `agora init` misses** — open an issue with your project's manifest files.
- **Polish what's there** — there's always a rough edge worth grinding.

_Last updated: 2026-05-20. See [CHANGELOG.md](./CHANGELOG.md) for the shipped history._
