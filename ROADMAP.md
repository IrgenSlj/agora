# Roadmap

Where Agora is headed. For the *why* behind this — the three-surface model, the
open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## The direction

Agora is a **standalone terminal marketplace hub**. The OpenCode plugin is one
surface, not the product. The destination is an **open, self-regulating
marketplace** where third-party developers publish and sell advanced skills,
tools, and kits — Agora provides discovery, trust, and delivery; the developers
bring the goods.

**Payments are deliberately deferred.** Phases 1–2 below focus entirely on the
content and the standalone experience. Commerce comes after the hub is good on
its own.

## Phase 1 — The standalone hub experience (current)

- **Flat-minimal CLI restyle.** A cohesive look across every command — accent
  identifiers, dim metadata, plain body text. _In progress (`src/ui.ts`)._
- **Gradient wordmark banner** shown on `agora` with no arguments. _Done — placeholder art; final wordmark + palette pending design handoff (`docs/claude-design-brief.md`)._
- **Catalog growth.** More MCP servers, more workflows, more tutorials in the
  offline data.
- **Demo recording.** Asciinema/VHS recording of the standalone CLI.
- **"Last refreshed" stamp** on bundled data so users know how fresh it is.

## Phase 2 — Backend & accounts

- **Hosted backend.** Deploy `backend/` so profiles, reviews, discussions, and
  publishing work out of the box. **Prerequisite:** rework auth first — the
  current backend uses the raw GitHub OAuth token as the API bearer credential
  (plaintext storage, implicit account creation). Replace with short-lived
  Agora-issued JWTs, hashed token storage, explicit registration, and a
  device-code login flow (`agora login`, not token paste). See the
  `// SECURITY:` note in `backend/src/index.ts`.
- **Catalog as a service.** The catalog becomes a real API; the bundled JSON
  stays as the offline fallback — a genuine strength, kept on purpose.
- **Real reviews & ratings** — verified-purchase only, replacing the fabricated
  plugin tools that were removed in 0.3.x.

## Phase 3 — Commerce (deferred)

- Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`,
  entitlement-aware `install`, seller-side `publish --price` / `earnings` /
  `payouts`. Browse stays free and login-free; the wall goes up only at purchase.

## Phase 4 — Trust & self-regulation

The actual product. An open marketplace of executable code is a supply-chain
surface — mechanism design does the policing, not a gatekeeper:

- Permission manifests per item (fs / network / exec), shown at install like an
  app-store prompt
- Automated scan on publish — does the code match its declared permissions?
- Verified-purchase reviews, install counts, earned (not granted) reputation
- Flag/report, and a kill switch for confirmed malware

## Phase 5 — Reach & optional agentic polish

- Public web hub for discovery/SEO, seller dashboards
- VS Code / JetBrains surface
- **MCP server mode** (`agora mcp`) — All marketplace tools available as
  standard MCP tools. Add to opencode.json for conversational marketplace
  queries from any OpenCode session. _Done in 0.4.0._
- **Free inference chat** (`agora chat`) — Delegates to `opencode` in two modes:
  - **TUI mode** (`agora chat`): Full `opencode` TUI with `inherit` stdio —
    persistent REPL, conversation history, editing, `/agora` commands.
    Zero per-message latency.
  - **One-shot mode** (`agora chat "question"`): Single query via `opencode run`.
  - Plugin tool (`/agora chat "question"`) available from inside OpenCode.
  _Done in 0.4.0._
2. **Sellable unit** — skills/workflows only, or also proprietary MCP servers?
3. **Payment model** — per-item Checkout vs. prepaid credits/wallet.

## How to help

- **Add an MCP server, workflow, or tutorial to the offline catalog.** See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Report a setup that `agora init` misses.** Open an issue with your project's manifest files.
- **Polish the standalone CLI experience.** Phase 1 is wide open.

_Last updated: 2026-05-14_
