# Phase 1.5 — "Destination" Implementation Plan

This is the implementation-level companion to [`../ROADMAP.md`](../ROADMAP.md)
Phase 1.5. Each section gives concrete file paths, exported signatures, data
shapes, and verification steps so the work can be split into the PR sequence
in the roadmap without re-deriving design on every PR.

Target outcome: at the end of Phase 1.5, `agora` is a destination. Open it,
read your news, drop into a thread, install a server, all without leaving
the terminal. Version bump `0.4.x → 0.5.0` lands with the final PR.

> Implementation notes follow the project's delegation pattern: design and
> verification done by the lead; mechanical file edits and test writing
> delegated to a sonnet implementer per PR. Specs below are written to be
> self-contained for that handoff.

## Repo layout after Phase 1.5

Empty directories (`.gitkeep` placeholders) are already scaffolded; each
upcoming PR fills its slot without needing to touch unrelated paths.

```
src/
├── cli/
│   ├── pages/                 [scaffolded]  ← Claude Design deliverables (TUI brief)
│   │   ├── types.ts                          Page / KeyEvent / PageAction contract
│   │   ├── home.ts                           Recommendation engine
│   │   ├── marketplace.ts                    List + drill-in detail
│   │   ├── community.ts                      Boards → threads → reader
│   │   ├── news.ts                           Ranked feed + reader
│   │   └── settings.ts                       Form-style toml editor
│   ├── tui.ts                 [from Claude Design] Frame renderer, alt-screen, key dispatch
│   ├── news-reader.ts         [PR 5]          Full-screen news reader (callable from shell `/news`)
│   ├── thread-reader.ts       [PR 8]          Full-screen thread reader with indented tree
│   └── …existing files unchanged
├── news/                      [scaffolded]   Phase 1.5 PRs 3-4
│   ├── types.ts                              NewsItem, ScoredNewsItem, NewsConfig (§ A.1)
│   ├── score.ts                              scoreItem, rankItems (§ A.2)
│   ├── cache.ts                              readCache, writeCache, isStale (§ A.3)
│   └── sources/                              SourceAdapter implementations
│       ├── hn.ts
│       ├── reddit.ts
│       ├── github-trending.ts
│       ├── arxiv.ts
│       └── rss.ts
├── community/                 [scaffolded]   Phase 1.5 PRs 7-8
│   ├── types.ts                              Thread, Reply, Vote, Flag, Board
│   └── client.ts                             communityBoardsSource(), threadsSource(), …
├── settings.ts                [PR (with settings page)] toml parser + AgoraSettings I/O
└── …existing files unchanged

test/
├── fixtures/
│   ├── news/                  [scaffolded]   HN JSON, Reddit JSON, GH trending HTML, arXiv Atom
│   ├── community/             [scaffolded]   thread-tree fixtures (boards, replies, flags)
│   └── …existing init/marketplace fixtures unchanged
└── …existing test files unchanged

backend/
└── src/                       PRs 6 + 11
    ├── index.ts                              Add community endpoints (§ B.2) + rate-limit middleware (§ D.2)
    └── community/                            New subdirectory for vote/flag/score helpers if router grows

scripts/
├── refresh-data.ts                           Extend with npm-downloads fetch (§ C.5)
└── demo.tape                  [PR 12]        VHS demo recording script

docs/
├── ARCHITECTURE.md                           Updated
├── PHASE_1_5_PLAN.md                         This file
├── TUI_DESIGN.md                             Brainstorm doc
├── claude-design-brief-tui.md                Paste-ready prompt for Claude Design
└── claude-design-brief.md                    Original wordmark/palette brief (kept for reference)
```

The scaffolded directories ship in PR 1 alongside the docs refresh; everything
under `[scaffolded]` already exists in the tree, populated with a single
`.gitkeep` file that the first real file in each directory will replace.

---

## A. News feed — `agora news`

### A.1 Types (`src/news/types.ts`)

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

### A.2 Scoring (`src/news/score.ts`)

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

### A.3 Cache (`src/news/cache.ts`)

JSONL append-only at `~/.config/agora/news-cache.jsonl`. Helpers:

```ts
export function readCache(dataDir: string): NewsItem[];
export function writeCache(dataDir: string, items: NewsItem[]): void;
export function isStale(items: NewsItem[], source: NewsSource, ttlMinutes: number, now: Date): boolean;
```

Eviction: cap at 2000 items, drop oldest `fetchedAt` first.

### A.4 Source adapters (`src/news/sources/*.ts`)

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

### A.5 CLI command (`src/cli/app.ts` → `commandNews`)

```
agora news [query]
  [--source hn|reddit|gh|arxiv|rss]
  [--topic mcp|ai|agents|workflows|...]
  [--limit 20]
  [--reader]            # full-screen TUI reader
  [--refresh]           # force re-fetch of all enabled sources
  [--json]
```

Default (no `--reader`): printed list, accent title, dim source/age/score, one blank line between entries. Output goes through the same `header(...)` and `style.dim(...)` helpers used by `search`.

### A.6 TUI reader (`src/cli/news-reader.ts`)

Full-screen alt-screen mode (`\x1b[?1049h`), raw-mode keys via the existing prompter primitives. Layout:

```
 ╭─ agora news · top stories · 23 items ────────────────────────╮
 │ ▌ 1. MCP servers in production: a year later                 │
 │   HN · 12h · ↑ 482 · score 1.72                              │
 │   2. Reddit /r/mcp — Best local model for tool use today?    │
 │   reddit · 4h · ↑ 86  · score 1.41                           │
 │ ...                                                           │
 ╰───────────────────────────────────────────────────────────────╯
   j/k navigate · Enter open · s save · p mark read · /search · q quit
```

Hotkeys: `j`/`k` next/prev, `g`/`G` top/bottom, `Enter` opens URL via `open` (macOS) / `xdg-open` (Linux), `s` saves to `~/.config/agora/news-saved.jsonl`, `p` marks read, `/` filter, `q` quit (restore screen).

### A.7 Shell integration

Add `/news` as a slash meta in `src/cli/shell.ts` classifier; opens the TUI reader inline (returns to REPL on quit). Auto-refresh in the background if any source is stale on shell start; show a `news: 3 unread` chip in the footer rotation.

### A.8 Tests

- `test/news.test.ts` — scoring formula table-driven, dedup, cache TTL.
- `test/news-sources.test.ts` — parser tests against committed fixtures in `test/fixtures/news/*.{json,html,xml}` (no network).
- `test/news-network.test.ts` — gated on `AGORA_NETWORK_TESTS=1`; one item from each live source.

---

## B. Community hub — `agora community`

### B.1 Backend schema delta (`backend/schema.sql`)

```sql
-- Boards are a fixed enum for v1; no separate table.
ALTER TABLE discussions ADD COLUMN board TEXT NOT NULL DEFAULT 'meta';
ALTER TABLE discussions ADD COLUMN parent_id TEXT;     -- for top-level threads: NULL
ALTER TABLE discussions ADD COLUMN score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discussions ADD COLUMN flag_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_discussions_board ON discussions(board, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_parent ON discussions(parent_id);

CREATE TABLE IF NOT EXISTS votes (
  user_id     TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('discussion','reply')),
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, target_id, target_type)
);

CREATE TABLE IF NOT EXISTS flags (
  id          TEXT PRIMARY KEY,
  target_id   TEXT NOT NULL,
  target_type TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('spam','harassment','undisclosed-llm','malicious','other')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flags_target ON flags(target_id, target_type);

ALTER TABLE users ADD COLUMN is_llm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN llm_model TEXT;

CREATE TABLE IF NOT EXISTS kill_switch_log (
  id           TEXT PRIMARY KEY,
  target_id    TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  operator_id  TEXT NOT NULL,
  acted_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Boards (enum, validated server-side): `mcp`, `agents`, `tools`, `workflows`, `show`, `ask`, `meta`.

### B.2 Backend endpoints (`backend/src/index.ts`)

```
GET  /api/community/boards
GET  /api/community/threads?board=&sort=top|new|active&page=
GET  /api/community/thread/:id              # returns thread + reply tree
POST /api/community/threads                 # auth required
POST /api/community/reply/:parent_id        # auth required
POST /api/community/vote/:id                # auth required, body { value: -1|1, target_type }
POST /api/community/flag/:id                # auth required, body { reason, target_type, notes? }
```

`sort=active` ranks by `score / (hours_since_created + 2)^1.8` (Reddit's hot algorithm, simplified). `sort=top` is `score DESC`. `sort=new` is `created_at DESC`.

### B.3 CLI commands (`src/cli/app.ts`)

```
agora community                                 # list boards with thread counts
agora community <board> [--sort top|new|active] # list threads
agora thread <id> [--reader]                    # read thread (TUI in --reader)
agora post --board <b> --title <t> --content <c>|--content-file <p>
agora reply <id> --content <c>|--content-file <p>
agora vote <id> --up|--down [--type discussion|reply]
agora flag <id> --reason <r> [--notes <n>] [--type discussion|reply]
```

All write commands require auth (`agora auth login`); they call existing
`live.ts` source helpers — extend `live.ts` with `communityBoardsSource`,
`communityThreadsSource`, `communityThreadSource`, `createThreadSource`,
`createReplySource`, `voteSource`, `flagSource`.

### B.4 TUI thread reader (`src/cli/thread-reader.ts`)

```
 ╭─ /mcp · Best local model for tool use? ─────────────── ↑ 86 ─╮
 │ posted by ada · 4h ago · 12 replies                          │
 │                                                              │
 │ I've been testing Qwen 2.5 7B for tool-use in MCP servers... │
 │                                                              │
 │ ├─ ↑ 14 · joe · 2h · [bot · claude-haiku-4-5]                │
 │ │  Qwen 2.5 is decent at small-tool flows but degrades at 4+ │
 │ │  parallel calls. Llama 3.1 8B instruct held up better...   │
 │ │  └─ ↑ 3 · ada · 1h                                         │
 │ │     Useful, thanks. Did you measure latency?               │
 │ │                                                            │
 │ └─ ↑ 7 · ben · 3h                                            │
 │    flag-and-collapse: this reply was flagged 4× as spam      │
 ╰──────────────────────────────────────────────────────────────╯
   j/k navigate · Enter expand · r reply · v vote · f flag · q quit
```

Indent guides `│ ` per depth. `[bot · model]` chip for `is_llm` authors. Collapsed (flagged) replies render as a single-line chip; `Enter` expands.

`r` opens `$EDITOR` (fallback `nano` then `vi`) on a tempfile preloaded with `> quoted parent` context; on save+exit, POST to reply endpoint.

### B.5 Tests

- `test/community.test.ts` — boards listing, sort ordering, vote idempotency, flag counting, kill-switch audit trail.
- `test/thread-reader.test.ts` — render with fixtures (no live backend); collapse logic at the flag threshold.
- Backend tests in `backend/test/community.test.ts` mirroring the above.

---

## C. Marketplace elaboration

### C.1 `agora similar <id>` (`src/marketplace.ts`)

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

### C.2 `agora compare <id1> <id2> [<id3>...]`

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

### C.3 Permission manifests (`src/types.ts`)

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

### C.4 `agora flag <id>` for marketplace items

Reuses the `flags` table from B.1 with `target_type='package'|'workflow'`. CLI: `agora flag <id> --reason <r>`. `agora browse <id>` shows a `[community-flagged: N]` chip when `flag_count` crosses the threshold.

### C.5 Live npm download counts in `scripts/refresh-data.ts`

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

## Verification checklist (run before each PR merge)

```bash
bun run lint
bun run format:check
bun run typecheck
bun test
```

For PRs touching the backend:

```bash
cd backend && bun run typecheck && bun test
```

For PRs touching news/community TUI surfaces, smoke-test manually in an
interactive terminal:

```bash
bun src/cli.ts news --reader
bun src/cli.ts community mcp
bun src/cli.ts thread <fixture-id> --reader
```

---

_Owner: lead. Implementation: sonnet `implementer` agent per PR (see the
project's delegation pattern). Last updated: 2026-05-15._
