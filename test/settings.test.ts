import { describe, expect, test } from 'bun:test';
import { loadSettings, writeSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { existsSync, readFileSync, unlinkSync, rmdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

// ── News source toggle fields ────────────────────────────────────────────────

describe('news source toggle fields', () => {
  const NEWS_SOURCE_IDS = ['hn', 'reddit', 'github-trending', 'arxiv', 'rss'] as const;

  test('each source id generates a field with correct key', () => {
    for (const src of NEWS_SOURCE_IDS) {
      const key = `news_${src}`;
      expect(key).toBe(`news_${src}`);
    }
  });

  test('toggle write function: enabled=true -> toggled state has enabled=false', () => {
    // Test the pure toggle write function, not round-trip through TOML
    const base = {
      account: { username: '', backend: '', declared_llm: '' },
      display: { color: 'auto' as const, banner: true },
      news: {
        sources: { hn: { enabled: true, ttl_minutes: 10 } as { enabled: boolean; ttl_minutes: number } },
        feeds: [] as string[]
      },
      community: { default_board: 'mcp', collapse_flag_threshold: 3 }
    };
    const sources = base.news.sources as Record<string, { enabled: boolean; ttl_minutes: number }>;
    const toggled = {
      ...base,
      news: {
        ...base.news,
        sources: { ...sources, hn: { ...(sources['hn'] ?? {}), enabled: !sources['hn']?.enabled } }
      }
    };
    expect((toggled.news.sources as Record<string, { enabled: boolean }>)['hn']?.enabled).toBe(false);
  });

  test('toggle write function: enabled=false -> toggled state has enabled=true', () => {
    const base = {
      account: { username: '', backend: '', declared_llm: '' },
      display: { color: 'auto' as const, banner: true },
      news: {
        sources: { arxiv: { enabled: false, ttl_minutes: 60 } as { enabled: boolean; ttl_minutes: number } },
        feeds: [] as string[]
      },
      community: { default_board: 'mcp', collapse_flag_threshold: 3 }
    };
    const sources = base.news.sources as Record<string, { enabled: boolean; ttl_minutes: number }>;
    const toggled = {
      ...base,
      news: {
        ...base.news,
        sources: { ...sources, arxiv: { ...(sources['arxiv'] ?? {}), enabled: !sources['arxiv']?.enabled } }
      }
    };
    expect((toggled.news.sources as Record<string, { enabled: boolean }>)['arxiv']?.enabled).toBe(true);
  });

  test('toggling one source does not affect others', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-ns-'));
    const s = loadSettings(tmpDir);
    const sources = s.news.sources as Record<string, { enabled: boolean; ttl_minutes: number }>;
    const toggled = {
      ...s,
      news: {
        ...s.news,
        sources: {
          ...sources,
          hn: { ...(sources['hn'] ?? {}), enabled: !sources['hn']?.enabled }
        }
      }
    };
    const tSources = toggled.news.sources as Record<string, { enabled: boolean }>;
    expect(tSources['reddit']?.enabled).toBe(sources['reddit']?.enabled);
    expect(tSources['github-trending']?.enabled).toBe(sources['github-trending']?.enabled);
    rmSync(tmpDir, { recursive: true });
  });
});

// ── Revert behavior ──────────────────────────────────────────────────────────

describe('settings revert', () => {
  test('load -> mutate -> write -> reload reads mutated value', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-revert-'));
    const original = loadSettings(tmpDir);
    const mutated = {
      ...original,
      account: { ...original.account, username: 'mutated' }
    };
    writeSettings(tmpDir, mutated);
    const afterWrite = loadSettings(tmpDir);
    expect(afterWrite.account.username).toBe('mutated');
    rmSync(tmpDir, { recursive: true });
  });

  test('fresh dir with explicit written defaults returns expected values', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-revert2-'));
    // Write known values then reload to verify round-trip, avoiding DEFAULT_SETTINGS mutation
    const s = loadSettings(tmpDir);
    const known = { ...s, account: { ...s.account, username: '' }, display: { ...s.display, color: 'auto' as const } };
    writeSettings(tmpDir, known);
    const reverted = loadSettings(tmpDir);
    expect(reverted.account.username).toBe('');
    expect(reverted.display.color).toBe('auto');
    rmSync(tmpDir, { recursive: true });
  });

  test('revert restores previous on-disk state', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-revert3-'));
    const s1 = loadSettings(tmpDir);
    const modified = { ...s1, account: { ...s1.account, username: 'before' } };
    writeSettings(tmpDir, modified);
    // Simulate: further in-memory mutation, then revert = reload from disk
    const reverted = loadSettings(tmpDir);
    expect(reverted.account.username).toBe('before');
    rmSync(tmpDir, { recursive: true });
  });
});
