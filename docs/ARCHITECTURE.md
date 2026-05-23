# Architecture & Direction

This document captures *what Agora is becoming* and the reasoning behind it.
For the sequenced plan, see [`../ROADMAP.md`](../ROADMAP.md).

## What Agora is

Agora is a **standalone terminal marketplace** for the agentic-coding ecosystem.
The name is the thesis: the *agora* was the public square of a Greek city —
marketplace and forum at once, where independent merchants traded and the polis
provided the space and the rules. Agora-the-app is the square and the rules; the
developers are the merchants.

The destination is an **open, self-regulating marketplace**: third-party
developers publish and sell advanced skills, tools, and kits, and Agora
facilitates — discovery, trust, payments, delivery — without being the seller.

## The three-surface model

Agora is **one marketplace engine** behind three surfaces:

| Surface | Role | Owns inference? |
|---|---|---|
| **`agora` CLI / TUI** | The primary, standalone experience. Browse, install, manage, (later) buy and publish. | No |
| **OpenCode / Claude Code plugin** | A thin bridge — surfaces the catalog *inside* the harness and installs into the current project. No payment flow. | Uses the host's |
| **`hub/` web app** | Discovery / SEO, account and seller dashboards. | No |

The engine — search, browse, trending, install-plan generation, the offline
catalog — lives in `src/marketplace.ts`, `src/data.ts`, `src/init.ts`. Every
surface is a thin presentation layer over it.

### Why standalone, not "an OpenCode plugin"

The OpenCode plugin API can register *tools* and *hooks* — not slash commands,
not a custom TUI. It was never capable of being the whole product. And it didn't
need to be: `src/cli/app.ts` is already a substantial standalone CLI. So the
plugin is correctly scoped as **one distribution endpoint**, and the CLI is the
product. The `/agora` slash command exists only because `agora init` writes a
command file into the project — the plugin itself cannot create it.

## The inference question

A recurring question: should Agora be a full agentic terminal app like Claude
Code or OpenCode, borrowing their LLM/harness?

**Decision: Agora borrows inference from OpenCode, not from a separate provider.**
Since Agora is built for OpenCode, and OpenCode is already installed and
configured on the user's machine — with its own model, providers, and free-tier
gateway models — the chat layer delegates to `opencode run` rather than requiring
its own API key.

Two surfaces deliver this:

1. **`agora mcp`** — An MCP (Model Context Protocol) server that exposes the
   marketplace engine (search, browse, trending, install-plan, tutorials) as
   standard MCP tools. Users configure it in their `opencode.json`:

   ```json
   {
     "mcp": {
       "agora": {
         "type": "local",
         "command": ["agora", "mcp"]
       }
     }
   }
   ```

   Once registered, any OpenCode session can answer marketplace queries
   conversationally — "find me a postgres MCP server" — by calling Agora's tools
   through the model's tool-use loop. Free inference, no separate auth, and the
   MCP server is useful independently of the chat feature.

2. **`agora chat [message]`** — Two modes:
   - **TUI mode** (`agora chat`): Hands off to the `opencode` TUI with `inherit`
     stdio, giving a persistent read-eval-print loop with conversation history,
     editing, and `/agora` slash commands. Zero per-message latency.
   - **One-shot mode** (`agora chat "question"`): Wraps `opencode run --format json`,
     streams the response back, and persists the session ID for `--continue`.
   - A plugin tool `agora_chat` is also available via `/agora chat <message>`
     inside OpenCode for conversational marketplace Q&A.

Agora still does not *own* inference — it borrows OpenCode's. The marketplace
core (browse, search, install) works fully offline with zero AI. The
conversational layer is an optional convenience, not a foundation.

## Trust is the product

An open marketplace where anyone publishes **executable code that runs on the
buyer's machine** is a supply-chain surface. "Self-regulating" does not mean "no
rules" — the historical agora had inspectors and standardized weights. It means
**mechanism design does the policing** rather than a human gatekeeper:

- **Permission manifests** — each item declares what it touches (filesystem,
  network, process execution); `install` surfaces this like an app-store prompt.
- **Automated scanning on publish** — does the code match its declared
  permissions?
- **Verified-purchase reviews**, install counts, and reputation *earned* over
  time, not granted.
- **Flag/report**, plus a **kill switch** for confirmed malware — the one thing
  pure anarchy cannot do.

This trust layer is arguably Agora's actual product. The listing is commodity;
making a stranger's tool feel safe to install is not.

## Design principles

- **Browse free, authenticate at purchase.** Discovery costs nothing and works
  offline. Friction appears only at the point of commitment.
- **Offline-first is a feature, not a fallback.** The bundled catalog working
  with no backend is a genuine differentiator — kept on purpose, even after the
  hosted backend ships.
- **Honest output.** No fabricated data. Fake `review`/`discussions`/`profile`
  plugin tools were removed in 0.3.x; community features live in the
  backend-backed CLI or not at all.
- **The plugin stays thin.** No payment flow inside an LLM tool call. Purchases
  are CLI/web only.
- **Graceful terminal degradation.** Colour, gradients, and the banner degrade
  cleanly under `NO_COLOR`, `TERM=dumb`, non-TTY pipes, and narrow terminals.

## Destination, not just a tool

Phase 1 made `agora` a polished CLI. Phase 1.5 turns it into a **destination** —
a place a developer opens daily, not a binary they invoke once. That requires
two new surfaces alongside the marketplace, both terminal-native and text-only:

### News feed

The thesis: a developer's "morning read" doesn't need a browser. HN, Reddit's
relevant AI/dev subs, GitHub trending, and arXiv together give you 95% of the
signal in 5% of the noise. Agora aggregates those (free APIs, local cache),
ranks by `recencyW · e^(-h/12) + engagementW · log(eng+1) + topicW · topicMatch`,
and renders a TUI reader you can drive with `j/k/Enter/s/p/?`. Topic weighting
biases toward the agentic-coding world the marketplace serves — MCP, agent
skills, harnesses, Obsidian/markdown.

Why this fits Agora: every story is one hop from a marketplace action. A new
MCP server lands on HN → `agora install <id>` from the reader. The news feed
and the marketplace share the same demographic and the same offline-first
discipline (cache locally, work without internet, refresh on demand).

### Community hub

Reddit's basic shape — boards, threaded replies, votes — but reduced to text
in a terminal. Boards mirror the topics that already drive search:
`/mcp`, `/agents`, `/tools`, `/workflows`, `/show`, `/ask`, `/meta`.

Two opinionated stances:

1. **Flag, don't delete.** Mechanism over moderator. Content with N flags
   collapses behind a chip; users can still expand it. The kill switch is
   reserved for confirmed malware/CSAM/etc. The historical agora had
   inspectors, not censors — the same instinct.
2. **LLMs are welcome, if they say so.** Any account can declare itself
   `is_llm` with a `llm_model` string; their posts render with a `[bot]`
   chip. Undisclosed AI is flaggable. We expect bots to be useful: a
   "what's-new-in-MCP" weekly digest bot, a "fix-this-error" responder bot,
   a per-package release-notes bot. Pretending to be human is the foul,
   not being a bot.

### Trust as the through-line

All three pillars — news, community, marketplace — are content surfaces where
strangers' work appears in front of your eyes (and sometimes runs on your
machine). The same trust mechanism applies:

- Reputation is **earned, not granted** (install counts, post score, age).
- Reviews are **verified-purchase only** once Phase 3 lands.
- Permission manifests gate **executable items** at install time.
- The community gates **public content** via flags + a narrow kill switch.

Phase 1.5 is partly a content release and partly the soft launch of this
trust layer — community moderation in particular is a dry run of the same
flag/score/threshold logic that Phase 4 needs for marketplace items.

## The next step: reach, memory, and a self-growing catalog

Phase 1.5 made `agora` a destination you *can* open daily. The 0.4.3 "Destination"
cut (see [`../ROADMAP.md`](../ROADMAP.md)) makes it one you *want* to — by going
where developers already are, remembering them across sessions, and growing its
own catalog. Three convictions, reinforced by the multi-channel agent gateways
the field is converging on (Hermes Agent, OpenClaw, OpenCode):

- **Be reachable on every channel.** A terminal hub that only exists when you
  type `agora` leaves most of its value on the table. The same digest that powers
  `agora today` should arrive in Discord and Telegram on a schedule, and the
  marketplace engine should answer a `/agora search` from inside those apps. Both
  run on the existing Cloudflare Worker via inbound webhooks — no always-on server.
  A small channel/notifier abstraction keeps Slack, RSS, and webhooks one adapter
  away.
- **Carry memory across sessions.** The shell already records per-cwd transcripts;
  `/recall` and `/sessions` turn that into searchable cross-session memory. This is
  the cheap half of the "closed learning loop" pattern — recall first, summarization
  and skill-extraction later.
- **Let the catalog grow itself.** A hand-fed catalog caps at whatever the
  maintainers curate. The AI curator (`src/curator/`) discovers and verifies items
  from GitHub + HuggingFace; run server-side on a schedule, it makes the catalog a
  living thing every user benefits from — while the bundled JSON stays the
  offline-first fallback.

None of this changes the thesis: the marketplace core works offline with zero AI,
trust is still the product, and the plugin stays thin. Reach, memory, and curation
are amplifiers on a foundation that already stands on its own.

## The daily-driver layer: agent stack manager & capability acquisition

The marketplace, news, and community remain the core — but discovery is an
*occasional* job, and a destination needs a *daily* one. The unlock is to own the
layer the website competitors structurally cannot: the developer's actual agent
configuration, and the moment an agent reaches for a new capability.

**Agent stack manager.** Every agent tool — OpenCode, Claude Code, Cursor,
Windsurf — keeps its MCP servers in a different config file and format. No one owns
the universal layer. `agora` does, via `src/stack/`, structured like `src/hubs/`:
one `ToolAdapter` per tool normalizes its config into a single `ConfiguredServer`
shape. On top of that:

- `agora installed` / `agora doctor` — one view of every configured MCP server
  across all tools, and a health check (config parses, command resolvable on
  `PATH`, conflicting definitions, optional `--probe` to actually start it).
- `agora.toml` + `agora sync` — a declarative manifest of the servers / skills /
  workflows you want, reconciled into each tool's real config. The Brewfile for
  your agent stack: reproducible, shareable ("clone someone's setup"), and the
  on-ramp from *using* the catalog to *publishing* to it.

This is the daily loop that ties the pillars together: discover in the
marketplace → `install` → `sync`/`doctor` keep it healthy → publish back →
discuss in the community.

**Capability acquisition for autonomous agents.** `agora mcp` already makes the
marketplace queryable by an agent mid-task. The end state: an autonomous agent
hits a capability gap → calls `agora` for a *verified* server → the scan gate
enforces "don't install unvetted code" → `install` writes the config → the agent
proceeds. `agora` is the **safe capability-acquisition gateway** — the policy
checkpoint between an autonomous agent and arbitrary executable code. The trust
layer is what makes that defensible; nobody should let an agent `npm install`
random MCP servers unmediated.

## The algorithms (fast, offline, original)

`agora` stays snappy and offline-first by design, not by luck:

- **BM25 capability/catalog search** (`src/search/catalog-index.ts`) — a
  no-dependency inverted index with field weighting and query-side synonym
  expansion replaces the linear scan, so search stays fast as the catalog grows.
  The original extension (next): index MCP servers' *declared tool schemas* and
  rank by capability overlap, not README keywords.
- **SHA-keyed memoized re-curation** — the curator caches AI verdicts against
  `version=commitSha`, so the weekly server-side cron re-verifies only what
  changed: curation cost scales with churn, not catalog size.
- **Composed trust score** — a Bayesian blend of the LLM genuineness verdict,
  mechanical quality signals (`src/hubs/quality.ts`), and opt-in install-retention
  telemetry. Earned reputation for catalog items, with no human curator.
- **News ranking** — `recencyW·e^(-h/12) + engagementW·log(eng+1) + topicW·topicMatch`,
  to be extended with LLM dedup/clustering and a topic-weight bandit.
- **Offline-first, content-addressed caches** throughout (hub cache by
  `repo@sha`, curation cache, news cache) and a `bun --compile` binary for instant
  startup.

## Open decisions

1. **Sellable unit** — skills/workflows only, or also proprietary MCP servers? This shapes both `install` and the permission manifest.
2. **Payment model** — per-item Stripe Checkout vs. prepaid credits/wallet.
3. **Runtime sandbox shape** — the declared permission manifest is currently informational. Phase 4 will enforce it at runtime; the shape (Linux namespaces? Cloudflare-style isolates? Bun's `--prefer-offline` + `npm`'s built-in policies?) is undecided.

## Status

- **Phase 1 (standalone hub experience)** — done.
- **Phase 1.5 + 1.6 ("Destination" pillars + polish)** — shipped end-to-end. News feed (5 sources + AI summarization), community hub (boards, threads, votes, flags, FTS5 search, kill-switch), live marketplace hubs (GitHub + HuggingFace), reputation calc + sort weighting, permission-manifest display + install acknowledgment.
- **Phase 2 (backend & accounts)** — feature-complete; deploy blocked on rate-limit middleware + production wrangler config. See [`../ROADMAP.md`](../ROADMAP.md).
- **Phase 3 (commerce)** — deferred behind Phase 4 trust work. `Pricing` type on `Package` is scaffolded; the paid branch is a typed no-op.
- **Phase 4 (trust & self-regulation)** — in progress. Display + acknowledgment + earned reputation + flag/kill-switch + client/server scan shipped; declared-vs-observed permission diff and runtime sandbox enforcement remain (0.4.3 Wave 4).
- **Phase 5 (reach)** — `agora mcp` and `agora chat` shipped in 0.4.0; Discord/Telegram bots are 0.4.3 Wave 3; public web hub and IDE surfaces are future work.
- **0.4.3 "Destination" cut** — **shipped 2026-05-23.** Wave 1 (cross-session shell memory `/recall` · `/sessions`, never-dead daily surface, `build:binary` script, hardened AI curator, indexed BM25 catalog search) plus the agent stack manager and local capability search below. Backend deploy, multi-channel bots, and trust-depth enforcement are the next milestone. See [`../ROADMAP.md`](../ROADMAP.md).
- **Agent stack manager** (`src/stack/`) — **shipped 0.4.3.** The cross-tool adapter layer (opencode / Claude Code / Cursor / Windsurf) behind `agora installed` · `doctor [--probe]` · `freeze` · `sync [--from]` · `install --save` · `try` · `capabilities`, a TUI Stack page, and read-only `agora mcp` introspection tools. Tool schemas discovered via a minimal MCP stdio client (`src/stack/mcp-probe.ts`) feed a local capability cache. The daily-driver layer on top of the marketplace; catalog-wide capability search follows once the backend lands. See [`../ROADMAP.md`](../ROADMAP.md).
