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

## Phase 1.5 — "Destination" (next, in design)

Phase 1 made `agora` look and feel like a polished standalone CLI. Phase 1.5
makes it a **place you spend time** — a hub, not a tool you invoke. Three
pillars, each shippable on its own, sequenced to land before backend deploy.

### Pillar A — News feed (`agora news`)

Curated tech-news feed for the agentic-coding ecosystem, terminal-native and
text-only. Built so a developer can open it as a daily habit alongside their
shell.

- **Sources** (all free, all rate-limited, all cached locally):
  - **Hacker News** via the Algolia API (`hn.algolia.com/api/v1/search`)
  - **Reddit JSON** — `/r/{mcp,LocalLLaMA,programming,MachineLearning}.json`
  - **GitHub Trending** — scrape `github.com/trending` (30-min TTL, respect robots.txt)
  - **arXiv** — Atom feed for `cs.AI`, `cs.CL`
  - Optional **RSS** feeds configured in `~/.config/agora/news.toml`
- **Algorithm** (`src/news/score.ts`):
  `score = recencyW · e^(-hoursOld/12) + engagementW · log(engagement+1) + topicW · topicMatch`,
  default weights `1.0 / 0.6 / 0.8`. Dedupe by URL host+slug.
- **Topics**: MCP, AI tooling, agent skills, harnesses, Obsidian / markdown
  ecosystem, AI research.
- **Storage**: cache in `~/.config/agora/news-cache.jsonl`; per-source TTL.
  Background refresh on stale.
- **TUI**:
  - `agora news` → top 20 list (default), one accent line per story, dim source/age.
  - `agora news --reader` → full-screen reader: `j`/`k` navigate, `Enter` opens
    URL via `open`/`xdg-open`, `s` to save, `p` to mark read, `/` to filter.
  - `agora news --source hn|reddit|gh|arxiv`, `--topic <tag>`, `--json`.
  - In the interactive shell, `/news` opens the reader without leaving the REPL.
- **Files**:
  `src/news/{score,cache,types}.ts`, `src/news/sources/{hn,reddit,github-trending,arxiv}.ts`,
  `src/cli/news-reader.ts`, `test/news.test.ts`, `test/news-reader.test.ts`.

### Pillar B — Community hub (`agora community`)

Reddit-style, text-only, threaded community where developers and self-identified
LLMs/bots exchange ideas around the same topics that drive the marketplace.

- **Boards** (initial set): `/mcp`, `/agents`, `/tools`, `/workflows`,
  `/show`, `/ask`, `/meta`.
- **Backend schema additions** (in `backend/schema.sql`):
  - extend `discussions` with `board`, `parent_id`, `score`;
  - new `votes` (user × target × ±1) and `flags` (target, reporter, reason);
  - extend `users` with `is_llm` boolean and `llm_model` text.
- **Endpoints**:
  - `GET  /api/community/boards`
  - `GET  /api/community/threads?board=&sort=top|new|active`
  - `GET  /api/community/thread/:id` (returns full reply tree)
  - `POST /api/community/threads` (auth)
  - `POST /api/community/reply/:parent_id` (auth)
  - `POST /api/community/vote/:id` (auth, ±1)
  - `POST /api/community/flag/:id` (auth)
- **CLI commands**: `agora community`, `agora community <board>`, `agora thread <id>`,
  `agora post --board <b> --title <t> --content <c>`, `agora reply <id> --content <c>`,
  `agora vote <id> --up|--down`, `agora flag <id> --reason <r>`.
- **TUI thread reader** (`src/cli/thread-reader.ts`): indented reply tree
  with `│ ` depth guides, hotkeys `j/k` navigate, `Enter` expand/collapse,
  `r` reply (opens `$EDITOR`), `v` vote, `f` flag. `[bot]` chip for `is_llm`
  authors.
- **Moderation philosophy**: **flag, don't delete.** Content with N flags
  collapses behind a `[flagged: N]` chip; users can expand it. A kill switch
  remains for confirmed malware/CSAM/etc.; everything else is community-driven.
  Codified in [`COMMUNITY_GUIDELINES.md`](./COMMUNITY_GUIDELINES.md).
- **LLM participation**: any account can be marked `is_llm=true` with a
  declared model. Bot posts render with a `[bot · gpt-4o-mini]`-style chip.
  Bots that don't self-identify are flaggable as "undisclosed AI."

### Pillar C — Marketplace elaboration

Make the existing marketplace the strongest part of the app.

- **`agora similar <id>`** — Jaccard similarity over `item.tags`, weighted by
  tag rarity (IDF), top 5 results. ~30 lines in `src/marketplace.ts`,
  surfaced as a "Related" section in `agora browse <id>`.
- **`agora compare <id1> <id2> [<id3>...]`** — side-by-side table:
  name, author, installs, stars, last updated, tags, license, npm package,
  shared tags highlighted.
- **`agora flag <id>`** — marketplace-side flag-don't-delete for packages
  and workflows, surfaces a community-flagged chip on `browse`.
- **Permission manifests** — add `permissions: { fs?, net?, exec? }` to the
  `Package` type, display on `install` as an app-store-style prompt.
- **Automated publish scan** — backend pre-publish check: parse the npm
  package's `package.json` for `postinstall`/`preinstall` scripts and basic
  static heuristics; flag mismatches with the declared manifest.
- **Live npm download counts** — `scripts/refresh-data.ts` already exists;
  extend it to hit `api.npmjs.org/downloads/point/last-week/<pkg>` and update
  `samplePackages[].installs` before each release.

### Production-readiness gates (block backend deploy)

1. **Auth rework** — replace raw GitHub OAuth bearer in `backend/src/index.ts`
   `requireUser` with Agora-issued JWTs and hashed-token storage. (Marked
   `// SECURITY:` in the source; `SECURITY.md` tracks it.)
2. **Rate limiting middleware** — `rate_limits` table already exists; wire
   it to every write endpoint and to anonymous-search past N req/min.
3. **`COMMUNITY_GUIDELINES.md`** committed before community endpoints go live.
4. **Demo recording** — VHS tape (`scripts/demo.tape`) checked in, generated
   `docs/demo.gif` inlined into README.
5. **Version bump 0.4.x → 0.5.0** — the "Destination" release. Per policy
   we bump only once Phase 1.5 lands fully; do not bump per-PR.

### Sequencing (proposed PRs)

| PR | Scope | Approx size |
|---|---|---|
| 1 | Docs refresh + `SECURITY.md` + `COMMUNITY_GUIDELINES.md` | ~200 |
| 2 | `/agora` slash hotfix in shell + regression tests | done (this PR) |
| 3 | `agora similar` + `agora compare` + "Related" in `browse` | ~210 |
| 4 | News feed core: types, scoring, cache, fixture-based command | ~500 |
| 5 | News feed live adapters (HN, Reddit, GH trending, arXiv) | ~350 |
| 6 | News TUI reader + `/news` shell integration | ~200 |
| 7 | Backend community schema + endpoints | ~450 |
| 8 | CLI community commands (`community`, `thread`, `post`, `reply`, `vote`, `flag`) | ~450 |
| 9 | Community TUI thread reader | ~200 |
| 10 | Permission manifests + `agora flag` for marketplace items | ~250 |
| 11 | Backend auth rework + rate-limit middleware | ~200 |
| 12 | VHS demo tape + README hero gif + 0.5.0 bump | ~50 |

## Phase 1 — The standalone hub experience (current)

- **Flat-minimal CLI restyle.** A cohesive look across every command — accent
  identifiers, dim metadata, plain body text. _Done (`src/ui.ts`)._
- **`agora use` / `agora tutorial` without id** now lists available items
  instead of erroring. _Done (`app.ts` `commandUse` / `commandTutorial`)._
- **Gradient wordmark banner** shown on `agora` with no arguments — warm cream →
  terracotta → deep brick gradient across carved-relief letterforms. _Done.
  NO_COLOR fallback: compact text header instead of flat block characters._
- **NO_COLOR welcome fix.** Non-TTY/pipe/CI users now get a clean text greeting
  instead of a washed-out block-character banner. _Done (`app.ts` `welcome()`)._
- **Arrow key fix.** `[` (0x5b) was miscategorized as a CSI final byte, causing
  arrow keys to print escape letters instead of navigating cursor/history.
  _Done (`prompter.ts`)._
- **`/quit` no longer hangs.** stdin stayed in flowing mode after prompter cleanup,
  keeping the event loop alive after `break`. Added `inp.pause()` + `process.exit()`.
  _Done (`prompter.ts`, `cli.ts`)._
- **`/clear` reprints home banner.** Clears screen then redraws wordmark, motto,
  version, and slash-command bar — a proper home state. _Done (`shell.ts`)._
- **Footer shows model name + rotating tips.** Replaced unhelpful turn-count with
  `model: deepseek-… · type /help to see all slash commands`. 17 tips, stable per
  turn. _Done (`shell.ts`)._
- **Auto-complete slash commands on `/`.** Type `/` and completions appear in the
  footer immediately, narrowing with each character. No Tab needed. _Done
  (`prompter.ts`)._
- **`--sort`, `--order`, `--table`, pagination flags** on `agora search` and
  `agora trending`. Sort by stars/installs/name/updated, render box-drawn tables,
  paginate with `--page` / `--per-page`. _Done (`marketplace.ts`, `app.ts`)._
- **Catalog growth.** More MCP servers, more workflows, more tutorials in the
  offline data. _Done: 60+ MCP servers, 12 workflows, 12 tutorials, 7 prompts._
- **Demo recording.** Asciinema/VHS recording of the standalone CLI.
- **"Last refreshed" stamp** on bundled data so users know how fresh it is.
  _Done (`data.ts` `dataRefreshedAt`)._
- **npm package validation.** All 60+ catalog npmPackage entries verified live
  against the npm registry; entries without published packages retain browsable
  status but are marked uninstallable. _Done (test suite, network-gated)._
- **login/logout/whoami aliases.** CLI aliases that delegate to `auth` subcommand.
  _Done (`app.ts`)._

## Phase 2 — Backend & accounts

- **Hosted backend.** Deploy `backend/` so profiles, reviews, discussions, and
  publishing work out of the box. **Prerequisite:** rework auth — device-code
  login flow, short-lived Agora-issued JWTs, hashed token storage, explicit
  registration. _Done (see `src/cli/app.ts` `commandAuth`, `state.ts`
  `setAuthState`, `backend/src/index.ts`)._
- **Local dev: Docker Compose** for running the backend locally with wrangler's
  D1 SQLite emulation. _Done (`backend/Dockerfile`, `docker-compose.yml`)._
- **Catalog as a service.** The catalog becomes a real API; the bundled JSON
  stays as the offline fallback — a genuine strength, kept on purpose.
  _CLI `sourceOptions` already supports automatic API-first with offline
  fallback when `--api`, `AGORA_API_URL`, or stored credentials are set._
- **Real reviews & ratings** — verified-purchase only, replacing the fabricated
  plugin tools that were removed in 0.3.x. _API endpoints exist in `backend/`;
  CLI `review` / `reviews` commands ready._

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

## How to help

- **Add an MCP server, workflow, or tutorial to the offline catalog.** See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Report a setup that `agora init` misses.** Open an issue with your project's manifest files.
- **Polish the standalone CLI experience.** Phase 1 is wide open.

_Last updated: 2026-05-15 · Phase 1.5 "Destination" plan added (news feed, community hub, marketplace elaboration). Phase 1 status unchanged._
