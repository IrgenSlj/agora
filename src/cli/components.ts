// The shared string components the command output still uses.
//
// This was a 445-line component vocabulary for the full-screen TUI: pills,
// sparklines, health stripes, spinners, table rows, page headers, key-hint
// bars, breakpoints, and a second set of trust widgets. The TUI was retired
// under brief DA-14 and took all of its callers with it.
//
// What survived is what the ordinary commands print. Three functions, plus the
// ANSI-aware padding one of them needs. Everything else was kept alive only by
// its own tests, which is not a caller.
//
// The trust chips that used to live here — `trustPanel`, `verdictBanner`,
// `statusTriad`, the provenance badges — are not the ones `agora trust` renders.
// That output is built in `trust-view.ts` and always was; these were the TUI's
// parallel implementation of the same idea, and keeping two would guarantee
// they eventually disagreed about what a verdict looks like.

import type { Theme } from './theme.js';

// Widths must be measured after the escape sequences, or a coloured string
// pads as though its colour codes were visible characters.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vlen = (s: string): number => s.replace(ANSI_RE, '').length;

function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}

/** `[tag] [tag]` — dimmed, space-separated. */
export function tagList(tags: ReadonlyArray<string>, theme: Theme): string {
  return tags.map((t) => theme.dim('[' + t + ']')).join(' ');
}

/** A left-aligned label column followed by its value. */
export function kvRow(key: string, value: string, keyW: number, theme: Theme): string {
  return theme.muted(padRight(key, keyW)) + value;
}

export type HealthTone = 'success' | 'warning' | 'error' | 'info';

/**
 * Glyph plus label. The glyph comes from the theme rather than a literal so
 * that `NO_COLOR` and `TERM=dumb` degrade to ASCII instead of losing the
 * distinction between a pass and a failure entirely.
 */
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
