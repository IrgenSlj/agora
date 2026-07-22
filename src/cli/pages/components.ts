// src/cli/pages/components.ts
// Pure-string component vocabulary for the agora TUI.
// - All widths are ANSI-aware (use vlen, never .length).
// - No new dependencies; Bun/Node stdlib only.
// - Components accept a Theme (theme.ts). Many also accept a plain Styler
//   for callers that haven't migrated — see `themeLike` shim.

import type { SourceId } from '../../federation/types.js';
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

// ═══════════════════════════════════════════════════════════════════════════════
// TRUST COMPONENTS (redesign — engineering handoff §4)
//
// Every trust signal (scan verdict, provenance, drift, permissions) has ONE
// visual grammar reused identically everywhere: a user reads
// `✓ pass · [official] · no drift` at a glance on any screen. Verdict and
// provenance-official are RENDER MODES over existing tones (reverse-video,
// rule-weight), NOT new colors — so they survive NO_COLOR by glyph + weight +
// position alone. `drift` is the one genuinely new tone (theme.ts).
// ═══════════════════════════════════════════════════════════════════════════════

/** Scan/gate verdict — the spine of the trust grammar. */
export type Verdict = 'pass' | 'warn' | 'fail';
/** Provenance = the federation source of record (single source of truth). */
export type Provenance = SourceId;
/** Plaza origin — same badge grammar as provenance, different family. */
export type Origin =
  | 'HN'
  | 'Lobsters'
  | 'arXiv'
  | 'GitHub'
  | 'Bluesky'
  | 'Mastodon'
  | 'Discourse'
  | 'RSS';
/** One scan check line. */
export interface Check {
  id: string;
  tone: HealthTone;
  label: string;
}

const REV = '\x1b[7m';

const VERDICT_TONE: Record<Verdict, Tone> = { pass: 'success', warn: 'warning', fail: 'error' };
function verdictGlyph(v: Verdict, theme: Theme): string {
  return v === 'pass' ? theme.glyph('ok') : v === 'warn' ? theme.glyph('warn') : theme.glyph('err');
}

const PROV_LABEL: Record<Provenance, string> = {
  official: 'official',
  glama: 'glama',
  pulsemcp: 'pulse',
  'skills-github': 'skills',
  smithery: 'smithery',
  github: 'github',
  huggingface: 'hf',
  local: 'local'
};

/** A single provenance badge. `official` = accent reverse-video + always sorted first. */
export function provenanceBadge(p: Provenance, theme: Theme): string {
  const label = PROV_LABEL[p] ?? String(p);
  if (p === 'official') {
    return theme.useColor ? REV + theme.accent(' ' + label + ' ') + '\x1b[0m' : '*OFFICIAL*';
  }
  if (p === 'local') {
    return theme.dim('[' + label + ' cache]');
  }
  return theme.dim('[' + label + ']');
}

/** A row of provenance badges: official first (reverse-video), then alphabetical; deduped. */
export function provenanceBadges(sources: ReadonlyArray<Provenance>, theme: Theme): string {
  const uniq = [...new Set(sources)];
  uniq.sort((a, b) => (a === 'official' ? -1 : b === 'official' ? 1 : a.localeCompare(b)));
  return uniq.map((s) => provenanceBadge(s, theme)).join(' ');
}

/** A plaza origin chip (info-toned bracket), same grammar as provenance. */
export function originChip(origin: Origin, theme: Theme): string {
  return theme.useColor ? theme.info('[' + origin + ']') : '[' + origin + ']';
}

/** The small drift chip. `changed` → orchid ≠ drift; else dim "no drift". */
export function driftChip(changed: boolean, theme: Theme): string {
  return changed ? theme.tone('drift', theme.glyph('drift') + ' drift') : theme.dim('no drift');
}

/**
 * The one-glance trust line, used on every catalog row.
 * → "✓ pass · [official] · no drift"  (NO_COLOR: "v pass · *OFFICIAL* · no drift")
 */
export function statusTriad(v: Verdict, prov: Provenance, drift: boolean, theme: Theme): string {
  const verdict = theme.tone(VERDICT_TONE[v], verdictGlyph(v, theme) + ' ' + v);
  const sep = ' ' + theme.dim(theme.glyph('bullet')) + ' ';
  return [verdict, provenanceBadge(prov, theme), driftChip(drift, theme)].join(sep);
}

/**
 * The verdict banner — the ONE element allowed real visual weight (§4.4).
 * pass/warn → single ─ rule top+bottom; fail → ═ DOUBLE rule (used nowhere else).
 * Label chip is reverse-video. FAIL offers NO re-run hint (it is final).
 */
export function verdictBanner(o: {
  verdict: Verdict;
  headline: string;
  detail?: string;
  hint?: string;
  width: number;
  theme: Theme;
}): string[] {
  const { verdict, headline, detail, hint, width, theme } = o;
  const tone = VERDICT_TONE[verdict];
  const label = verdict.toUpperCase();
  const ruleCh = verdict === 'fail' ? (theme.unicode ? '═' : '=') : theme.unicode ? '─' : '-';
  const ruleLine = theme.tone(tone, ruleCh.repeat(Math.max(0, width)));
  const chipText = verdictGlyph(verdict, theme) + ' ' + label;
  const chip = theme.useColor ? REV + theme.tone(tone, ' ' + chipText + ' ') + '\x1b[0m' : chipText;
  const lines: string[] = [
    ruleLine,
    padRight(' ' + chip + '  ' + theme.bold(theme.fg(headline)), width)
  ];
  if (detail) lines.push(padRight('   ' + theme.muted(detail), width));
  // A hard FAIL is final — never offer a re-run flag.
  if (hint && verdict !== 'fail') lines.push(padRight('   ' + theme.dim(hint), width));
  lines.push(ruleLine);
  return lines;
}

/**
 * The trust panel (Item detail centerpiece, §4.3): scan summary + per-check
 * lines · declared→observed permissions · drift vs baseline.
 */
export function trustPanel(o: {
  scan: { pass: number; warn: number; fail: number; lines: ReadonlyArray<string> };
  perms: ReadonlyArray<{
    kind: 'fs' | 'net' | 'proc';
    tone: HealthTone;
    declared: string;
    observed?: string;
  }>;
  drift: { changed: boolean; baseline: string };
  width: number;
  theme: Theme;
}): string[] {
  const { scan, perms, drift, width, theme } = o;
  const lines: string[] = [];
  const summary = [
    theme.tone('success', theme.glyph('ok') + ' ' + scan.pass + ' pass'),
    theme.tone('warning', theme.glyph('warn') + ' ' + scan.warn + ' warn'),
    theme.tone('error', theme.glyph('err') + ' ' + scan.fail + ' fail')
  ].join('   ');
  lines.push(padRight(' ' + theme.muted(padRight('scan', 12)) + summary, width));
  for (const l of scan.lines) lines.push(padRight('   ' + theme.dim(l), width));
  lines.push(padRight(' ' + theme.muted('permissions'), width));
  for (const p of perms) {
    const obs = p.observed ? '  ' + theme.glyph('arrow') + ' ' + p.observed : '';
    const body = padRight(p.kind, 5) + p.declared + obs;
    lines.push(padRight('   ' + status(p.tone, body, theme), width));
  }
  const driftLine = drift.changed
    ? theme.tone('drift', theme.glyph('drift') + ' drift vs ' + drift.baseline)
    : theme.tone('success', theme.glyph('ok') + ' no drift vs ' + drift.baseline);
  lines.push(padRight(' ' + theme.muted(padRight('drift', 12)) + driftLine, width));
  return lines;
}

/**
 * The plan diff — the interface for every config write (Terraform-ish, §4.1/§5).
 * footer: "+2 add  ~1 update  -1 remove · writes N files · apply? [y/N]"
 * Plan-before-apply is non-negotiable: a page returns this; the shell writes.
 */
export function planDiff(
  sections: ReadonlyArray<{
    harness: string;
    file: string;
    changes: ReadonlyArray<{ op: '+' | '~' | '-'; name: string; detail: string }>;
  }>,
  width: number,
  theme: Theme
): string[] {
  const lines: string[] = [];
  let add = 0,
    upd = 0,
    rem = 0;
  let filesTouched = 0;
  for (const sec of sections) {
    if (sec.changes.length > 0) filesTouched++;
    lines.push(
      padRight(' ' + theme.bold(theme.accent(sec.harness)) + '  ' + theme.dim(sec.file), width)
    );
    for (const c of sec.changes) {
      const tone: Tone = c.op === '+' ? 'success' : c.op === '-' ? 'error' : 'warning';
      if (c.op === '+') add++;
      else if (c.op === '-') rem++;
      else upd++;
      lines.push(
        padRight('   ' + theme.tone(tone, c.op + ' ' + c.name) + '  ' + theme.dim(c.detail), width)
      );
    }
  }
  const dot = ' ' + theme.dim(theme.glyph('bullet')) + ' ';
  if (add + upd + rem === 0) {
    lines.push(
      padRight(
        ' ' + theme.success(theme.glyph('ok') + ' no changes — stack matches profile'),
        width
      )
    );
    return lines;
  }
  const summary =
    theme.tone('success', '+' + add + ' add') +
    '  ' +
    theme.tone('warning', '~' + upd + ' update') +
    '  ' +
    theme.tone('error', '-' + rem + ' remove') +
    dot +
    theme.dim('writes ' + filesTouched + ' file' + (filesTouched === 1 ? '' : 's')) +
    dot +
    theme.accent('apply?') +
    ' ' +
    theme.dim('[y/N]');
  lines.push(padRight(' ' + summary, width));
  return lines;
}
