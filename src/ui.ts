/**
 * Terminal styling for the agora CLI — a flat, minimal look: one accent colour
 * for identifiers, dim for everything secondary, plain foreground for body text,
 * plus a gradient wordmark banner and a rounded header frame for the standalone
 * hub experience.
 *
 * Colour is opt-in. It is emitted only to an interactive TTY, and never under
 * `NO_COLOR`, `TERM=dumb`, or `--json`. Non-TTY callers (pipes, the test
 * harness) get plain strings, so output stays assertable.
 *
 * The wordmark art, gradient, and accent colour below come from the Claude
 * Design handoff (docs/claude-design-brief.md → `agora-wordmark.ts`). Palette:
 * "agora at golden hour" — Aegean blue → marble warm → terracotta.
 */

export type RGB = [number, number, number];

export interface Styler {
  accent(value: string): string;
  dim(value: string): string;
  bold(value: string): string;
}

const RESET = '\x1b[0m';

/**
 * ACCENT — used for package identifiers in list output. A desaturated amber:
 * high contrast on both light and dark terminals, and distinct from the
 * gradient stops so ids never blend into the banner.
 */
export const ACCENT = {
  hex: '#D4A85A',
  rgb: [212, 168, 90] as RGB,
  ansi256: 179, // xterm-256 warm gold
  ansiBasic: 33 // ANSI yellow (fg) — 16-colour fallback
} as const;

const plain: Styler = {
  accent: (value) => value,
  dim: (value) => value,
  bold: (value) => value
};

/**
 * Builds a styler. The accent colour is emitted as 24-bit when the terminal
 * advertises truecolor, otherwise as the nearest xterm-256 cube colour.
 */
export function createStyler(useColor: boolean, trueColor = false): Styler {
  if (!useColor) return plain;
  const accentCode = trueColor
    ? `38;2;${ACCENT.rgb[0]};${ACCENT.rgb[1]};${ACCENT.rgb[2]}`
    : `38;5;${ACCENT.ansi256}`;
  const wrap = (code: string) => (value: string) => `\x1b[${code}m${value}${RESET}`;
  return {
    accent: wrap(accentCode),
    dim: wrap('2'),
    bold: wrap('1')
  };
}

export function shouldUseColor(
  stream: { isTTY?: boolean },
  env: Record<string, string | undefined>,
  json: boolean
): boolean {
  if (json) return false;
  if (env.NO_COLOR != null) return false;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream.isTTY);
}

/** 24-bit colour is only safe to emit when the terminal advertises it. */
export function supportsTrueColor(env: Record<string, string | undefined>): boolean {
  const colorterm = env.COLORTERM ?? '';
  return colorterm === 'truecolor' || colorterm === '24bit';
}

// ── Wordmark + banner ───────────────────────────────────────────────────────

/**
 * Carved-relief letterforms (7 rows × 52 cols). Built from a SOLID skeleton +
 * an algorithmic shading pass: cells whose neighbour above is empty get `▓`
 * (top highlight), cells whose neighbour below is empty get `▒` (bottom
 * shadow), plus a few weather specks on stroke interiors. The pass only ever
 * rewrites existing `█` cells, so it cannot bleed into the O / R counters.
 * Reads as top-lit carved stone; survives `NO_COLOR` because the texture is
 * in the *characters*, not the colours.
 */
export const AGORA_WORDMARK_RELIEF: string[] = [
  '    ▓▓▓      ▓▓▓▓▓     ▓▓▓▓▓    ▓▓▓▓▓▓      ▓▓▓     ',
  '   ▓▒▒▒▓    ▓█   ▒▓   ▓█   █▓   ██   █▓    ▓▒▒▒▓    ',
  '  ▓▒   █▓   █▒        █▒   ██   █▒   █▒   ▓▒   █▓   ',
  '  ██   ▒█   ██  ▓▓▓▓  ██   ██   ██▓▓▓▒    ██   ▒█   ',
  '  ██▓▓▓██   ██   ▒█   ██   █▒   ██ ▒▒     ██▓▓▓██   ',
  '  ██   █▒   ▒█   █▒   ▒█   █▒   ██  ▒▓    ██   █▒   ',
  '  ▒▒   ▒▒    ▒▓▓▓▒     ▒▓▓▓▒    ▒▒   ▒▓   ▒▒   ▒▒   '
];

/**
 * BANNER_GRADIENT — 3 stops sampled across the wordmark's columns.
 * "Marble & terracotta": warm cream → terracotta → deep brick. A purely
 * warm Mediterranean sweep; neither endpoint touches pure black or white,
 * so it holds contrast on either terminal background.
 */
export const BANNER_GRADIENT: RGB[] = [
  [220, 196, 158], // #DCC49E  warm cream
  [198, 106, 74], // #C66A4A  terracotta
  [148, 64, 56] // #944038  deep brick
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Nearest colour in the xterm-256 6×6×6 cube — the fallback when truecolor is off. */
function rgbTo256(rgb: RGB): number {
  const axis = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * axis(rgb[0]) + 6 * axis(rgb[1]) + axis(rgb[2]);
}

export function colorize(char: string, rgb: RGB, trueColor: boolean): string {
  const code = trueColor ? `38;2;${rgb[0]};${rgb[1]};${rgb[2]}` : `38;5;${rgbTo256(rgb)}`;
  return `\x1b[${code}m${char}${RESET}`;
}

export function sampleGradient(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const clamped = Math.min(1, Math.max(0, t));
  const span = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(span));
  const local = span - index;
  const from = stops[index];
  const to = stops[index + 1];
  return [lerp(from[0], to[0], local), lerp(from[1], to[1], local), lerp(from[2], to[2], local)];
}

/** Colorizes each character of `text` across BANNER_GRADIENT stops. */
export function gradientText(text: string, opts: { trueColor: boolean }): string {
  if (text.length === 0) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const t = text.length === 1 ? 0 : i / (text.length - 1);
    const rgb = sampleGradient(BANNER_GRADIENT, t);
    out += colorize(text[i], rgb, opts.trueColor);
  }
  return out;
}

export interface BannerOptions {
  color: boolean;
  trueColor: boolean;
  /** Dim line printed under the wordmark. */
  subtitle?: string;
}

/**
 * Renders the AGORA wordmark with a left-to-right gradient applied per column
 * (so the gradient stays aligned across all rows), followed by an optional
 * dim subtitle. Degrades to plain block letters when colour is off.
 */
export function renderBanner(opts: BannerOptions): string {
  const rows = AGORA_WORDMARK_RELIEF;
  const width = Math.max(...rows.map((line) => line.length));

  const lines = rows.map((line) => {
    if (!opts.color) return line;
    let out = '';
    for (let col = 0; col < line.length; col += 1) {
      const char = line[col];
      if (char === ' ') {
        out += char;
        continue;
      }
      const rgb = sampleGradient(BANNER_GRADIENT, col / (width - 1));
      out += colorize(char, rgb, opts.trueColor);
    }
    return out;
  });

  if (opts.subtitle) {
    const subtitle = opts.color ? `\x1b[2m${opts.subtitle}${RESET}` : opts.subtitle;
    lines.push('', subtitle);
  }

  return lines.join('\n');
}

// ── Header frame ────────────────────────────────────────────────────────────

export interface BoxOptions {
  color: boolean;
  trueColor: boolean;
}

/**
 * A calm rounded-corner frame for the welcome header — rounded corners, single
 * sides, a half-block "pillar" prefix on each content line (the pillar reads as
 * a small column — fitting for the agora). The first line is the bold accent
 * title; the rest are dim body text. Border and pillar are accent-tinted; body
 * text is left uncoloured per the design spec.
 */
export function renderBox(title: string, body: string[], opts: BoxOptions): string {
  const styler = createStyler(opts.color, opts.trueColor);
  const contentLines = [title, ...body];
  const textWidth = Math.max(...contentLines.map((line) => line.length));
  // layout per row: │ + 2 pad + "▍ " + text(textWidth) + 2 pad + │
  const inner = 2 + 2 + textWidth + 2;

  const top = styler.accent(`╭${'─'.repeat(inner)}╮`);
  const bottom = styler.accent(`╰${'─'.repeat(inner)}╯`);
  const blank = `${styler.accent('│')}${' '.repeat(inner)}${styler.accent('│')}`;

  const row = (text: string, isTitle: boolean) => {
    const trailing = ' '.repeat(textWidth - text.length);
    const styledText = isTitle ? styler.bold(text) : styler.dim(text);
    return `${styler.accent('│')}  ${styler.accent('▍')} ${styledText}${trailing}  ${styler.accent('│')}`;
  };

  return [top, blank, ...contentLines.map((line, i) => row(line, i === 0)), blank, bottom].join(
    '\n'
  );
}

// ── Movement tints — distinct per-kind accent for the ▍ marker ──────────────

/**
 * One tint per chat-movement kind so a transcript reads at a glance:
 * thinking = cool grey-tan (low energy), tool = terracotta (mid), response =
 * accent amber (full). All three sit inside the BANNER_GRADIENT palette.
 */
export const MOVEMENT_COLOR = {
  thinking: { hex: '#8A7866', rgb: [138, 120, 102] as RGB },
  tool: { hex: '#C66A4A', rgb: [198, 106, 74] as RGB },
  response: { hex: '#D4A85A', rgb: [212, 168, 90] as RGB }
} as const;

export type MovementKind = keyof typeof MOVEMENT_COLOR;

/** Colorize `▍` with the tint for a given movement kind. */
export function movementBar(kind: MovementKind, opts: { trueColor: boolean }): string {
  return colorize('▍', MOVEMENT_COLOR[kind].rgb, opts.trueColor);
}

// ── Meander — Greek-key frieze + loading bar ────────────────────────────────

/**
 * 52-cell crenellated frieze (`▟▙` × 26). Used three ways:
 *   1. Idle ornament under the entry banner — every cell dim, reads as a
 *      static Greek-key ribbon tying the wordmark to the agora theme.
 *   2. Indeterminate loading wave during thinking — a 5-cell warm-to-hot pulse
 *      sweeps left→right with brief pauses between sweeps.
 *   3. Determinate progress bar — `agora install`, downloads, anything with a
 *      known endpoint. Filled cells use ACCENT, leading edge uses terracotta.
 */
export const MEANDER = '▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄▀▀▄▄';

const MEANDER_DIM: RGB = [107, 98, 83]; // #6B6253 — brightened for dark terminal visibility
const MEANDER_TAIL: RGB = [122, 90, 72]; // #7A5A48 — warm-dim trailing tail

export interface MeanderOptions {
  trueColor: boolean;
  /** Render mode: `idle` (default), `wave`, or `progress`. */
  mode?: 'idle' | 'wave' | 'progress';
  /** For `wave`: elapsed time in ms. The head moves at ~18 cells/sec. */
  tMs?: number;
  /** For `progress`: 0–100. */
  pct?: number;
}

/** Per-cell colour for the indeterminate wave at time `tMs`. */
function meanderWaveColor(i: number, tMs: number): RGB {
  const speed = 0.018; // cells per ms
  const period = MEANDER.length + 8; // 8-cell pause between sweeps
  const head = Math.floor(tMs * speed) % period;
  const dist = (head - i + period) % period;
  if (dist === 0) return ACCENT.rgb;
  if (dist <= 2) return MOVEMENT_COLOR.tool.rgb;
  if (dist <= 4) return MEANDER_TAIL;
  return MEANDER_DIM;
}

/** Per-cell colour for the determinate progress bar at `pct`. */
function meanderProgressColor(i: number, pct: number): RGB {
  const n = MEANDER.length;
  const filled = Math.round((n * Math.max(0, Math.min(100, pct))) / 100);
  if (i < filled - 1) return ACCENT.rgb;
  if (i === filled - 1) return MOVEMENT_COLOR.tool.rgb;
  return MEANDER_DIM;
}

/** Render the meander as a single styled line. */
export function renderMeander(opts: MeanderOptions): string {
  const mode = opts.mode ?? 'idle';
  let out = '';
  for (let i = 0; i < MEANDER.length; i++) {
    const ch = MEANDER[i];
    let rgb: RGB;
    if (mode === 'wave') rgb = meanderWaveColor(i, opts.tMs ?? 0);
    else if (mode === 'progress') rgb = meanderProgressColor(i, opts.pct ?? 0);
    else rgb = MEANDER_DIM;
    out += colorize(ch, rgb, opts.trueColor);
  }
  return out;
}

// ── Mascot — Ionic column capital that dances while the model thinks ────────

/**
 * 5-char dancing figure built from the top of an Ionic column: the corner
 * brackets `╭ ╮ ╰ ╯` form the *abacus* (flat slab), the two `⊙` characters
 * are the *volutes* (spiral scrolls), and the `─` between them is the
 * *echinus*. Only the abacus corners swap between frames — the volutes and
 * echinus are fixed — so the eye reads it as one figure swaying, not four
 * different glyphs flickering.
 *
 * Lifecycle: paint while a `thinking` movement is in flight; clear the line
 * on the first response token so the user's eye lands on the answer, not the
 * dance. Survives `NO_COLOR` because the silhouette is in the characters.
 */
export const MASCOT_FRAMES: readonly string[] = [
  '╭⊙─⊙╮', // both corners up — abacus level
  '╭⊙─⊙╯', // right corner dips — column leans right
  '╰⊙─⊙╯', // both corners down
  '╰⊙─⊙╮' //  left corner dips — column leans left
] as const;

/** Pick the current mascot frame given elapsed thinking time in ms. */
export function mascotFrame(tMs: number): string {
  return MASCOT_FRAMES[Math.floor(tMs / 200) % MASCOT_FRAMES.length];
}
