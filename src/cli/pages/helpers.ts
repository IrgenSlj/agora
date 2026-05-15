// eslint-disable-next-line no-control-regex
export const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function vlen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

export function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}

export function truncate(s: string, w: number): string {
  if (vlen(s) <= w) return s;
  const plain = s.replace(ANSI_RE, '');
  return plain.slice(0, Math.max(0, w - 1)) + '\u2026';
}

export function rail(style: { accent(s: string): string }): string {
  return style.accent('x') === 'x' ? '> ' : style.accent('\u258c') + ' ';
}

export function noRail(): string {
  return '  ';
}

export function sep(label: string, width: number, style: { dim(s: string): string }): string {
  if (!label) return style.dim('\u2500'.repeat(Math.max(0, width)));
  const head = '\u2500\u2500 ' + label + ' ';
  const fill = Math.max(0, width - head.length);
  return style.dim(head + '\u2500'.repeat(fill));
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(padRight(truncate(lines[i] ?? '', width), width));
  }
  return out.join('\n');
}

/** Box-drawing characters (with ASCII fallback if useAscii) */
export function box(useAscii: boolean): { tl: string; tr: string; bl: string; br: string; h: string; v: string } {
  if (useAscii) return { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };
  return { tl: '\u250c', tr: '\u2510', bl: '\u2514', br: '\u2518', h: '\u2500', v: '\u2502' };
}

/**
 * Render a scrollbar for a list viewport.
 * Returns an array of `height` strings, each being a 1-char scroll indicator.
 * The thumb position is proportional to the list position.
 */
export function scrollbar(
  listLength: number,
  viewportHeight: number,
  cursorIndex: number,
  style: { dim(s: string): string; accent(s: string): string },
): string[] {
  const bar: string[] = [];
  if (listLength <= viewportHeight) {
    for (let i = 0; i < viewportHeight; i++) bar.push(' ');
    return bar;
  }
  const thumbPos = Math.round((cursorIndex / (listLength - 1)) * (viewportHeight - 1));
  for (let i = 0; i < viewportHeight; i++) {
    bar.push(i === thumbPos ? style.accent('\u2588') : style.dim('\u2591'));
  }
  return bar;
}
