import { describe, test, expect } from 'bun:test';
import { renderHeader, renderFooter } from '../../src/cli/tui';
import { createStyler } from '../../src/ui';
import { liftStyler } from '../../src/cli/theme';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, '');
const vlen = (s: string) => strip(s).length;

const WIDTH = 100;

const baseApp = {
  user: { username: 'testuser' },
  cwd: '/tmp/test',
  unread: { news: 0, community: 0 }
};

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTheme(color: boolean, tc: boolean) {
  const style = createStyler(color, tc);
  return { style, theme: liftStyler(style, { trueColor: tc }) };
}

// ── renderFooter — width constraint ──────────────────────────────────────────

describe('renderFooter width guard', () => {
  for (const [label, color, tc] of [
    ['color+truecolor', true, true],
    ['color+256', true, false],
    ['NO_COLOR', false, false]
  ] as [string, boolean, boolean][]) {
    test(`footer lines fit within width (${label})`, () => {
      const { theme } = makeTheme(color, tc);
      const [sl, footer] = renderFooter(WIDTH, theme, [], null);
      expect(vlen(sl)).toBeLessThanOrEqual(WIDTH);
      expect(vlen(footer)).toBeLessThanOrEqual(WIDTH);
    });

    test(`status line fits within width — info tone (${label})`, () => {
      const { theme } = makeTheme(color, tc);
      const [sl] = renderFooter(WIDTH, theme, [], { msg: 'something happened', tone: 'info' });
      expect(vlen(sl)).toBeLessThanOrEqual(WIDTH);
    });

    test(`status line fits within width — warn tone (${label})`, () => {
      const { theme } = makeTheme(color, tc);
      const [sl] = renderFooter(WIDTH, theme, [], { msg: 'watch out', tone: 'warn' });
      expect(vlen(sl)).toBeLessThanOrEqual(WIDTH);
    });

    test(`status line fits within width — error tone (${label})`, () => {
      const { theme } = makeTheme(color, tc);
      const [sl] = renderFooter(WIDTH, theme, [], { msg: 'something went wrong', tone: 'error' });
      expect(vlen(sl)).toBeLessThanOrEqual(WIDTH);
    });

    test(`footer with page hotkeys fits width (${label})`, () => {
      const { theme } = makeTheme(color, tc);
      const hotkeys = [
        { key: 'i', label: 'install' },
        { key: 'r', label: 'remove' },
        { key: 'u', label: 'update' }
      ];
      const [, footer] = renderFooter(WIDTH, theme, hotkeys, null);
      expect(vlen(footer)).toBeLessThanOrEqual(WIDTH);
    });
  }

  test('footer never exceeds a narrow width (60)', () => {
    const { theme } = makeTheme(true, true);
    const [sl, footer] = renderFooter(60, theme, [{ key: 'i', label: 'install' }], null);
    expect(vlen(sl)).toBeLessThanOrEqual(60);
    expect(vlen(footer)).toBeLessThanOrEqual(60);
  });
});

// ── renderFooter — content checks ────────────────────────────────────────────

describe('renderFooter content', () => {
  test('empty status renders blank line of exactly WIDTH chars (NO_COLOR)', () => {
    const { theme } = makeTheme(false, false);
    const [sl] = renderFooter(WIDTH, theme, [], null);
    // statusLine with empty msg returns spaces
    expect(vlen(sl)).toBe(WIDTH);
  });

  test('hotkey bar contains expected global keys (NO_COLOR)', () => {
    const { theme } = makeTheme(false, false);
    const [, footer] = renderFooter(WIDTH, theme, [], null);
    const plain = strip(footer);
    expect(plain).toContain('Esc');
    expect(plain).toContain('q');
    expect(plain).toContain('1-5');
    expect(plain).toContain('?');
  });

  test('page-specific hotkeys appear in footer (NO_COLOR)', () => {
    const { theme } = makeTheme(false, false);
    const [, footer] = renderFooter(WIDTH, theme, [{ key: 'i', label: 'install' }], null);
    const plain = strip(footer);
    expect(plain).toContain('install');
  });

  test('hidden hotkeys are omitted (NO_COLOR)', () => {
    const { theme } = makeTheme(false, false);
    const [, footer] = renderFooter(
      WIDTH,
      theme,
      [{ key: 'x', label: 'secret', hidden: true }],
      null
    );
    const plain = strip(footer);
    expect(plain).not.toContain('secret');
  });
});

// ── renderHeader — active tab highlighted ────────────────────────────────────

describe('renderHeader active tab', () => {
  for (const [label, color, tc] of [
    ['color+truecolor', true, true],
    ['NO_COLOR', false, false]
  ] as [string, boolean, boolean][]) {
    test(`active tab contains brackets (${label})`, () => {
      const { style, theme } = makeTheme(color, tc);
      const [row1] = renderHeader({
        width: WIDTH,
        style,
        theme,
        current: 'home',
        app: baseApp,
        narrow: false
      });
      const plain = strip(row1);
      expect(plain).toContain('[Home]');
    });

    test(`inactive tabs do not have brackets (${label})`, () => {
      const { style, theme } = makeTheme(color, tc);
      const [row1] = renderHeader({
        width: WIDTH,
        style,
        theme,
        current: 'home',
        app: baseApp,
        narrow: false
      });
      const plain = strip(row1);
      // 'Market' is the marketplace page's navLabel; it must appear without brackets
      expect(plain).not.toContain('[Market]');
      expect(plain).toContain('Market');
    });

    test(`header rows fit within width (${label})`, () => {
      const { style, theme } = makeTheme(color, tc);
      const [r1, r2] = renderHeader({
        width: WIDTH,
        style,
        theme,
        current: 'home',
        app: baseApp,
        narrow: false
      });
      expect(vlen(r1)).toBeLessThanOrEqual(WIDTH);
      expect(vlen(r2)).toBeLessThanOrEqual(WIDTH);
    });
  }

  test('narrow mode uses navIcon or single char', () => {
    const { style, theme } = makeTheme(false, false);
    const [row1] = renderHeader({
      width: 70,
      style,
      theme,
      current: 'home',
      app: baseApp,
      narrow: true
    });
    const plain = strip(row1);
    // Full labels like 'Marketplace' should not appear in narrow mode
    expect(plain).not.toContain('Marketplace');
  });

  test('unread news badge appears in header', () => {
    const { style, theme } = makeTheme(false, false);
    const app = { ...baseApp, unread: { news: 3, community: 0 } };
    const [row1] = renderHeader({
      width: WIDTH,
      style,
      theme,
      current: 'home',
      app,
      narrow: false
    });
    const plain = strip(row1);
    // superscript 3 = ³ (U+00B3)
    expect(plain).toContain('³');
  });

  test('wordmark AGORA present in header', () => {
    const { style, theme } = makeTheme(false, false);
    const [row1] = renderHeader({
      width: WIDTH,
      style,
      theme,
      current: 'home',
      app: baseApp,
      narrow: false
    });
    expect(strip(row1)).toContain('AGORA');
  });

  test('stack page present in PAGE_ORDER (regression: must not be removed)', () => {
    const { style, theme } = makeTheme(false, false);
    const [row1] = renderHeader({
      width: WIDTH,
      style,
      theme,
      current: 'stack',
      app: baseApp,
      narrow: false
    });
    const plain = strip(row1);
    expect(plain).toContain('[Stack]');
  });
});
