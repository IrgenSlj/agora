import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems, getTrendingItems, type MarketplaceItem,
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

interface HomeState { selected: number; }
const state: HomeState = { selected: 0 };

function pickPrimary(items: ReadonlyArray<MarketplaceItem>): MarketplaceItem | undefined {
  const filtered = items.filter((i) => i.id !== 'mcp-everything');
  let best: MarketplaceItem | undefined;
  for (const it of filtered) {
    if (!best || (it.installs ?? 0) > (best.installs ?? 0)) best = it;
  }
  return best;
}

// FIXTURE: stub for v1 reasoning sentence
function reason(_item: MarketplaceItem): string {
  return 'tag-IDF Jaccard 0.62 vs your install of mcp-postgres \u00b7 4/5 cohort kept both';
}

export const homePage: Page = {
  id: 'home',
  title: 'HOME',
  navLabel: 'Home',
  navIcon: 'H',
  hotkeys: [
    { key: 'r', label: 'refresh' },
    { key: '/', label: 'search' },
    { key: 'i', label: 'install last' },
    { key: 's', label: 'saved' },
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const items = getMarketplaceItems();
    const primary = pickPrimary(items);
    const trending = getTrendingItems().slice(0, 3);

    const lines: string[] = [];
    lines.push(' ' + style.bold('HOME') + style.dim('  recommended for you'));
    lines.push(' ' + sep('', width - 2, style));

    if (primary) {
      const stars = primary.stars !== undefined
        ? '  ' + fmtCount(primary.stars) + ' \u2605' : '';
      const stats = style.dim(fmtCount(primary.installs ?? 0) + ' installs' + stars);
      lines.push(' ' + rail(style) + style.bold(primary.name)
        + style.dim('  similar to mcp-postgres')
        + '   ' + stats);
      lines.push('   ' + style.dim((primary.description ?? '')
        + (primary.author ? '  \u00b7  ' + primary.author : '')));
      lines.push('   '
        + style.accent('i') + style.dim(' install') + '  '
        + style.accent('s') + style.dim(' save') + '  '
        + style.accent('Enter') + style.dim(' details') + '  '
        + style.dim('\u2500\u2500  why: ') + reason(primary));
    } else {
      lines.push(' ' + style.dim('(cold start) press ')
        + style.accent('2') + style.dim(' to browse the marketplace'));
    }
    lines.push('');
    lines.push(' ' + sep('Other suggestions', width - 2, style));
    if (trending.length === 0) {
      lines.push('   ' + style.dim('nothing trending in the last 24h'));
    } else {
      for (const t of trending) {
        const desc = (t.description ?? '').slice(0, Math.max(0, width - 28));
        lines.push('   ' + style.dim('\u00b7 ')
          + style.bold(t.name.padEnd(18)) + style.dim(desc));
      }
    }
    lines.push(' ' + sep('Community', width - 2, style));
    lines.push('   ' + style.dim('\u00b7 ') + style.accent('/mcp')
      + style.dim('   \u201cHow are you composing servers?\u201d   ')
      + style.dim('12 \u2191')); // FIXTURE
    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    switch (event.key) {
      case 'up': case 'k': state.selected = Math.max(0, state.selected - 1); return { kind: 'none' };
      case 'down': case 'j': state.selected += 1; return { kind: 'none' };
      case 'enter': return { kind: 'switch', to: 'marketplace' };
      case 'i': return { kind: 'status', message: 'install queued (fixture)' };
      case 's': return { kind: 'status', message: 'saved' };
      case 'r': return { kind: 'status', message: 'refreshed' };
      case '/': return { kind: 'switch', to: 'marketplace' };
      default: return { kind: 'none' };
    }
  },
};
