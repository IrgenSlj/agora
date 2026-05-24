// src/cli/theme.ts
// Semantic token / theme layer for the agora TUI.
//
// Additive over the existing src/ui.ts Styler — Theme extends Styler with
// success/warning/error/info/muted/fg/tone()/glyph(). Anything that already
// destructures { accent, orange, bold, dim } from a Styler keeps working.
//
// Resolution:
//   trueColor  → 24-bit ANSI 38;2;r;g;b
//   256        → xterm-256 indices picked to preserve hue + contrast
//   NO_COLOR   → identity (returns the input untouched) — differentiation
//                must come from glyphs, weight and layout, not color.
//
// Glyph degradation: when unicode=false, geometric/box glyphs fall back to
// ASCII equivalents (✓→v, ✗→x, ⚠→!, ▰→#, ▸→>, ·→*, ▌→>).

import type { Styler } from '../ui.js';

export type Tone =
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted'
  | 'dim'
  | 'fg'
  | 'orange';

export type GlyphName =
  | 'ok'
  | 'warn'
  | 'err'
  | 'info'
  | 'bullet'
  | 'arrow'
  | 'pip'
  | 'rail'
  | 'spinner';

export interface Theme extends Styler {
  // semantic tones (additive)
  success(s: string): string;
  warning(s: string): string;
  error(s: string): string;
  info(s: string): string;
  muted(s: string): string;
  fg(s: string): string;
  tone(name: Tone, s: string): string;
  // shape glyphs that survive NO_COLOR by carrying meaning in form
  glyph(name: GlyphName): string;
  // capability flags
  readonly useColor: boolean;
  readonly trueColor: boolean;
  readonly unicode: boolean;
}

// ── token anchors ────────────────────────────────────────────────────────────
// Warm-leaning palette: accent (gold) is the brand; success/warning/error
// are tuned so they're distinguishable for the common deuteran-protan case
// (success leans sage-yellow, error leans terracotta-red, warning is amber
// and lives between them — under colorblind sim warning and error stay
// separable from accent because of the glyph + weight pairing).
const HEX: Record<Tone, { r: number; g: number; b: number }> = {
  accent: { r: 0xd4, g: 0xa8, b: 0x5a }, // brand gold
  success: { r: 0x7f, g: 0xb0, b: 0x69 }, // sage
  warning: { r: 0xe0, g: 0xa3, b: 0x3b }, // amber
  error: { r: 0xc6, g: 0x6a, b: 0x4a }, // terra (= existing orange family)
  info: { r: 0x7f, g: 0xa9, b: 0xc8 }, // slate blue
  muted: { r: 0x8a, g: 0x82, b: 0x75 },
  dim: { r: 0x5a, g: 0x52, b: 0x47 },
  fg: { r: 0xe8, g: 0xe2, b: 0xd6 },
  orange: { r: 0xff, g: 0x8c, b: 0x00 } // legacy
};

// xterm-256 fallback — hand-picked.
const X256: Record<Tone, number> = {
  accent: 179,
  success: 108,
  warning: 215,
  error: 167,
  info: 109,
  muted: 245,
  dim: 240,
  fg: 230,
  orange: 208
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function tcEsc(c: { r: number; g: number; b: number }): string {
  return `\x1b[38;2;${c.r};${c.g};${c.b}m`;
}
function x256Esc(i: number): string {
  return `\x1b[38;5;${i}m`;
}

export interface CreateThemeOpts {
  useColor: boolean;
  trueColor?: boolean;
  unicode?: boolean;
}

export function createTheme(opts: CreateThemeOpts): Theme {
  const useColor = !!opts.useColor;
  const trueColor = !!opts.trueColor;
  const unicode = opts.unicode !== false;

  const wrap = (t: Tone, s: string): string => {
    if (!useColor) return s;
    return (trueColor ? tcEsc(HEX[t]) : x256Esc(X256[t])) + s + RESET;
  };
  const dimWrap = (s: string): string => (useColor ? DIM + s + RESET : s);

  const theme: Theme = {
    // legacy Styler surface — identical behavior to createStyler()
    accent: (s) => wrap('accent', s),
    orange: (s) => wrap('orange', s),
    bold: (s) => (useColor ? BOLD + s + RESET : s),
    dim: dimWrap,
    // semantic
    success: (s) => wrap('success', s),
    warning: (s) => wrap('warning', s),
    error: (s) => wrap('error', s),
    info: (s) => wrap('info', s),
    muted: (s) => wrap('muted', s),
    fg: (s) => wrap('fg', s),
    tone(name, s) {
      if (name === 'dim') return dimWrap(s);
      return wrap(name, s);
    },
    glyph(name) {
      if (unicode) {
        switch (name) {
          case 'ok':
            return '✓'; // ✓
          case 'warn':
            return '⚠'; // ⚠
          case 'err':
            return '✗'; // ✗
          case 'info':
            return '·'; // ·
          case 'bullet':
            return '·'; // ·
          case 'arrow':
            return '▸'; // ▸
          case 'pip':
            return '▰'; // ▰
          case 'rail':
            return '▌'; // ▌
          case 'spinner':
            return '⠋'; // ⠋
        }
      }
      switch (name) {
        case 'ok':
          return 'v';
        case 'warn':
          return '!';
        case 'err':
          return 'x';
        case 'info':
          return 'i';
        case 'bullet':
          return '*';
        case 'arrow':
          return '>';
        case 'pip':
          return '#';
        case 'rail':
          return '>';
        case 'spinner':
          return '|';
      }
    },
    useColor,
    trueColor,
    unicode
  };
  return theme;
}

/**
 * Lift an existing legacy Styler into a Theme. Preserves bit-for-bit output
 * for the four legacy methods (so visual goldens against current callers
 * stay clean), and adds the semantic surface on top.
 *
 * Detect color-on by probing accent('x') — under NO_COLOR / TERM=dumb the
 * createStyler() factory returns an identity-shaped styler, so 'x' === 'x'.
 */
export function liftStyler(legacy: Styler, opts: { trueColor: boolean; unicode?: boolean }): Theme {
  const useColor = legacy.accent('x') !== 'x';
  const fresh = createTheme({ useColor, trueColor: opts.trueColor, unicode: opts.unicode });
  // delegate the four legacy methods so existing callers see identical output
  fresh.accent = legacy.accent.bind(legacy);
  fresh.orange = legacy.orange.bind(legacy);
  fresh.bold = legacy.bold.bind(legacy);
  fresh.dim = legacy.dim.bind(legacy);
  return fresh;
}
