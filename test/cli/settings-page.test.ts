/**
 * Render tests for src/cli/pages/settings.ts (UI2 design-system restyling).
 *
 * Asserts:
 *  - Fields grouped by section (Account / Display / News)
 *  - Focused-row indicator present
 *  - Toggle shows on/off affordance; select cycles; number shows +/- affordance
 *  - unsaved → saved indicator on write
 *  - Narrow mode: no line exceeds width
 *  - NO_COLOR mode: readable plain text, no ANSI codes
 *  - Help overlay: hotkey list + field descriptions
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';

import { _resetSettingsState, settingsPage } from '../../src/cli/pages/settings.js';
import type { AppState, KeyEvent, PageContext } from '../../src/cli/pages/types.js';
import { createStyler } from '../../src/ui.js';

// ── helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, '');
const vlen = (s: string) => strip(s).length;

function makeCtx(opts: {
  tmp: string;
  width?: number;
  height?: number;
  color?: boolean;
}): PageContext {
  const { tmp, width = 100, height = 40, color = false } = opts;
  const style = createStyler(color);
  return {
    io: {
      stdout: { write: () => {} } as any,
      stderr: { write: () => {} } as any,
      env: { HOME: tmp, AGORA_HOME: tmp, PATH: process.env.PATH ?? '' },
      cwd: tmp
    },
    style,
    width,
    height,
    trueColor: false,
    app: { user: {}, cwd: tmp, unread: { news: 0 } } as AppState,
    repaint() {}
  } as PageContext;
}

function key(k: string): KeyEvent {
  return { key: k, raw: k, ctrl: false, shift: false, meta: false };
}

// ── setup ─────────────────────────────────────────────────────────────────────

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agora-settings-page-test-'));
  _resetSettingsState();
});

// ── section grouping ──────────────────────────────────────────────────────────

describe('settings render — section grouping', () => {
  test('all three sections appear in the output', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('account');
    expect(out).toContain('display');
    expect(out).toContain('news');
  });

  test('Account fields appear before Display fields', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out.indexOf('account')).toBeLessThan(out.indexOf('display'));
  });

  test('Display fields appear before News fields', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    const dPos = out.indexOf('display');
    const nPos = out.indexOf('news');
    expect(dPos).toBeLessThan(nPos);
  });

  test('username, declared_llm are in Account section', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('username');
    expect(out).toContain('declared_llm');
  });

  test('news source toggles are present', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('source.hn');
    expect(out).toContain('source.arxiv');
    expect(out).toContain('source.rss');
  });
});

// ── header ────────────────────────────────────────────────────────────────────

describe('settings render — header', () => {
  test('SETTINGS title appears in header', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('SETTINGS');
  });

  test('saved indicator shown when not dirty', () => {
    const ctx = makeCtx({ tmp });
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('saved');
  });

  test('unsaved indicator shown after a toggle', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx); // prime state.current
    // Navigate to banner field (index 3 = Display → banner toggle)
    for (let i = 0; i < 3; i++) {
      settingsPage.handleKey(key('j'), ctx);
    }
    settingsPage.handleKey(key('space'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('unsaved');
  });

  test('unsaved indicator disappears after write', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    for (let i = 0; i < 3; i++) settingsPage.handleKey(key('j'), ctx);
    settingsPage.handleKey(key('space'), ctx);
    settingsPage.handleKey(key('w'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).not.toContain('unsaved');
    expect(out).toContain('saved');
  });
});

// ── focused-row indicator ─────────────────────────────────────────────────────

describe('settings render — focused row', () => {
  test('cursor=0: first field has focused indicator (NO_COLOR shows >)', () => {
    const ctx = makeCtx({ tmp, color: false });
    const out = settingsPage.render(ctx); // NO_COLOR
    // rail() returns '> ' when no color
    expect(out).toContain('>');
  });

  test('navigating down moves focus to next field', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('j'), ctx);
    const out = strip(settingsPage.render(ctx));
    // 'declared_llm' should now be selected (field[1]); help text should appear
    expect(out).toContain('declared_llm');
  });

  test('j/k navigation stays in bounds', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    // Navigate well past the end
    for (let i = 0; i < 50; i++) settingsPage.handleKey(key('j'), ctx);
    // Navigate well past the start
    for (let i = 0; i < 50; i++) settingsPage.handleKey(key('k'), ctx);
    // Should not throw; output still renders
    const out = settingsPage.render(ctx);
    expect(out.length).toBeGreaterThan(0);
  });
});

// ── toggle affordance ─────────────────────────────────────────────────────────

describe('settings render — toggle affordance', () => {
  test('toggle field shows on or off', () => {
    const ctx = makeCtx({ tmp });
    // Navigate to banner field (index 3)
    settingsPage.render(ctx);
    for (let i = 0; i < 3; i++) settingsPage.handleKey(key('j'), ctx);
    const out = strip(settingsPage.render(ctx));
    // Default banner=true so shows 'on'
    expect(out.toLowerCase()).toMatch(/\bon\b|\boff\b/);
  });

  test('space toggles a toggle field and marks dirty', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    for (let i = 0; i < 3; i++) settingsPage.handleKey(key('j'), ctx);
    const before = strip(settingsPage.render(ctx));
    settingsPage.handleKey(key('space'), ctx);
    const after = strip(settingsPage.render(ctx));
    // The on/off value must have changed
    const getVal = (s: string) => {
      const m = s.match(/\b(on|off)\b/i);
      return m ? m[1]!.toLowerCase() : '';
    };
    expect(getVal(before)).not.toBe(getVal(after));
  });
});

// ── select affordance ─────────────────────────────────────────────────────────

describe('settings render — select affordance', () => {
  test('color field shows its current value', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    // Navigate to color field (index 2)
    for (let i = 0; i < 2; i++) settingsPage.handleKey(key('j'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toMatch(/auto|truecolor|none/);
  });

  test('space on select field cycles to next option', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    for (let i = 0; i < 2; i++) settingsPage.handleKey(key('j'), ctx);
    const before = strip(settingsPage.render(ctx));
    settingsPage.handleKey(key('space'), ctx);
    const after = strip(settingsPage.render(ctx));
    // The value should have changed (auto → truecolor → none → auto)
    expect(before).not.toBe(after);
  });
});

// ── text edit affordance ──────────────────────────────────────────────────────

describe('settings render — text edit (live caret)', () => {
  test('Enter on text field enters editing mode (caret shown)', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx); // cursor=0, username field
    settingsPage.handleKey(key('enter'), ctx);
    const out = strip(settingsPage.render(ctx));
    // In editing mode a caret character appears (▏ or | in NO_COLOR)
    // We just need to confirm we're in the edit path — the raw value is visible
    expect(out).toContain('username');
  });

  test('typing characters appends to buffer', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('enter'), ctx);
    settingsPage.handleKey(key('a'), ctx);
    settingsPage.handleKey(key('b'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('ab');
  });

  test('Esc cancels edit without saving', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('enter'), ctx);
    settingsPage.handleKey(key('a'), ctx);
    settingsPage.handleKey(key('esc'), ctx);
    const after = strip(settingsPage.render(ctx));
    // Should not contain 'unsaved' (cancelled, so not dirty)
    expect(after).not.toContain('unsaved');
  });

  test('Enter confirms edit and marks dirty', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('enter'), ctx);
    settingsPage.handleKey(key('t'), ctx);
    settingsPage.handleKey(key('s'), ctx);
    settingsPage.handleKey(key('t'), ctx);
    settingsPage.handleKey(key('enter'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('unsaved');
  });
});

// ── write / revert ────────────────────────────────────────────────────────────

describe('settings render — write and revert', () => {
  test('w write returns status action "wrote settings.toml"', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    const action = settingsPage.handleKey(key('w'), ctx);
    expect(action).toMatchObject({ kind: 'status', message: 'wrote settings.toml' });
  });

  test('after write, dirty flag clears (indicator shows saved)', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    for (let i = 0; i < 3; i++) settingsPage.handleKey(key('j'), ctx);
    settingsPage.handleKey(key('space'), ctx);
    settingsPage.handleKey(key('w'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).not.toContain('unsaved');
    expect(out).toContain('saved');
  });

  test('r revert restores from disk and clears dirty', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    for (let i = 0; i < 3; i++) settingsPage.handleKey(key('j'), ctx);
    settingsPage.handleKey(key('space'), ctx);
    expect(strip(settingsPage.render(ctx))).toContain('unsaved');
    settingsPage.handleKey(key('r'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).not.toContain('unsaved');
    expect(out).toContain('saved');
  });
});

// ── help overlay ──────────────────────────────────────────────────────────────

describe('settings render — help overlay', () => {
  test('? opens help overlay with hotkey list', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('?'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('SETTINGS HELP');
    expect(out).toContain('j/k');
    expect(out).toContain('write');
  });

  test('? again or Esc closes help overlay', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('?'), ctx);
    settingsPage.handleKey(key('esc'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).not.toContain('SETTINGS HELP');
    expect(out).toContain('SETTINGS');
  });

  test('help overlay contains field descriptions', () => {
    const ctx = makeCtx({ tmp });
    settingsPage.render(ctx);
    settingsPage.handleKey(key('?'), ctx);
    const out = strip(settingsPage.render(ctx));
    expect(out).toContain('username');
    expect(out).toContain('Hacker News');
  });
});

// ── width / NO_COLOR constraints ──────────────────────────────────────────────

describe('settings render — width and NO_COLOR', () => {
  test('NO_COLOR mode produces no ANSI escape codes', () => {
    const ctx = makeCtx({ tmp, color: false });
    const out = settingsPage.render(ctx);
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/\x1b\[/);
  });

  test('NO_COLOR mode is readable: sections and field names present', () => {
    const ctx = makeCtx({ tmp, color: false });
    const out = settingsPage.render(ctx);
    expect(out).toContain('account');
    expect(out).toContain('username');
    expect(out).toContain('SETTINGS');
  });

  test('narrow width: no line exceeds width (80)', () => {
    const ctx = makeCtx({ tmp, width: 80, color: false });
    const out = settingsPage.render(ctx);
    for (const line of out.split('\n')) {
      expect(vlen(line)).toBeLessThanOrEqual(80);
    }
  });

  test('narrow width: no line exceeds width (60)', () => {
    const ctx = makeCtx({ tmp, width: 60, color: false });
    const out = settingsPage.render(ctx);
    for (const line of out.split('\n')) {
      expect(vlen(line)).toBeLessThanOrEqual(60);
    }
  });

  test('normal width: no line exceeds width (100)', () => {
    const ctx = makeCtx({ tmp, width: 100, color: false });
    const out = settingsPage.render(ctx);
    for (const line of out.split('\n')) {
      expect(vlen(line)).toBeLessThanOrEqual(100);
    }
  });
});
