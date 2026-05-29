import { execSync } from 'node:child_process';
import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems,
  searchMarketplaceItems,
  similarItems,
  starCountLabel,
  createInstallPlan,
  renderPermissionLines,
  hasPermissions,
  describePermissionGlob,
  type MarketplaceItem,
  type InstallPlan
} from '../../marketplace.js';
import { fmtCount, frame, scrollbar } from './helpers.js';
import { enrichItem, enrichHfItem, type EnrichmentEntry } from '../../hubs/enrichment.js';
import { scanItem, type ScanResult } from '../../scan.js';
import {
  detectAgoraDataDir,
  loadAgoraState,
  saveItemToState,
  writeAgoraState
} from '../../state.js';
import { liftStyler } from '../theme.js';
import {
  pageHeader,
  rule,
  pill,
  tagList,
  kvRow,
  status,
  rail,
  vlen,
  padRight,
  truncate,
  bp
} from './components.js';

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
  view: 'list' | 'install-preview' | 'install-perm-details' | 'scan';
  installPlan: InstallPlan | null;
  installStatus: string | null;
  enrichment: EnrichmentEntry | null;
  enrichmentLoading: boolean;
  scanResult: ScanResult | null;
  scanLoading: boolean;
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
  enrichmentLoading: false,
  scanResult: null,
  scanLoading: false
};

function itemSource(item: MarketplaceItem): 'github' | 'hf' | undefined {
  return item.kind === 'package' ? item.source : undefined;
}

function itemPricing(item: MarketplaceItem): 'free' | 'paid' {
  if (item.kind !== 'package') return 'free';
  return item.pricing?.kind ?? 'free';
}

function itemRepository(item: MarketplaceItem): string | undefined {
  return item.kind === 'package' ? item.repository : undefined;
}

function itemPushedAt(item: MarketplaceItem): string | undefined {
  return item.kind === 'package' ? item.pushedAt : undefined;
}

export function sourceBadge(item: MarketplaceItem): string {
  const src = itemSource(item);
  if (src === 'github') return '[gh] ';
  if (src === 'hf') return '[hf] ';
  return '[c]  ';
}

function matchesSourceFilter(item: MarketplaceItem, filter: SourceFilter): boolean {
  if (filter === 'all') return true;
  const src = itemSource(item);
  if (filter === 'curated') return !src;
  return src === filter;
}

function matchesPricingFilter(item: MarketplaceItem, filter: PricingFilter): boolean {
  if (filter === 'all') return true;
  return itemPricing(item) === filter;
}

function filtered(source: ReadonlyArray<MarketplaceItem>): MarketplaceItem[] {
  const all = state.query ? searchMarketplaceItems({ query: state.query }) : source;
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
    { key: 'S', label: 'scan' },
    { key: 's', label: 'save' },
    { key: 'o', label: 'sort/open' },
    { key: '/', label: 'filter' },
    { key: 'c', label: 'category' },
    { key: 't', label: 'source' },
    { key: 'p', label: 'price' }
  ],
  render(ctx: PageContext): string {
    const { style, width, height, trueColor } = ctx;
    const theme = liftStyler(style, { trueColor });
    const narrow = bp(width) === 'xs';

    // ── SCAN view ──────────────────────────────────────────────────────────────
    if (state.view === 'scan') {
      const lines: string[] = [];
      lines.push(pageHeader({ title: 'SCAN', width, theme }));
      lines.push(' ' + rule(width - 2, undefined, theme));
      lines.push('');
      const it = filtered(getMarketplaceItems())[state.cursor];
      if (it) {
        lines.push(' ' + theme.bold(it.name) + theme.muted('  ' + it.id));
      }
      lines.push('');
      if (state.scanLoading) {
        lines.push(' ' + theme.dim('Scanning…'));
      } else if (state.scanResult) {
        for (const c of state.scanResult.checks) {
          const tone = c.status === 'pass' ? 'success' : c.status === 'warn' ? 'warning' : 'error';
          const row = status(tone, theme.dim(c.label) + '  ' + c.message, theme);
          lines.push('   ' + row);
        }
        lines.push('');
        const { pass, warn, fail } = state.scanResult.summary;
        lines.push(' ' + theme.muted(`${pass} pass · ${warn} warning(s) · ${fail} failure(s)`));
      } else {
        lines.push(' ' + theme.dim('No scan result.'));
      }
      lines.push('');
      lines.push(' ' + theme.accent('esc') + theme.dim(' back'));
      return frame(lines, width, height);
    }

    // ── INSTALL PREVIEW view ───────────────────────────────────────────────────
    if (state.view === 'install-preview' && state.installPlan) {
      const plan = state.installPlan;
      const lines: string[] = [];
      lines.push(pageHeader({ title: 'INSTALL PREVIEW', width, theme }));
      lines.push(' ' + rule(width - 2, undefined, theme));
      lines.push('');
      lines.push(' ' + theme.bold(plan.item.name) + '  ' + theme.muted(plan.kind));
      lines.push('');
      if (plan.kind === 'git-clone') {
        if (plan.cloneTarget) {
          lines.push(' ' + kvRow('Target', plan.cloneTarget, 8, theme));
        }
        if (plan.commands.length) {
          lines.push('');
          lines.push(' ' + theme.muted('Command'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
        if (plan.postInstallHint) {
          lines.push('');
          lines.push(' ' + kvRow('Next steps', plan.postInstallHint, 12, theme));
        }
      } else if (plan.kind === 'package-install') {
        if (plan.commands.length) {
          lines.push(' ' + theme.muted('Commands'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
      } else {
        if (plan.commands.length) {
          lines.push(' ' + theme.muted('Commands'));
          for (const cmd of plan.commands) lines.push('   ' + cmd);
        }
        if (plan.notes.length) {
          lines.push('');
          for (const note of plan.notes) lines.push(' ' + theme.dim(note));
        }
      }
      lines.push('');
      const permLines = renderPermissionLines(plan.permissions);
      if (permLines.length === 1) {
        lines.push(' ' + theme.dim(permLines[0]));
      } else {
        lines.push(' ' + theme.dim(permLines[0]));
        for (const row of permLines.slice(1)) {
          const spaceIdx = row.indexOf(' ', 2);
          const label = row.slice(2, spaceIdx);
          const value = row.slice(spaceIdx + 1);
          lines.push('   ' + theme.muted(padRight(label, 6)) + value);
        }
      }
      if (state.installStatus) {
        lines.push('');
        lines.push(' ' + theme.accent(state.installStatus));
      }
      lines.push('');
      if (hasPermissions(plan.permissions)) {
        lines.push(
          ' ' +
            theme.accent('g') +
            theme.dim(' grant + install   ') +
            theme.accent('d') +
            theme.dim(' details   ') +
            theme.accent('n') +
            theme.dim('/') +
            theme.accent('Esc') +
            theme.dim(' cancel')
        );
      } else {
        lines.push(
          ' ' +
            theme.accent('y') +
            theme.dim(' confirm   ') +
            theme.accent('n') +
            theme.dim('/') +
            theme.accent('Esc') +
            theme.dim(' cancel')
        );
      }
      return frame(lines, width, height);
    }

    // ── PERMISSIONS DETAIL view ────────────────────────────────────────────────
    if (state.view === 'install-perm-details' && state.installPlan) {
      const perms = state.installPlan.permissions;
      const lines: string[] = [];
      lines.push(pageHeader({ title: 'PERMISSIONS DETAIL', width, theme }));
      lines.push(' ' + rule(width - 2, undefined, theme));
      lines.push('');
      const renderGroup = (label: string, legend: string, values: string[] | undefined): void => {
        if (!values?.length) return;
        lines.push(' ' + theme.muted(padRight(label, 6)) + theme.dim(legend));
        for (const v of values) {
          const note = describePermissionGlob(v);
          lines.push('   ' + v + (note ? '  ' + theme.dim('— ' + note) : ''));
        }
        lines.push('');
      };
      renderGroup('fs', 'What the package can read or write on disk.', perms?.fs);
      renderGroup('net', 'Hosts the package will reach over the network.', perms?.net);
      renderGroup('exec', 'Binaries the package will invoke.', perms?.exec);
      lines.push(' ' + theme.accent('Esc') + theme.dim(' back'));
      return frame(lines, width, height);
    }

    // ── LIST + DETAIL views ────────────────────────────────────────────────────
    const allItems = getMarketplaceItems();
    const items = filtered(allItems);
    state.cursor = Math.min(state.cursor, Math.max(0, items.length - 1));
    const lines: string[] = [];

    // Source breakdown counts for right cluster
    const countCluster = (() => {
      const cnt = items.length;
      const countStr = theme.muted(cnt + (cnt === 1 ? ' item' : ' items'));
      if (!narrow && state.sourceFilter === 'all') {
        const nCurated = allItems.filter((i) => !itemSource(i)).length;
        const nGh = allItems.filter((i) => itemSource(i) === 'github').length;
        const nHf = allItems.filter((i) => itemSource(i) === 'hf').length;
        const parts: string[] = [];
        if (nCurated) parts.push(nCurated + ' curated');
        if (nGh) parts.push(nGh + ' gh');
        if (nHf) parts.push(nHf + ' hf');
        return countStr + (parts.length ? '  ' + theme.dim(parts.join(' · ')) : '');
      }
      return countStr;
    })();

    // Right cluster: category · sort · count (elide on xs)
    const rightCluster = narrow
      ? theme.muted(state.category) + ' ' + theme.muted(state.sort)
      : theme.muted('cat:') +
        theme.accent(state.category) +
        theme.muted('  sort:') +
        theme.accent(state.sort) +
        theme.muted('  src:') +
        theme.accent(state.sourceFilter) +
        theme.muted('  price:') +
        theme.accent(state.pricingFilter) +
        '   ' +
        countCluster;

    // Detail breadcrumb or plain header
    if (state.detail) {
      const it = items[state.cursor];
      const crumbName = it ? truncate(it.name, 30) : '';
      lines.push(
        pageHeader({
          title: 'MARKETPLACE',
          crumbs: crumbName ? [crumbName] : [],
          right: rightCluster,
          width,
          theme
        })
      );
    } else {
      lines.push(pageHeader({ title: 'MARKETPLACE', right: rightCluster, width, theme }));
    }
    lines.push(' ' + rule(width - 2, undefined, theme));

    // Filter input bar
    if (state.filtering) {
      lines.push(' ' + theme.accent('/') + ' ' + state.query + theme.dim('▏'));
      lines.push('');
    }

    // Empty state
    if (items.length === 0) {
      lines.push('');
      lines.push(
        '   ' +
          theme.dim('No items match ') +
          theme.accent(state.query || state.category) +
          theme.dim('.')
      );
      lines.push(
        '   ' +
          theme.dim('Press ') +
          theme.accent('/') +
          theme.dim(' to change filter, ') +
          theme.accent('c') +
          theme.dim(' to reset category.')
      );
      if (process.env.AGORA_LIVE_HUBS !== '1' && state.sourceFilter !== 'curated') {
        lines.push('');
        lines.push(
          '   ' + theme.dim('Tip: set AGORA_LIVE_HUBS=1 to pull live GitHub + HuggingFace items.')
        );
      }
      return frame(lines, width, height);
    }

    // ── DETAIL view ────────────────────────────────────────────────────────────
    if (state.detail) {
      const it = items[state.cursor];
      if (!it) return frame(lines, width, height);

      const detail: string[] = [];

      // Source pill + pricing pill
      const src = itemSource(it);
      const srcPill =
        src === 'github'
          ? pill('gh', 'info', theme) + ' '
          : src === 'hf'
            ? pill('hf', 'warning', theme) + ' '
            : pill('curated', 'muted', theme) + ' ';
      const pricePill = itemPricing(it) === 'paid' ? pill('PAID', 'accent', theme) + ' ' : '';
      detail.push(' ' + srcPill + pricePill + theme.bold(theme.accent(it.name)));

      // Author + version
      const metaParts: string[] = [];
      if (it.author) metaParts.push('by ' + it.author);
      if (it.version) metaParts.push('v' + it.version);
      if (metaParts.length) detail.push(' ' + theme.muted(metaParts.join('   ')));

      detail.push(' ' + rule(width - 2, undefined, theme));

      // Description (AI-enriched when available)
      const displayDesc = state.enrichment?.description
        ? state.enrichment.description + theme.dim(' (ai)')
        : (it.description ?? '');
      if (displayDesc) detail.push(' ' + displayDesc);
      if (state.enrichmentLoading) detail.push(' ' + theme.dim('(enriching…)'));

      // Stats
      detail.push('');
      const statsParts: string[] = [];
      if (it.installs !== undefined) {
        statsParts.push(theme.accent(fmtCount(it.installs)) + theme.muted(' installs'));
      }
      if (it.stars !== undefined) {
        statsParts.push(
          theme.accent(fmtCount(it.stars)) + theme.muted(' ' + starCountLabel(it, allItems))
        );
      }
      const pushedAt = itemPushedAt(it);
      if (pushedAt) {
        const ageH = (Date.now() - new Date(pushedAt).getTime()) / 3600000;
        const age = ageH < 24 ? Math.round(ageH) + 'h' : Math.round(ageH / 24) + 'd';
        statsParts.push(theme.dim('updated ' + age + ' ago'));
      }
      if (statsParts.length) detail.push(' ' + statsParts.join('   '));

      // Tags
      if (it.tags?.length) {
        detail.push(' ' + tagList(it.tags, theme));
      }

      // Repository
      const repoUrl = itemRepository(it);
      if (repoUrl) {
        detail.push(' ' + kvRow('repo', repoUrl, 6, theme));
      }

      // Permissions block
      const itPerms = it.kind === 'package' ? it.permissions : undefined;
      if (hasPermissions(itPerms)) {
        detail.push('');
        detail.push(' ' + rule(width - 2, 'Permissions', theme));
        for (const row of renderPermissionLines(itPerms).slice(1)) {
          const spaceIdx = row.indexOf(' ', 2);
          const label = row.slice(2, spaceIdx);
          const value = row.slice(spaceIdx + 1);
          detail.push('   ' + kvRow(label, value, 6, theme));
        }
      }

      // Related items
      const kind = it.kind === 'workflow' ? 'workflow' : 'package';
      const related = similarItems(it.id, { limit: 4, type: kind });
      const relatedFiltered = related.filter((r) => r.id !== it.id).slice(0, 3);
      if (relatedFiltered.length > 0) {
        detail.push('');
        detail.push(' ' + rule(width - 2, 'Related', theme));
        for (const rel of relatedFiltered) {
          const relStats = theme.muted(fmtCount(rel.installs ?? 0) + ' installs');
          detail.push('   ' + theme.bold(padRight(rel.name, 28)) + relStats);
          if (rel.description) {
            detail.push('   ' + theme.dim(truncate(rel.description, Math.max(0, width - 6))));
          }
        }
      }

      // Footer — pinned via padding
      const footer = [
        ' ' + rule(width - 2, undefined, theme),
        ' ' +
          theme.accent('i') +
          theme.dim(' install   ') +
          theme.accent('s') +
          theme.dim(' save   ') +
          theme.accent('o') +
          theme.dim(' open repo   ') +
          theme.accent('Esc') +
          theme.dim(' back')
      ];
      const padCount = Math.max(0, height - lines.length - detail.length - footer.length);
      lines.push(...detail);
      for (let i = 0; i < padCount; i++) lines.push('');
      lines.push(...footer);
      return frame(lines, width, height);
    }

    // ── LIST view ──────────────────────────────────────────────────────────────
    const limit = Math.max(0, height - lines.length - 1);
    const start = Math.max(0, Math.min(state.cursor - Math.floor(limit / 2), items.length - limit));
    const sbar = scrollbar(items.length, limit, state.cursor, style);
    for (let i = 0; i < limit && start + i < items.length; i++) {
      const it = items[start + i];
      if (!it) continue;
      const selected = start + i === state.cursor;
      const railStr = rail(theme, selected);
      const src = itemSource(it);
      const srcLabel =
        src === 'github'
          ? theme.info('[gh]')
          : src === 'hf'
            ? theme.warning('[hf]')
            : theme.muted('[c] ');
      const pricingBadge = itemPricing(it) === 'paid' ? theme.accent('PAID') + ' ' : '';
      const stats =
        pricingBadge +
        theme.accent(fmtCount(it.installs ?? 0).padStart(7)) +
        theme.muted(' installs') +
        (it.stars !== undefined
          ? '  ' +
            theme.accent(fmtCount(it.stars).padStart(5)) +
            theme.muted(' ' + starCountLabel(it, allItems))
          : '');
      const nameCell = selected ? theme.bold(it.name) : it.name;
      const perms = it.kind === 'package' ? it.permissions : undefined;
      const permCats = perms
        ? (['fs', 'net', 'exec'] as const).filter((k) => perms[k]?.length).join(' ')
        : '';
      const permSuffix = permCats ? ' ' + theme.dim('[' + permCats + ']') : '';

      // On narrow (xs), skip source badge to save space
      const left = narrow
        ? ' ' + railStr + nameCell + permSuffix
        : ' ' + railStr + srcLabel + ' ' + nameCell + permSuffix;
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
  handleKey(event, _ctx: PageContext): PageAction {
    if (state.view === 'scan') {
      if (event.key === 'esc' || event.key === 'n') {
        state.view = 'list';
        state.scanResult = null;
        state.scanLoading = false;
      }
      return { kind: 'none' };
    }

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
    const items = filtered(getMarketplaceItems());
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
          const selectedSource = selected ? itemSource(selected) : undefined;
          if (selected && selectedSource === 'github') {
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
          } else if (selected && selectedSource === 'hf') {
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
      case 'S': {
        const it = items[state.cursor];
        if (!it) return { kind: 'status', message: 'nothing selected' };
        state.view = 'scan';
        state.scanResult = null;
        state.scanLoading = true;
        const ctx = _ctx;
        scanItem(it, { githubToken: process.env.AGORA_GITHUB_TOKEN })
          .then((r) => {
            state.scanResult = r;
            state.scanLoading = false;
            ctx.repaint();
          })
          .catch(() => {
            state.scanLoading = false;
            ctx.repaint();
          });
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
          const url = it ? itemRepository(it) : undefined;
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
        state.sourceFilter = order[(order.indexOf(state.sourceFilter) + 1) % order.length] ?? 'all';
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
