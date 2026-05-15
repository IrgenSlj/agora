import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems, searchMarketplaceItems, type MarketplaceItem,
} from '../../marketplace.js';

// ── helpers ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vlen = (s: string): number => s.replace(ANSI_RE, '').length;
function padRight(s: string, w: number): string {
  const need = w - vlen(s);
  return need > 0 ? s + ' '.repeat(need) : s;
}
function truncate(s: string, w: number): string {
  if (vlen(s) <= w) return s;
  const plain = s.replace(ANSI_RE, '');
  return plain.slice(0, Math.max(0, w - 1)) + '\u2026';
}
function rail(style: { accent(s: string): string }): string {
  return style.accent('x') === 'x' ? '> ' : style.accent('\u258c') + ' ';
}
function noRail(): string { return '  '; }
function sep(label: string, width: number, style: { dim(s: string): string }): string {
  if (!label) return style.dim('\u2500'.repeat(Math.max(0, width)));
  const head = '\u2500\u2500 ' + label + ' ';
  const fill = Math.max(0, width - head.length);
  return style.dim(head + '\u2500'.repeat(fill));
}
function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}
function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(padRight(truncate(lines[i] ?? '', width), width));
  }
  return out.join('\n');
}
// ──────────────────────────────────────────────────────────────────────────────

type SortKey = 'installs' | 'stars' | 'name';
interface MpState {
  cursor: number;
  detail: boolean;
  query: string;
  filtering: boolean;
  category: string;
  sort: SortKey;
}
const state: MpState = {
  cursor: 0, detail: false, query: '', filtering: false,
  category: 'all', sort: 'installs',
};

function filtered(): MarketplaceItem[] {
  const all = state.query ? searchMarketplaceItems({ query: state.query }) : getMarketplaceItems();
  const sorted = all.slice().sort((a, b) => {
    if (state.sort === 'name') return a.name.localeCompare(b.name);
    if (state.sort === 'stars') return (b.stars ?? 0) - (a.stars ?? 0);
    return (b.installs ?? 0) - (a.installs ?? 0);
  });
  return state.category === 'all'
    ? sorted
    : sorted.filter((i) => (i.tags ?? []).includes(state.category));
}

export const marketplacePage: Page = {
  id: 'marketplace',
  title: 'MARKETPLACE',
  navLabel: 'Market',
  navIcon: 'M',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'details' },
    { key: 'i', label: 'install' },
    { key: 's', label: 'save' },
    { key: '/', label: 'filter' },
    { key: 'c', label: 'category' },
    { key: 'o', label: 'sort' },
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const items = filtered();
    state.cursor = Math.min(state.cursor, Math.max(0, items.length - 1));
    const lines: string[] = [];
    const top = ' ' + style.bold(style.accent('MARKETPLACE'))
      + '   ' + style.dim('category: ') + style.accent(state.category)
      + style.dim('  \u00b7  sort: ') + style.accent(state.sort)
      + '   ' + style.dim(items.length + (items.length === 1 ? ' item' : ' items'));
    lines.push(top);
    lines.push(' ' + sep('', width - 2, style));

    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.query + style.dim('\u258f'));
      lines.push('');
    }

    if (items.length === 0) {
      lines.push('');
      lines.push('   ' + style.dim('No items match ')
        + style.accent(state.query || state.category) + style.dim('.'));
      lines.push('   ' + style.dim('Press ') + style.accent('/')
        + style.dim(' to change filter, ') + style.accent('c')
        + style.dim(' to reset category.'));
      return frame(lines, width, height);
    }

    if (state.detail) {
      const it = items[state.cursor];
      if (it) {
        lines.push('');
        lines.push(' ' + style.bold(it.name)
          + (it.author ? style.dim('   by ' + it.author) : ''));
        lines.push(' ' + style.dim((it.tags ?? []).map((t) => '[' + t + ']').join(' ')));
        lines.push('');
        lines.push(' ' + (it.description ?? ''));
        lines.push('');
        lines.push(' '
          + style.accent(fmtCount(it.installs ?? 0)) + style.dim(' installs   ')
          + (it.stars !== undefined
            ? style.accent(fmtCount(it.stars)) + style.dim(' \u2605') : ''));
        lines.push('');
        lines.push(' '
          + style.accent('i') + style.dim(' install   ')
          + style.accent('s') + style.dim(' save   ')
          + style.accent('Esc') + style.dim(' back'));
      }
      return frame(lines, width, height);
    }

    const limit = Math.max(0, height - lines.length - 1);
    const start = Math.max(0,
      Math.min(state.cursor - Math.floor(limit / 2), items.length - limit));
    for (let i = 0; i < limit && start + i < items.length; i++) {
      const it = items[start + i];
      if (!it) continue;
      const selected = start + i === state.cursor;
      const lead = selected ? rail(style) : noRail();
      const stats = style.accent(fmtCount(it.installs ?? 0).padStart(7))
        + style.dim(' installs')
        + (it.stars !== undefined
          ? '  ' + style.accent(fmtCount(it.stars).padStart(5)) + style.dim(' \u2605')
          : '');
      const nameCell = selected ? style.bold(it.name) : it.name;
      const left = ' ' + lead + nameCell;
      const room = width - vlen(left) - vlen(stats) - 1;
      const desc = style.dim((it.description ?? '').slice(0, Math.max(0, room - 2)));
      const pad = ' '.repeat(Math.max(1, room - vlen(desc) - 1));
      lines.push(left + '  ' + desc + pad + stats);
    }
    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    if (state.filtering) {
      if (event.key === 'esc') { state.filtering = false; state.query = ''; return { kind: 'none' }; }
      if (event.key === 'enter') { state.filtering = false; return { kind: 'none' }; }
      if (event.key === 'backspace') { state.query = state.query.slice(0, -1); return { kind: 'none' }; }
      if (event.key.length === 1 && !event.ctrl) { state.query += event.key; return { kind: 'none' }; }
      return { kind: 'none' };
    }
    const items = filtered();
    switch (event.key) {
      case 'j': case 'down':
        state.cursor = Math.min(items.length - 1, state.cursor + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.cursor = Math.max(0, state.cursor - 1); return { kind: 'none' };
      case 'enter': state.detail = !state.detail; return { kind: 'none' };
      case 'esc': if (state.detail) state.detail = false; return { kind: 'none' };
      case 'i': {
        const it = items[state.cursor];
        return { kind: 'status', message: it ? 'install ' + it.id + ' queued' : 'nothing selected' };
      }
      case 's': return { kind: 'status', message: 'saved' };
      case '/': state.filtering = true; return { kind: 'none' };
      case 'c': {
        const order = ['all', 'db', 'fs', 'web', 'ai'];
        state.category = order[(order.indexOf(state.category) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'o': {
        const order: SortKey[] = ['installs', 'stars', 'name'];
        state.sort = order[(order.indexOf(state.sort) + 1) % order.length] ?? 'installs';
        return { kind: 'none' };
      }
      default: return { kind: 'none' };
    }
  },
};
