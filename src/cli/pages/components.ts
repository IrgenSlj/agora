// src/cli/pages/components.ts
// Pure-string component vocabulary for the agora TUI.
// - All widths are ANSI-aware (use vlen, never .length).
// - No new dependencies; Bun/Node stdlib only.
// - Components accept a Theme (theme.ts). Many also accept a plain Styler
//   for callers that haven't migrated — see `themeLike` shim.

import type { Theme, Tone } from '../theme.js';

// ── width helpers ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const vlen = (s: string): number => s.replace(ANSI_RE, '').length;

export function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}
export function padLeft(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? ' '.repeat(need) + s : s;
}
export function truncate(s: string, w: number): string {
  if (vlen(s) <= w) return s;
  const plain = s.replace(ANSI_RE, '');
  return plain.slice(0, Math.max(0, w - 1)) + '…';
}
export function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) out.push(padRight(truncate(lines[i] ?? '', width), width));
  return out.join('\n');
}

// ── rules / rails ────────────────────────────────────────────────────────────
export function rule(width: number, label: string | undefined, theme: Theme): string {
  if (!label) return theme.dim('─'.repeat(Math.max(0, width)));
  const head = '── ' + label + ' ';
  return theme.dim(head + '─'.repeat(Math.max(0, width - head.length)));
}
export function rail(theme: Theme, selected: boolean = true): string {
  if (!selected) return '  ';
  return theme.useColor ? theme.accent(theme.glyph('rail')) + ' ' : '> ';
}

// ── chips / pills / tags ─────────────────────────────────────────────────────
export function pill(text: string, tone: Tone, theme: Theme): string {
  return theme.tone(tone, ' ' + text + ' ');
}
export function tagList(tags: ReadonlyArray<string>, theme: Theme): string {
  return tags.map((t) => theme.dim('[' + t + ']')).join(' ');
}

// ── key/value rows ───────────────────────────────────────────────────────────
export function kvRow(key: string, value: string, keyW: number, theme: Theme): string {
  return theme.muted(padRight(key, keyW)) + value;
}

// ── status (glyph + label, NO_COLOR-safe) ────────────────────────────────────
export type HealthTone = 'success' | 'warning' | 'error' | 'info';
export function status(tone: HealthTone, label: string, theme: Theme): string {
  const g =
    tone === 'success'
      ? theme.glyph('ok')
      : tone === 'warning'
        ? theme.glyph('warn')
        : tone === 'error'
          ? theme.glyph('err')
          : theme.glyph('info');
  return theme.tone(tone, g) + (label ? ' ' + label : '');
}

// ── sparkline / health stripe / progress ─────────────────────────────────────
export function sparkline(values: ReadonlyArray<number>, theme: Theme): string {
  if (values.length === 0) return '';
  const max = Math.max(1, ...values);
  const blocks = theme.unicode
    ? ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    : ['_', '.', '-', '~', '=', '+', '*', '#'];
  let out = '';
  for (const v of values) {
    const norm = Math.max(0, Math.min(1, v / max));
    const idx = Math.min(blocks.length - 1, Math.floor(norm * (blocks.length - 1)));
    out += blocks[idx]!;
  }
  return theme.accent(out);
}

/** A row of colored pips, newest-right. */
export function healthStripe(states: ReadonlyArray<HealthTone>, theme: Theme): string {
  const pip = theme.glyph('pip');
  return states.map((s) => theme.tone(s, pip)).join('');
}

export function progress(pct: number, width: number, theme: Theme): string {
  const clamped = Math.max(0, Math.min(1, pct));
  const cells = Math.floor(clamped * width);
  if (theme.unicode) {
    return theme.accent('█'.repeat(cells)) + theme.dim('░'.repeat(Math.max(0, width - cells)));
  }
  return theme.accent('#'.repeat(cells)) + theme.dim('-'.repeat(Math.max(0, width - cells)));
}

// ── spinner frames ───────────────────────────────────────────────────────────
export const SPINNER_BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
export const SPINNER_ASCII = ['|', '/', '-', '\\'] as const;
export function spinnerFrame(tick: number, theme: Theme): string {
  const frames = theme.unicode ? SPINNER_BRAILLE : SPINNER_ASCII;
  const i = ((tick % frames.length) + frames.length) % frames.length;
  return theme.accent(frames[i] as string);
}

// ── table rows ───────────────────────────────────────────────────────────────
export interface TableCell {
  text: string;
  width: number;
  align?: 'left' | 'right';
}
export function tableRow(cells: ReadonlyArray<TableCell>, gap: number, theme: Theme): string {
  void theme;
  return cells
    .map((c) => {
      const t = truncate(c.text, c.width);
      return c.align === 'right' ? padLeft(t, c.width) : padRight(t, c.width);
    })
    .join(' '.repeat(Math.max(0, gap)));
}

// ── page header (title + breadcrumbs + right cluster) ────────────────────────
export interface PageHeaderOpts {
  title: string;
  crumbs?: ReadonlyArray<string>;
  right?: string;
  width: number;
  theme: Theme;
}
export function pageHeader(o: PageHeaderOpts): string {
  const { title, crumbs, right, width, theme } = o;
  const trail = (crumbs ?? []).length
    ? '  ' + theme.dim((crumbs ?? []).join('  ' + theme.glyph('arrow') + '  '))
    : '';
  const left = ' ' + theme.bold(theme.accent(title)) + trail;
  if (!right) return padRight(left, width);
  const gap = Math.max(1, width - vlen(left) - vlen(right) - 1);
  return left + ' '.repeat(gap) + right + ' ';
}

// ── key-hint footer / status line / toast ────────────────────────────────────
export interface KeyHint {
  key: string;
  label: string;
}
export function keyHintBar(hints: ReadonlyArray<KeyHint>, width: number, theme: Theme): string {
  const sep = '  ' + theme.dim('·') + '  ';
  const parts = hints.map((h) => theme.accent(h.key) + ' ' + theme.dim(h.label));
  let line = ' ' + parts.join(sep);
  if (vlen(line) > width) {
    const acc: string[] = [];
    let used = 1;
    for (const p of parts) {
      const next = (acc.length ? vlen(sep) : 0) + vlen(p);
      if (used + next > width - 2) break;
      acc.push(p);
      used += next;
    }
    line = ' ' + acc.join(sep) + '  ' + theme.dim('…');
  }
  return padRight(line, width);
}

export function statusLine(
  message: string,
  tone: Tone | undefined,
  width: number,
  theme: Theme
): string {
  if (!message) return ' '.repeat(width);
  const t: Tone = tone ?? 'muted';
  const glyph =
    tone === 'error'
      ? theme.glyph('err') + ' '
      : tone === 'warning'
        ? theme.glyph('warn') + ' '
        : tone === 'success'
          ? theme.glyph('ok') + ' '
          : tone === 'info'
            ? theme.glyph('info') + ' '
            : '';
  return padRight(' ' + theme.tone(t, glyph + message), width);
}

// ── responsive utility ───────────────────────────────────────────────────────
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg';
export function bp(width: number): Breakpoint {
  if (width < 60) return 'xs';
  if (width < 80) return 'sm';
  if (width < 120) return 'md';
  return 'lg';
}
