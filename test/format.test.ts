import { describe, test, expect } from 'bun:test';
import { formatStars, formatInstalls } from '../src/format';

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
