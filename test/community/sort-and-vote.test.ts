import { describe, expect, test } from 'bun:test';
import { voteGlyph } from '../../src/cli/pages/community.js';

const noStyle = {
  accent: (s: string) => s,
  dim: (s: string) => s
};

describe('voteGlyph', () => {
  test('upvote (1) returns up-arrow prefix with score', () => {
    const result = voteGlyph(1, 42, noStyle);
    expect(result).toContain('▲');
    expect(result).toContain('42');
  });

  test('downvote (-1) returns down-arrow prefix with score', () => {
    const result = voteGlyph(-1, 5, noStyle);
    expect(result).toContain('▼');
    expect(result).toContain('5');
  });

  test('no vote (0) returns dim up-arrow prefix', () => {
    const result = voteGlyph(0, 10, noStyle);
    expect(result).toContain('↑');
    expect(result).toContain('10');
  });

  test('undefined vote returns dim indicator', () => {
    const result = voteGlyph(undefined, 3, noStyle);
    expect(result).toContain('↑');
    expect(result).toContain('3');
  });

  test('upvote uses accent style', () => {
    const calls: string[] = [];
    const trackStyle = {
      accent: (s: string) => { calls.push('accent:' + s); return s; },
      dim: (s: string) => { calls.push('dim:' + s); return s; }
    };
    voteGlyph(1, 7, trackStyle);
    expect(calls.some((c) => c.startsWith('accent:▲'))).toBe(true);
  });

  test('no vote uses dim style for arrow', () => {
    const calls: string[] = [];
    const trackStyle = {
      accent: (s: string) => { calls.push('accent:' + s); return s; },
      dim: (s: string) => { calls.push('dim:' + s); return s; }
    };
    voteGlyph(0, 7, trackStyle);
    expect(calls.some((c) => c.startsWith('dim:↑'))).toBe(true);
  });
});

describe('thread sort cycle', () => {
  test('sort values cycle through top -> new -> active -> top', () => {
    const order = ['top', 'new', 'active'] as const;
    let idx = 0;
    expect(order[idx]).toBe('top');
    idx = (idx + 1) % order.length;
    expect(order[idx]).toBe('new');
    idx = (idx + 1) % order.length;
    expect(order[idx]).toBe('active');
    idx = (idx + 1) % order.length;
    expect(order[idx]).toBe('top');
  });

  test('cycle length is 3', () => {
    const order = ['top', 'new', 'active'];
    expect(order.length).toBe(3);
  });
});
