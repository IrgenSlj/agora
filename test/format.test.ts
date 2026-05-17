import { describe, test, expect } from 'bun:test';
import { formatStars, formatInstalls } from '../src/format';
import { formatProfileDetail } from '../src/cli/format.js';
import { createStyler } from '../src/ui.js';
import type { ApiProfile } from '../src/live.js';

describe('Formatting Utilities', () => {
  describe('formatStars', () => {
    test('formats thousands', () => {
      expect(formatStars(1500)).toBe('1.5K');
    });

    test('formats hundreds', () => {
      expect(formatStars(500)).toBe('500');
    });
  });

  describe('formatInstalls', () => {
    test('formats millions', () => {
      expect(formatInstalls(1500000)).toBe('1.5M');
    });

    test('formats thousands', () => {
      expect(formatInstalls(2500)).toBe('2.5K');
    });

    test('formats hundreds', () => {
      expect(formatInstalls(500)).toBe('500');
    });
  });
});

describe('formatProfileDetail', () => {
  const style = createStyler(false);

  const baseProfile: ApiProfile = {
    id: 'u-1',
    username: 'alice',
    displayName: 'Alice',
    packages: 3,
    workflows: 1,
    discussions: 7,
    reputation: 42.5,
    joinedAt: '2025-01-01T00:00:00Z'
  };

  test('includes Reputation line', () => {
    const output = formatProfileDetail(baseProfile, style);
    expect(output).toContain('reputation');
    expect(output).toContain('42.5');
  });

  test('defaults reputation to 0 when not provided', () => {
    const profile: ApiProfile = { ...baseProfile, reputation: undefined };
    const output = formatProfileDetail(profile, style);
    expect(output).toContain('reputation');
    expect(output).toContain('0');
  });
});
