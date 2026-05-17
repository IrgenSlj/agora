import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems,
  getTrendingItems,
  similarItems,
  type MarketplaceItem
} from '../../marketplace.js';
import { rail, sep, fmtCount, frame } from './helpers.js';

interface HomeState {
  selected: number;
}
const state: HomeState = { selected: 0 };

let cachedPrimary: MarketplaceItem | undefined;
let cachedSimilar: MarketplaceItem[] = [];

function pickPrimary(items: ReadonlyArray<MarketplaceItem>): MarketplaceItem | undefined {
  const filtered = items.filter((i) => i.id !== 'mcp-everything');
  let best: MarketplaceItem | undefined;
  for (const it of filtered) {
    if (!best || (it.installs ?? 0) > (best.installs ?? 0)) best = it;
  }
  return best;
}

function refreshRecommendations(items: ReadonlyArray<MarketplaceItem>): void {
  const itemsArr = items as MarketplaceItem[];
  const seed =
    itemsArr.find((i) => i.id === 'mcp-postgres' || i.id === 'mcp-github') ?? pickPrimary(itemsArr);
  cachedPrimary = seed;
  if (seed) {
    const type = seed.kind === 'workflow' ? 'workflow' : 'package';
    cachedSimilar = similarItems(seed.id, { limit: 3, type: type as any }).filter(
      (s) => s.id !== seed.id
    );
  } else {
    cachedSimilar = [];
  }
}

function reason(item: MarketplaceItem, seed: MarketplaceItem | undefined): string {
  if (!seed) return '';
  const shared = (item.tags ?? []).filter((t) => (seed.tags ?? []).includes(t));
  if (shared.length > 0)
    return 'shares tags [' + shared.slice(0, 4).join(', ') + '] with ' + seed.id;
  return 'similar to ' + seed.id + ' by category';
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
    { key: 's', label: 'saved' }
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const items = getMarketplaceItems();
    refreshRecommendations(items);
    const primary = cachedPrimary;
    const recs = cachedSimilar;
    const trending = getTrendingItems().slice(0, 3);

    const lines: string[] = [];
    lines.push('');
    lines.push('  ' + sep('Recommended for you', width - 2, style));
    lines.push('');
    if (recs.length > 0) {
      const rec = recs[0]!;
      lines.push('  ' + rail(style) + style.bold(rec.name) + style.dim('   (similar items)'));
      if (rec.description) {
        lines.push(
          '     ' +
            style.dim(rec.description) +
            (rec.author ? style.dim(' \u00b7 ' + rec.author) : '')
        );
      }
      lines.push(
        '     ' +
          style.accent(fmtCount(rec.installs ?? 0)) +
          style.dim(' installs') +
          (rec.stars !== undefined
            ? '   ' + style.accent(fmtCount(rec.stars)) + style.dim(' \u2605')
            : '')
      );
      lines.push('');
      lines.push(
        '     ' +
          style.accent('i') +
          style.dim(' install    ') +
          style.accent('s') +
          style.dim(' save    ') +
          style.accent('Enter') +
          style.dim(' view full details')
      );
      lines.push('');
      lines.push('     ' + style.dim('Why: ') + reason(rec, primary));
    } else if (primary) {
      lines.push(
        '  ' + rail(style) + style.bold(primary.name) + style.dim('   (top-installed package)')
      );
      if (primary.description) {
        lines.push(
          '     ' +
            style.dim(primary.description) +
            (primary.author ? style.dim(' \u00b7 ' + primary.author) : '')
        );
      }
      lines.push(
        '     ' +
          style.accent(fmtCount(primary.installs ?? 0)) +
          style.dim(' installs') +
          (primary.stars !== undefined
            ? '   ' + style.accent(fmtCount(primary.stars)) + style.dim(' \u2605')
            : '')
      );
      lines.push('');
      lines.push(
        '     ' +
          style.accent('i') +
          style.dim(' install    ') +
          style.accent('s') +
          style.dim(' save    ') +
          style.accent('Enter') +
          style.dim(' view full details')
      );
      lines.push('');
      lines.push('     ' + style.dim('Why: ') + reason(primary, undefined));
    } else {
      lines.push(
        '  ' +
          style.dim('Nothing to recommend yet \u2014 press ') +
          style.accent('2') +
          style.dim(' to browse the marketplace.')
      );
    }
    lines.push('');
    lines.push('');
    if (recs.length > 1) {
      lines.push('  ' + sep('More like this', width - 2, style));
      lines.push('');
      for (let i = 1; i < recs.length; i++) {
        const r = recs[i]!;
        lines.push('     \u00b7 ' + style.bold(r.name.padEnd(20)) + style.dim(r.description ?? ''));
      }
    } else {
      lines.push('  ' + sep('Trending', width - 2, style));
      lines.push('');
      if (trending.length === 0) {
        lines.push('     ' + style.dim('Nothing trending right now.'));
      } else {
        for (const t of trending) {
          lines.push(
            '     \u00b7 ' + style.bold(t.name.padEnd(20)) + style.dim(t.description ?? '')
          );
        }
      }
    }
    return frame(lines, width, height);
  },
  handleKey(event, _ctx): PageAction {
    switch (event.key) {
      case 'up':
      case 'k':
        state.selected = Math.max(0, state.selected - 1);
        return { kind: 'none' };
      case 'down':
      case 'j':
        state.selected += 1;
        return { kind: 'none' };
      case 'enter':
        return { kind: 'switch', to: 'marketplace' };
      case 'i':
        return { kind: 'status', message: 'install queued (fixture)' };
      case 's':
        return { kind: 'status', message: 'saved' };
      case 'r':
        return { kind: 'status', message: 'refreshed' };
      case '/':
        return { kind: 'switch', to: 'marketplace' };
      default:
        return { kind: 'none' };
    }
  }
};
