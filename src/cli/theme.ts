// The semantic layer every command prints through: tones, glyphs and the
// shared layout pieces of docs/TERMINAL.md.
//
// A state is always a glyph first (✓ ✗ ! ?), so it survives NO_COLOR, and an
// ASCII glyph when the terminal is not UTF-8. Unknown has its own glyph and
// colour and never borrows success's.

import {
  type ColorDepth,
  colorDepth,
  paint,
  type Styler,
  supportsUnicode,
  TOKENS,
  type TokenName
} from '../ui.js';
import type { CliIo } from './flags.js';

export type Tone = TokenName | 'info' | 'dim' | 'fg';

export type GlyphName =
  | 'ok'
  | 'fail'
  | 'warn'
  | 'unknown'
  | 'info'
  | 'denied'
  | 'signed'
  | 'unsigned'
  | 'link'
  | 'start'
  | 'end'
  | 'rail'
  | 'leader'
  | 'rule'
  | 'arrow'
  | 'ramp';

const GLYPHS: Record<GlyphName, [unicode: string, ascii: string]> = {
  ok: ['✓', 'v'],
  fail: ['✗', 'x'],
  warn: ['!', '!'],
  unknown: ['?', '?'],
  info: ['•', '>'],
  denied: ['■', '#'],
  signed: ['◆', '*'],
  unsigned: ['◇', '~'],
  link: ['●', 'o'],
  start: ['┌─', '.-'],
  end: ['└─', "'-"],
  rail: ['│', '|'],
  leader: ['·', '.'],
  rule: ['─', '-'],
  arrow: ['→', '->'],
  ramp: ['░▒▓█', '.:=#']
};

export interface Theme extends Styler {
  success(s: string): string;
  warning(s: string): string;
  error(s: string): string;
  unknown(s: string): string;
  /** Informational text: the accent. */
  info(s: string): string;
  /** Secondary text: faint. */
  muted(s: string): string;
  fg(s: string): string;
  tone(name: Tone, s: string): string;
  glyph(name: GlyphName): string;
  readonly useColor: boolean;
  readonly depth: ColorDepth;
  readonly trueColor: boolean;
  readonly unicode: boolean;
}

export interface CreateThemeOpts {
  useColor: boolean;
  depth?: ColorDepth;
  /** Shorthand for depth 'truecolor' (true) or '256' (false). */
  trueColor?: boolean;
  unicode?: boolean;
}

const RESET = '\x1b[0m';

export function createTheme(opts: CreateThemeOpts): Theme {
  const useColor = Boolean(opts.useColor);
  const depth: ColorDepth = opts.depth ?? (opts.trueColor ? 'truecolor' : '256');
  const unicode = opts.unicode !== false;
  const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}${RESET}` : s);
  const faint = sgr('2');
  const color = (t: TokenName) => (s: string) => (useColor ? paint(TOKENS[t], depth, s) : s);
  const tones: Record<Tone, (s: string) => string> = {
    accent: color('accent'),
    success: color('success'),
    warning: color('warning'),
    error: color('error'),
    unknown: color('unknown'),
    // Muted is faint on every tier: it recedes on any background.
    muted: faint,
    info: color('accent'),
    dim: faint,
    fg: (s) => s
  };
  return {
    accent: tones.accent,
    dim: faint,
    bold: sgr('1'),
    success: tones.success,
    warning: tones.warning,
    error: tones.error,
    unknown: tones.unknown,
    info: tones.info,
    muted: tones.muted,
    fg: tones.fg,
    tone: (name, s) => tones[name](s),
    glyph: (name) => GLYPHS[name][unicode ? 0 : 1],
    useColor,
    depth,
    trueColor: depth === 'truecolor',
    unicode
  };
}

/** The full theme for one CLI run: colour from the styler, depth and glyphs from the env. */
export function cliTheme(style: Styler, io: CliIo): Theme {
  const env = io.env ?? process.env;
  return createTheme({
    useColor: style.accent('x') !== 'x',
    depth: colorDepth(env),
    unicode: supportsUnicode(env)
  });
}
