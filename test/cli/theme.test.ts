import { describe, expect, test } from 'vitest';
import { createTheme, liftStyler } from '../../src/cli/theme';
import { createStyler } from '../../src/ui';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, '');

// Reusable regex patterns (defined here to avoid inline control-char literals).
// eslint-disable-next-line no-control-regex
const TC_ESC = /^\x1b\[38;2;\d+;\d+;\d+m/;
// eslint-disable-next-line no-control-regex
const X256_ESC = /^\x1b\[38;5;\d+m/;
const TC_WRAP = (ch: string) => new RegExp(`^\x1b\\[38;2;\\d+;\\d+;\\d+m${ch}\x1b\\[0m$`);
const X256_WRAP = (ch: string) => new RegExp(`^\x1b\\[38;5;\\d+m${ch}\x1b\\[0m$`);

// ── createTheme trueColor ─────────────────────────────────────────────────────
describe('createTheme({ useColor:true, trueColor:true })', () => {
  const t = createTheme({ useColor: true, trueColor: true });

  test('capability flags', () => {
    expect(t.useColor).toBe(true);
    expect(t.trueColor).toBe(true);
    expect(t.unicode).toBe(true);
  });

  test('success wraps with 24-bit escape and reset', () => {
    expect(t.success('hi')).toMatch(TC_WRAP('hi'));
  });

  test('warning wraps with 24-bit escape', () => {
    expect(t.warning('w')).toMatch(TC_WRAP('w'));
  });

  test('error wraps with 24-bit escape', () => {
    expect(t.error('e')).toMatch(TC_WRAP('e'));
  });

  test('info wraps with 24-bit escape', () => {
    expect(t.info('i')).toMatch(TC_WRAP('i'));
  });

  test('muted wraps with 24-bit escape', () => {
    expect(t.muted('m')).toMatch(TC_WRAP('m'));
  });

  test('fg wraps with 24-bit escape', () => {
    expect(t.fg('f')).toMatch(TC_WRAP('f'));
  });

  test('accent wraps with 24-bit escape', () => {
    expect(t.accent('a')).toMatch(TC_WRAP('a'));
  });

  test('bold uses \\x1b[1m', () => {
    expect(t.bold('b')).toBe('\x1b[1mb\x1b[0m');
  });

  test('accent uses gold rgb 212;168;90', () => {
    expect(t.accent('x')).toContain('212;168;90');
  });

  test('success uses sage rgb 127;176;105', () => {
    expect(t.success('x')).toContain('127;176;105');
  });

  test('error uses terra rgb 198;106;74', () => {
    expect(t.error('x')).toContain('198;106;74');
  });

  test('strip reveals plain text', () => {
    expect(strip(t.success('hello'))).toBe('hello');
  });
});

// ── createTheme 256-color ─────────────────────────────────────────────────────
describe('createTheme({ useColor:true, trueColor:false })', () => {
  const t = createTheme({ useColor: true, trueColor: false });

  test('capability flags', () => {
    expect(t.useColor).toBe(true);
    expect(t.trueColor).toBe(false);
  });

  test('success uses 256-color escape \\x1b[38;5;Nm', () => {
    expect(t.success('s')).toMatch(X256_WRAP('s'));
  });

  test('accent uses 256-color escape', () => {
    expect(t.accent('a')).toMatch(X256_WRAP('a'));
  });

  test('tone result starts with x256 escape', () => {
    expect(t.accent('x')).toMatch(X256_ESC);
  });

  test('accent uses xterm 179', () => {
    expect(t.accent('x')).toContain('38;5;179');
  });

  test('success uses xterm 108', () => {
    expect(t.success('x')).toContain('38;5;108');
  });

  test('warning uses xterm 215', () => {
    expect(t.warning('x')).toContain('38;5;215');
  });

  test('error uses xterm 167', () => {
    expect(t.error('x')).toContain('38;5;167');
  });

  test('bold still uses \\x1b[1m', () => {
    expect(t.bold('b')).toBe('\x1b[1mb\x1b[0m');
  });
});

// ── createTheme NO_COLOR ──────────────────────────────────────────────────────
describe('createTheme({ useColor:false })', () => {
  const t = createTheme({ useColor: false });

  test('capability flags', () => {
    expect(t.useColor).toBe(false);
  });

  test('every tone is identity', () => {
    expect(t.success('x')).toBe('x');
    expect(t.warning('x')).toBe('x');
    expect(t.error('x')).toBe('x');
    expect(t.info('x')).toBe('x');
    expect(t.muted('x')).toBe('x');
    expect(t.fg('x')).toBe('x');
    expect(t.accent('x')).toBe('x');
    expect(t.orange('x')).toBe('x');
  });

  test('tone() is identity', () => {
    expect(t.tone('accent', 'x')).toBe('x');
    expect(t.tone('dim', 'x')).toBe('x');
    expect(t.tone('success', 'x')).toBe('x');
  });

  test('bold is identity', () => {
    expect(t.bold('b')).toBe('b');
  });

  test('dim is identity', () => {
    expect(t.dim('d')).toBe('d');
  });
});

// ── glyph() ───────────────────────────────────────────────────────────────────
describe('glyph()', () => {
  const tu = createTheme({ useColor: false, unicode: true });
  const ta = createTheme({ useColor: false, unicode: false });

  test('ok → ✓ (unicode) or v (ascii)', () => {
    expect(tu.glyph('ok')).toBe('✓');
    expect(ta.glyph('ok')).toBe('v');
  });

  test('err → ✗ (unicode) or x (ascii)', () => {
    expect(tu.glyph('err')).toBe('✗');
    expect(ta.glyph('err')).toBe('x');
  });

  test('rail → ▌ (unicode) or > (ascii)', () => {
    expect(tu.glyph('rail')).toBe('▌');
    expect(ta.glyph('rail')).toBe('>');
  });

  test('warn → ⚠ (unicode) or ! (ascii)', () => {
    expect(tu.glyph('warn')).toBe('⚠');
    expect(ta.glyph('warn')).toBe('!');
  });

  test('arrow → ▸ (unicode) or > (ascii)', () => {
    expect(tu.glyph('arrow')).toBe('▸');
    expect(ta.glyph('arrow')).toBe('>');
  });

  test('pip → ▰ (unicode) or # (ascii)', () => {
    expect(tu.glyph('pip')).toBe('▰');
    expect(ta.glyph('pip')).toBe('#');
  });

  test('info → · (unicode) or i (ascii)', () => {
    expect(tu.glyph('info')).toBe('·');
    expect(ta.glyph('info')).toBe('i');
  });

  test('unicode flag defaults to true when not specified', () => {
    const t = createTheme({ useColor: false });
    expect(t.unicode).toBe(true);
    expect(t.glyph('ok')).toBe('✓');
  });
});

// ── tone() ────────────────────────────────────────────────────────────────────
describe('tone()', () => {
  const t = createTheme({ useColor: true, trueColor: true });

  test('tone("dim", s) uses DIM escape', () => {
    expect(t.tone('dim', 'x')).toBe('\x1b[2mx\x1b[0m');
  });

  test('tone("accent", s) starts with 24-bit escape', () => {
    expect(t.tone('accent', 'x')).toMatch(TC_ESC);
    expect(t.tone('accent', 'x')).toContain('212;168;90');
    expect(strip(t.tone('accent', 'x'))).toBe('x');
  });

  test('tone("success", s) same as success(s)', () => {
    expect(t.tone('success', 'x')).toBe(t.success('x'));
  });
});

// ── liftStyler ────────────────────────────────────────────────────────────────
describe('liftStyler — color on', () => {
  const legacy = createStyler(true, true);
  const lifted = liftStyler(legacy, { trueColor: true });

  test('useColor resolves true', () => {
    expect(lifted.useColor).toBe(true);
  });

  test('accent output byte-identical to legacy', () => {
    expect(lifted.accent('x')).toBe(legacy.accent('x'));
  });

  test('orange output byte-identical to legacy', () => {
    expect(lifted.orange('x')).toBe(legacy.orange('x'));
  });

  test('bold output byte-identical to legacy', () => {
    expect(lifted.bold('x')).toBe(legacy.bold('x'));
  });

  test('dim output byte-identical to legacy', () => {
    expect(lifted.dim('x')).toBe(legacy.dim('x'));
  });

  test('semantic methods work on top of lifted', () => {
    const out = lifted.success('ok');
    expect(out).toMatch(TC_ESC);
    expect(strip(out)).toBe('ok');
  });
});

describe('liftStyler — color off', () => {
  const legacy = createStyler(false, false);
  const lifted = liftStyler(legacy, { trueColor: false });

  test('useColor resolves false', () => {
    expect(lifted.useColor).toBe(false);
  });

  test('accent is identity', () => {
    expect(lifted.accent('x')).toBe('x');
  });

  test('semantic tones are identity', () => {
    expect(lifted.success('x')).toBe('x');
    expect(lifted.warning('x')).toBe('x');
  });
});
