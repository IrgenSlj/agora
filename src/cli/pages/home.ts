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

// FIXTURE: real impl is tag-IDF Jaccard against user's most recent install.
function reason(_item: MarketplaceItem): string {
  return 'shares tags [db, sql, postgres, realtime] with packages you have installed';
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
    lines.push('');
    lines.push('  ' + sep('Recommended for you', width - 2, style));
    lines.push('');
    if (primary) {
      lines.push('  ' + rail(style) + style.bold(primary.name)
        + style.dim('   (top-installed package)'));
      if (primary.description) {
        lines.push('     ' + style.dim(primary.description)
          + (primary.author ? style.dim(' \u00b7 ' + primary.author) : ''));
      }
      lines.push('     '
        + style.accent(fmtCount(primary.installs ?? 0)) + style.dim(' installs')
        + (primary.stars !== undefined
          ? '   ' + style.accent(fmtCount(primary.stars)) + style.dim(' \u2605')
          : ''));
      lines.push('');
      lines.push('     '
        + style.accent('i') + style.dim(' install    ')
        + style.accent('s') + style.dim(' save    ')
        + style.accent('Enter') + style.dim(' view full details'));
      lines.push('');
      lines.push('     ' + style.dim('Why: ') + reason(primary));
    } else {
      lines.push('  ' + style.dim('Nothing to recommend yet \u2014 press ')
        + style.accent('2') + style.dim(' to browse the marketplace.'));
    }
    lines.push('');
    lines.push('');
    lines.push('  ' + sep('Other suggestions', width - 2, style));
    lines.push('');
    if (trending.length === 0) {
      lines.push('     ' + style.dim('Nothing trending right now.'));
    } else {
      for (const t of trending) {
        lines.push('     \u00b7 ' + style.bold(t.name.padEnd(20))
          + style.dim(t.description ?? ''));
      }
    }
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
