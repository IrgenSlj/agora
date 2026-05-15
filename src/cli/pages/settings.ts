import type { Page, PageAction, PageContext } from './types.js';
import {
  loadSettings, writeSettings, type AgoraSettings,
} from '../../settings.js';
import { vlen, rail, noRail, frame } from './helpers.js';

interface Field {
  section: 'Account' | 'Display' | 'News' | 'Community';
  key: string;
  label: string;
  kind: 'text' | 'toggle' | 'select' | 'number';
  options?: ReadonlyArray<string>;
  read(s: AgoraSettings): string;
  write(s: AgoraSettings, v: string): AgoraSettings;
}

const FIELDS: ReadonlyArray<Field> = [
  { section: 'Account', key: 'username', label: 'username', kind: 'text',
    read: (s) => s.account.username,
    write: (s, v) => ({ ...s, account: { ...s.account, username: v } }) },
  { section: 'Account', key: 'backend', label: 'backend', kind: 'text',
    read: (s) => s.account.backend,
    write: (s, v) => ({ ...s, account: { ...s.account, backend: v } }) },
  { section: 'Account', key: 'declared_llm', label: 'declared_llm', kind: 'text',
    read: (s) => s.account.declared_llm || '',
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
  { section: 'Community', key: 'default_board', label: 'default_board', kind: 'text',
    read: (s) => s.community.default_board,
    write: (s, v) => ({ ...s, community: { ...s.community, default_board: v } }) },
  { section: 'Community', key: 'collapse_flag_threshold', label: 'collapse_flag_threshold', kind: 'number',
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
  if (!state.current) state.current = loadSettings('~/.config/agora');
  return state.current;
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
  ],
  render(ctx: PageContext): string {
    const { style, width, height } = ctx;
    const s = ensureLoaded(ctx);
    const lines: string[] = [];
    const head = ' ' + style.bold(style.accent('SETTINGS'))
      + style.dim('  ~/.config/agora/settings.toml');
    const right = state.dirty
      ? style.accent('unsaved') + style.dim('  (')
        + style.accent('w') + style.dim(' to write)')
      : style.dim('clean');
    const gap = Math.max(2, width - vlen(head) - vlen(right) - 2);
    lines.push(head + ' '.repeat(gap) + right);
    lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));

    let lastSection = '';
    FIELDS.forEach((f, i) => {
      if (f.section !== lastSection) {
        lines.push(' ' + style.dim('[' + f.section.toLowerCase() + ']'));
        lastSection = f.section;
      }
      const sel = i === state.cursor;
      const lead = sel ? rail(style) : noRail();
      const raw = state.editing && sel ? state.buffer : f.read(s);
      const value = state.editing && sel
        ? style.accent(raw) + style.dim('\u258f')
        : style.accent(raw.length ? raw : '\u2014');
      const hintText = f.kind === 'toggle' ? 'space'
        : f.kind === 'select' ? 'space cycle'
        : f.kind === 'number' ? '+/-'
        : 'Enter';
      const hint = sel ? '   ' + style.dim(hintText) : '';
      lines.push(' ' + lead + style.bold(f.label.padEnd(28)) + '= ' + value + hint);
    });
    lines.push(' ' + style.dim('\u2500'.repeat(Math.max(0, width - 2))));
    lines.push(' ' + style.dim('TOML is hand-editable; the TUI re-reads on next launch.'));
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
      case '+': case '=':
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
        if (state.current) writeSettings('~/.config/agora', state.current);
        state.dirty = false;
        return { kind: 'status', message: 'wrote settings.toml' };
      default: return { kind: 'none' };
    }
  },
};
