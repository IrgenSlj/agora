import { describe, test, expect } from 'bun:test';
import {
  vlen,
  padRight,
  padLeft,
  truncate,
  pill,
  status,
  statusLine,
  keyHintBar,
  sparkline,
  progress,
  healthStripe,
  pageHeader,
  tableRow,
  bp
} from '../../src/cli/pages/components';
import { createTheme } from '../../src/cli/theme';

const tc = createTheme({ useColor: true, trueColor: true });
const plain = createTheme({ useColor: false });

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI_RE, '');

// Pre-defined patterns to avoid inline control characters in test bodies.
// eslint-disable-next-line no-control-regex
const HAS_ANSI = /\x1b\[/;
// eslint-disable-next-line no-control-regex
const TC_ESC = /\x1b\[38;2;\d+;\d+;\d+m/;

// ── vlen ─────────────────────────────────────────────────────────────────────
describe('vlen', () => {
  test('ignores ANSI escapes', () => {
    const s = tc.accent('hello');
    expect(vlen(s)).toBe(5);
  });

  test('plain string: vlen === length', () => {
    expect(vlen('abc')).toBe(3);
  });

  test('empty string', () => {
    expect(vlen('')).toBe(0);
  });

  test('multiple escapes', () => {
    const s = tc.bold(tc.accent('hi'));
    expect(vlen(s)).toBe(2);
  });
});

// ── padRight ──────────────────────────────────────────────────────────────────
describe('padRight', () => {
  test('pads plain string to width', () => {
    expect(padRight('ab', 5)).toBe('ab   ');
  });

  test('ANSI-aware: pads colored string to visual width', () => {
    const colored = tc.accent('ab');
    const padded = padRight(colored, 5);
    expect(vlen(padded)).toBe(5);
    expect(padded.startsWith(colored)).toBe(true);
  });

  test('no-op when already at width', () => {
    expect(padRight('abc', 3)).toBe('abc');
  });

  test('no-op when wider than width', () => {
    expect(padRight('abcde', 3)).toBe('abcde');
  });
});

// ── padLeft ───────────────────────────────────────────────────────────────────
describe('padLeft', () => {
  test('pads plain string on the left', () => {
    expect(padLeft('ab', 5)).toBe('   ab');
  });

  test('ANSI-aware: pads colored string to visual width', () => {
    const colored = tc.accent('ab');
    const padded = padLeft(colored, 5);
    expect(vlen(padded)).toBe(5);
    expect(padded.endsWith(colored)).toBe(true);
  });

  test('no-op when already at width', () => {
    expect(padLeft('abc', 3)).toBe('abc');
  });
});

// ── truncate ──────────────────────────────────────────────────────────────────
describe('truncate', () => {
  test('no-op when within width', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('ellipsizes and never exceeds width', () => {
    const out = truncate('hello world', 7);
    expect(vlen(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith('…')).toBe(true);
  });

  test('exact width: no truncation', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  test('width 1: result is ellipsis only', () => {
    const out = truncate('hello', 1);
    expect(vlen(out)).toBeLessThanOrEqual(1);
  });

  test('strips ANSI before slicing', () => {
    const colored = tc.accent('hello world');
    const out = truncate(colored, 7);
    expect(vlen(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ── pill ──────────────────────────────────────────────────────────────────────
describe('pill', () => {
  test('wraps text with leading/trailing space', () => {
    const out = pill('beta', 'accent', plain);
    expect(out).toBe(' beta ');
  });

  test('applies tone color', () => {
    const out = pill('ok', 'success', tc);
    expect(out).toMatch(TC_ESC);
    expect(strip(out)).toBe(' ok ');
  });
});

// ── status ────────────────────────────────────────────────────────────────────
describe('status', () => {
  test('success → ok glyph', () => {
    const out = status('success', 'good', plain);
    expect(out).toContain('✓');
    expect(out).toContain('good');
  });

  test('warning → warn glyph', () => {
    const out = status('warning', 'watch', plain);
    expect(out).toContain('⚠');
  });

  test('error → err glyph', () => {
    const out = status('error', 'bad', plain);
    expect(out).toContain('✗');
  });

  test('info → info glyph', () => {
    const out = status('info', 'note', plain);
    expect(out).toContain('·');
  });

  test('applies tone color in color mode', () => {
    const out = status('success', 'yes', tc);
    expect(out).toMatch(TC_ESC);
    expect(strip(out)).toContain('yes');
  });

  test('no color escape in plain mode', () => {
    const out = status('error', 'fail', plain);
    expect(out).not.toMatch(HAS_ANSI);
  });

  test('ascii glyph fallback', () => {
    const ta = createTheme({ useColor: false, unicode: false });
    expect(status('success', '', ta)).toContain('v');
    expect(status('error', '', ta)).toContain('x');
    expect(status('warning', '', ta)).toContain('!');
  });
});

// ── statusLine ────────────────────────────────────────────────────────────────
describe('statusLine', () => {
  test('empty message → spaces of width', () => {
    const out = statusLine('', undefined, 20, plain);
    expect(out).toBe(' '.repeat(20));
  });

  test('with message → padded to width', () => {
    const out = statusLine('hello', undefined, 20, plain);
    expect(vlen(out)).toBe(20);
    expect(out).toContain('hello');
  });

  test('error tone → err glyph prefix', () => {
    const out = statusLine('bad', 'error', 30, plain);
    expect(out).toContain('✗');
  });

  test('warning tone → warn glyph prefix', () => {
    const out = statusLine('watch', 'warning', 30, plain);
    expect(out).toContain('⚠');
  });

  test('success tone → ok glyph prefix', () => {
    const out = statusLine('good', 'success', 30, plain);
    expect(out).toContain('✓');
  });

  test('info tone → info glyph prefix', () => {
    const out = statusLine('note', 'info', 30, plain);
    expect(out).toContain('·');
  });

  test('ANSI-aware vlen === width in color mode', () => {
    const out = statusLine('hello', 'error', 40, tc);
    expect(vlen(out)).toBe(40);
  });
});

// ── keyHintBar ────────────────────────────────────────────────────────────────
describe('keyHintBar', () => {
  const hints = [
    { key: 'q', label: 'quit' },
    { key: 'j', label: 'down' },
    { key: 'k', label: 'up' }
  ];

  test('contains keys and labels', () => {
    const out = keyHintBar(hints, 80, plain);
    expect(out).toContain('q');
    expect(out).toContain('quit');
    expect(out).toContain('j');
    expect(out).toContain('down');
  });

  test('vlen === width', () => {
    const out = keyHintBar(hints, 80, plain);
    expect(vlen(out)).toBe(80);
  });

  test('overflow: truncates with … and vlen <= width', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, label: `label${i}` }));
    const out = keyHintBar(many, 80, plain);
    expect(vlen(out)).toBeLessThanOrEqual(80);
    expect(out).toContain('…');
  });

  test('color mode: vlen === width', () => {
    const out = keyHintBar(hints, 80, tc);
    expect(vlen(out)).toBe(80);
  });
});

// ── sparkline ─────────────────────────────────────────────────────────────────
describe('sparkline', () => {
  test('empty → empty string', () => {
    expect(sparkline([], plain)).toBe('');
  });

  test('length equals values length', () => {
    const values = [1, 2, 3, 4, 5];
    const out = sparkline(values, plain);
    expect(vlen(out)).toBe(values.length);
  });

  test('unicode blocks used in unicode mode', () => {
    const out = sparkline([1, 2, 3], createTheme({ useColor: false, unicode: true }));
    expect(vlen(out)).toBe(3);
  });

  test('ascii chars used in ascii mode', () => {
    const ta = createTheme({ useColor: false, unicode: false });
    const out = sparkline([0, 5, 10], ta);
    expect(out).toMatch(/^[_.~=+*#-]+$/);
  });
});

// ── progress ──────────────────────────────────────────────────────────────────
describe('progress', () => {
  // Use ascii theme for character-exact assertions (plain has unicode:true by default)
  const ascii = createTheme({ useColor: false, unicode: false });

  test('progress(0.5, 10) has right filled/empty split', () => {
    const out = progress(0.5, 10, ascii);
    // 5 filled (#) + 5 empty (-)
    expect(strip(out)).toBe('#####-----');
  });

  test('progress(0, 10) all empty', () => {
    const out = progress(0, 10, ascii);
    expect(strip(out)).toBe('----------');
  });

  test('progress(1, 10) all filled', () => {
    const out = progress(1, 10, ascii);
    expect(strip(out)).toBe('##########');
  });

  test('unicode mode uses block chars', () => {
    const tu = createTheme({ useColor: false, unicode: true });
    const out = progress(0.5, 10, tu);
    expect(vlen(out)).toBe(10);
  });

  test('color mode: has ANSI escape', () => {
    const out = progress(0.5, 10, tc);
    expect(out).toMatch(HAS_ANSI);
    expect(vlen(out)).toBe(10);
  });
});

// ── healthStripe ──────────────────────────────────────────────────────────────
describe('healthStripe', () => {
  test('length === states length (plain)', () => {
    const states = ['success', 'warning', 'error', 'info'] as const;
    const out = healthStripe(states, plain);
    expect(vlen(out)).toBe(states.length);
  });

  test('empty states → empty string', () => {
    expect(healthStripe([], plain)).toBe('');
  });

  test('color mode: toned pips', () => {
    const states = ['success', 'error'] as const;
    const out = healthStripe(states, tc);
    expect(out).toMatch(TC_ESC);
    expect(vlen(out)).toBe(states.length);
  });
});

// ── pageHeader ────────────────────────────────────────────────────────────────
describe('pageHeader', () => {
  test('includes title', () => {
    const out = pageHeader({ title: 'Home', width: 80, theme: plain });
    expect(out).toContain('Home');
  });

  test('without right: vlen === width', () => {
    const out = pageHeader({ title: 'Home', width: 80, theme: plain });
    expect(vlen(out)).toBe(80);
  });

  test('with right: total vlen === width', () => {
    const out = pageHeader({ title: 'Home', right: 'v1.0', width: 80, theme: plain });
    expect(vlen(out)).toBe(80);
  });

  test('with crumbs: includes arrow separator', () => {
    const out = pageHeader({
      title: 'Home',
      crumbs: ['Packages', 'detail'],
      width: 80,
      theme: plain
    });
    expect(out).toContain('Packages');
    expect(out).toContain('detail');
    expect(out).toContain('▸');
  });

  test('color mode: vlen === width with right', () => {
    const out = pageHeader({ title: 'Hub', right: 'status', width: 80, theme: tc });
    expect(vlen(out)).toBe(80);
  });
});

// ── tableRow ──────────────────────────────────────────────────────────────────
describe('tableRow', () => {
  test('left-align pads right', () => {
    const cells = [{ text: 'hi', width: 10, align: 'left' as const }];
    const out = tableRow(cells, 0, plain);
    expect(out).toBe('hi        ');
    expect(out.length).toBe(10);
  });

  test('right-align pads left', () => {
    const cells = [{ text: 'hi', width: 10, align: 'right' as const }];
    const out = tableRow(cells, 0, plain);
    expect(out).toBe('        hi');
    expect(out.length).toBe(10);
  });

  test('respects gap between cells', () => {
    const cells = [
      { text: 'a', width: 3, align: 'left' as const },
      { text: 'b', width: 3, align: 'left' as const }
    ];
    const out = tableRow(cells, 2, plain);
    // 'a  ' + '  ' + 'b  '
    expect(out).toBe('a    b  ');
  });

  test('truncates long text to cell width', () => {
    const cells = [{ text: 'hello world', width: 5, align: 'left' as const }];
    const out = tableRow(cells, 0, plain);
    expect(vlen(out)).toBe(5);
  });
});

// ── bp ────────────────────────────────────────────────────────────────────────
describe('bp', () => {
  test('< 60 → xs', () => {
    expect(bp(0)).toBe('xs');
    expect(bp(59)).toBe('xs');
  });

  test('< 80 → sm', () => {
    expect(bp(60)).toBe('sm');
    expect(bp(79)).toBe('sm');
  });

  test('< 120 → md', () => {
    expect(bp(80)).toBe('md');
    expect(bp(119)).toBe('md');
  });

  test('>= 120 → lg', () => {
    expect(bp(120)).toBe('lg');
    expect(bp(200)).toBe('lg');
  });
});
