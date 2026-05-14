/**
 * Terminal styling for the agora CLI — a flat, minimal look: one accent colour
 * for identifiers, dim for everything secondary, plain foreground for body text,
 * plus a gradient wordmark banner for the standalone hub experience.
 *
 * Colour is opt-in. It is emitted only to an interactive TTY, and never under
 * `NO_COLOR`, `TERM=dumb`, or `--json`. Non-TTY callers (pipes, the test
 * harness) get plain strings, so output stays assertable.
 *
 * NOTE: the banner art below is a PLACEHOLDER. The final wordmark + palette are
 * being designed separately — see docs/claude-design-brief.md. The render
 * pipeline (gradient, truecolor/256 fallback, no-colour degradation) is final;
 * only the `AGORA_WORDMARK` lines and `BANNER_GRADIENT` stops get swapped.
 */

export interface Styler {
  accent(value: string): string;
  dim(value: string): string;
  bold(value: string): string;
}

type RGB = [number, number, number];

const RESET = '\x1b[0m';
const CODES = {
  accent: '36', // cyan
  dim: '2',
  bold: '1'
} as const;

const plain: Styler = {
  accent: (value) => value,
  dim: (value) => value,
  bold: (value) => value
};

export function createStyler(useColor: boolean): Styler {
  if (!useColor) return plain;
  const wrap = (code: string) => (value: string) => `\x1b[${code}m${value}${RESET}`;
  return {
    accent: wrap(CODES.accent),
    dim: wrap(CODES.dim),
    bold: wrap(CODES.bold)
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

// ── Banner ──────────────────────────────────────────────────────────────────

/** PLACEHOLDER wordmark — fixed-width (39 cols) block letters, 5 rows. */
const AGORA_WORDMARK = [
  ' █████   ██████  █████  ██████   █████ ',
  '██   ██ ██      ██   ██ ██   ██ ██   ██',
  '███████ ██  ███ ██   ██ ██████  ███████',
  '██   ██ ██   ██ ██   ██ ██  ██  ██   ██',
  '██   ██  ██████  █████  ██   ██ ██   ██'
];

/** PLACEHOLDER gradient — indigo → violet → pink, left to right. */
const BANNER_GRADIENT: RGB[] = [
  [99, 102, 241],
  [168, 85, 247],
  [236, 72, 153]
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
  /** Dim line printed under the wordmark. */
  subtitle?: string;
}

/**
 * Renders the AGORA wordmark with a left-to-right gradient applied per column
 * (so the gradient stays aligned across all rows), followed by an optional
 * dim subtitle. Degrades to plain block letters when colour is off.
 */
export function renderBanner(opts: BannerOptions): string {
  const width = Math.max(...AGORA_WORDMARK.map((line) => line.length));

  const lines = AGORA_WORDMARK.map((line) => {
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
