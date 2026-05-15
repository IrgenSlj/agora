import { describe, expect, test } from 'bun:test';
import { loadSettings, writeSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { existsSync, readFileSync, unlinkSync, rmdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = '/tmp/agora-settings-test';

describe('loadSettings', () => {
  test('returns defaults when file does not exist', () => {
    const settings = loadSettings('/tmp/agora-test-nonexistent');
    expect(settings.account.username).toBe('');
    expect(settings.display.color).toBe('auto');
    expect(settings.news.sources.hn.enabled).toBe(true);
    expect(settings.community.default_board).toBe('mcp');
  });

  test('round-trips through writeSettings and loadSettings', () => {
    const modified = { ...DEFAULT_SETTINGS };
    modified.account.username = 'testuser';
    modified.display.color = 'none';
    modified.news.sources.hn.enabled = false;
    modified.community.collapse_flag_threshold = 5;

    writeSettings(TEST_DIR, modified);
    const loaded = loadSettings(TEST_DIR);

    expect(loaded.account.username).toBe('testuser');
    expect(loaded.display.color).toBe('none');
    expect(loaded.news.sources.hn.enabled).toBe(false);
    expect(loaded.community.collapse_flag_threshold).toBe(5);
  });
});
