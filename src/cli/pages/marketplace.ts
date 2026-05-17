import { execSync } from 'node:child_process';
import type { Page, PageAction, PageContext } from './types.js';
import {
  getMarketplaceItems,
  searchMarketplaceItems,
  similarItems,
  createInstallPlan,
  type MarketplaceItem,
  type InstallPlan
} from '../../marketplace.js';
import { vlen, rail, noRail, sep, fmtCount, frame, scrollbar } from './helpers.js';
import { enrichItem, type EnrichmentEntry } from '../../hubs/enrichment.js';
import { detectAgoraDataDir } from '../../state.js';

type SortKey = 'installs' | 'stars' | 'name';
interface MpState {
  cursor: number;
  detail: boolean;
  query: string;
  filtering: boolean;
  category: string;
  sort: SortKey;
  view: 'list' | 'install-preview';
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
  view: 'list',
  installPlan: null,
  installStatus: null,
  enrichment: null,
  enrichmentLoading: false
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
    { key: 'o', label: 'sort' }
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
      if (state.installStatus) {
        lines.push('');
        lines.push(' ' + style.accent(state.installStatus));
      }
      lines.push('');
      lines.push(
        ' ' +
          style.accent('y') +
          style.dim(' confirm   ') +
          style.accent('n') +
          style.dim('/') +
          style.accent('Esc') +
          style.dim(' cancel')
      );
      return frame(lines, width, height);
    }

    const items = filtered();
    state.cursor = Math.min(state.cursor, Math.max(0, items.length - 1));
    const lines: string[] = [];
    const top =
      ' ' +
      style.bold(style.accent('MARKETPLACE')) +
      '   ' +
      style.dim('category: ') +
      style.accent(state.category) +
      style.dim('  \u00b7  sort: ') +
      style.accent(state.sort) +
      '   ' +
      style.dim(items.length + (items.length === 1 ? ' item' : ' items'));
    lines.push(top);
    lines.push(' ' + sep('', width - 2, style));

    if (state.filtering) {
      lines.push(' ' + style.accent('/') + ' ' + state.query + style.dim('\u258f'));
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
      return frame(lines, width, height);
    }

    if (state.detail) {
      const it = items[state.cursor];
      if (it) {
        lines.push('');
        lines.push(' ' + style.bold(it.name) + (it.author ? style.dim('   by ' + it.author) : ''));
        lines.push(' ' + style.dim((it.tags ?? []).map((t) => '[' + t + ']').join(' ')));
        lines.push('');
        const displayDesc = state.enrichment?.description
          ? state.enrichment.description + style.dim(' (ai)')
          : (it.description ?? '');
        lines.push(' ' + displayDesc);
        if (state.enrichmentLoading) {
          lines.push(' ' + style.dim('(enriching…)'));
        }
        lines.push('');
        lines.push(
          ' ' +
            style.accent(fmtCount(it.installs ?? 0)) +
            style.dim(' installs   ') +
            (it.stars !== undefined ? style.accent(fmtCount(it.stars)) + style.dim(' \u2605') : '')
        );
        lines.push('');
        lines.push(
          ' ' +
            style.accent('i') +
            style.dim(' install   ') +
            style.accent('s') +
            style.dim(' save   ') +
            style.accent('Esc') +
            style.dim(' back')
        );
        const kind = it.kind === 'workflow' ? 'workflow' : 'package';
        const related = similarItems(it.id, { limit: 3, type: kind as any });
        if (related.length > 0) {
          lines.push('');
          lines.push(' ' + sep('Related', width - 2, style));
          for (const rel of related) {
            if (rel.id === it.id) continue;
            lines.push(
              '  \u00b7 ' +
                style.bold(rel.name.padEnd(20)) +
                style.dim(fmtCount(rel.installs ?? 0) + ' installs')
            );
          }
        }
      }
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
      const stats =
        style.accent(fmtCount(it.installs ?? 0).padStart(7)) +
        style.dim(' installs') +
        (it.stars !== undefined
          ? '  ' + style.accent(fmtCount(it.stars).padStart(5)) + style.dim(' \u2605')
          : '');
      const nameCell = selected ? style.bold(it.name) : it.name;
      const left = ' ' + lead + nameCell;
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
                '\u2013' +
                Math.min(start + limit, items.length) +
                ' of ' +
                items.length
            )
          : style.dim(items.length + (items.length === 1 ? ' item' : ' items')))
    );
    return frame(lines, width, height);
  },
  handleKey(event, _ctx: PageContext): PageAction {
    if (state.view === 'install-preview') {
      if (event.key === 'y' && state.installPlan) {
        const plan = state.installPlan;
        if (!plan.installable) {
          state.installStatus = plan.reason || 'Not installable.';
          return { kind: 'none' };
        }
        // Spawn commands sequentially via execSync (best-effort in TUI)
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
      case 's':
        return { kind: 'status', message: 'saved' };
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
        const order: SortKey[] = ['installs', 'stars', 'name'];
        state.sort = order[(order.indexOf(state.sort) + 1) % order.length] ?? 'installs';
        return { kind: 'none' };
      }
      default:
        return { kind: 'none' };
    }
  }
};
