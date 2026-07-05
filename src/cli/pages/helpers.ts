import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SourceOptions } from '../../live.js';
import { loadAgoraState, getAuthState } from '../../state.js';
import type { PageContext } from './types.js';
import type { MarketplaceItem } from '../../marketplace.js';
import type { FederatedItem } from '../../federation/types.js';
import { observedCapabilities, type ScanResult } from '../../scan.js';
import type { HealthTone, Verdict } from './components.js';

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

// ── shared trust-panel inputs (Acquire's GATE stage + the Item page) ───────
// Both pages resolve an item over federation, run the scan gate, and render
// the same `trustPanel` (components.ts) centerpiece — so the declared-vs-
// observed permission rows and the drift-vs-baseline summary are computed
// once here instead of drifting into two copies.

const PERM_LABEL: Record<'fs' | 'net' | 'exec', 'fs' | 'net' | 'proc'> = {
  fs: 'fs',
  net: 'net',
  exec: 'proc'
};

export interface PermRow {
  kind: 'fs' | 'net' | 'proc';
  tone: HealthTone;
  declared: string;
  observed?: string;
}

/** Declared (item.permissions) vs observed (tool-schema heuristics) — reuses
 * the same categories `checkObservedPermissions` (src/scan.ts) computes for
 * the scan, rather than re-parsing that check's free-text message. */
export function buildPermRows(item: MarketplaceItem, tools: FederatedItem['tools']): PermRow[] {
  const perms = item.kind === 'package' ? item.permissions : undefined;
  const observed = observedCapabilities(tools ?? []);
  const rows: PermRow[] = [];
  (['fs', 'net', 'exec'] as const).forEach((cat) => {
    const declaredList = perms?.[cat];
    const isObserved = observed.has(cat);
    if (!declaredList?.length && !isObserved) return;
    const tone: HealthTone = !declaredList?.length && isObserved ? 'warning' : 'success';
    rows.push({
      kind: PERM_LABEL[cat],
      tone,
      declared: declaredList?.length ? declaredList.join(', ') : '(not declared)',
      observed: isObserved ? 'observed in tool schemas' : undefined
    });
  });
  if (rows.length === 0) {
    rows.push({
      kind: 'fs',
      tone: 'success',
      declared: 'no fs/net/exec signal declared or observed'
    });
  }
  return rows;
}

/** Description-drift-vs-baseline summary for the trust panel's `drift` row. */
export function buildDrift(scan: ScanResult): { changed: boolean; baseline: string } {
  const check = scan.checks.find((c) => c.name === 'description_drift');
  if (!check) return { changed: false, baseline: 'no baseline recorded yet' };
  return { changed: check.status !== 'pass', baseline: 'approved baseline' };
}

/** The gate verdict — fail on any failed check, else warn on any warning, else pass. */
export function scanVerdict(scan: ScanResult): Verdict {
  if (scan.summary.fail > 0) return 'fail';
  if (scan.summary.warn > 0) return 'warn';
  return 'pass';
}
