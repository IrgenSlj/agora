import { describe, expect, test } from 'vitest';
import { cliTheme, createTheme, type GlyphName } from '../../src/cli/theme';
import {
  colorDepth,
  createStyler,
  RAMP,
  RAMP_ASCII,
  renderBanner,
  supportsUnicode,
  TOKENS,
  WORDMARK
} from '../../src/ui';

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape codes
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('tokens', () => {
  test('match the handoff: hex, xterm-256 and ANSI-16', () => {
    expect(TOKENS.accent).toMatchObject({
      hex: '#3A86AD',
      rgb: [58, 134, 173],
      x256: 31,
      ansi16: 36
    });
    expect(TOKENS.unknown).toMatchObject({ hex: '#8B7BC4', x256: 98, ansi16: 35 });
    expect(TOKENS.muted.ansi16).toBe(2);
  });
});

describe('createTheme', () => {
  test('each depth emits its own escape', () => {
    expect(createTheme({ useColor: true, depth: 'truecolor' }).accent('a')).toBe(
      '\x1b[38;2;58;134;173ma\x1b[0m'
    );
    expect(createTheme({ useColor: true, depth: '256' }).success('a')).toBe(
      '\x1b[38;5;65ma\x1b[0m'
    );
    expect(createTheme({ useColor: true, depth: '16' }).error('a')).toBe('\x1b[31ma\x1b[0m');
  });

  test('muted is faint on every tier, never a grey colour', () => {
    for (const depth of ['truecolor', '256', '16'] as const)
      expect(createTheme({ useColor: true, depth }).muted('m')).toBe('\x1b[2mm\x1b[0m');
  });

  test('no colour means no escapes at all', () => {
    const t = createTheme({ useColor: false });
    for (const tone of ['accent', 'success', 'warning', 'error', 'unknown', 'muted'] as const)
      expect(t.tone(tone, 'x')).toBe('x');
  });

  test('every glyph has a distinct ASCII fallback for the states', () => {
    const u = createTheme({ useColor: false });
    const a = createTheme({ useColor: false, unicode: false });
    const states: GlyphName[] = ['ok', 'fail', 'warn', 'unknown', 'denied', 'signed', 'unsigned'];
    expect(states.map((g) => u.glyph(g))).toEqual(['✓', '✗', '!', '?', '■', '◆', '◇']);
    expect(states.map((g) => a.glyph(g))).toEqual(['v', 'x', '!', '?', '#', '*', '~']);
    expect(new Set(states.map((g) => a.glyph(g))).size).toBe(states.length);
    for (const g of states) expect(a.glyph(g)).toMatch(/^[\x20-\x7e]+$/);
  });

  test('unknown never looks like ok', () => {
    const t = createTheme({ useColor: true, depth: '256' });
    expect(t.unknown(t.glyph('unknown'))).not.toBe(t.success(t.glyph('ok')));
  });
});

describe('capabilities', () => {
  test('colour depth from the environment', () => {
    expect(colorDepth({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(colorDepth({ TERM: 'xterm-256color' })).toBe('256');
    expect(colorDepth({ TERM: 'xterm' })).toBe('16');
  });

  test('ASCII on dumb terminals, non-UTF-8 locales or when asked', () => {
    expect(supportsUnicode({ LANG: 'en_US.UTF-8' })).toBe(true);
    expect(supportsUnicode({})).toBe(true);
    expect(supportsUnicode({ TERM: 'dumb' })).toBe(false);
    expect(supportsUnicode({ LANG: 'C' })).toBe(false);
    expect(supportsUnicode({ AGORA_ASCII: '1' })).toBe(false);
  });

  test('cliTheme follows the styler and the environment', () => {
    const t = cliTheme(createStyler(true, '16'), { env: { TERM: 'dumb' } } as never);
    expect(t).toMatchObject({ useColor: true, depth: '16', unicode: false });
    expect(cliTheme(createStyler(false), { env: {} } as never).useColor).toBe(false);
  });
});

describe('banner', () => {
  test('is 40 columns or less, wordmark over the ramp, tagline below', () => {
    const lines = renderBanner({ color: false }).split('\n');
    expect(lines.slice(0, 3)).toEqual(WORDMARK.map((r) => `  ${r}`));
    expect(lines[3]).toBe(`  ${RAMP}`);
    expect(lines.at(-2)).toBe('  a written limit for every coding agent,');
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(42);
  });

  test('ASCII and compact variants', () => {
    const ascii = renderBanner({ color: false, unicode: false, columns: 40 }).split('\n');
    expect(ascii[0]).toBe('  A G O R A');
    expect(ascii[1]).toBe(`  ${RAMP_ASCII}`);
    expect(ascii.at(-2)).toBe('  a written limit for every coding');
  });

  test('in colour only the ramp takes the accent', () => {
    const out = renderBanner({ color: true, depth: '256' });
    expect(out).toContain(`\x1b[38;5;31m${RAMP}\x1b[0m`);
    expect(strip(out)).toBe(renderBanner({ color: false }));
  });
});
