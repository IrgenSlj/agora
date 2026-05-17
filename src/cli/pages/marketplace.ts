import { execSync } from 'node:child_process';
import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems,
  searchMarketplaceItems,
  similarItems,
  createInstallPlan,
  renderPermissionLines,
  hasPermissions,
  describePermissionGlob,
  type MarketplaceItem,
  type InstallPlan
} from '../../marketplace.js';
import { vlen, rail, noRail, sep, fmtCount, frame, scrollbar } from './helpers.js';
import { enrichItem, enrichHfItem, type EnrichmentEntry } from '../../hubs/enrichment.js';
import {
  detectAgoraDataDir,
  loadAgoraState,
  saveItemToState,
  writeAgoraState
} from '../../state.js';

type SortKey = 'installs' | 'stars' | 'name';
type SourceFilter = 'all' | 'curated' | 'github' | 'hf';
type PricingFilter = 'all' | 'free' | 'paid';

interface MpState {
  cursor: number;
  detail: boolean;
  query: string;
  filtering: boolean;
  category: string;
  sort: SortKey;
  sourceFilter: SourceFilter;
  pricingFilter: PricingFilter;
  view: 'list' | 'install-preview' | 'install-perm-details';
  installPlan: InstallPlan | null;
  installStatus: string | null;
  enrichment: EnrichmentEntry | null;
  enrichmentLoading: boolean;
}
const state: MpState = {
  cursor: 0,
  detail: false,
  query: '',
  filtering: false,
  category: 'all',
  sort: 'installs',
  sourceFilter: 'all',
  pricingFilter: 'all',
  view: 'list',
  installPlan: null,
  installStatus: null,
  enrichment: null,
  enrichmentLoading: false
};

export function sourceBadge(item: MarketplaceItem): string {
  const src = (item as any).source as string | undefined;
  if (src === 'github') return '[gh] ';
  if (src === 'hf') return '[hf] ';
  return '[c]  ';
}

function matchesSourceFilter(item: MarketplaceItem, filter: SourceFilter): boolean {
  if (filter === 'all') return true;
  const src = (item as any).source as string | undefined;
  if (filter === 'curated') return !src;
  return src === filter;
}

function matchesPricingFilter(item: MarketplaceItem, filter: PricingFilter): boolean {
  if (filter === 'all') return true;
  const kind = (item as any).pricing?.kind ?? 'free';
  return kind === filter;
}

function filtered(): MarketplaceItem[] {
  const all = state.query ? searchMarketplaceItems({ query: state.query }) : getMarketplaceItems();
  const sorted = all.slice().sort((a, b) => {
    if (state.sort === 'name') return a.name.localeCompare(b.name);
    if (state.sort === 'stars') return (b.stars ?? 0) - (a.stars ?? 0);
    return (b.installs ?? 0) - (a.installs ?? 0);
  });
  return sorted
    .filter((i) => state.category === 'all' || (i.tags ?? []).includes(state.category))
    .filter((i) => matchesSourceFilter(i, state.sourceFilter))
    .filter((i) => matchesPricingFilter(i, state.pricingFilter));
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
    { key: 'o', label: 'sort/open' },
    { key: '/', label: 'filter' },
    { key: 'c', label: 'category' },
    { key: 't', label: 'source' },
    { key: 'p', label: 'price' }
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;

    if (state.view === 'install-preview' && state.installPlan) {
      const plan = state.installPlan;
      const lines: string[] = [];
      lines.push(' ' + style.bold(style.accent('INSTALL PREVIEW')));
      lines.push(' ' + sep('', width - 2, style));
      lines.push('');
      lines.push(' ' + style.bold(plan.item.name) + style.dim('  ' + plan.kind));
      lines.push('');
      if (plan.kind === 'git-clone') {
        if (plan.cloneTarget) lines.push(' ' + style.dim('Target  ') + plan.cloneTarget);
        if (plan.commands.length) {
          lines.push('');
          lines.push(' ' + style.dim('Command'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
        if (plan.postInstallHint) {
          lines.push('');
          lines.push(' ' + style.dim('Next steps  ') + plan.postInstallHint);
        }
      } else if (plan.kind === 'package-install') {
        if (plan.commands.length) {
          lines.push(' ' + style.dim('Commands'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
      } else {
        if (plan.commands.length) {
          lines.push(' ' + style.dim('Commands'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
        if (plan.notes.length) {
          lines.push('');
          for (const note of plan.notes) lines.push(' ' + style.dim(note));
        }
      }
      lines.push('');
      const permLines = renderPermissionLines(plan.permissions);
      if (permLines.length === 1) {
        lines.push(' ' + style.dim(permLines[0]));
      } else {
        lines.push(' ' + style.dim(permLines[0]));
        for (const row of permLines.slice(1)) {
          const spaceIdx = row.indexOf(' ', 2);
          const label = row.slice(2, spaceIdx);
          const value = row.slice(spaceIdx + 1);
          lines.push('   ' + style.dim(label) + '  ' + value);
        }
      }
      if (state.installStatus) {
        lines.push('');
        lines.push(' ' + style.accent(state.installStatus));
      }
      lines.push('');
      if (hasPermissions(plan.permissions)) {
        lines.push(
          ' ' +
            style.accent('g') +
            style.dim(' grant + install   ') +
            style.accent('d') +
            style.dim(' details   ') +
            style.accent('n') +
            style.dim('/') +
            style.accent('Esc') +
            style.dim(' cancel')
        );
      } else {
        lines.push(
          ' ' +
            style.accent('y') +
            style.dim(' confirm   ') +
            style.accent('n') +
            style.dim('/') +
            style.accent('Esc') +
            style.dim(' cancel')
        );
      }
      return frame(lines, width, height);
    }

    if (state.view === 'install-perm-details' && state.installPlan) {
      const perms = state.installPlan.permissions;
      const lines: string[] = [];
      lines.push(' ' + style.bold(style.accent('PERMISSIONS DETAIL')));
      lines.push(' ' + sep('', width - 2, style));
      lines.push('');
      const renderGroup = (
        label: string,
        legend: string,
        values: string[] | undefined
      ): void => {
        if (!values?.length) return;
        lines.push(' ' + style.dim(label) + '  ' + style.dim(legend));
        for (const v of values) {
          const note = describePermissionGlob(v);
          lines.push('   ' + v + (note ? '  ' + style.dim('— ' + note) : ''));
        }
        lines.push('');
      };
      renderGroup('fs  ', 'What the package can read or write on disk.', perms?.fs);
      renderGroup('net ', 'Hosts the package will reach over the network.', perms?.net);
      renderGroup('exec', 'Binaries the package will invoke.', perms?.exec);
      lines.push(' ' + style.accent('Esc') + style.dim(' back'));
      return frame(lines, width, height);
    }

    const allItems = getMarketplaceItems();
    const items = filtered();
    state.cursor = Math.min(state.cursor, Math.max(0, items.length - 1));
    const lines: string[] = [];

    // Source breakdown counts
    let sourceBreakdown = '';
    if (state.sourceFilter === 'all') {
      const nCurated = allItems.filter((i) => !(i as any).source).length;
      const nGh = allItems.filter((i) => (i as any).source === 'github').length;
      const nHf = allItems.filter((i) => (i as any).source === 'hf').length;
      const parts: string[] = [];
      if (nCurated) parts.push(nCurated + ' curated');
      if (nGh) parts.push(nGh + ' gh');
      if (nHf) parts.push(nHf + ' hf');
      if (parts.length) sourceBreakdown = '   ' + style.dim(parts.join(' · '));
    }

    const top =
      ' ' +
      style.bold(style.accent('MARKETPLACE')) +
      '   ' +
      style.dim('category: ') +
      style.accent(state.category) +
      style.dim('  ·  sort: ') +
      style.accent(state.sort) +
      style.dim('  ·  src: ') +
      style.accent(state.sourceFilter) +
      style.dim('  ·  price: ') +
      style.accent(state.pricingFilter) +
      '   ' +
      style.dim(items.length + (items.length === 1 ? ' item' : ' items')) +
      sourceBreakdown;
    lines.push(top);
    lines.push(' ' + sep('', width - 2, style));

    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.query + style.dim('▏'));
      lines.push('');
    }

    if (items.length === 0) {
      lines.push('');
      lines.push(
        '   ' +
          style.dim('No items match ') +
          style.accent(state.query || state.category) +
          style.dim('.')
      );
      lines.push(
        '   ' +
          style.dim('Press ') +
          style.accent('/') +
          style.dim(' to change filter, ') +
          style.accent('c') +
          style.dim(' to reset category.')
      );
      if (
        process.env.AGORA_LIVE_HUBS !== '1' &&
        state.sourceFilter !== 'curated'
      ) {
        lines.push('');
        lines.push(
          '   ' +
            style.dim('Tip: set AGORA_LIVE_HUBS=1 to pull live GitHub + HuggingFace items.')
        );
      }
      return frame(lines, width, height);
    }

    if (state.detail) {
      const it = items[state.cursor];
      if (!it) return frame(lines, width, height);

      const detail: string[] = [];
      // Header line: badge + name + pricing + author
      const badge = style.dim(sourceBadge(it));
      const pricing =
        ((it as any).pricing?.kind ?? 'free') === 'paid' ? '  ' + style.accent('PAID') : '';
      detail.push(' ' + badge + style.bold(style.accent(it.name)) + pricing);
      const metaLine =
        (it.author ? style.dim('by ' + it.author) : '') +
        (it.version ? style.dim('   v' + it.version) : '');
      if (metaLine.trim()) detail.push(' ' + metaLine);
      detail.push(' ' + sep('', width - 2, style));

      // Description block (AI-enriched when available)
      const displayDesc = state.enrichment?.description
        ? state.enrichment.description + style.dim(' (ai)')
        : (it.description ?? '');
      if (displayDesc) detail.push(' ' + displayDesc);
      if (state.enrichmentLoading) detail.push(' ' + style.dim('(enriching…)'));

      // Stats line
      detail.push('');
      const statsParts: string[] = [];
      if (it.installs !== undefined) {
        statsParts.push(style.accent(fmtCount(it.installs)) + style.dim(' installs'));
      }
      if (it.stars !== undefined) {
        statsParts.push(style.accent(fmtCount(it.stars)) + style.dim(' ★'));
      }
      if ((it as any).pushedAt) {
        const ageH = (Date.now() - new Date((it as any).pushedAt).getTime()) / 3600000;
        const age = ageH < 24 ? Math.round(ageH) + 'h' : Math.round(ageH / 24) + 'd';
        statsParts.push(style.dim('updated ' + age + ' ago'));
      }
      if (statsParts.length) detail.push(' ' + statsParts.join('   '));

      // Tags
      if (it.tags?.length) {
        detail.push(' ' + style.dim((it.tags ?? []).map((t) => '[' + t + ']').join(' ')));
      }

      // Repository link
      if ((it as any).repository) {
        detail.push(' ' + style.dim('repo  ') + (it as any).repository);
      }

      // Permissions block (always shown — none-declared is informative)
      const itPerms = it.kind === 'package' ? it.permissions : undefined;
      if (hasPermissions(itPerms)) {
        detail.push('');
        detail.push(' ' + sep('Permissions', width - 2, style));
        for (const row of renderPermissionLines(itPerms).slice(1)) {
          const spaceIdx = row.indexOf(' ', 2);
          const label = row.slice(2, spaceIdx);
          const value = row.slice(spaceIdx + 1);
          detail.push('   ' + style.dim(label) + '  ' + value);
        }
      }

      // Related items
      const kind = it.kind === 'workflow' ? 'workflow' : 'package';
      const related = similarItems(it.id, { limit: 4, type: kind as any });
      const relatedFiltered = related.filter((r) => r.id !== it.id).slice(0, 3);
      if (relatedFiltered.length > 0) {
        detail.push('');
        detail.push(' ' + sep('Related', width - 2, style));
        for (const rel of relatedFiltered) {
          const relStats = style.dim(fmtCount(rel.installs ?? 0) + ' installs');
          detail.push('   ' + style.bold(rel.name.padEnd(28)) + relStats);
          if (rel.description) {
            detail.push(
              '   ' + style.dim((rel.description ?? '').slice(0, Math.max(0, width - 6)))
            );
          }
        }
      }

      // Footer — pinned via padding
      const footer = [
        ' ' + sep('', width - 2, style),
        ' ' +
          style.accent('i') +
          style.dim(' install   ') +
          style.accent('s') +
          style.dim(' save   ') +
          style.accent('o') +
          style.dim(' open repo   ') +
          style.accent('Esc') +
          style.dim(' back')
      ];
      const padCount = Math.max(0, height - lines.length - detail.length - footer.length);
      lines.push(...detail);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    const limit = Math.max(0, height - lines.length - 1);
    const start = Math.max(0, Math.min(state.cursor - Math.floor(limit / 2), items.length - limit));
    const sbar = scrollbar(items.length, limit, state.cursor, style);
    for (let i = 0; i < limit && start + i < items.length; i++) {
      const it = items[start + i];
      if (!it) continue;
      const selected = start + i === state.cursor;
      const lead = selected ? rail(style) : noRail();
      const badge = style.dim(sourceBadge(it));
      const pricingBadge =
        ((it as any).pricing?.kind ?? 'free') === 'paid'
          ? style.accent('PAID') + ' '
          : '';
      const stats =
        pricingBadge +
        style.accent(fmtCount(it.installs ?? 0).padStart(7)) +
        style.dim(' installs') +
        (it.stars !== undefined
          ? '  ' + style.accent(fmtCount(it.stars).padStart(5)) + style.dim(' ★')
          : '');
      const nameCell = selected ? style.bold(it.name) : it.name;
      const perms = it.kind === 'package' ? it.permissions : undefined;
      const permCats = perms
        ? (['fs', 'net', 'exec'] as const).filter((k) => perms[k]?.length).join(' ')
        : '';
      const permSuffix = permCats ? ' ' + style.dim('[' + permCats + ']') : '';
      const left = ' ' + lead + badge + nameCell + permSuffix;
      const room = width - vlen(left) - vlen(stats) - 2;
      const desc = style.dim((it.description ?? '').slice(0, Math.max(0, room - 2)));
      const pad = ' '.repeat(Math.max(1, room - vlen(desc) - 1));
      lines.push(left + '  ' + desc + pad + stats + ' ' + sbar[i]!);
    }
    lines.push(
      '  ' +
        (items.length > limit
          ? style.dim(
              'items ' +
                (start + 1) +
                '–' +
                Math.min(start + limit, items.length) +
                ' of ' +
                items.length
            )
          : style.dim(items.length + (items.length === 1 ? ' item' : ' items')))
    );
    return frame(lines, width, height);
  },
  handleKey(event, _ctx: PageContext): PageAction {
    if (state.view === 'install-perm-details') {
      if (event.key === 'esc') state.view = 'install-preview';
      return { kind: 'none' };
    }

    if (state.view === 'install-preview') {
      const confirmKeys =
        state.installPlan && hasPermissions(state.installPlan.permissions)
          ? new Set(['g', 'y'])
          : new Set(['y']);
      if (confirmKeys.has(event.key) && state.installPlan) {
        const plan = state.installPlan;
        if (!plan.installable) {
          state.installStatus = plan.reason || 'Not installable.';
          return { kind: 'none' };
        }
        let success = true;
        for (const cmd of plan.commands) {
          try {
            execSync(cmd, { stdio: 'pipe', timeout: 60000 });
          } catch {
            state.installStatus = `Failed: ${cmd}`;
            success = false;
            break;
          }
        }
        if (success) {
          state.installStatus = `Installed ${plan.item.name}`;
        }
        return { kind: 'none' };
      }
      if (event.key === 'd' && state.installPlan && hasPermissions(state.installPlan.permissions)) {
        state.view = 'install-perm-details';
        return { kind: 'none' };
      }
      if (event.key === 'n' || event.key === 'esc') {
        state.view = 'list';
        state.installPlan = null;
        state.installStatus = null;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }

    if (state.filtering) {
      if (event.key === 'esc') {
        state.filtering = false;
        state.query = '';
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        state.filtering = false;
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        state.query = state.query.slice(0, -1);
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl) {
        state.query += event.key;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }
    const items = filtered();
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
        state.detail = !state.detail;
        if (state.detail) {
          const selected = items[state.cursor];
          if (selected && (selected as any).source === 'github') {
            state.enrichment = null;
            state.enrichmentLoading = true;
            const repoId = selected.id.startsWith('gh:') ? selected.id.slice(3) : null;
            if (repoId) {
              const dataDir = detectAgoraDataDir({ env: process.env });
              const ctx = _ctx;
              enrichItem(repoId, dataDir).then((entry) => {
                state.enrichment = entry;
                state.enrichmentLoading = false;
                ctx.repaint();
              });
            } else {
              state.enrichmentLoading = false;
            }
          } else if (selected && (selected as any).source === 'hf') {
            state.enrichment = null;
            state.enrichmentLoading = true;
            const repoId = selected.id.startsWith('hf:') ? selected.id.slice(3) : null;
            if (repoId) {
              const dataDir = detectAgoraDataDir({ env: process.env });
              const ctx = _ctx;
              enrichHfItem(repoId, dataDir).then((entry) => {
                state.enrichment = entry;
                state.enrichmentLoading = false;
                ctx.repaint();
              });
            } else {
              state.enrichmentLoading = false;
            }
          } else {
            state.enrichment = null;
            state.enrichmentLoading = false;
          }
        } else {
          state.enrichment = null;
          state.enrichmentLoading = false;
        }
        return { kind: 'none' };
      }
      case 'esc':
        if (state.detail) {
          state.detail = false;
          state.enrichment = null;
          state.enrichmentLoading = false;
        }
        return { kind: 'none' };
      case 'i': {
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        const plan = createInstallPlan(
          it,
          {},
          {
            aiInstallHint: state.enrichment?.installHint
          }
        );
        state.installPlan = plan;
        state.installStatus = null;
        state.view = 'install-preview';
        return { kind: 'none' };
      }
      case '/':
        state.filtering = true;
        return { kind: 'none' };
      case 'c': {
        const order = ['all', 'db', 'fs', 'web', 'ai'];
        state.category = order[(order.indexOf(state.category) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'o': {
        if (state.detail) {
          const it = items[state.cursor];
          const url = (it as any)?.repository;
          if (url) return { kind: 'open-url', url };
          return { kind: 'status', message: 'no repo url' };
        }
        const order: SortKey[] = ['installs', 'stars', 'name'];
        state.sort = order[(order.indexOf(state.sort) + 1) % order.length] ?? 'installs';
        return { kind: 'none' };
      }
      case 's': {
        if (!state.detail) return { kind: 'none' };
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        const dir = detectAgoraDataDir({ env: process.env });
        const next = saveItemToState(loadAgoraState(dir), it);
        if (!next.added) return { kind: 'status', message: 'already saved' };
        writeAgoraState(dir, next.state);
        return { kind: 'status', message: 'saved ' + it.name };
      }
      case 't': {
        const order: SourceFilter[] = ['all', 'curated', 'github', 'hf'];
        state.sourceFilter =
          order[(order.indexOf(state.sourceFilter) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      case 'p': {
        const order: PricingFilter[] = ['all', 'free', 'paid'];
        state.pricingFilter =
          order[(order.indexOf(state.pricingFilter) + 1) % order.length] ?? 'all';
        state.cursor = 0;
        return { kind: 'none' };
      }
      default:
        return { kind: 'none' };
    }
  }
};
