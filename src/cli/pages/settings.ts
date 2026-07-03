import type { Page, PageAction, PageContext } from './types.js';
import { loadSettings, writeSettings, type AgoraSettings } from '../../settings.js';
import { detectAgoraDataDir } from '../../state.js';
import { liftStyler } from '../theme.js';
import { vlen, frame, rule, rail, kvRow, pill, status, pageHeader } from './components.js';

interface Field {
  section: 'Account' | 'Display' | 'News' | 'Community';
  key: string;
  label: string;
  kind: 'text' | 'toggle' | 'select' | 'number';
  options?: ReadonlyArray<string>;
  read(s: AgoraSettings): string;
  write(s: AgoraSettings, v: string): AgoraSettings;
}

const NEWS_SOURCE_IDS = ['hn', 'github-trending', 'arxiv', 'rss'] as const;
type NewsSourceId = (typeof NEWS_SOURCE_IDS)[number];

function makeNewsSourceField(src: NewsSourceId): Field {
  return {
    section: 'News',
    key: `news_${src}`,
    label: `source.${src}`,
    kind: 'toggle',
    read: (s) => (s.news.sources[src]?.enabled ? 'on' : 'off'),
    write: (s, _v) => ({
      ...s,
      news: {
        ...s.news,
        sources: {
          ...s.news.sources,
          [src]: {
            ...s.news.sources[src],
            enabled: !s.news.sources[src]?.enabled
          }
        }
      }
    })
  };
}

const FIELD_HELP: Record<string, string> = {
  username: 'Public name shown on posts and reviews.',
  backend: 'Backend URL override — reserved, not currently wired to any command.',
  declared_llm: 'LLM identity to disclose on posts (optional).',
  color: 'Terminal color mode: auto, truecolor, or none.',
  banner: 'Show/hide the ASCII banner on startup.',
  default_board: 'Community board opened by default.',
  collapse_flag_threshold: 'Posts flagged this many times are collapsed.',
  news_hn: 'Fetch stories from Hacker News.',
  'news_github-trending': 'Fetch trending GitHub repositories.',
  news_arxiv: 'Fetch AI/ML papers from arXiv.',
  news_rss: 'Fetch items from configured RSS feeds.'
};

const FIELDS: ReadonlyArray<Field> = [
  {
    section: 'Account',
    key: 'username',
    label: 'username',
    kind: 'text',
    read: (s) => s.account.username,
    write: (s, v) => ({ ...s, account: { ...s.account, username: v } })
  },
  {
    section: 'Account',
    key: 'backend',
    label: 'backend',
    kind: 'text',
    read: (s) => s.account.backend,
    write: (s, v) => ({ ...s, account: { ...s.account, backend: v } })
  },
  {
    section: 'Account',
    key: 'declared_llm',
    label: 'declared_llm',
    kind: 'text',
    read: (s) => s.account.declared_llm || '',
    write: (s, v) => ({ ...s, account: { ...s.account, declared_llm: v } })
  },
  {
    section: 'Display',
    key: 'color',
    label: 'color',
    kind: 'select',
    options: ['auto', 'truecolor', 'none'],
    read: (s) => s.display.color,
    write: (s, v) => ({
      ...s,
      display: { ...s.display, color: v as AgoraSettings['display']['color'] }
    })
  },
  {
    section: 'Display',
    key: 'banner',
    label: 'banner',
    kind: 'toggle',
    read: (s) => (s.display.banner ? 'on' : 'off'),
    write: (s, _v) => ({ ...s, display: { ...s.display, banner: !s.display.banner } })
  },
  ...NEWS_SOURCE_IDS.map(makeNewsSourceField),
  {
    section: 'Community',
    key: 'default_board',
    label: 'default_board',
    kind: 'text',
    read: (s) => s.community.default_board,
    write: (s, v) => ({ ...s, community: { ...s.community, default_board: v } })
  },
  {
    section: 'Community',
    key: 'collapse_flag_threshold',
    label: 'collapse_flag_threshold',
    kind: 'number',
    read: (s) => String(s.community.collapse_flag_threshold),
    write: (s, v) => ({
      ...s,
      community: { ...s.community, collapse_flag_threshold: Number(v) || 0 }
    })
  }
];

// Key column width — wide enough for the longest label
const KEY_W = 24;

interface SettState {
  cursor: number;
  current: AgoraSettings | undefined;
  editing: boolean;
  buffer: string;
  dirty: boolean;
  helpOpen: boolean;
}
const state: SettState = {
  cursor: 0,
  current: undefined,
  editing: false,
  buffer: '',
  dirty: false,
  helpOpen: false
};

/** Reset module-level state — for test isolation only. */
export function _resetSettingsState(): void {
  state.cursor = 0;
  state.current = undefined;
  state.editing = false;
  state.buffer = '';
  state.dirty = false;
  state.helpOpen = false;
}

function resolveDataDir(ctx: PageContext): string {
  return detectAgoraDataDir({ cwd: ctx.io.cwd, home: ctx.io.env?.HOME, env: ctx.io.env });
}

function ensureLoaded(ctx: PageContext): AgoraSettings {
  if (!state.current) state.current = loadSettings(resolveDataDir(ctx));
  return state.current;
}

/** Render a field value using pills for toggle/select, accent+caret for editing. */
function renderValue(
  f: Field,
  raw: string,
  editing: boolean,
  theme: ReturnType<typeof liftStyler>
): string {
  if (editing) {
    return theme.accent(raw) + theme.dim('▏');
  }
  if (f.kind === 'toggle') {
    return raw === 'on' ? pill('on', 'success', theme) : pill('off', 'muted', theme);
  }
  if (f.kind === 'select') {
    return pill(raw || '—', 'accent', theme);
  }
  if (f.kind === 'number') {
    return theme.accent(raw || '0') + theme.dim('  +/-');
  }
  return theme.accent(raw.length ? raw : '—');
}

export const settingsPage: Page = {
  id: 'settings',
  title: 'SETTINGS',
  navLabel: 'Settings',
  navIcon: 'S',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Space', label: 'toggle' },
    { key: 'Enter', label: 'edit' },
    { key: '+/-', label: 'inc/dec' },
    { key: 'Esc', label: 'cancel' },
    { key: 'w', label: 'write' },
    { key: 'r', label: 'revert' },
    { key: '?', label: 'help' }
  ],
  render(ctx: PageContext): string {
    const { style, width, height, trueColor } = ctx;
    const theme = liftStyler(style, { trueColor });
    const s = ensureLoaded(ctx);

    // ── Help overlay ──────────────────────────────────────────────────────────
    if (state.helpOpen) {
      const lines: string[] = [];
      lines.push(pageHeader({ title: 'SETTINGS HELP', width, theme }));
      lines.push(' ' + rule(Math.max(0, width - 2), undefined, theme));
      lines.push('');
      lines.push(' ' + theme.bold('Hotkeys'));
      lines.push('   ' + theme.accent('j/k') + theme.dim('        navigate fields'));
      lines.push('   ' + theme.accent('Space') + theme.dim('      toggle on/off or cycle select'));
      lines.push('   ' + theme.accent('Enter') + theme.dim('      edit text field'));
      lines.push('   ' + theme.accent('+/-') + theme.dim('        increment/decrement number'));
      lines.push('   ' + theme.accent('w') + theme.dim('          write (save) to disk'));
      lines.push('   ' + theme.accent('r') + theme.dim('          revert unsaved changes'));
      lines.push('   ' + theme.accent('Esc') + theme.dim('        cancel edit'));
      lines.push('   ' + theme.accent('?') + theme.dim('          toggle this help'));
      lines.push('');
      lines.push(' ' + theme.bold('Fields'));
      for (const [key, desc] of Object.entries(FIELD_HELP)) {
        lines.push('   ' + theme.accent(key.padEnd(26)) + theme.dim(desc));
      }
      lines.push('');
      lines.push(' ' + theme.dim('Press ? or Esc to dismiss.'));
      return frame(lines, width, height);
    }

    // ── Main settings view ────────────────────────────────────────────────────
    const lines: string[] = [];

    // Header: title + unsaved/saved indicator
    const indicator = state.dirty
      ? status('warning', 'unsaved', theme)
      : status('success', 'saved', theme);
    lines.push(
      pageHeader({
        title: 'SETTINGS',
        crumbs: ['~/.config/agora/settings.toml'],
        right: indicator,
        width,
        theme
      })
    );

    let lastSection = '';
    FIELDS.forEach((f, i) => {
      if (f.section !== lastSection) {
        // Section rule — indented one space, fills remaining width
        lines.push(' ' + rule(Math.max(0, width - 2), f.section.toLowerCase(), theme));
        lastSection = f.section;
      }

      const sel = i === state.cursor;
      const lead = rail(theme, sel);
      const raw = state.editing && sel ? state.buffer : f.read(s);
      const value = renderValue(f, raw, state.editing && sel, theme);

      // kvRow for the label; rail prefix eats 2 chars
      const labelStr = kvRow(f.label, '', KEY_W, theme);
      const row = ' ' + lead + labelStr + value;
      lines.push(row);

      // Inline hint on the selected row (edit/toggle affordance)
      if (sel && !state.editing) {
        const hintText =
          f.kind === 'toggle'
            ? 'space'
            : f.kind === 'select'
              ? 'space cycle'
              : f.kind === 'number'
                ? '+/-'
                : 'enter';
        // Append hint after value if space allows, else skip (narrow)
        // eslint-disable-next-line no-control-regex
        const rowPlain = row.replace(/\x1b\[[0-9;]*m/g, '');
        const hintStr = '   ' + theme.dim(hintText);
        if (rowPlain.length + vlen(hintStr) < width) {
          // replace last line with hint appended
          lines[lines.length - 1] = row + hintStr;
        }
      }

      // Focused row: inline help text below
      if (sel) {
        const helpText = FIELD_HELP[f.key];
        if (helpText) {
          lines.push('   ' + theme.dim('  ' + helpText));
        }
      }
    });

    lines.push(' ' + rule(Math.max(0, width - 2), undefined, theme));
    lines.push(' ' + theme.dim('TOML is hand-editable; the TUI re-reads on next launch.'));

    return frame(lines, width, height);
  },
  handleKey(event, ctx): PageAction {
    if (state.helpOpen) {
      if (event.key === '?' || event.key === 'esc') {
        state.helpOpen = false;
      }
      return { kind: 'none' };
    }

    const s = ensureLoaded(ctx);
    const field = FIELDS[state.cursor];
    if (state.editing && field) {
      if (event.key === 'esc') {
        state.editing = false;
        state.buffer = '';
        return { kind: 'none' };
      }
      if (event.key === 'enter') {
        state.current = field.write(s, state.buffer);
        state.editing = false;
        state.dirty = true;
        return { kind: 'none' };
      }
      if (event.key === 'backspace') {
        state.buffer = state.buffer.slice(0, -1);
        return { kind: 'none' };
      }
      if (event.key.length === 1 && !event.ctrl) {
        state.buffer += event.key;
        return { kind: 'none' };
      }
      return { kind: 'none' };
    }
    switch (event.key) {
      case 'j':
      case 'down':
        state.cursor = Math.min(FIELDS.length - 1, state.cursor + 1);
        return { kind: 'none' };
      case 'k':
      case 'up':
        state.cursor = Math.max(0, state.cursor - 1);
        return { kind: 'none' };
      case 'space':
      case 'enter': {
        if (!field) return { kind: 'none' };
        if (field.kind === 'toggle') {
          state.current = field.write(s, '');
          state.dirty = true;
          return { kind: 'none' };
        }
        if (field.kind === 'select' && field.options) {
          const cur = field.read(s);
          const next =
            field.options[(field.options.indexOf(cur) + 1) % field.options.length] ??
            field.options[0]!;
          state.current = field.write(s, next);
          state.dirty = true;
          return { kind: 'none' };
        }
        state.editing = true;
        state.buffer = field.read(s);
        return { kind: 'none' };
      }
      case '+':
      case '=':
        if (field?.kind === 'number') {
          state.current = field.write(s, String((Number(field.read(s)) || 0) + 1));
          state.dirty = true;
        }
        return { kind: 'none' };
      case '-':
        if (field?.kind === 'number') {
          state.current = field.write(s, String((Number(field.read(s)) || 0) - 1));
          state.dirty = true;
        }
        return { kind: 'none' };
      case 'w':
        if (state.current) writeSettings(resolveDataDir(ctx), state.current);
        state.dirty = false;
        return { kind: 'status', message: 'wrote settings.toml' };
      case 'r':
        if (state.dirty) {
          state.current = loadSettings(resolveDataDir(ctx));
          state.dirty = false;
          return { kind: 'status', message: 'reverted' };
        }
        return { kind: 'none' };
      case '?':
        state.helpOpen = true;
        return { kind: 'none' };
      default:
        return { kind: 'none' };
    }
  }
};
