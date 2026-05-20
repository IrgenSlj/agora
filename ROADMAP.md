# Roadmap

Where `agora` is headed. For the *why* — the three-surface model, the open-marketplace vision, the inference question — see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). For what's already shipped, see [`CHANGELOG.md`](./CHANGELOG.md).

## Direction

`agora` is a **standalone terminal marketplace hub**. The OpenCode plugin is one surface, not the product. The destination is an **open, self-regulating marketplace** where third-party developers publish and sell skills, tools, and kits — `agora` provides discovery, trust, and delivery; the developers bring the goods. Payments are deliberately deferred to Phase 3; everything before that focuses on making the hub good on its own.

## Status: Phase 1.5 + 1.6 shipped

The "Destination" pillars — news / community / live marketplace hubs — landed end-to-end during 2026-05-17, and the Phase 1.6 polish list (HuggingFace README enrichment, FTS5 search cutover, kill-switch operator UI, reputation calc + sort weighting, permission-manifest display + acknowledgment) closed shortly after. The next named cut is **0.5.0 "Destination"**; see the open work below.

## Phase 2 — Backend & accounts (mostly shipped, deploy gated)

Most of the work landed during 0.4.x / Phase 1.5; what blocks a public-hosted backend is operational rather than feature work.

- ✓ Hosted-backend codebase (Cloudflare Workers + D1 in `backend/`)
- ✓ Auth rework — device-code login, short-lived JWTs, hashed token storage
- ✓ Local dev: Docker Compose with wrangler's D1 SQLite emulation
- ✓ Catalog-as-a-service: bundled JSON stays as the offline fallback
- ✓ Real reviews / ratings / publishing endpoints
- ✓ **Rate-limit middleware**: applied globally to `/api/*` with separate read (60/min) and write (10/min) buckets; anonymous half-quota in `backend/src/index.ts`
- ☐ **Hosted deploy**: production wrangler config, env secrets, DNS

## Phase 3 — Commerce (deferred until trust lands)

Stripe Connect (Agora as marketplace operator), `agora buy`, `agora library`, entitlement-aware `install`, seller-side `publish --price` / `earnings` / `payouts`. Browse stays free and login-free; the wall goes up only at purchase. The `Pricing` type on `Package` is already scaffolded so commerce can drop in without a model change.

## Phase 4 — Trust & self-regulation (in progress)

The actual product. An open marketplace of executable code is a supply-chain surface — mechanism design does the policing, not a gatekeeper:

- ✓ **Permission manifests per item** (fs / network / exec), shown at install like an app-store prompt — display + acknowledgment shipped (TUI flips to `g grant + install / d details`, CLI `--write` requires `--yes`)
- ✓ **Earned (not granted) reputation** — recompute + thread-sort weighting shipped
- ✓ **Flag/report + kill switch** for confirmed malware — auto-collapse at 3 flags, auto-hide at 10, operator `agora admin hide` with public audit log
- ✓ **Automated scan on publish** — client side: `agora scan <id>` (CLI + MCP tool + TUI `S` key) and a scan gate on `agora install --write`. Server side: `POST /api/packages` runs `runPublishScan` (npm existence + github repo reachability) and rejects a definitive 404 with 422; admins can bypass via `skipScan` for registry-propagation false positives. Deeper checks (license, README, declared-vs-observed permissions) remain a follow-up.
- ☐ **Runtime sandbox enforcement** — today the manifest is informational. Future: spawn installed MCP servers under fs / net / exec restrictions matching what they declared
- ☐ **Verified-purchase reviews** — gated on Phase 3 commerce

## Phase 5 — Reach & ecosystem

- ☐ **Public web hub** for discovery / SEO / share links
- ☐ **VS Code + JetBrains surfaces** consuming the same marketplace core
- ✓ **MCP server mode** (`agora mcp`) — marketplace as an MCP server (shipped 0.4.0)
- ✓ **Free inference chat** (`agora chat`) via `opencode` — TUI + one-shot + plugin tool (shipped 0.4.0)

## Toward 0.5.0 "Destination" cut

Small, focused items remaining before the cut:

| Item | Notes |
|---|---|
| ◐ VHS demo tape + README hero gif | `scripts/demo.tape` scaffold landed; `docs/demo.gif` is regenerated on demand via `vhs scripts/demo.tape` (output gitignored) |
| ✓ Automated publish scan (Phase 4) | Client `agora scan` + install gate, MCP/TUI surfaces, and backend `runPublishScan` on `POST /api/packages` all shipped; deeper license/README/permission-diff checks remain |
| ☐ 0.5.0 version bump + release notes | Per policy: one bump per landed phase, not per PR |

## How to help

- **Add a curated entry to `src/data.ts`** — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Every npm entry is verified against the registry.
- **Build a runtime sandbox** for Phase 4 (interesting unscoped problem; tag an issue if you start).
- **Report what `agora init` misses** — open an issue with your project's manifest files.
- **Polish what's there** — there's always a rough edge worth grinding.

_Last updated: 2026-05-19. See [CHANGELOG.md](./CHANGELOG.md) for the shipped history._
