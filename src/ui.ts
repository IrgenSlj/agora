/**
 * The terminal identity: colour tokens, capability detection and the banner.
 * Spec: docs/TERMINAL.md (from the Claude Design handoff, 2026-11-12).
 *
 * Meaning is carried by glyph and layout first, colour second, so every screen
 * reads the same with no colour at all. Colour is emitted only to an
 * interactive TTY, never under `NO_COLOR`, `TERM=dumb` or `--json`. Three
 * tiers: truecolor when the terminal advertises it, xterm-256, then ANSI-16.
 */

export type RGB = [number, number, number];
export type ColorDepth = 'truecolor' | '256' | '16';

export interface Token {
  name: string;
  hex: string;
  rgb: RGB;
  x256: number;
  /** SGR code for 16-colour terminals; muted uses faint (2) rather than bright black. */
  ansi16: number;
}

const token = (name: string, hex: string, x256: number, ansi16: number): Token => {
  const n = Number.parseInt(hex.slice(1), 16);
  return { name, hex, rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], x256, ansi16 };
};

/** One accent, four states, one quiet tone. Mid-luminance: they hold on dark and light. */
export const TOKENS = {
  accent: token('ink', '#3A86AD', 31, 36),
  success: token('moss', '#4C9457', 65, 32),
  warning: token('amber', '#B5802A', 136, 33),
  error: token('brick', '#CC5A48', 167, 31),
  unknown: token('violet', '#8B7BC4', 98, 35),
  muted: token('stone', '#807D75', 244, 2)
} as const;
export type TokenName = keyof typeof TOKENS;

const RESET = '\x1b[0m';

export function sgr(t: Token, depth: ColorDepth): string {
  if (depth === 'truecolor') return `\x1b[38;2;${t.rgb[0]};${t.rgb[1]};${t.rgb[2]}m`;
  if (depth === '256') return `\x1b[38;5;${t.x256}m`;
  return `\x1b[${t.ansi16}m`;
}

export function paint(t: Token, depth: ColorDepth, value: string): string {
  return `${sgr(t, depth)}${value}${RESET}`;
}

/** The part of the theme commands receive before it is lifted into a full Theme. */
export interface Styler {
  accent(value: string): string;
  dim(value: string): string;
  bold(value: string): string;
}

const plain: Styler = { accent: (v) => v, dim: (v) => v, bold: (v) => v };

export function createStyler(useColor: boolean, depth: ColorDepth | boolean = '256'): Styler {
  if (!useColor) return plain;
  const d: ColorDepth = depth === true ? 'truecolor' : depth === false ? '256' : depth;
  return {
    accent: (v) => paint(TOKENS.accent, d, v),
    dim: (v) => `\x1b[2m${v}${RESET}`,
    bold: (v) => `\x1b[1m${v}${RESET}`
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

export function colorDepth(env: Record<string, string | undefined>): ColorDepth {
  if (supportsTrueColor(env)) return 'truecolor';
  const term = env.TERM ?? '';
  if (term.includes('256') || env.TERM_PROGRAM) return '256';
  return '16';
}

/**
 * Block and box glyphs need a UTF-8 terminal. ASCII when the terminal is dumb,
 * when the locale says it is not UTF-8, or when asked with AGORA_ASCII.
 */
export function supportsUnicode(env: Record<string, string | undefined>): boolean {
  if (env.AGORA_ASCII) return false;
  if (env.TERM === 'dumb') return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (locale && !/utf-?8/i.test(locale)) return false;
  return true;
}

// ── Banner ──────────────────────────────────────────────────────────────────

/** Three rows of half-block letters, 38 columns. */
export const WORDMARK = [
  '██▀▀██  ██▀▀▀▀  ██▀▀██  ██▀▀██  ██▀▀██',
  '██▄▄██  ██ ▄▄▄  ██  ██  ██▄▄█▀  ██▄▄██',
  '██  ██  ██▄▄██  ██▄▄██  ██ ▀█▄  ██  ██'
];
/** The density ramp under the wordmark: depth from texture, light to solid. */
export const RAMP = '░░░░░░░░░▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓██████████';
export const WORDMARK_ASCII = ['A G O R A'];
export const RAMP_ASCII = '.........:::::::::==========##########';

export const TAGLINE = 'a written limit for every coding agent, a receipt for every change';
const TAGLINE_FULL = ['a written limit for every coding agent,', 'a receipt for every change.'];
const TAGLINE_COMPACT = ['a written limit for every coding', 'agent, a receipt for every change.'];

export interface BannerOptions {
  color: boolean;
  depth?: ColorDepth;
  unicode?: boolean;
  /** Terminal width; below 43 columns the tagline wraps shorter. */
  columns?: number;
}

/** The wordmark, its ramp in the accent, and the tagline in faint. Indented two columns. */
export function renderBanner(opts: BannerOptions): string {
  const unicode = opts.unicode !== false;
  const depth = opts.depth ?? '256';
  const faint = (s: string) => (opts.color ? `\x1b[2m${s}${RESET}` : s);
  const ramp = unicode ? RAMP : RAMP_ASCII;
  const tagline = (opts.columns ?? 80) < 43 ? TAGLINE_COMPACT : TAGLINE_FULL;
  return [
    ...(unicode ? WORDMARK : WORDMARK_ASCII).map((row) => `  ${row}`),
    `  ${opts.color ? paint(TOKENS.accent, depth, ramp) : ramp}`,
    '',
    ...tagline.map((line) => `  ${faint(line)}`)
  ].join('\n');
}
