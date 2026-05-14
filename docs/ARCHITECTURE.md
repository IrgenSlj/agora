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

**Decision: the hub does not own inference.** A marketplace is a marketplace —
browsing, buying, installing, and publishing want no LLM. `brew` is an excellent
terminal experience with zero AI. The agentic work happens *after*, inside
OpenCode or Claude Code, on the skills and tools Agora delivered. Agora feeds the
harness; it does not compete with it.

**If** a conversational layer is wanted later (smart `init`, interactive
tutorials), it is an opt-in Phase 5 dependency, not a foundation. Options, in
order of preference:

1. **Claude Agent SDK** — Claude Code's harness available as a library (TS +
   Python): agentic loop, tool use, MCP, permissions. The user brings their own
   API key or existing auth.
2. **OpenCode headless** — OpenCode is MIT-licensed; it can be scripted as a
   subprocess. More DIY.
3. **Direct Anthropic API** — for one-shot, non-agentic tasks (e.g. "summarize
   this tool"); no harness needed.

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

## Open decisions

1. **TUI shape** — styled one-shot commands (scriptable, current) vs. a
   full-screen interactive TUI (Ink — a real build) vs. hybrid (`agora` with no
   args launches a browse mode).
2. **Sellable unit** — skills/workflows only, or also proprietary MCP servers?
   This shapes `install` and the permission manifest.
3. **Payment model** — per-item Stripe Checkout vs. prepaid credits/wallet.

## Status

- **Phase 1 (standalone hub experience)** — in progress.
- **Phases 2–5** — see [`../ROADMAP.md`](../ROADMAP.md). Payments (Phase 3) are
  deliberately deferred behind the content and experience work.
