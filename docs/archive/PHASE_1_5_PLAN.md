# Phase 1.5 — "Destination" Implementation Plan

This is the implementation-level companion to [`../ROADMAP.md`](../ROADMAP.md)
Phase 1.5. Each section gives concrete file paths, exported signatures, data
shapes, and verification steps so the work can be split into the PR sequence
in the roadmap without re-deriving design on every PR.

Target outcome: at the end of Phase 1.5, `agora` is a destination. Open it,
read your news, drop into a thread, install a server, all without leaving
the terminal. Version bump `0.4.x → 0.5.0` lands with the final PR.

> **Archived 2026-05-17 — Phase 1.5 is shipped.** This plan was the working
> spec from 2026-05 onward. The six final PRs (live GitHub hub, install
> rework, README enrichment, HuggingFace hub, community deepening, cross-thread
> search) landed on 2026-05-17. Remaining loose ends moved to **Phase 1.6**
> in [ROADMAP.md](../ROADMAP.md) — see the polish section there.

## Repo layout (✓ all shipped)

All planned files are implemented. No `.gitkeep` placeholders remain.

```
src/
├── cli/
│   ├── pages/                 ✓ 5 pages (home, marketplace, community, news, settings)
│   │   ├── types.ts                          Page / KeyEvent / PageAction / PageContext
│   │   ├── helpers.ts                        frame, scrollbar, sep, rail, truncate
│   │   ├── home.ts                           Dashboard
│   │   ├── marketplace.ts                    List + drill-in detail
│   │   ├── community.ts                      Boards → threads → reader
│   │   ├── news.ts                           Ranked feed + reader + AI summarization
│   │   └── settings.ts                       Settings form
│   ├── tui.ts                 ✓  Full-screen frame renderer, alt-screen, key dispatch
│   ├── menu.ts                ✓  Interactive command builder wizard
│   ├── shell.ts               ✓  Interactive shell (+ /terminal, /menu, /tui)
│   └── …existing files unchanged
├── news/                      ✓
│   ├── types.ts                              NewsItem, ScoredNewsItem, NewsConfig
│   ├── score.ts                              scoreItem, rankItems
│   ├── cache.ts                              readCache, writeCache, isStale, readNewsMeta
│   └── sources/                              hn, reddit, github-trending, arxiv
├── community/                 ✓
│   ├── types.ts                              Thread, Reply, Vote, Flag, Board
│   └── client.ts                             communityBoardsSource(), threadsSource(), …
├── preferences.ts             ✓  Local preferences (theme, verbosity, username, etc.)
├── history.ts                 ✓  Search + chat history (JSONL append log)
├── settings.ts                ✓  Settings persistence
└── …existing files unchanged

test/                          ✓
├── news.test.ts                              News scoring, cache, sources
├── history.test.ts                           History persistence
├── preferences.test.ts                       Preferences persistence
└── …existing test files unchanged

backend/
└── src/                       ✓  Community endpoints defined, not yet deployed
    ├── index.ts                              Community endpoints + rate-limit middleware
    └── schema.sql                            D1 schema with votes, flags, kill_switch_log

docs/
├── ARCHITECTURE.md                           Needs status update
├── PHASE_1_5_PLAN.md                         This file (converted to progress tracker)
├── TUI_DESIGN.md                             Historical design reference
└── claude-design-brief*.md                   Archived — served their purpose
```

---

## A. News feed — `agora news` ✓ shipped

### A.1 Types (`src/news/types.ts`) ✓

```ts
export type NewsSource = 'hn' | 'reddit' | 'github-trending' | 'arxiv' | 'rss';

export interface NewsItem {
  id: string;             // stable: `${source}:${nativeId}`
  source: NewsSource;
  title: string;
  url: string;
  author?: string;
  publishedAt: string;    // ISO 8601
  fetchedAt: string;      // ISO 8601
  engagement: number;     // upvotes / stars / replies — source-normalised
  tags: string[];         // lowercase, deduped
  summary?: string;       // 1–2 sentence excerpt where available
}

export interface ScoredNewsItem extends NewsItem {
  score: number;
  scoreBreakdown: { recency: number; engagement: number; topic: number };
}

export interface NewsConfig {
  sources: Record<NewsSource, { enabled: boolean; ttlMinutes: number }>;
  topics: string[];        // weighted keywords
  weights: { recency: number; engagement: number; topic: number };
}
```

### A.2 Scoring (`src/news/score.ts`) ✓

```ts
export function scoreItem(item: NewsItem, config: NewsConfig, now: Date): ScoredNewsItem;
export function rankItems(items: NewsItem[], config: NewsConfig, now: Date): ScoredNewsItem[];
```

Formula (default weights `{ recency: 1.0, engagement: 0.6, topic: 0.8 }`):

```
recency    = e^(-hoursOld / 12)         // 12-hour half-life
engagement = log10(engagement + 1) / 4  // normalised so ~10k upvotes ≈ 1.0
topic      = matched-topic-weight       // 0..1 from topic config
score      = wR · recency + wE · engagement + wT · topic
```

Dedup: by `host(url) + slug(url)`; keep the higher-scoring entry.

### A.3 Cache (`src/news/cache.ts`) ✓

JSONL append-only at `~/.config/agora/news-cache.jsonl`. Helpers:

```ts
export function readCache(dataDir: string): NewsItem[];
export function writeCache(dataDir: string, items: NewsItem[]): void;
export function isStale(items: NewsItem[], source: NewsSource, ttlMinutes: number, now: Date): boolean;
export function readNewsMeta(dataDir: string): NewsMeta;
export function writeNewsMeta(dataDir: string, meta: NewsMeta): void;
```

Eviction: cap at 2000 items, drop oldest `fetchedAt` first. News meta (read/saved marks) persisted in `news-meta.json`.

### A.4 Source adapters (`src/news/sources/*.ts`) ✓

Each adapter exports a single async function:

```ts
export interface SourceAdapter {
  fetch(opts: { fetcher: FetchLike; signal?: AbortSignal }): Promise<NewsItem[]>;
}
```

- **`hn.ts`** — `https://hn.algolia.com/api/v1/search?tags=front_page&numericFilters=points>50`
- **`reddit.ts`** — `https://www.reddit.com/r/{sub}/hot.json?limit=25` for `mcp`, `LocalLLaMA`, `programming`, `MachineLearning`
- **`github-trending.ts`** — scrape `https://github.com/trending/typescript?since=daily` (and `python`); parse with a regex over the `<article>` blocks
- **`arxiv.ts`** — `http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL&sortBy=submittedDate&sortOrder=descending&max_results=25` (Atom)
- **`rss.ts`** — optional, reads `~/.config/agora/news.toml` for user-defined feeds

All adapters: 10s timeout, exponential backoff on 429, no auth required.

### A.5 CLI command (`src/cli/app.ts` → `commandNews`) ✓

```
agora news [query]
  [--source hn|reddit|gh|arxiv|rss]
  [--topic mcp|ai|agents|workflows|...]
  [--limit 20]
  [--reader]            # full-screen TUI reader
  [--refresh]           # force re-fetch of all enabled sources
  [--json]
```

Default (no `--reader`): printed list, accent title, dim source/age/score, one blank line between entries.

### A.6 TUI reader (`src/cli/pages/news.ts`) ✓

The News page in the TUI (`agora tui` → News) provides:
- Category tabs (All, Mcp, Tools, Skills, Llms, Repos, Market, Search) with Tab/Shift+Tab and arrow navigation
- Scrollable ranked list with rail cursor, source label, age, engagement, score
- Detail view on Enter: full metadata, tags, summary
- Preview on `p`: fetches article HTML → strips to text → AI summarizes via `opencode run` → word-wrapped display with scrollbar
- `s` save, `m` mark read, `o` open URL, `/` filter, `r` refresh
- Read/saved marks persist across restarts

### A.7 Shell integration ✓

News is accessible via the TUI (/news), the standalone `agora news` CLI command, and the interactive shell's /search in the REPL.

### A.8 Tests ✓

- `test/news.test.ts` — scoring formula, cache operations, dedup, TTL checks (197 lines).

---

## B. Community hub — `agora community` ✓ CLI shipped, needs backend deploy

### B.1 Backend schema delta (`backend/schema.sql`) ✓

All tables and columns are defined.

### B.2 Backend endpoints (`backend/src/index.ts`) ✓ (defined, not yet deployed)

```
GET  /api/community/boards
GET  /api/community/threads?board=&sort=top|new|active&page=
GET  /api/community/thread/:id              # returns thread + reply tree
POST /api/community/threads                 # auth required
POST /api/community/reply/:parent_id        # auth required
POST /api/community/vote/:id                # auth required, body { value: -1|1, target_type }
POST /api/community/flag/:id                # auth required, body { reason, target_type, notes? }
```

### B.3 CLI commands (`src/cli/app.ts`) ✓

```
agora community                                 # list boards with thread counts
agora community <board> [--sort top|new|active] # list threads
agora thread <id> [--reader]                    # read thread (TUI in --reader)
agora post --board <b> --title <t> --content <c>|--content-file <p>
agora reply <id> --content <c>|--content-file <p>
agora vote <id> --up|--down [--type discussion|reply]
agora flag <id> --reason <r> [--notes <n>] [--type discussion|reply]
```

All write commands require auth (`agora auth login`); they use source helpers
from `src/community/client.ts` and `src/live.ts`.

### B.4 TUI Community page (`src/cli/pages/community.ts`) ✓

Community page in the TUI with boards listing, thread lists, and thread reader
with indented reply trees, vote/flag/reply hotkeys.

### B.5 Tests

- `test/community.test.ts` — boards, sort, votes, flags.

---

## C. Marketplace elaboration (partial)

### C.1 `agora similar <id>` (`src/marketplace.ts`) ✓

```ts
export function similarItems(
  id: string,
  options?: { limit?: number; type?: 'package' | 'workflow' }
): MarketplaceItem[];
```

Implementation: tag-IDF-weighted Jaccard.

```
weight(tag) = log((N + 1) / (1 + df(tag)))    // standard IDF
sim(a, b)   = sum(weight(t) for t in a.tags ∩ b.tags)
            / sum(weight(t) for t in a.tags ∪ b.tags)
```

Returns the top-N excluding `a` itself, tiebreak by `b.installs`.

CLI: `commandSimilar` in `src/cli/app.ts`; also called from `commandBrowse` to append a "Related" section.

### C.2 `agora compare <id1> <id2> [<id3>...]` ✓

`commandCompare` in `src/cli/app.ts`. Renders a box-drawn table:

```
┌─────────────┬─────────────────────┬─────────────────────┐
│             │ mcp-postgres        │ mcp-supabase        │
├─────────────┼─────────────────────┼─────────────────────┤
│ author      │ Anthropic, PBC      │ Supabase            │
│ installs    │ 182.4K              │ 41.2K               │
│ stars       │ 85.6K               │ 9.1K                │
│ updated     │ 2026-01-14          │ 2026-01-22          │
│ tags        │ db, sql, *postgres* │ db, sql, *postgres* │
│ npm package │ @mcp/server-postgres│ @supabase/mcp       │
└─────────────┴─────────────────────┴─────────────────────┘
   shared tags highlighted in accent
```

Shared tags (intersection) render with the accent styler; unique tags dim.

### C.3 Permission manifests (`src/types.ts`) **pending**

```ts
export interface Package {
  // ...existing fields
  permissions?: {
    fs?: string[];    // e.g. ['~/Documents', '/tmp']
    net?: string[];   // e.g. ['api.github.com', 'npmjs.org']
    exec?: string[];  // e.g. ['git', 'npm']
  };
}
```

`agora install <id>` surfaces these before writing config:

```
About to install mcp-github. It declares these permissions:
  net   api.github.com, github.com
  exec  git
Proceed? [y/N]
```

Skippable with `--yes`.

### C.4 `agora flag <id>` for marketplace items **pending**

Reuses the `flags` table from B.1 with `target_type='package'|'workflow'`. CLI: `agora flag <id> --reason <r>`. `agora browse <id>` shows a `[community-flagged: N]` chip when `flag_count` crosses the threshold.

### C.5 Live npm download counts in `scripts/refresh-data.ts` **pending**

Already exists for refreshing data; extend it to:

```
GET https://api.npmjs.org/downloads/point/last-week/<npmPackage>
```

Update `samplePackages[i].installs` from `downloads`. Run as part of the
0.5.0 release prep, not on every CI run.

---

## D. Production-readiness gates

These are blockers for the public backend deploy, not the standalone CLI.

### D.1 Auth rework (`backend/src/index.ts`)

Replace `requireUser` token-as-GitHub-OAuth with:

1. On `POST /auth/device/token` success, issue an Agora JWT signed with
   `AUTH_SECRET` (HS256). Payload: `{ sub: user_id, username, iat, exp }`.
   Default expiry 30 days.
2. Hash GitHub access tokens with SHA-256 + per-user salt before persisting
   in `users.github_access_token_hash`. The plaintext lives in memory for
   the request only.
3. `requireUser` verifies the JWT and loads the user from D1 — no GitHub
   round-trip per request.

### D.2 Rate limiting

Wire the existing `rate_limits` table to a Hono middleware:

```ts
app.use('/api/*', rateLimit({ key: ipOrUserId, limit: 60, window: '1m' }));
app.use('/api/community/threads', { method: 'POST', limit: 5, window: '5m' });
app.use('/api/community/reply/*', { method: 'POST', limit: 30, window: '5m' });
```

Anonymous limits halved.

### D.3 VHS demo

`scripts/demo.tape`:

```
Output docs/demo.gif

Set FontSize 14
Set Width 1200
Set Height 720

Type "agora"
Enter
Sleep 1s
Type "search filesystem"
Enter
Sleep 2s
Type "/news"
Enter
Sleep 3s
Type "q"
Sleep 500ms
Type "/agora install mcp-postgres --write"
Enter
Sleep 3s
Type "/quit"
Enter
```

Generate with `vhs scripts/demo.tape`. Commit `docs/demo.gif` and inline in
README's Demo section.

### D.4 Version bump

Final PR bumps `package.json` `0.4.x → 0.5.0` and adds the `0.5.0` entry
to `CHANGELOG.md`. Per project policy this is the only version bump in
Phase 1.5.

---

## Verification checklist

```bash
bun run lint
bun run typecheck
bun test
bun run build
```

---

_This plan was the Phase 1.5 working spec. Phase 1.5 is substantially shipped
as of v0.4.0 (2026-05-16). See [ROADMAP.md](../ROADMAP.md) for the current
status of remaining items._
