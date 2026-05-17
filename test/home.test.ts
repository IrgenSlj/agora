import { describe, expect, test } from 'bun:test';
import { truncate, homePage } from '../src/cli/pages/home';

describe('home truncate', () => {
  test('returns short strings unchanged', () => {
    expect(truncate('short', 10)).toBe('short');
  });
  test('appends ellipsis when over the limit', () => {
    expect(truncate('hello world here', 10)).toBe('hello wor…');
  });
  test('handles a max <= 1 without throwing', () => {
    expect(truncate('hello', 1)).toBe('…');
  });
});

describe('home page', () => {
  test('exposes the expected hotkeys', () => {
    const keys = homePage.hotkeys?.map((h) => h.key);
    expect(keys).toContain('n');
    expect(keys).toContain('c');
    expect(keys).toContain('m');
    expect(keys).toContain('r');
  });

  test('routes hotkey n → news', () => {
    const ctx = {} as any;
    const evt = { key: 'n' } as any;
    const action = homePage.handleKey!(evt, ctx);
    expect(action).toEqual({ kind: 'switch', to: 'news' });
  });

  test('routes hotkey c → community', () => {
    const ctx = {} as any;
    const evt = { key: 'c' } as any;
    const action = homePage.handleKey!(evt, ctx);
    expect(action).toEqual({ kind: 'switch', to: 'community' });
  });

  test('routes hotkey m → marketplace', () => {
    const ctx = {} as any;
    const evt = { key: 'm' } as any;
    const action = homePage.handleKey!(evt, ctx);
    expect(action).toEqual({ kind: 'switch', to: 'marketplace' });
  });

  test('routes j/k for section cursor without throwing', () => {
    const ctx = {} as any;
    expect(homePage.handleKey!({ key: 'j' } as any, ctx)).toEqual({ kind: 'none' });
    expect(homePage.handleKey!({ key: 'k' } as any, ctx)).toEqual({ kind: 'none' });
  });
});
