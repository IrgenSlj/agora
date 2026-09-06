import { describe, expect, test } from 'vitest';
import { kvRow, status, tagList } from '../../src/cli/components';
import { createTheme } from '../../src/cli/theme';

// This file used to cover a 445-line component vocabulary built for the
// full-screen TUI. The TUI was retired under brief DA-14 and took every caller
// with it; the components it left behind were kept alive by these tests alone,
// which is not a caller. What remains is the three the ordinary commands print
// through — and the property that actually matters for them, which is that a
// terminal with no colour still distinguishes a pass from a failure.

const tc = createTheme({ useColor: true, trueColor: true });
const plain = createTheme({ useColor: false });

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, '');
// eslint-disable-next-line no-control-regex
const HAS_ANSI = /\x1b\[/;
// eslint-disable-next-line no-control-regex
const TC_ESC = /\x1b\[38;2;/;

describe('status', () => {
  test('each tone gets its own glyph', () => {
    expect(status('success', 'good', plain)).toContain('✓');
    expect(status('warning', 'watch', plain)).toContain('⚠');
    expect(status('error', 'bad', plain)).toContain('✗');
    expect(status('info', 'note', plain)).toContain('·');
  });

  test('keeps the label', () => {
    expect(status('success', 'good', plain)).toContain('good');
  });

  test('applies tone colour when colour is available', () => {
    const out = status('success', 'yes', tc);
    expect(out).toMatch(TC_ESC);
    expect(strip(out)).toContain('yes');
  });

  test('emits no escape at all in plain mode', () => {
    expect(status('error', 'fail', plain)).not.toMatch(HAS_ANSI);
  });

  test('falls back to ascii glyphs, never to nothing', () => {
    // The load-bearing case. Under NO_COLOR and TERM=dumb the tone is carried
    // entirely by the glyph, so dropping it would render a failure and a pass
    // as the same string — a silent wrong answer, not a degraded one.
    const ta = createTheme({ useColor: false, unicode: false });
    expect(status('success', '', ta)).toContain('v');
    expect(status('error', '', ta)).toContain('x');
    expect(status('warning', '', ta)).toContain('!');
  });
});

describe('kvRow', () => {
  test('pads the key column to the requested width', () => {
    expect(strip(kvRow('name', 'value', 8, plain))).toBe('name    value');
  });

  test('measures width after the escapes, not through them', () => {
    // A coloured key is longer in bytes than it is on screen. Padding on
    // `.length` would under-pad every coloured row and misalign the column.
    const coloured = strip(kvRow('name', 'value', 8, tc));
    expect(coloured).toBe('name    value');
  });

  test('a key already wider than the column is not truncated', () => {
    expect(strip(kvRow('a-very-long-key', 'v', 4, plain))).toBe('a-very-long-keyv');
  });
});

describe('tagList', () => {
  test('brackets and joins', () => {
    expect(strip(tagList(['mcp', 'fs'], plain))).toBe('[mcp] [fs]');
  });

  test('no tags renders empty, not "[]"', () => {
    expect(tagList([], plain)).toBe('');
  });
});
