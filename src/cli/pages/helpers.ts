import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SourceOptions } from '../../live.js';
import { loadAgoraState, getAuthState } from '../../state.js';
import type { PageContext } from './types.js';

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

/**
 * Render a scrollbar for a list viewport.
 * Returns an array of `height` strings, each being a 1-char scroll indicator.
 * The thumb position is proportional to the list position.
 */
export function scrollbar(
  listLength: number,
  viewportHeight: number,
  cursorIndex: number,
  style: { dim(s: string): string; accent(s: string): string }
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

/**
 * Build SourceOptions for backend-fronted page calls.
 *
 * Reads AGORA_API_URL / AGORA_TOKEN from process env first; falls back to the
 * persisted auth state. When `requireAuth` is true and credentials are missing,
 * returns null so callers can render a "sign in" hint instead of firing a doomed
 * request. When `requireAuth` is false (default), returns a permissive options
 * object — useful for read-only endpoints that have offline fallbacks.
 */
export function pageSourceOptions(
  ctx: PageContext,
  opts: { requireAuth?: boolean } = {}
): SourceOptions | null {
  const env = ctx.io.env ?? {};
  const configured = env.AGORA_HOME || process.env.AGORA_HOME;
  const xdg = env.XDG_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const dir = configured || join(xdg, 'agora');
  let apiUrl = process.env.AGORA_API_URL || '';
  let token = process.env.AGORA_TOKEN || process.env.AGORA_API_TOKEN || '';
  if (!apiUrl || !token) {
    try {
      const auth = getAuthState(loadAgoraState(dir));
      if (auth) {
        if (!apiUrl) apiUrl = auth.apiUrl || '';
        if (!token) token = auth.accessToken || '';
      }
    } catch {
      /* ignore */
    }
  }
  if (opts.requireAuth && (!apiUrl || !token)) return null;
  return { useApi: Boolean(apiUrl), apiUrl, token, fetcher: ctx.io.fetcher, timeoutMs: 10000 };
}

