# Claude Design Brief — Agora TUI pages (Home · Marketplace · Community · News · Settings)

This file is a **paste-ready prompt**. Copy everything below the line into
Claude on the web. It asks for **drop-in TypeScript code** that implements
the five TUI pages and the surrounding shell, against a frozen contract
that already exists in this repo.

For the user-facing design brainstorm this prompt builds on, see
[`./TUI_DESIGN.md`](./TUI_DESIGN.md). Anything you find ambiguous in this
prompt should default to whatever that doc says.

---

## Prompt

You are designing the full-screen TUI for **Agora**, a standalone terminal
marketplace and community hub for the agentic-coding ecosystem (MCP
servers, workflows, tutorials, news, and discussion boards). The CLI ships
today; we are adding a single-screen, keyboard-driven TUI on top of it.

I need **drop-in TypeScript files**, not mockups, not pseudo-code, and not
a design system. The code should compile against the existing project's
strict TypeScript config with no edits beyond placing the files at the
paths I specify.

### What Agora is (for tone)

Agora = the ancient Greek public square: marketplace and forum in one.
The brand is *open commerce, developer-first, calm and modern* — not
cyberpunk, not corporate. The TUI should feel like it belongs next to
`helix`, `lazygit`, `k9s`, and the OpenCode TUI. Calm box-drawing
characters, terracotta accent (already established in `src/ui.ts`),
generous whitespace, never noisy.

### The five pages

The TUI has exactly five top-level pages, switched with `1`–`5`:

| Key | Page id | Title row | Purpose |
|---|---|---|---|
| `1` | `home` | `HOME` | Recommendation engine. One primary suggestion with reasoning, plus secondary suggestions. |
| `2` | `marketplace` | `MARKETPLACE` | List + detail of MCP servers, workflows, prompts. Install / save. |
| `3` | `community` | `COMMUNITY` | Boards → threads → reader. Vote / flag / reply. |
| `4` | `news` | `NEWS` | Ranked feed from HN / Reddit / GitHub trending / arXiv. |
| `5` | `settings` | `SETTINGS` | Account, display, news sources, community defaults. |

Detailed visual targets for each page (use as the **baseline to improve
on**, equal-width rows assumed):

```
HOME

Recommended for you ──────────────────────────────────────
 mcp-supabase                          (similar to mcp-postgres)
  Realtime PostgreSQL with auth, storage · Supabase
  41.2K installs · 9.1K ★

  i install · s save · Enter view full details

  Why: you installed mcp-postgres last week. Both share tags
  [db, sql, postgres, realtime]; 4 of 5 users who took one kept both.

Other suggestions ────────────────────────────────────────
 · mcp-github       shares tags with mcp-gitlab (in your saved)
 · wf-tdd-cycle     trending in /workflows
 · /mcp · "How are you composing servers?"   (12 ↑)
```

The Home page is a **recommendation engine**, not a lobby. Recommendation
rules (v1, no ML):

- Primary suggestion: tag-IDF Jaccard against the user's most recent
  install. If `AppState.user.username` is empty or there is no recent
  install, fall back to "highest-installed package excluding the bundled
  `mcp-everything` reference server" and render a cold-start variant
  that nudges the user toward pages 2-5.
- Secondary suggestions (max 3): Jaccard against the saved set, plus the
  top-scored thread of the last 7 days in any board the user has visited.
  Both can be stubbed against fixtures for now — mark with `// FIXTURE`.

```
MARKETPLACE                                  category: all  ·  61 items
▌ mcp-filesystem            264.2K installs · 85.6K ★
   Secure file r/w, search, metadata · Anthropic, PBC
  mcp-postgres              182.4K installs · 85.6K ★
   Read-only PostgreSQL access · Anthropic, PBC
  ...
```

```
COMMUNITY                                                  7 boards
▌ /mcp        236 threads · 14 new today
  /agents     112 threads · 8 new
  ...
```

```
NEWS              sources: all · last refreshed 12:31 · 23 stories
▌ 1. HN · 12h · ↑ 482 · score 1.72
     MCP servers in production: a year later
     news.ycombinator.com
  ...
```

```
SETTINGS
── Account ───────────────────────────────────────────────
 username       ada
 backend        https://api.agora.example.com
 declared LLM   (none)
...
```

### Surrounding chrome (already specified)

Every page is rendered inside a fixed frame:

```
┌─ AGORA ─┬─ [Home] · Market · Comm · News³ · Settings ─────── ada · ~/agora · 12:34 ┐
├─────────┴────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  <PAGE CONTENT — sized to width × height; main pane is the FULL terminal width>      │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
 1-5 page  ·  j/k nav  ·  Enter open  ·  /  search  ·  r refresh  ·  q quit
```

- **Row 1 — header**: `AGORA` brand on the left in accent inside a small
  cell (~9 cols including separators). Tabs follow, `·` separator between
  them. Selected tab is square-bracketed and accent-coloured: `[Home]`.
  Unselected tabs are dim plain text. Right-flush: `username · cwd · HH:MM`
  in dim.
- **Row 2** is a horizontal divider; below it the main pane uses the full
  terminal width.
- **Badge**: append the unread count to the tab label in accent
  (`News³`). Omit if zero.
- **Footer** renders the **current page's** hotkeys (the page declares them).
- **Narrow-fall back**: below 80 cols, collapse tab labels to single
  letters (`[H] M C N S`). Below 60 cols, refuse to render.

You may propose adjustments to spacing or how the tab cell is composed,
but **do not** propose a different layout shape — top tabs is the chosen
shape and is fixed in `TUI_DESIGN.md`.

### Frozen contract (do not change these signatures)

You will be given two files that already exist in the repo. Your code must
import from them and produce files that consume their types without
modification.

`src/ui.ts` exports (excerpt — full file in the repo):

```ts
export type RGB = [number, number, number];
export interface Styler {
  accent(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  underline(s: string): string;
  // ...more — assume any reasonable method exists
}
export function createStyler(useColor: boolean, trueColor?: boolean): Styler;
export function renderBanner(opts: { color: boolean; trueColor: boolean }): string;
export function gradientText(s: string, opts: { trueColor: boolean }): string;
export function supportsTrueColor(env: Record<string, string | undefined>): boolean;
```

`src/cli/app.ts` exports:

```ts
export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  env?: Record<string, string | undefined>;
  cwd?: string;
}
```

`src/marketplace.ts` exports `getMarketplaceItems()`, `searchMarketplaceItems()`,
`findMarketplaceItem()`, `getTrendingItems()`, plus the `MarketplaceItem`
type. Use these for live marketplace data; do not invent fake items.

### Page contract you must implement

```ts
// src/cli/pages/types.ts — return this file verbatim; everyone else imports from it

import type { Styler } from '../../ui.js';
import type { CliIo } from '../app.js';

export type PageId = 'home' | 'marketplace' | 'community' | 'news' | 'settings';

export interface KeyEvent {
  raw: string;
  key:
    | 'up' | 'down' | 'left' | 'right'
    | 'enter' | 'esc' | 'tab' | 'backspace' | 'space'
    | 'pageup' | 'pagedown' | 'home' | 'end'
    | string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
}

export interface Hotkey {
  key: string;
  label: string;
  hidden?: boolean;
}

export type PageAction =
  | { kind: 'none' }
  | { kind: 'quit' }
  | { kind: 'switch'; to: PageId }
  | { kind: 'open-url'; url: string }
  | { kind: 'run-shell'; cmd: string }
  | { kind: 'status'; message: string; tone?: 'info' | 'warn' | 'error' };

export interface AppState {
  user: { username?: string; isLLM?: boolean };
  cwd: string;
  unread: { news: number; community: number };
  lastPage?: PageId;
}

export interface PageContext {
  io: CliIo;
  style: Styler;
  width: number;
  height: number;
  trueColor: boolean;
  app: AppState;
}

export interface Page {
  id: PageId;
  title: string;
  navLabel: string;     // ≤ 9 chars — tab label
  navIcon?: string;     // single letter for narrow-terminal collapsed mode (< 80 cols)
  hotkeys: Hotkey[];
  mount?(ctx: PageContext): void | Promise<void>;
  unmount?(ctx: PageContext): void | Promise<void>;
  render(ctx: PageContext): string;
  handleKey(event: KeyEvent, ctx: PageContext): PageAction | Promise<PageAction>;
}
```

### Deliverables — return **exactly** these files

Return one fenced TypeScript block per file, in this order:

1. **`src/cli/pages/types.ts`** — the contract above, verbatim.

2. **`src/cli/tui.ts`** — the frame renderer. Owns:
   - alt-screen entry/exit (`\x1b[?1049h` / `\x1b[?1049l`),
   - raw-mode key reading and `KeyEvent` normalisation,
   - frame composition (header bar with top tabs + brand + right-flush metadata, divider row, main pane, footer),
   - global keys `1`-`5`, `Tab`, `Shift-Tab`, `q`, `Ctrl-C`, `Ctrl-L`, `?` overlay,
   - `SIGWINCH` resize handling (re-render whole frame),
   - one exported function `runTui(io: CliIo, opts?: { initial?: PageId }): Promise<number>`.

3. **`src/cli/pages/home.ts`** — exports `homePage: Page`. Hotkeys: `r` refresh, `/` search, `i` install last, `s` saved.

4. **`src/cli/pages/marketplace.ts`** — exports `marketplacePage: Page`. Uses `getMarketplaceItems()` and `searchMarketplaceItems()` from `../../marketplace.js`. List + detail overlay (drill-in with `Enter`, back with `Esc`). Hotkeys: `j/k` nav, `Enter` details, `i` install, `s` save, `/` filter, `c` change category, `o` sort.

5. **`src/cli/pages/community.ts`** — exports `communityPage: Page`. Three nested views (boards → threads → reader). The endpoints are not live yet — render against **fixture data** that you embed at the top of the file, marked `// FIXTURE — replace with backend calls in PR 7`. Hotkeys per view (see `TUI_DESIGN.md`).

6. **`src/cli/pages/news.ts`** — exports `newsPage: Page`. Same fixture-driven pattern for now (`// FIXTURE — replace with src/news/* in PR 3`). Hotkeys: `j/k`, `Enter` open URL, `s` save, `p` mark read, `/` filter, `t` toggle topic, `r` refresh, `1-4` source filter.

7. **`src/cli/pages/settings.ts`** — exports `settingsPage: Page`. Reads / writes settings to `~/.config/agora/settings.toml` (separate from `state.json`). Use the helper signatures below — assume the implementation file `src/settings.ts` will be authored in a later PR; mark its calls with `// TODO PR-N` but keep them typed correctly so the file compiles:

```ts
// src/settings.ts — to be implemented in a later PR
export interface AgoraSettings {
  account: { username: string; backend: string; declared_llm: string };
  display: { color: 'auto' | 'truecolor' | 'none'; banner: boolean };
  news: { sources: Record<string, { enabled: boolean; ttl_minutes: number }> };
  community: { default_board: string; collapse_flag_threshold: number };
}
export function loadSettings(dataDir: string): AgoraSettings;
export function writeSettings(dataDir: string, settings: AgoraSettings): void;
```

Persistence is toml, hand-editable. The rendering and edit flow should work end-to-end against in-memory `AgoraSettings`. Hotkeys: `j/k`, `Space`/`Enter` toggle/edit, `+`/`-` numeric, `Esc` cancel, `w` write.

For each of files **3 through 7** (the five pages), return **two design
variants** under headings `Variant A — <one-word descriptor>` and
`Variant B — <one-word descriptor>`. Keep the page contract identical
across variants; vary only the *render* (layout density, separator style,
where the title sits, how the selected row is marked, how empty states
look). One variant per page should be "calm" (whitespace, few dividers),
one should be "dense" (more info per row, more dividers).

### Hard rules

- **TypeScript only.** No JSX, no JSON-as-config. The code goes into a
  strict TS project; no `any`, no `@ts-ignore`.
- **No new dependencies.** Use only what is already in `package.json`
  (`@clack/prompts`, `@modelcontextprotocol/sdk`, `zod`) plus Node /
  Bun built-ins. No `ink`, no `blessed`, no `chalk`, no `boxen`.
- **Pure-string render.** Each page's `render(ctx)` must return a single
  string sized to fit `ctx.width × ctx.height` exactly. The shell prints
  it once per frame. Do not write to stdout from inside `render`.
- **Single-character key bindings.** Multi-char sequences only for arrow
  keys and standard CSI. No leader keys, no `g`+`g`, no chords beyond
  `Ctrl-<letter>`.
- **`NO_COLOR` fallback.** Every visual differentiator (selected row,
  badge, accent) must degrade to a plain-text alternative when
  `style.accent` is the identity function. Selected rows: `▌` (with
  colour) or `>` (without).
- **Narrow-terminal floor.** Refuse to render below 60 cols × 20 rows;
  return a single-line error string and let the shell exit.
- **No fake counts.** When data is empty, render an empty-state line.
  Never write `"5 items"` if there are zero.
- **Equal-width rows.** Lines in a page's render must all match
  `ctx.width` after styling (pad on the right with spaces). The frame
  composition counts on it.

### Style guidance

- **Box drawing**: `┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ┼` only. No double-line variants
  for primary chrome; reserve `═` etc. for the "now-active" overlay
  border if you want one.
- **Separators within a page**: `── label ──────────────` — a label
  flush-left with `── ` lead-in and trailing `─` fill to the right edge.
- **Selected row rail**: leading `▌ ` in accent (or `> ` in NO_COLOR).
  Non-selected rows: leading two spaces.
- **Dim metadata**: counts, sources, timestamps, hotkeys in the footer.
- **Accent**: title row, IDs, selected-row rail, hotkey keys in the
  footer (`r` in `r refresh`).
- **Body**: plain text.
- **No emoji** in chrome or page content. The shell's gradient banner is
  the only "graphic"; everything else is letterforms and box-drawing.

### Output format

For each deliverable file, output:

````md
### `src/cli/pages/home.ts` — Variant A — calm

```ts
// drop-in code here
```

### `src/cli/pages/home.ts` — Variant B — dense

```ts
// drop-in code here
```
````

For `types.ts` and `tui.ts`, return only one block each (no variants).

After all files, return:

- A **rationale paragraph** per variant pair explaining what you traded
  off and which you'd recommend.
- A short **integration note** telling me what to add in `src/cli/app.ts`
  to wire `agora tui` to `runTui(...)` (one switch-case entry, no more).

### What I'll do after you respond

I'll diff the two variants per page, pick one per page, and merge. Then
the same Phase 1.5 plan in `ROADMAP.md` replaces the FIXTURE blocks in
`community.ts` and `news.ts` with the real backend + scoring code in
later PRs.

Constraints recap, in priority order:

1. Strict TS, no new deps, no JSX, pure-string render.
2. Five pages, fixed top-tabs frame, single-character keymap.
3. Empty / loading / error states honest, no fake counts.
4. NO_COLOR and narrow-terminal fallbacks.
5. Two render variants per page, identical contract.

Now design.
