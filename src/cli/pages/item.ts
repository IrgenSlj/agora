// src/cli/pages/item.ts
// The Item detail page (TUI-2): resolves one catalog item over federation
// (`federatedFetchItem`) and runs the trust gate (`scanItem`), with the
// `trustPanel` component as the centerpiece — provenance, merged metadata,
// and the scan/permissions/drift summary in one place (brief §4.3). A
// satellite page, like Acquire: reached via `Enter` from Search, pre-seeded
// through module state (`seedItem`) since page switches carry no payload —
// not a primary tab, so it never consumes a 1-5 shortcut or a Tab slot.
//
// Async fetch happens in `mount()` only; `render()` stays a pure function of
// state.

import { federatedFetchItem } from '../../federation/index.js';
import type { FederatedItem, FederationEnv } from '../../federation/types.js';
import { type ScanResult, scanItem } from '../../scan.js';
import type { Theme } from '../theme.js';
import { liftStyler } from '../theme.js';
import { seedAcquire } from './acquire.js';
import {
  frame,
  kvRow,
  pageHeader,
  pill,
  provenanceBadges,
  rule,
  spinnerFrame,
  tagList,
  truncate,
  trustPanel
} from './components.js';
import { buildDrift, buildPermRows, fmtCount } from './helpers.js';
import type { Page, PageAction, PageContext, PageId } from './types.js';

export interface ItemSeed {
  /** Item id — resolved via `federatedFetchItem` (federation + local catalog). */
  id: string;
  /** Page to return to on Esc — the page that launched Item (normally Search). */
  returnTo?: PageId;
}

interface ItemState {
  id: string | null;
  returnTo: PageId;
  loading: boolean;
  notFound: boolean;
  item: FederatedItem | null;
  scan: ScanResult | null;
  seq: number;
  tick: number;
}

const state: ItemState = {
  id: null,
  returnTo: 'search',
  loading: false,
  notFound: false,
  item: null,
  scan: null,
  seq: 0,
  tick: 0
};

let seed: ItemSeed | null = null;

/**
 * Seed the Item page before switching to it — the launch affordance from
 * Search calls this, then returns `{ kind: 'switch', to: 'item' }`. `mount()`
 * reads and clears the seed (module state is the only way to pass data across
 * a page switch — `PageContext` carries no payload), same pattern as
 * `seedAcquire` (acquire.ts).
 */
export function seedItem(s: ItemSeed): void {
  seed = s;
}

function envRecord(ctx: PageContext): Record<string, string | undefined> | undefined {
  return ctx.io.env as Record<string, string | undefined> | undefined;
}

function federationEnv(ctx: PageContext): FederationEnv {
  const env = envRecord(ctx);
  return { fetcher: ctx.io.fetcher, home: env?.HOME, env };
}

async function runFetch(ctx: PageContext, id: string): Promise<void> {
  const mySeq = ++state.seq;
  state.loading = true;
  state.notFound = false;
  state.item = null;
  state.scan = null;
  ctx.repaint();

  const env = federationEnv(ctx);
  const item = await federatedFetchItem(id, env);
  if (mySeq !== state.seq) return;
  if (!item) {
    state.notFound = true;
    state.loading = false;
    ctx.repaint();
    return;
  }
  state.item = item;

  const scan = await scanItem(item, {
    fetcher: ctx.io.fetcher,
    githubToken: envRecord(ctx)?.AGORA_GITHUB_TOKEN,
    officialStatus: item.officialStatus,
    tools: item.tools
  });
  if (mySeq !== state.seq) return;
  state.scan = scan;
  state.loading = false;
  ctx.repaint();
}

export const itemPage: Page = {
  id: 'item',
  title: 'ITEM',
  navLabel: 'Item',
  navIcon: 'I',
  hotkeys: [
    { key: 'a', label: 'acquire' },
    { key: 'o', label: 'open repo' },
    { key: 'Esc', label: 'back' }
  ],

  async mount(ctx: PageContext): Promise<void> {
    const s = seed;
    seed = null;
    state.tick = 0;
    if (s) {
      state.id = s.id;
      state.returnTo = s.returnTo ?? 'search';
    }
    if (state.id) await runFetch(ctx, state.id);
  },

  render(ctx: PageContext): string {
    const { width, height } = ctx;
    const theme: Theme = liftStyler(ctx.style, { trueColor: ctx.trueColor });
    const lines: string[] = [];

    lines.push(
      pageHeader({
        title: 'ITEM',
        crumbs: state.item ? [truncate(state.item.name, 30)] : [],
        width,
        theme
      })
    );
    lines.push(' ' + rule(width - 2, undefined, theme));

    // ── loading ──────────────────────────────────────────────────────────────
    if (state.loading) {
      state.tick++;
      lines.push('');
      lines.push(
        ' ' +
          spinnerFrame(state.tick, theme) +
          '  ' +
          theme.dim('Resolving ' + (state.id ?? '') + ' via federation…')
      );
      return frame(lines, width, height);
    }

    // ── not found ────────────────────────────────────────────────────────────
    if (state.notFound) {
      lines.push('');
      lines.push(' ' + theme.error(theme.glyph('err') + ' Not found'));
      lines.push(' ' + theme.dim('No source resolved "' + (state.id ?? '') + '".'));
      lines.push('');
      lines.push(' ' + theme.accent('Esc') + theme.dim(' back'));
      return frame(lines, width, height);
    }

    const item = state.item;
    if (!item) {
      lines.push('');
      lines.push(' ' + theme.dim('Nothing to show yet.'));
      return frame(lines, width, height);
    }

    const prov = item.provenance.map((p) => p.source);
    const body: string[] = [];

    const pricePill =
      item.kind === 'package' && item.pricing?.kind === 'paid'
        ? pill('PAID', 'accent', theme) + ' '
        : '';
    body.push(' ' + pricePill + theme.bold(theme.accent(item.name)) + theme.muted('  ' + item.id));
    body.push(' ' + provenanceBadges(prov, theme));

    const metaParts: string[] = [];
    if (item.author) metaParts.push('by ' + item.author);
    if (item.kind === 'package' && item.version) metaParts.push('v' + item.version);
    if (metaParts.length) body.push(' ' + theme.muted(metaParts.join('   ')));

    body.push(' ' + rule(width - 2, undefined, theme));
    if (item.description) body.push(' ' + truncate(item.description, width - 2));
    body.push('');

    body.push(
      ' ' +
        theme.accent(fmtCount(item.installs)) +
        theme.muted(' installs') +
        '   ' +
        theme.accent(fmtCount(item.stars)) +
        theme.muted(' stars')
    );
    if (item.tags?.length) body.push(' ' + tagList(item.tags, theme));

    const repoUrl = item.kind === 'package' ? item.repository : undefined;
    if (repoUrl) body.push(' ' + kvRow('repo', repoUrl, 6, theme));
    body.push('');

    // ── Trust (trustPanel is the centerpiece — brief §4.3) ────────────────────
    body.push(' ' + rule(width - 2, 'Trust', theme));
    if (!state.scan) {
      body.push(' ' + theme.dim('Scan pending…'));
    } else {
      const scan = state.scan;
      const panel = trustPanel({
        scan: {
          pass: scan.summary.pass,
          warn: scan.summary.warn,
          fail: scan.summary.fail,
          lines: scan.checks
            .filter((c) => c.status !== 'pass')
            .map((c) =>
              truncate(c.status.toUpperCase() + ' ' + c.label + ' — ' + c.message, width - 6)
            )
        },
        perms: buildPermRows(item, item.tools),
        drift: buildDrift(scan),
        width: width - 2,
        theme
      });
      body.push(...panel.map((l) => ' ' + l));
      body.push(
        ' ' + theme.dim('"passed the gate" means no known red flags — not a guarantee of safety.')
      );
    }

    const footerHint =
      ' ' +
      theme.accent('a') +
      theme.dim(' acquire   ') +
      (repoUrl ? theme.accent('o') + theme.dim(' open repo   ') : '') +
      theme.accent('Esc') +
      theme.dim(' back');
    const footer = [' ' + rule(width - 2, undefined, theme), footerHint];
    const padCount = Math.max(0, height - lines.length - body.length - footer.length);
    lines.push(...body);
    for (let i = 0; i < padCount; i++) lines.push('');
    lines.push(...footer);
    return frame(lines, width, height);
  },

  handleKey(event, _ctx: PageContext): PageAction {
    switch (event.key) {
      case 'a': {
        if (!state.item) return { kind: 'status', message: 'nothing to acquire yet' };
        seedAcquire({ id: state.item.id, returnTo: 'item' });
        return { kind: 'switch', to: 'acquire' };
      }
      case 'o': {
        const repoUrl =
          state.item && state.item.kind === 'package' ? state.item.repository : undefined;
        if (repoUrl) return { kind: 'open-url', url: repoUrl };
        return { kind: 'status', message: 'no repo url' };
      }
      case 'esc':
        return { kind: 'switch', to: state.returnTo };
      default:
        return { kind: 'none' };
    }
  }
};
