import { describe, test, expect } from 'bun:test';
import { 
  truncate, 
  formatStars, 
  formatInstalls, 
  formatDate,
  formatList,
  formatCard,
  formatTable
} from '../src/format';

describe('Formatting Utilities', () => {
  describe('truncate', () => {
    test('truncates long strings', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });

    test('keeps short strings intact', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    test('handles exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('formatStars', () => {
    test('formats thousands', () => {
      expect(formatStars(1500)).toBe('1.5k');
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

describe('formatDate', () => {
  test('handles today', () => {
    const today = new Date().toISOString();
    expect(formatDate(today)).toBe('today');
  });

  test('handles yesterday', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatDate(yesterday)).toBe('yesterday');
  });
});

describe('formatList', () => {
  test('formats empty list', () => {
    const result = formatList([]);
    expect(result).toBe('');
  });

  test('formats items with icons', () => {
    const items = [
      { name: 'pkg1', stars: 100 },
      { name: 'pkg2', stars: 200 }
    ];
    const result = formatList(items, { icons: true });
    expect(result).toContain('pkg1');
  });
});

describe('formatCard', () => {
  test('formats fields', () => {
    const fields = { Version: '1.0.0', Author: 'me' };
    const result = formatCard('MyPackage', fields);
    expect(result).toContain('MyPackage');
    expect(result).toContain('Version');
    expect(result).toContain('1.0.0');
  });
});

describe('formatTable', () => {
  test('formats headers and rows', () => {
    const headers = ['Name', 'Stars'];
    const rows = [['pkg1', '100'], ['pkg2', '200']];
    const result = formatTable(headers, rows);
    expect(result).toContain('Name');
    expect(result).toContain('Stars');
    expect(result).toContain('pkg1');
  });
});