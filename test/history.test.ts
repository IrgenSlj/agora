import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory, loadHistory, clearHistory } from '../src/history';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-history-test-'));
}

describe('history', () => {
  test('returns empty for no file', () => {
    const dir = makeTmp();
    expect(loadHistory(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('appends and loads entries in reverse order', () => {
    const dir = makeTmp();
    appendHistory(dir, {
      type: 'search',
      query: 'mcp',
      timestamp: '2025-01-01T00:00:00Z',
      results: 5
    });
    appendHistory(dir, {
      type: 'chat',
      query: 'hello',
      timestamp: '2025-01-02T00:00:00Z',
      model: 'deepseek'
    });
    appendHistory(dir, {
      type: 'search',
      query: 'tools',
      timestamp: '2025-01-03T00:00:00Z',
      results: 3
    });

    const entries = loadHistory(dir);
    expect(entries.length).toBe(3);
    expect(entries[0].query).toBe('tools');
    expect(entries[1].query).toBe('hello');
    expect(entries[2].query).toBe('mcp');
    rmSync(dir, { recursive: true, force: true });
  });

  test('respects limit', () => {
    const dir = makeTmp();
    appendHistory(dir, { type: 'search', query: 'q1', timestamp: '2025-01-01T00:00:00Z' });
    appendHistory(dir, { type: 'search', query: 'q2', timestamp: '2025-01-02T00:00:00Z' });
    expect(loadHistory(dir, 1).length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  test('clearHistory empties the file', () => {
    const dir = makeTmp();
    appendHistory(dir, { type: 'search', query: 'mcp', timestamp: '2025-01-01T00:00:00Z' });
    clearHistory(dir);
    expect(loadHistory(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
