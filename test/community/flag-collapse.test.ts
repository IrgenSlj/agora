import { describe, expect, test } from 'bun:test';
import { isCollapsed, renderCollapsed } from '../../src/cli/pages/community.js';

describe('flag-driven collapse', () => {
  test('item with 0 flags is not collapsed', () => {
    const expanded = new Set<string>();
    expect(isCollapsed('t-1', 0, expanded)).toBe(false);
  });

  test('item with 2 flags is not collapsed', () => {
    const expanded = new Set<string>();
    expect(isCollapsed('t-1', 2, expanded)).toBe(false);
  });

  test('item with exactly 3 flags is collapsed', () => {
    const expanded = new Set<string>();
    expect(isCollapsed('t-1', 3, expanded)).toBe(true);
  });

  test('item with 10 flags is collapsed', () => {
    const expanded = new Set<string>();
    expect(isCollapsed('t-1', 10, expanded)).toBe(true);
  });

  test('item with 3 flags but in expandedItems is not collapsed', () => {
    const expanded = new Set<string>(['t-1']);
    expect(isCollapsed('t-1', 3, expanded)).toBe(false);
  });

  test('different id in expandedItems does not expand item', () => {
    const expanded = new Set<string>(['t-2']);
    expect(isCollapsed('t-1', 3, expanded)).toBe(true);
  });

  test('renderCollapsed includes flag count', () => {
    const result = renderCollapsed(5);
    expect(result).toContain('5');
    expect(result).toContain('flagged');
  });

  test('renderCollapsed mentions expansion key', () => {
    const result = renderCollapsed(3);
    expect(result).toContain('X');
  });

  test('renderCollapsed with 1 flag', () => {
    // boundary: 1 < 3, but renderCollapsed is pure — just tests the string
    const result = renderCollapsed(1);
    expect(result).toContain('1');
  });
});
