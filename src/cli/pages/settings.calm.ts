import type { Page, PageAction, PageContext } from './types.js';
// TODO PR-N: src/settings.ts will be authored in a later PR; the signatures below are the contract.
import {
  loadSettings, writeSettings, type AgoraSettings,
} from '../../settings.js';

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
function frame(lines: ReadonlyArray<string>, width: number, height: number): string {
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    out.push(padRight(truncate(lines[i] ?? '', width), width));
  }
  return out.join('\n');
}
// ──────────────────────────────────────────────────────────────────────────────

interface Field {
  section: 'Account' | 'Display' | 'News' | 'Community';
  key: string;
  label: string;
  kind: 'text' | 'toggle' | 'select' | 'number';
  options?: ReadonlyArray<string>;
  read(s: AgoraSettings): string;
  write(s: AgoraSettings, value: string): AgoraSettings;
}

const FIELDS: ReadonlyArray<Field> = [
  { section: 'Account', key: 'username', label: 'username', kind: 'text',
    read: (s) => s.account.username,
    write: (s, v) => ({ ...s, account: { ...s.account, username: v } }) },
  { section: 'Account', key: 'backend', label: 'backend', kind: 'text',
    read: (s) => s.account.backend,
    write: (s, v) => ({ ...s, account: { ...s.account, backend: v } }) },
  { section: 'Account', key: 'declared_llm', label: 'declared LLM', kind: 'text',
    read: (s) => s.account.declared_llm || '(none)',
    write: (s, v) => ({ ...s, account: { ...s.account, declared_llm: v } }) },
  { section: 'Display', key: 'color', label: 'color', kind: 'select',
    options: ['auto', 'truecolor', 'none'],
    read: (s) => s.display.color,
    write: (s, v) => ({
      ...s,
      display: { ...s.display, color: v as AgoraSettings['display']['color'] },
    }) },
  { section: 'Display', key: 'banner', label: 'banner', kind: 'toggle',
    read: (s) => s.display.banner ? 'on' : 'off',
    write: (s, _v) => ({ ...s, display: { ...s.display, banner: !s.display.banner } }) },
  { section: 'Community', key: 'default_board', label: 'default board', kind: 'text',
    read: (s) => s.community.default_board,
    write: (s, v) => ({ ...s, community: { ...s.community, default_board: v } }) },
  { section: 'Community', key: 'collapse_flag_threshold', label: 'collapse flags \u2265', kind: 'number',
    read: (s) => String(s.community.collapse_flag_threshold),
    write: (s, v) => ({
      ...s,
      community: { ...s.community, collapse_flag_threshold: Number(v) || 0 },
    }) },
];

interface SettState {
  cursor: number;
  current: AgoraSettings | undefined;
  editing: boolean;
  buffer: string;
  dirty: boolean;
}
const state: SettState = {
  cursor: 0, current: undefined, editing: false, buffer: '', dirty: false,
};

function ensureLoaded(_ctx: PageContext): AgoraSettings {
  if (!state.current) {
    // TODO PR-N: dataDir resolution lives in src/settings.ts.
    state.current = loadSettings('~/.config/agora');
  }
  return state.current;
}

export const settingsPage: Page = {
  id: 'settings',
  title: 'SETTINGS',
  navLabel: 'Settings',
  navIcon: 'S',
  hotkeys: [
    { key: 'j/k', label: 'nav' },
    { key: 'Space', label: 'toggle/edit' },
    { key: 'Enter', label: 'edit' },
    { key: '+/-', label: 'inc/dec' },
    { key: 'Esc', label: 'cancel' },
    { key: 'w', label: 'write' },
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const s = ensureLoaded(ctx);
    const lines: string[] = [];
    lines.push(' ' + style.bold(style.accent('SETTINGS'))
      + (state.dirty ? '  ' + style.accent('\u2022 unsaved') : ''));
    lines.push('');

    let lastSection = '';
    FIELDS.forEach((f, i) => {
      if (f.section !== lastSection) {
        lines.push('  ' + sep(f.section, width - 4, style));
        lastSection = f.section;
      }
      const sel = i === state.cursor;
      const lead = sel ? rail(style) : noRail();
      const valueRaw = state.editing && sel ? state.buffer : f.read(s);
      const value = (state.editing && sel)
        ? style.accent(valueRaw) + style.dim('\u258f')
        : style.accent(valueRaw);
      lines.push(' ' + lead + style.bold(f.label.padEnd(16)) + value);
    });

    lines.push('');
    lines.push('  ' + style.dim('Settings live in ')
      + style.accent('~/.config/agora/settings.toml')
      + style.dim(' \u00b7 hand-editable.'));
    return frame(lines, width, height);
  },
  handleKey(event, ctx): PageAction {
    const s = ensureLoaded(ctx);
    const field = FIELDS[state.cursor];
    if (state.editing && field) {
      if (event.key === 'esc') { state.editing = false; state.buffer = ''; return { kind: 'none' }; }
      if (event.key === 'enter') {
        state.current = field.write(s, state.buffer);
        state.editing = false; state.dirty = true;
        return { kind: 'none' };
      }
      if (event.key === 'backspace') { state.buffer = state.buffer.slice(0, -1); return { kind: 'none' }; }
      if (event.key.length === 1 && !event.ctrl) { state.buffer += event.key; return { kind: 'none' }; }
      return { kind: 'none' };
    }
    switch (event.key) {
      case 'j': case 'down':
        state.cursor = Math.min(FIELDS.length - 1, state.cursor + 1); return { kind: 'none' };
      case 'k': case 'up':
        state.cursor = Math.max(0, state.cursor - 1); return { kind: 'none' };
      case 'space': case 'enter': {
        if (!field) return { kind: 'none' };
        if (field.kind === 'toggle') {
          state.current = field.write(s, '');
          state.dirty = true; return { kind: 'none' };
        }
        if (field.kind === 'select' && field.options) {
          const cur = field.read(s);
          const next = field.options[(field.options.indexOf(cur) + 1) % field.options.length] ?? field.options[0]!;
          state.current = field.write(s, next);
          state.dirty = true; return { kind: 'none' };
        }
        state.editing = true; state.buffer = field.read(s);
        return { kind: 'none' };
      }
      case '+': case '=': {
        if (field?.kind === 'number') {
          state.current = field.write(s, String((Number(field.read(s)) || 0) + 1));
          state.dirty = true;
        }
        return { kind: 'none' };
      }
      case '-': {
        if (field?.kind === 'number') {
          state.current = field.write(s, String((Number(field.read(s)) || 0) - 1));
          state.dirty = true;
        }
        return { kind: 'none' };
      }
      case 'w': {
        if (state.current) writeSettings('~/.config/agora', state.current);
        state.dirty = false;
        return { kind: 'status', message: 'settings written to ~/.config/agora/settings.toml' };
      }
      default: return { kind: 'none' };
    }
  },
};
