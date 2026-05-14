# Claude Design Brief — Agora terminal wordmark + palette

This file is a **paste-ready prompt**. Copy everything below the line into
Claude on the web (attach the two reference screenshots if you have them). It
asks for drop-in TypeScript that replaces the placeholder art in `src/ui.ts` —
the render pipeline is already built, only the *art and palette data* are
needed.

---

## Prompt

You are designing the terminal wordmark and colour palette for **Agora**, a
standalone terminal marketplace CLI (think `brew` or `npm`, but for AI agent
tooling — MCP servers, skills, workflows). I need **drop-in TypeScript data**,
not mockups.

### What Agora is (for tone)

Agora = the ancient Greek public square: a marketplace and forum in one. The
brand is *open commerce, developer-first, calm and modern* — not cyberpunk, not
corporate. The wordmark should feel like it belongs next to Claude Code and the
Gemini CLI banners (see reference screenshots: a pixel-block gradient wordmark,
and an outlined-blocky wordmark with a boxed header).

### Deliverables — return exactly these, as a single TypeScript snippet

1. **`AGORA_WORDMARK: string[]`** — block-letter art spelling `AGORA`.
   - Provide **two variants** so I can compare in a real terminal:
     - `AGORA_WORDMARK_SOLID` — solid filled blocks (Gemini-style), good for a
       smooth per-column gradient.
     - `AGORA_WORDMARK_OUTLINE` — outlined / double-stroke blocky letters
       (Claude Code-style).
   - **Hard rules:** every string in the array must be the **exact same
     length**. Max 80 columns wide, max 7 rows tall (terminal vertical space is
     precious). A space character `' '` is rendered as transparent — the
     gradient skips it — so use spaces for negative space, never for ink.
   - Allowed characters: `█ ▀ ▄ ▌ ▐ ░ ▒ ▓` and box-drawing `─ │ ┌ ┐ └ ┘ ━ ┃`
     plus ASCII. These are safe in modern terminals. Avoid anything exotic.

2. **`BANNER_GRADIENT: RGB[]`** where `type RGB = [number, number, number]` —
   2–4 gradient stops, applied left-to-right across the wordmark's columns.
   Pick a palette that reads well on **both dark and light terminal
   backgrounds**.

3. **`ACCENT`** — the single accent colour used for identifiers in list output
   (e.g. package ids). Return it as `{ hex: string; ansi256: number; ansiBasic: number }`
   where `ansiBasic` is one of the 16 standard codes (30–37 / 90–97) for the
   no-truecolor fallback.

4. **A one-paragraph rationale** — why this palette, how it degrades, any
   terminal-background caveats.

5. *(Optional, secondary)* **`headerBox`** — a spec for a boxed header like the
   "Welcome to Claude Code" frame: which box-drawing characters, padding, and
   how the title sits inside. Return as a short comment block, not code.

### The render pipeline you are designing for

This already exists in `src/ui.ts` — design within it:

```ts
type RGB = [number, number, number];

// Per-column gradient: for a wordmark `width` columns wide, the character at
// column `c` is coloured by sampleGradient(BANNER_GRADIENT, c / (width - 1)).
// Spaces are skipped (left transparent). Rows are coloured independently but
// share the column→colour mapping, so the gradient stays vertically aligned.
//
// Truecolor terminals get 24-bit colour; others get the nearest xterm-256
// cube colour; NO_COLOR / TERM=dumb / non-TTY get plain text (the raw
// AGORA_WORDMARK strings, uncoloured). Your art must therefore look fine with
// no colour at all.
```

### Constraints recap

- Monospace; assume an 80-column terminal minimum.
- Must look good **uncoloured** (the no-colour fallback prints the raw strings).
- Keep it short — a tall banner is annoying on every invocation.
- Equal-length rows, spaces = transparent.

### Baseline to beat

This is the current placeholder (`AGORA` in solid blocks, indigo→violet→pink).
It is functional but generic — improve the letterforms and the palette:

```
 █████   ██████  █████  ██████   █████
██   ██ ██      ██   ██ ██   ██ ██   ██
███████ ██  ███ ██   ██ ██████  ███████
██   ██ ██   ██ ██   ██ ██  ██  ██   ██
██   ██  ██████  █████  ██   ██ ██   ██
```

```ts
const BANNER_GRADIENT: RGB[] = [
  [99, 102, 241],   // indigo
  [168, 85, 247],   // violet
  [236, 72, 153]    // pink
];
```

### Output format

Return one fenced ```ts block I can paste directly into `src/ui.ts`, with all
of `AGORA_WORDMARK_SOLID`, `AGORA_WORDMARK_OUTLINE`, `BANNER_GRADIENT`, and
`ACCENT` exported as `const`. Then the rationale paragraph, then the optional
`headerBox` comment. Do not include the render functions — I have those.
