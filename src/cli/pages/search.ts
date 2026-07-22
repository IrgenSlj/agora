// src/cli/pages/search.ts
// The Search page (TUI-2, formerly "Marketplace" — the design brief bans that
// word in the UI). Wired to `federatedSearch` (src/federation/index.ts): every
// enabled upstream registry (official/smithery/glama/github/huggingface) plus
// the bundled local catalog is queried, deduped, and merged. Per-source
// results are shown progressively — each source's honest status
// (ok/unreachable/offline) is rendered alongside the merged, provenance-badged
// item list (official-first). `Enter` drills into the Item detail page
// (item.ts); `a` launches Acquire pre-seeded, same launch affordance as Stack.
//
// Async fetch happens in `mount()` (and on submitting a new query) — never in
// `render()`, which stays a pure function of state.
import { join } from 'node:path';
import { federatedSearch } from '../../federation/index.js';
import type {
  FederatedItem,
  FederationEnv,
  SourceId,
  SourceStatus
} from '../../federation/types.js';
import type { MarketplaceItem } from '../../marketplace.js';
import {
  detectAgoraDataDir,
  loadAgoraState,
  saveItemToState,
  writeAgoraState
} from '../../state.js';
import type { Theme } from '../theme.js';
import { liftStyler } from '../theme.js';
import { seedAcquire } from './acquire.js';
import {
  bp,
  frame,
  pageHeader,
  provenanceBadges,
  rail,
  rule,
  spinnerFrame,
  status,
  vlen
} from './components.js';
import { fmtCount, scrollbar } from './helpers.js';
import { seedItem } from './item.js';
import type { Page, PageAction, PageContext } from './types.js';

type SortKey = 'installs' | 'stars' | 'name';
type ProvFilter = 'all' | SourceId;

const PROV_ORDER: ProvFilter[] = [
  'all',
  'official',
  'smithery',
  'glama',
  'github',
  'huggingface',
  'local'
];

interface SearchState {
  query: string;
  filtering: boolean;
  draft: string;
  cursor: number;
  sort: SortKey;
  provFilter: ProvFilter;
  loading: boolean;
  loaded: boolean;
  items: FederatedItem[];
  statuses: SourceStatus[];
  error: string | null;
  seq: number;
  tick: number;
}

const state: SearchState = {
  query: '',
  filtering: false,
  draft: '',
  cursor: 0,
  sort: 'installs',
  provFilter: 'all',
  loading: false,
  loaded: false,
  items: [],
  statuses: [],
  error: null,
  seq: 0,
  tick: 0
};

function envRecord(ctx: PageContext): Record<string, string | undefined> | undefined {
  return ctx.io.env as Record<string, string | undefined> | undefined;
}

function federationEnv(ctx: PageContext): FederationEnv {
  const env = envRecord(ctx);
  const dataDir = detectAgoraDataDir({ cwd: ctx.io.cwd, home: env?.HOME, env });
  return {
    fetcher: ctx.io.fetcher,
    home: env?.HOME,
    env,
    cacheDir: join(dataDir, 'federation'),
    storePath: join(dataDir, 'agora.db'),
    casDir: join(dataDir, 'cas')
  };
}

async function runSearch(ctx: PageContext, query: string): Promise<void> {
  const mySeq = ++state.seq;
  state.loading = true;
  state.error = null;
  ctx.repaint();
  try {
    const result = await federatedSearch(query, { limit: 30 }, federationEnv(ctx));
    if (mySeq !== state.seq) return;
    state.items = result.items;
    state.statuses = result.statuses;
    state.cursor = 0;
  } catch (err) {
    if (mySeq !== state.seq) return;
    state.error = err instanceof Error ? err.message : String(err);
    state.items = [];
    state.statuses = [];
  } finally {
    if (mySeq === state.seq) {
      state.loading = false;
      state.loaded = true;
      ctx.repaint();
    }
  }
}

function itemPricing(item: FederatedItem): 'free' | 'paid' {
  if (item.kind !== 'package') return 'free';
  return item.pricing?.kind ?? 'free';
}

function hasOfficial(item: FederatedItem): boolean {
  return item.provenance.some((p) => p.source === 'official');
}

function matchesProv(item: FederatedItem, filter: ProvFilter): boolean {
  if (filter === 'all') return true;
  return item.provenance.some((p) => p.source === filter);
}

/** Official-first, then the active sort key — a merged item that resolved
 * through the official MCP Registry is the most trustworthy signal we have,
 * so it always floats to the top regardless of installs/stars/name sort. */
function sortedFiltered(): FederatedItem[] {
  return state.items
    .filter((i) => matchesProv(i, state.provFilter))
    .slice()
    .sort((a, b) => {
      const aOff = hasOfficial(a) ? 0 : 1;
      const bOff = hasOfficial(b) ? 0 : 1;
      if (aOff !== bOff) return aOff - bOff;
      if (state.sort === 'name') return a.name.localeCompare(b.name);
      if (state.sort === 'stars') return b.stars - a.stars;
      return b.installs - a.installs;
    });
}

function sourceStatusChip(s: SourceStatus, theme: Theme): string {
  if (s.state === 'ok') return status('success', s.source + ' ' + s.count, theme);
  if (s.state === 'unreachable') return status('warning', s.source + ' unreachable', theme);
  if (s.state === 'offline') return theme.dim(s.source + ' offline');
  return theme.dim(s.source + ' …'); // 'searching' — federatedSearch resolves synchronously per source today
}

/**
 * Origin badge for the bundled catalog's own curation metadata — distinct
 * from (and superseded by) the federation `provenanceBadges` shown per row:
 * this reflects which hub *curated* the entry into the local catalog, not
 * which live registries currently list it. Kept exported for API/back-compat
 * (test/marketplace.test.ts) but not wired into the row below.
 */
export function sourceBadge(item: MarketplaceItem): string {
  const src = item.kind === 'package' ? item.source : undefined;
  if (src === 'github') return '[gh] ';
  if (src === 'hf') return '[hf] ';
  return '[c]  ';
}

export const searchPage: Page = {
  id: 'search',
  title: 'SEARCH',
  navLabel: 'Search',
  navIcon: 'S',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Enter', label: 'item' },
    { key: 'a', label: 'acquire' },
    { key: 's', label: 'save' },
    { key: 'o', label: 'sort' },
    { key: 't', label: 'source' },
    { key: '/', label: 'search' }
  ],

  async mount(ctx: PageContext): Promise<void> {
    await runSearch(ctx, state.query);
  },

  render(ctx: PageContext): string {
    const { style, width, height, trueColor } = ctx;
    const theme = liftStyler(style, { trueColor });
    const narrow = bp(width) === 'xs';
    const lines: string[] = [];

    const rightCluster = narrow
      ? theme.muted(state.sort)
      : theme.muted('sort:') +
        theme.accent(state.sort) +
        theme.muted('  src:') +
        theme.accent(state.provFilter);

    lines.push(pageHeader({ title: 'SEARCH', right: rightCluster, width, theme }));
    lines.push(' ' + rule(width - 2, undefined, theme));

    // ── query / filter input row ────────────────────────────────────────────
    if (state.filtering) {
      lines.push(' ' + theme.accent('search ▸') + ' ' + state.draft + theme.dim('▏'));
      lines.push(' ' + theme.dim('Enter to search the federation, Esc to cancel.'));
    } else {
      lines.push(
        ' ' +
          theme.muted('query:') +
          ' ' +
          (state.query ? theme.accent(state.query) : theme.dim('(all items)'))
      );
    }
    lines.push('');

    // ── per-source status row — progressive, honest results (never a lying
    // spinner: "ok N" / "unreachable" / "offline" per source) ──────────────
    if (state.loading) {
      state.tick++;
      lines.push(
        ' ' + spinnerFrame(state.tick, theme) + '  ' + theme.dim('searching the federation…')
      );
    } else if (state.statuses.length > 0) {
      lines.push(' ' + state.statuses.map((s) => sourceStatusChip(s, theme)).join('   '));
    } else if (state.error) {
      lines.push(' ' + theme.error(theme.glyph('err') + ' ' + state.error));
    }
    lines.push('');

    const items = sortedFiltered();
    state.cursor = Math.min(state.cursor, Math.max(0, items.length - 1));

    // ── empty state ──────────────────────────────────────────────────────────
    if (items.length === 0) {
      if (!state.loading) {
        lines.push(
          '   ' +
            theme.dim('No items match ') +
            theme.accent(state.query || '(all items)') +
            theme.dim('.')
        );
        lines.push(
          '   ' +
            theme.dim('Press ') +
            theme.accent('/') +
            theme.dim(' to search, ') +
            theme.accent('t') +
            theme.dim(' to reset the source filter.')
        );
      }
      return frame(lines, width, height);
    }

    // ── list ─────────────────────────────────────────────────────────────────
    const limit = Math.max(0, height - lines.length - 1);
    const start = Math.max(0, Math.min(state.cursor - Math.floor(limit / 2), items.length - limit));
    const sbar = scrollbar(items.length, limit, state.cursor, style);
    for (let i = 0; i < limit && start + i < items.length; i++) {
      const it = items[start + i];
      if (!it) continue;
      const selected = start + i === state.cursor;
      const railStr = rail(theme, selected);
      const badges = provenanceBadges(
        it.provenance.map((p) => p.source),
        theme
      );
      const pricingBadge = itemPricing(it) === 'paid' ? theme.accent('PAID') + ' ' : '';
      const stats =
        pricingBadge +
        theme.accent(fmtCount(it.installs).padStart(7)) +
        theme.muted(' installs') +
        '  ' +
        theme.accent(fmtCount(it.stars).padStart(5)) +
        theme.muted(' ★');
      const nameCell = selected ? theme.bold(it.name) : it.name;
      const left = narrow ? ' ' + railStr + nameCell : ' ' + railStr + badges + ' ' + nameCell;
      const room = width - vlen(left) - vlen(stats) - 2;
      const desc = theme.dim((it.description ?? '').slice(0, Math.max(0, room - 2)));
      const pad = ' '.repeat(Math.max(1, room - vlen(desc) - 1));
      lines.push(left + '  ' + desc + pad + stats + ' ' + sbar[i]!);
    }
    lines.push(
      '  ' +
        (items.length > limit
          ? theme.muted(
              'items ' +
                (start + 1) +
                '–' +
                Math.min(start + limit, items.length) +
                ' of ' +
                items.length
            )
          : theme.muted(items.length + (items.length === 1 ? ' item' : ' items')))
    );
    return frame(lines, width, height);
  },

  async handleKey(event, ctx: PageContext): Promise<PageAction> {
    if (state.filtering) {
      switch (event.key) {
        case 'esc':
          state.filtering = false;
          return { kind: 'none' };
        case 'enter':
          state.filtering = false;
          state.query = state.draft.trim();
          await runSearch(ctx, state.query);
          return { kind: 'none' };
        case 'backspace':
          state.draft = state.draft.slice(0, -1);
          return { kind: 'none' };
        default:
          if (event.key.length === 1 && !event.ctrl) state.draft += event.key;
          return { kind: 'none' };
      }
    }

    const items = sortedFiltered();
    switch (event.key) {
      case 'j':
      case 'down':
        state.cursor = Math.min(items.length - 1, state.cursor + 1);
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.cursor = Math.max(0, state.cursor - 1);
        return { kind: 'none' };
      case 'enter': {
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        seedItem({ id: it.id, returnTo: 'search' });
        return { kind: 'switch', to: 'item' };
      }
      case 'a': {
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        seedAcquire({ id: it.id, returnTo: 'search' });
        return { kind: 'switch', to: 'acquire' };
      }
      case 's': {
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        const dir = detectAgoraDataDir({ env: envRecord(ctx) });
        const next = saveItemToState(loadAgoraState(dir), it);
        if (!next.added) return { kind: 'status', message: 'already saved' };
        writeAgoraState(dir, next.state);
        return { kind: 'status', message: 'saved ' + it.name };
      }
      case 'o': {
        const order: SortKey[] = ['installs', 'stars', 'name'];
        state.sort = order[(order.indexOf(state.sort) + 1) % order.length] ?? 'installs';
        return { kind: 'none' };
      }
      case 't': {
        state.provFilter =
          PROV_ORDER[(PROV_ORDER.indexOf(state.provFilter) + 1) % PROV_ORDER.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case '/':
        state.filtering = true;
        state.draft = state.query;
        return { kind: 'none' };
      default:
        return { kind: 'none' };
    }
  }
};
