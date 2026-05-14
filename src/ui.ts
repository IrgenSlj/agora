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
 * Filled-block letterforms (Gemini-style), 5 rows × 39 cols. Tuned to stay
 * legible uncoloured: the G's inner spur reads as G (not C), the R's diagonal
 * leg is offset from its bowl so it doesn't read as P.
 */
export const AGORA_WORDMARK_SOLID: string[] = [
  ' █████   █████   █████  ██████   █████ ',
  '██   ██ ██      ██   ██ ██   ██ ██   ██',
  '███████ ██  ███ ██   ██ ██████  ███████',
  '██   ██ ██   ██ ██   ██ ██  ██  ██   ██',
  '██   ██  █████   █████  ██   ██ ██   ██'
];

/**
 * Outlined / hairline letterforms (Claude Code-style), 5 rows × 39 cols.
 * A thinner, more architectural wordmark — good for a quieter banner over a
 * single accent colour rather than a gradient.
 */
export const AGORA_WORDMARK_OUTLINE: string[] = [
  ' ▄▀▀▀▄   ▄▀▀▀▄   ▄▀▀▀▄   █▀▀▀▄   ▄▀▀▀▄ ',
  ' █   █   █       █   █   █   █   █   █ ',
  ' █▀▀▀█   █  ▀▄   █   █   █▀▀▄    █▀▀▀█ ',
  ' █   █   █   █   █   █   █   █   █   █ ',
  ' ▀   ▀   ▀▄▄▄▀   ▀▄▄▄▀   ▀   ▀   ▀   ▀ '
];

/** Default banner art. */
export const AGORA_WORDMARK = AGORA_WORDMARK_SOLID;

/**
 * BANNER_GRADIENT — 3 stops sampled across the wordmark's columns.
 * "agora at golden hour": Aegean blue → marble warm → terracotta. Neither
 * endpoint touches pure black or white, so it holds contrast on either
 * terminal background.
 */
export const BANNER_GRADIENT: RGB[] = [
  [92, 142, 170], // #5C8EAA  Aegean blue
  [212, 184, 134], // #D4B886  marble warm
  [199, 116, 82] // #C77452  terracotta
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Sample a multi-stop gradient at position t ∈ [0, 1]. */
function sampleGradient(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const clamped = Math.min(1, Math.max(0, t));
  const span = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(span));
  const local = span - index;
  const from = stops[index];
  const to = stops[index + 1];
  return [lerp(from[0], to[0], local), lerp(from[1], to[1], local), lerp(from[2], to[2], local)];
}

/** Nearest colour in the xterm-256 6×6×6 cube — the fallback when truecolor is off. */
function rgbTo256(rgb: RGB): number {
  const axis = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * axis(rgb[0]) + 6 * axis(rgb[1]) + axis(rgb[2]);
}

function colorize(char: string, rgb: RGB, trueColor: boolean): string {
  const code = trueColor ? `38;2;${rgb[0]};${rgb[1]};${rgb[2]}` : `38;5;${rgbTo256(rgb)}`;
  return `\x1b[${code}m${char}${RESET}`;
}

export interface BannerOptions {
  color: boolean;
  trueColor: boolean;
  /** Which wordmark to render (default: solid). */
  variant?: 'solid' | 'outline';
  /** Dim line printed under the wordmark. */
  subtitle?: string;
}

/**
 * Renders the AGORA wordmark with a left-to-right gradient applied per column
 * (so the gradient stays aligned across all rows), followed by an optional
 * dim subtitle. Degrades to plain block letters when colour is off.
 */
export function renderBanner(opts: BannerOptions): string {
  const rows = opts.variant === 'outline' ? AGORA_WORDMARK_OUTLINE : AGORA_WORDMARK_SOLID;
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
