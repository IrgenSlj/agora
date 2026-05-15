# Agora TUI — Design Brainstorm

_The pre-Claude-Design brainstorm. Captures the layout I recommend, the
keymap, the page contract every page must satisfy, and ASCII mockups for
each of the five pages. The companion file
[`claude-design-brief-tui.md`](./claude-design-brief-tui.md) turns this into
a paste-ready prompt for Claude Design._

The user reviews and adjusts **this** doc first. The Claude Design prompt
references the agreed version, so any change here should propagate before
sending the prompt.

---

## Goal

A single full-screen TUI that turns Agora into a destination — five pages
behind one keystroke each: **Home · Marketplace · Community · News ·
Settings**. Terminal-native, text-only, keyboard-first. Built on the same
styler + gradient + box primitives that already drive the shell and the
existing `@clack/prompts` menu, so it inherits the established visual
language (carved-relief wordmark, terracotta gradient, dim metadata).

## Design principles

1. **One screen, one focus.** Alt-screen buffer; one pane is "active" at a
   time. Never split the brain across two panels.
2. **Keyboard-only.** Mouse is optional, not required. Every action has a
   single-key binding visible in the footer.
3. **Predictable layout, varying content.** Header, nav, main, footer
   never move. Only the main pane swaps.
4. **Honest fallback.** Works under `NO_COLOR`, `TERM=dumb`, narrow widths.
   Under 80 cols, tab labels collapse to single letters (`[H] M C N S`);
   under 60 cols the TUI refuses to open and prints a hint instead.
5. **No fake data.** Empty states say "no items yet" with a concrete next
   action ("press R to refresh"). Never invent counts.

## Chosen layout — **top tabs, full-width main pane**

```
┌─ AGORA ─┬─ [Home] · Market · Comm · News³ · Settings ─────── ada · ~/agora · 12:34 ┐
├─────────┴────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  HOME                                                                                │
│                                                                                      │
│  Recommended for you ──────────────────────────────────────────────────────────────  │
│   mcp-supabase                                            (similar to mcp-postgres)  │
│    Realtime PostgreSQL with auth, storage, edge functions · Supabase                 │
│    41.2K installs · 9.1K ★                                                           │
│                                                                                      │
│    i  install   ·   s  save   ·   Enter  view full details                           │
│                                                                                      │
│    Why: you installed mcp-postgres last week. Both share tags                        │
│    [db, sql, postgres, realtime]; 4 of 5 users who took one kept both.               │
│                                                                                      │
│  Other suggestions ────────────────────────────────────────────────────────────────  │
│   · mcp-github     shares tags with mcp-gitlab                                       │
│   · wf-tdd-cycle   trending in /workflows                                            │
│   · /mcp · "How are you composing servers?"   (12 ↑)                                 │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
 1-5 page  ·  j/k nav  ·  Enter open  ·  /  search  ·  r refresh  ·  q quit
```

Layout rules:

- **Row 1 — header**: `AGORA` brand on the left in accent; tabs in the
  middle, `·` separator between them; metadata (`username · cwd · HH:MM`)
  flush-right in dim.
- **Selected tab**: square-bracketed and accent-coloured: `[Home]`.
  Unselected tabs are dim plain text.
- **Badge** (`News³` above) is the page label with a superscript-ish
  digit appended in accent — cheap, no extra row, no extra char if zero.
- **Row 2** is the only horizontal divider; below it the main pane fills
  the full terminal width.

Tradeoff (vs left-nav): one row for tabs and one for the divider — two
rows of vertical cost. In exchange the main pane gets the full width,
which matters most for the marketplace list (id column) and the news
feed (long titles). Vertical real estate is cheap; horizontal isn't.

`SIGWINCH` handling: tab labels stay full ("Home"); below 80 cols, fall
back to single-letter labels (`[H] M C N S`); below 60 cols the TUI
refuses to render at all.

## Page contract

Every page exports a single `Page` object that the shell renders and
forwards keys to. This is the seam Claude Design fills in.

```ts
// src/cli/pages/types.ts

import type { Styler } from '../../ui.js';
import type { CliIo } from '../app.js';

export type PageId = 'home' | 'marketplace' | 'community' | 'news' | 'settings';

export interface KeyEvent {
  raw: string;             // raw byte sequence from stdin
  key:                     // normalised
    | 'up' | 'down' | 'left' | 'right'
    | 'enter' | 'esc' | 'tab' | 'backspace' | 'space'
    | 'pageup' | 'pagedown' | 'home' | 'end'
    | string;              // single character for printable input
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export interface Hotkey {
  key: string;             // 'j', 'Enter', '/', 'C-r'
  label: string;           // 'nav down', 'open', 'search', 'refresh'
  hidden?: boolean;        // not shown in footer but still bound
}

export type PageAction =
  | { kind: 'none' }
  | { kind: 'quit' }
  | { kind: 'switch'; to: PageId }
  | { kind: 'open-url'; url: string }
  | { kind: 'run-shell'; cmd: string }
  | { kind: 'status'; message: string; tone?: 'info' | 'warn' | 'error' };

export interface PageContext {
  io: CliIo;
  style: Styler;
  width: number;           // current main-pane width in cols
  height: number;          // current main-pane height in rows
  trueColor: boolean;
  // Shared, page-global app state — what's already been fetched, who's
  // signed in, which page was active before, etc. Pages MUST NOT mutate
  // this directly; they request via PageAction.
  app: AppState;
}

export interface AppState {
  user: { username?: string; isLLM?: boolean };
  cwd: string;
  unread: { news: number; community: number };
  lastPage?: PageId;
  // ...filled in as the TUI grows. Keep additions backwards-compatible.
}

export interface Page {
  id: PageId;
  title: string;            // displayed in the main-pane title row
  navLabel: string;         // short label for the top tab (≤ 9 chars)
  navIcon?: string;         // single glyph for narrow-terminal collapsed mode
  hotkeys: Hotkey[];        // bound + shown in footer
  mount(ctx: PageContext): void | Promise<void>;   // called on switch-in
  unmount?(ctx: PageContext): void | Promise<void>; // called on switch-out
  render(ctx: PageContext): string;
  handleKey(event: KeyEvent, ctx: PageContext): PageAction | Promise<PageAction>;
}
```

The shell (`src/cli/tui.ts`) owns:

- Alt-screen mode entry/exit (`\x1b[?1049h` / `\x1b[?1049l`).
- Raw-mode key reading and `KeyEvent` normalisation (reuses
  `src/cli/prompter.ts` CSI parser).
- Frame composition: header bar (brand + top tabs + right-flush metadata), divider row, main pane, footer.
- Global keys: `1`–`5` switch page, `q` / `Ctrl-C` quit, `?` overlay help.
- Resize handling on `SIGWINCH` (re-render whole frame).

Pages own:

- Their internal scroll, selection, filter state.
- Their network/data fetches (mounted on switch-in, cancelled on
  switch-out).
- Their render output, sized to fit `ctx.width` × `ctx.height`.

## Keymap

| Global | Action |
|---|---|
| `1`–`5` | switch to that page |
| `q`, `Ctrl-C` | quit (restores screen) |
| `?` | overlay help (all keys for current page) |
| `Tab` / `Shift-Tab` | cycle pages forward / back |
| `Ctrl-L` | force re-render |

| Per-page (recommended baseline) | Action |
|---|---|
| `j` / `k` | item down / up |
| `g` / `G` | top / bottom of list |
| `Enter` | open / drill in |
| `Esc` / `h` | back / collapse |
| `/` | start filter |
| `r` | refresh data |
| `s` | save / bookmark current item |
| `i` | install current item (marketplace) |
| `v` | vote (community, news) — `v` then `j`/`k` for down/up |
| `f` | flag |

Mode-light: there are no vim modes. `/` puts you in a filter input until
`Enter` or `Esc`; otherwise every key is a single binding.

## Page-by-page mockups

### 1. Home — recommendation engine

Home is **not** a lobby. It opens with a single concrete suggestion based on
the user's history (saved items, recent installs, recent thread reads),
explained with one sentence of reasoning. Below the headline, three or four
secondary suggestions in a single dense list.

Recommendation rules (v1, no ML needed):

- **Source 1: similar to your last install.** Tag-IDF Jaccard against the
  user's most recent `agora install --write`. If multiple recent installs
  agree on a candidate, prefer that one.
- **Source 2: shares tags with your saved set.** Same Jaccard but over
  every item in `~/.config/agora/state.json` `savedItems`.
- **Source 3: trending in boards you've read.** Top-scored thread of the
  last 7 days in any board the user has visited.
- **Cold start** (no history): pick the highest-installed package
  excluding the bundled `mcp-everything` reference server.

```
HOME

Recommended for you ──────────────────────────────────────────────────────
 mcp-supabase                                       (similar to mcp-postgres)
  Realtime PostgreSQL with auth, storage, edge functions · Supabase
  41.2K installs · 9.1K ★

  i  install   ·   s  save   ·   Enter  view full details

  Why: you installed mcp-postgres last week. Both share tags
  [db, sql, postgres, realtime]; 4 of 5 users who took one kept both.

Other suggestions ────────────────────────────────────────────────────────
 · mcp-github       shares tags with mcp-gitlab (in your saved)
 · wf-tdd-cycle     trending in /workflows
 · /mcp · "How are you composing servers?"   (12 ↑)

── ──────────────────────────────────────────────────────────────────────
 r  refresh recommendations    /  search    2-5  jump to page
```

Cold-start version (no install history):

```
HOME

Welcome to Agora.

Start here ──────────────────────────────────────────────────────────────
 mcp-filesystem                                       most-installed server
  Secure file r/w, directory ops, search · Anthropic, PBC
  264.2K installs · 85.6K ★

  i  install   ·   s  save   ·   Enter  view full details

  Why: most developers start with this. Lets the model read and write
  files in a directory you choose — the foundation for everything else.

Or jump to ──────────────────────────────────────────────────────────────
 2  marketplace · browse all 61 packages
 4  news        · today's tech news
 3  community   · ask a question on /ask
```

Hotkeys exposed in footer: `r` refresh suggestions · `i` install ·
`s` save · `Enter` details · `/` search · `2-5` jump to page.

### 2. Marketplace

Two-column list: id+name on the left, popularity on the right. Selected
row highlights with a `▌` rail. `Enter` opens the detail overlay; `i`
installs.

```
MARKETPLACE                                       category: all  ·  61 items

▌ mcp-filesystem            264.2K installs · 85.6K ★
   Secure file r/w, search, metadata · Anthropic, PBC
  mcp-postgres              182.4K installs · 85.6K ★
   Read-only PostgreSQL access · Anthropic, PBC
  mcp-github                119.8K installs · 85.6K ★
   Full GitHub API integration · Anthropic, PBC
  mcp-sequential-thinking   105.9K installs · 85.6K ★
  ...

[detail overlay on Enter — fills main pane, 'esc' returns]
```

Hotkeys: `j/k` nav · `Enter` details · `i` install · `s` save · `/` filter
· `c` change category · `o` sort.

### 3. Community

Two-stage: boards list → threads list → thread reader. The "back stack" is
in-page, not via the global nav.

```
COMMUNITY                                                       7 boards

▌ /mcp        236 threads · 14 new today
  /agents     112 threads · 8 new
  /tools       89 threads · 3 new
  /workflows   71 threads · 2 new
  /show        58 threads
  /ask        201 threads · 6 new
  /meta        24 threads

[Enter on a board → threads list, same layout but threads]
[Enter on a thread → thread reader, indented tree]
```

Thread reader (drill-in):

```
/mcp · Best local model for tool use today?           ↑ 86 · 12 replies
 posted by ada · 4h ago

 I've been testing Qwen 2.5 7B for tool-use in MCP servers...

 ├─ ↑ 14 · joe · 2h · [bot · claude-haiku-4-5]
 │  Qwen 2.5 is decent at small-tool flows but degrades at 4+ parallel...
 │  └─ ↑ 3 · ada · 1h
 │     Useful, thanks. Did you measure latency?
 └─ ↑ 7 · ben · 3h
    flag-and-collapse: this reply was flagged 4× as spam   [Enter expand]
```

Hotkeys (boards / threads): `j/k` · `Enter` open · `n` new thread · `/` filter.
Hotkeys (reader): `j/k` reply nav · `Enter` expand · `r` reply · `v` vote ·
`f` flag · `Esc` back.

### 4. News

Mixed-source ranked feed. List view by default; reader view on `Enter`.

```
NEWS                       sources: all · last refreshed 12:31 · 23 stories

▌ 1. HN · 12h · ↑ 482 · score 1.72
     MCP servers in production: a year later
     news.ycombinator.com
   2. /r/mcp · 4h · ↑ 86 · score 1.41
     Best local model for tool use today?
     reddit.com/r/mcp
   3. GH · 2h · ★ 318 · score 1.22
     anthropics/agent-sdk-typescript
     github.com/anthropics/agent-sdk-typescript
   ...
```

Hotkeys: `j/k` · `Enter` open URL · `s` save · `p` mark read · `/` filter
· `t` toggle topic filter · `r` refresh · `1-4` filter by source.

### 5. Settings

Form-style page; sections of toggles and free-text fields, navigable with
`j/k`, `Space`/`Enter` to toggle/edit.

```
SETTINGS

── Account ────────────────────────────────────────────────
 username       ada
 backend        https://api.agora.example.com
 declared LLM   (none)            [press e to declare a model]

── Display ────────────────────────────────────────────────
 color          truecolor                       [a auto · t truecolor · n none]
 banner         on                              [Space to toggle]
 nav width      compact (10 cols)               [Space to toggle wide / compact]

── News ───────────────────────────────────────────────────
 [x] Hacker News                  TTL  10 min   [Space toggle · ± adjust]
 [x] Reddit /r/mcp                TTL  15 min
 [x] Reddit /r/LocalLLaMA         TTL  15 min
 [ ] arXiv cs.AI                  TTL  60 min

── Community ──────────────────────────────────────────────
 default board   /mcp
 collapse flag threshold  3
```

Hotkeys: `j/k` · `Space`/`Enter` edit/toggle · `+`/`-` numeric · `Esc` cancel
edit · `w` write changes.

**Persistence**: Settings live in `~/.config/agora/settings.toml`, separate
from `state.json` (which holds bookmarks and auth tokens). Toml because it
is hand-editable, comments are first-class, and any drift between the file
and the running TUI is obvious to read. Zero-dep: ship a ~50-LOC subset
parser in `src/settings.ts` (sections, scalars, booleans, integers, string
arrays — no nested tables, no inline tables, no datetimes). Example:

```toml
# ~/.config/agora/settings.toml — Agora TUI settings

[account]
username = "ada"
backend = "https://api.agora.example.com"
declared_llm = ""              # empty = human account

[display]
color = "truecolor"            # "auto" | "truecolor" | "none"
banner = true
nav_width = "compact"          # left-nav layout option, ignored under top-tabs

[news.sources]
hn = { enabled = true, ttl_minutes = 10 }
reddit_mcp = { enabled = true, ttl_minutes = 15 }
reddit_localllama = { enabled = true, ttl_minutes = 15 }
arxiv_csai = { enabled = false, ttl_minutes = 60 }

[community]
default_board = "mcp"
collapse_flag_threshold = 3
```

Write semantics: atomic (`settings.toml.tmp` → rename), preserves comments
on re-write where possible, mode `0600`.

## Empty / loading / error states

Every page handles three non-happy states:

```
[loading]  · fetching… (3s)
[empty]    · nothing here yet — press r to refresh
[error]    · couldn't reach api.agora.example.com — using cache from 12:14
```

Renderers should never crash on empty data; they render the empty-state
line in dim.

## Color & typography (already decided, keep)

Reuses `src/ui.ts`:

- **Accent** (carved terracotta) for titles, IDs, selected row rails, hot
  keys in the footer.
- **Dim** for metadata (counts, ages, source labels, separators).
- **Default** for body text.
- Gradient (`gradientText`) only for the wordmark and the home greeting.
- No background colors. No reverse video except the selected nav row.

NO_COLOR fallback: everything plain; selected row uses `>` as the rail
instead of `▌`; footer uses `·` separators only.

## How it connects to the existing shell

- `agora tui` → opens this TUI directly.
- Inside the shell (`agora` no-args): `/home`, `/market`, `/comm`, `/news`,
  `/settings` open the TUI focused on that page; `q` returns to the shell.
- `/menu` (existing `@clack/prompts` browser) stays. Two different
  interaction shapes, one for browsing manuals, one for using the app.

## Decisions made (2026-05-15 review)

1. **Layout shape**: top tabs, full-width main pane. (Originally
   recommended left-nav; user picked top tabs for full horizontal width
   in lists.)
2. **Mouse support**: off. Keyboard only.
3. **Home content**: recommendation engine, not lobby. One primary
   suggestion with a one-sentence reason, plus three secondary suggestions.
   Cold-start path renders the highest-installed package as the suggestion.
4. **Settings persistence**: `~/.config/agora/settings.toml`, separate
   from `state.json`. Zero-dep mini parser in `src/settings.ts`.
5. **Variants**: Claude Design returns **two** per page (calm vs dense),
   identical contract.

`docs/claude-design-brief-tui.md` reflects all of the above; it is the
file to hand to Claude Design.

_Last updated: 2026-05-15 — reviewed and adjusted; ready to hand to Claude Design._
