// The layout pieces every screen is built from (docs/TERMINAL.md): a header
// line, section titles, dot-leader rows, a rule and a summary footer. Content
// is indented two columns and laid out on a 62-column measure.

import type { GlyphName, Theme } from './theme.js';

export const MEASURE = 62;

// Widths are measured without escape sequences, or a coloured string pads as
// though its colour codes were visible characters.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const vlen = (s: string): number => [...s.replace(ANSI_RE, '')].length;

export function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}

export type HealthTone = 'success' | 'warning' | 'error' | 'unknown' | 'info';

const GLYPH: Record<HealthTone, GlyphName> = {
  success: 'ok',
  warning: 'warn',
  error: 'fail',
  unknown: 'unknown',
  info: 'info'
};

/** A state glyph in its colour, then the label. The glyph alone must carry the state. */
export function status(tone: HealthTone, label: string, theme: Theme): string {
  return theme.tone(tone, theme.glyph(GLYPH[tone])) + (label ? ` ${label}` : '');
}

/** `░▒▓█ agora <command>` with optional context right-aligned on the measure. */
export function headerLine(command: string, context: string, theme: Theme): string {
  const left = `${theme.accent(theme.glyph('ramp'))} ${theme.bold('agora')} ${command}`;
  if (!context) return `  ${left}`;
  const gap = Math.max(2, MEASURE - vlen(left) - vlen(context));
  return `  ${left}${' '.repeat(gap)}${theme.muted(context)}`;
}

/** An uppercase section title with an optional count or label right-aligned. */
export function section(title: string, theme: Theme, right = ''): string {
  const t = title.toUpperCase();
  if (!right) return `  ${theme.bold(t)}`;
  return `  ${theme.bold(t)}${' '.repeat(Math.max(2, MEASURE - t.length - vlen(right)))}${theme.muted(right)}`;
}

/** `label ······ value`, filling the measure with faint dot leaders. */
export function leader(label: string, value: string, theme: Theme, width = MEASURE): string {
  const dots = Math.max(2, width - vlen(label) - vlen(value) - 2);
  return `${label} ${theme.muted(theme.glyph('leader').repeat(dots))} ${value}`;
}

/** A row: glyph, label column, middle text and a right-aligned value, joined by leaders. */
export function row(
  tone: HealthTone | undefined,
  label: string,
  middle: string,
  right: string,
  theme: Theme,
  labelWidth = 18
): string {
  const head = tone ? `${status(tone, '', theme)} ` : '';
  const width = MEASURE - vlen(head);
  if (!middle) return `  ${head}${leader(label, right, theme, width)}`;
  const first = leader(label, '', theme, labelWidth).trimEnd();
  return `  ${head}${first} ${leader(middle, right, theme, width - vlen(first) - 1)}`;
}

export function rule(theme: Theme): string {
  return `  ${theme.muted(theme.glyph('rule').repeat(MEASURE))}`;
}

/** The closing tally: `7 pass · 2 warn · 1 fail`, zero counts left out. */
export function tally(parts: [number, string][], theme: Theme): string {
  const sep = ` ${theme.glyph('leader')} `;
  return `  ${parts
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`)
    .join(theme.muted(sep))}`;
}

/** `[tag] [tag]`, faint. */
export function tagList(tags: ReadonlyArray<string>, theme: Theme): string {
  return tags.map((t) => theme.dim(`[${t}]`)).join(' ');
}

/** A left-aligned label column followed by its value. */
export function kvRow(key: string, value: string, keyW: number, theme: Theme): string {
  return theme.muted(padRight(key, keyW)) + value;
}
