import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPreferences, writePreferences, prefsPath } from '../src/preferences';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-prefs-test-'));
}

describe('loadPreferences', () => {
  test('returns defaults when no file exists', () => {
    const dir = makeTmp();
    const prefs = loadPreferences(dir);
    expect(prefs.theme).toBe('dark');
    expect(prefs.verbosity).toBe('medium');
    expect(prefs.username).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns merged defaults + saved values', () => {
    const dir = makeTmp();
    writePreferences(dir, { ...loadPreferences(dir), username: 'testuser', theme: 'light' });
    const prefs = loadPreferences(dir);
    expect(prefs.theme).toBe('light');
    expect(prefs.verbosity).toBe('medium');
    expect(prefs.username).toBe('testuser');
    rmSync(dir, { recursive: true, force: true });
  });

  test('writes to disk and reads back', () => {
    const dir = makeTmp();
    writePreferences(dir, { theme: 'auto', verbosity: 'quiet', defaultNewsSource: 'hn', defaultNewsCategory: 'all', username: 'alice', email: 'alice@test.com', bio: 'tester', lastTab: 2 });
    const prefs = loadPreferences(dir);
    expect(prefs.theme).toBe('auto');
    expect(prefs.verbosity).toBe('quiet');
    expect(prefs.username).toBe('alice');
    expect(prefs.email).toBe('alice@test.com');
    expect(existsSync(prefsPath(dir))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('recovers from corrupt file', () => {
    const dir = makeTmp();
    writeFileSync(prefsPath(dir), '{corrupt', 'utf8');
    const prefs = loadPreferences(dir);
    expect(prefs.theme).toBe('dark');
    expect(prefs.verbosity).toBe('medium');
    rmSync(dir, { recursive: true, force: true });
  });
});
