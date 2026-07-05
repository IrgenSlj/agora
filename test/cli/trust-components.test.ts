import { test, expect, describe } from 'bun:test';
import { createTheme } from '../../src/cli/theme.js';
import {
  statusTriad,
  verdictBanner,
  provenanceBadges,
  provenanceBadge,
  trustPanel,
  planDiff,
  driftChip,
  originChip
} from '../../src/cli/pages/components.js';

// NO_COLOR theme: identity tones, so we can assert on plain text with no ANSI.
const plain = createTheme({ useColor: false, unicode: true });
const ascii = createTheme({ useColor: false, unicode: false });
const color = createTheme({ useColor: true, trueColor: true, unicode: true });

describe('drift token + glyph', () => {
  test('drift glyph is ≠ in unicode, ~ in ascii', () => {
    expect(plain.glyph('drift')).toBe('≠');
    expect(ascii.glyph('drift')).toBe('~');
  });
  test('drift tone wraps with the orchid truecolor escape when colored', () => {
    expect(color.tone('drift', 'x')).toBe('\x1b[38;2;169;139;208mx\x1b[0m');
  });
});

describe('statusTriad — the one-glance trust line', () => {
  test('NO_COLOR renders every state as unambiguous plain text', () => {
    const s = statusTriad('pass', 'official', false, plain);
    expect(s).toContain('pass');
    expect(s).toContain('*OFFICIAL*'); // official survives NO_COLOR
    expect(s).toContain('no drift');
  });
  test('drift=true surfaces the drift chip', () => {
    expect(statusTriad('warn', 'github', true, plain)).toContain('drift');
    expect(driftChip(true, plain)).toContain('≠');
  });
});

describe('verdictBanner — the one weighty element', () => {
  test('FAIL uses the ═ double rule; PASS/WARN use single ─', () => {
    const fail = verdictBanner({
      verdict: 'fail',
      headline: 'blocked',
      width: 40,
      theme: plain
    }).join('\n');
    const pass = verdictBanner({
      verdict: 'pass',
      headline: 'admitted',
      width: 40,
      theme: plain
    }).join('\n');
    expect(fail).toContain('═');
    expect(fail).not.toContain('─');
    expect(pass).toContain('─');
    expect(pass).not.toContain('═');
  });
  test('FAIL is final — never renders a re-run hint even if one is passed', () => {
    const fail = verdictBanner({
      verdict: 'fail',
      headline: 'blocked',
      hint: '--accept-warnings',
      width: 40,
      theme: plain
    }).join('\n');
    expect(fail).not.toContain('--accept-warnings');
    expect(fail).toContain('FAIL');
  });
  test('WARN surfaces the exact re-run flag', () => {
    const warn = verdictBanner({
      verdict: 'warn',
      headline: '1 warning',
      hint: 're-run with --accept-warnings',
      width: 44,
      theme: plain
    }).join('\n');
    expect(warn).toContain('--accept-warnings');
  });
  test('ascii FAIL uses = for the double rule', () => {
    const fail = verdictBanner({ verdict: 'fail', headline: 'x', width: 10, theme: ascii }).join(
      '\n'
    );
    expect(fail).toContain('=');
  });
});

describe('provenance ordering', () => {
  test('official is always first + reverse-video; rest alphabetical; deduped', () => {
    const row = provenanceBadges(['github', 'official', 'smithery', 'github'], plain);
    expect(row.indexOf('*OFFICIAL*')).toBeLessThan(row.indexOf('[github]'));
    expect(row.indexOf('[github]')).toBeLessThan(row.indexOf('[smithery]'));
    expect(row.match(/github/g)?.length).toBe(1); // deduped
  });
  test('local renders as a dim cache badge', () => {
    expect(provenanceBadge('local', plain)).toContain('local cache');
  });
  test('official badge is reverse-video when colored', () => {
    expect(provenanceBadge('official', color)).toContain('\x1b[7m');
  });
});

describe('planDiff — the write interface', () => {
  test('footer tallies ops and shows apply prompt', () => {
    const out = planDiff(
      [
        {
          harness: 'opencode',
          file: 'opencode.json',
          changes: [
            { op: '+', name: 'postgres', detail: 'npx …' },
            { op: '~', name: 'github', detail: 'env changed' },
            { op: '-', name: 'old', detail: 'removed' }
          ]
        }
      ],
      60,
      plain
    ).join('\n');
    expect(out).toContain('+1 add');
    expect(out).toContain('~1 update');
    expect(out).toContain('-1 remove');
    expect(out).toContain('apply?');
    expect(out).toContain('[y/N]');
  });
  test('no changes → honest "matches profile" line, no apply prompt', () => {
    const out = planDiff([{ harness: 'cursor', file: 'x', changes: [] }], 60, plain).join('\n');
    expect(out).toContain('no changes');
    expect(out).not.toContain('apply?');
  });
});

describe('trustPanel + originChip', () => {
  test('trustPanel shows scan / permissions / drift sections', () => {
    const out = trustPanel({
      scan: { pass: 4, warn: 1, fail: 0, lines: ['repo reachable'] },
      perms: [{ kind: 'fs', tone: 'warning', declared: './**', observed: './src' }],
      drift: { changed: false, baseline: 'v1' },
      width: 60,
      theme: plain
    }).join('\n');
    expect(out).toContain('scan');
    expect(out).toContain('permissions');
    expect(out).toContain('no drift vs v1');
    expect(out).toContain('fs');
  });
  test('originChip uses the badge grammar', () => {
    expect(originChip('HN', plain)).toBe('[HN]');
  });
});
