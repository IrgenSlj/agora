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

## Open decisions

1. **TUI shape** — **Decision: hybrid.** Scriptable one-shot commands remain
   the default (all named commands, `--json`, pipes, CI all work as before).
   In addition, `agora` with no command in an interactive TTY launches an
   interactive command browser powered by `@clack/prompts` — pick a command,
   read its manual, repeat. A full-screen Ink TUI is deferred; the hybrid
   covers the browsing use-case without the build complexity.
2. **Sellable unit** — skills/workflows only, or also proprietary MCP servers?
   This shapes `install` and the permission manifest.
3. **Payment model** — per-item Stripe Checkout vs. prepaid credits/wallet.

## Status

- **Phase 1 (standalone hub experience)** — done; sculpting before the next bump.
- **Phase 1.5 ("Destination": news feed + community hub + marketplace
  elaboration)** — designed; sequenced into ~10 PRs in `ROADMAP.md`.
- **Phases 2–5** — see [`../ROADMAP.md`](../ROADMAP.md). Payments (Phase 3) are
  deliberately deferred behind the content and experience work.
