import { describe, expect, test } from 'bun:test';
import { completeShellLine, ghostFromHistory, type CompletionContext } from '../src/cli/completions';

function makeContext(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    slashCommands: ['/help', '/menu', '/transcript', '/verbose', '/quiet', '/clear', '/quit', '/exit', '/last', '/again'],
    agoraCommands: ['install', 'browse', 'search', 'save', 'remove'],
    marketplaceIds: () => ['mcp-github', 'mcp-postgres', 'mcp-filesystem', 'wf-tdd-cycle'],
    savedIds: () => ['mcp-github', 'wf-tdd-cycle'],
    listDir: (p: string) => {
      if (p === '/tmp') return ['foo', 'bar', 'baz.sh'];
      if (p === '/') return ['tmp', 'usr', 'var'];
      if (p.endsWith('/home')) return ['alice', 'bob'];
      return [];
    },
    cwd: '/home/user',
    ...overrides,
  };
}

// ── Rule 1: slash completions ────────────────────────────────────────────────

describe('slash completions', () => {
  test('empty line offers all slash commands', () => {
    const r = completeShellLine('', 0, makeContext());
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.startsWith('/'))).toBe(true);
  });

  test('/h completes to /help', () => {
    const r = completeShellLine('/h', 2, makeContext());
    expect(r.matches).toContain('/help');
  });

  test('/q completes to /quit and /quiet', () => {
    const r = completeShellLine('/q', 2, makeContext());
    expect(r.matches).toContain('/quit');
    expect(r.matches).toContain('/quiet');
  });

  test('/z has no matches', () => {
    const r = completeShellLine('/z', 2, makeContext());
    expect(r.matches).toHaveLength(0);
  });

  test('replaceFrom is 0 for slash at start', () => {
    const r = completeShellLine('/h', 2, makeContext());
    expect(r.replaceFrom).toBe(0);
  });
});

// ── Rule 2: path completions ─────────────────────────────────────────────────

describe('path completions', () => {
  test('cd /tmp/ lists files in /tmp', () => {
    const line = 'cd /tmp/';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('/tmp/foo');
    expect(r.matches).toContain('/tmp/bar');
  });

  test('ls /tmp/f completes to /tmp/foo', () => {
    const line = 'ls /tmp/f';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('/tmp/foo');
    expect(r.matches).not.toContain('/tmp/bar');
  });

  test('cat completes paths', () => {
    const line = 'cat /tmp/b';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('/tmp/bar');
    expect(r.matches).toContain('/tmp/baz.sh');
  });

  test('replaceFrom points to start of last token', () => {
    const line = 'cd /tmp/f';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.replaceFrom).toBe(3); // 'cd ' is 3 chars
  });

  test('path with no matches returns empty', () => {
    const line = 'cd /nonexistent/';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toHaveLength(0);
  });
});

// ── Rule 3: marketplace/saved completions ────────────────────────────────────

describe('marketplace completions', () => {
  test('install <prefix> filters marketplace ids', () => {
    const line = 'install mcp-g';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('mcp-github');
    expect(r.matches).not.toContain('mcp-postgres');
  });

  test('browse mcp- shows all mcp items', () => {
    const line = 'browse mcp-';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('mcp-github');
    expect(r.matches).toContain('mcp-postgres');
  });

  test('remove <prefix> filters saved ids', () => {
    const line = 'remove mcp';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('mcp-github');
    expect(r.matches).not.toContain('mcp-postgres'); // not saved
  });

  test('save <prefix> filters marketplace ids', () => {
    const line = 'save wf-';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toContain('wf-tdd-cycle');
  });

  test('replaceFrom points to start of second token', () => {
    const line = 'install mcp-g';
    const r = completeShellLine(line, line.length, makeContext());
    // 'install ' = 8 chars, second token starts at 8
    expect(r.replaceFrom).toBe(8);
  });
});

// ── Rule 4: unknown first token ──────────────────────────────────────────────

describe('no completions for unknown commands', () => {
  test('git commit has no completions', () => {
    const line = 'git commit';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toHaveLength(0);
  });

  test('curl has no completions', () => {
    const line = 'curl http://';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches).toHaveLength(0);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('cursor mid-token for slash', () => {
    // Line is '/help' but cursor is at position 2 ('/h')
    const r = completeShellLine('/help', 2, makeContext());
    expect(r.matches).toContain('/help');
  });

  test('install with no prefix returns all marketplace ids', () => {
    const line = 'install ';
    const r = completeShellLine(line, line.length, makeContext());
    expect(r.matches.length).toBeGreaterThan(0);
  });

  test('at most 12 matches returned', () => {
    const ctx = makeContext({
      marketplaceIds: () => Array.from({ length: 20 }, (_, i) => `mcp-item-${i}`),
    });
    const line = 'install mcp-';
    const r = completeShellLine(line, line.length, ctx);
    expect(r.matches.length).toBeLessThanOrEqual(12);
  });
});

// ── Ghost from history ────────────────────────────────────────────────────────

describe('ghostFromHistory', () => {
  test('returns suffix for prefix match', () => {
    expect(ghostFromHistory('git', ['git status', 'ls'])).toBe(' status');
  });

  test('prefers most recent entry', () => {
    expect(ghostFromHistory('git', ['git log', 'ls', 'git status'])).toBe(' status');
  });

  test('returns null when no match', () => {
    expect(ghostFromHistory('xyz', ['git status', 'ls'])).toBeNull();
  });

  test('returns null for empty line', () => {
    expect(ghostFromHistory('', ['git status'])).toBeNull();
  });

  test('returns null when line equals entry exactly', () => {
    expect(ghostFromHistory('git status', ['git status'])).toBeNull();
  });

  test('returns null for whitespace-only line', () => {
    expect(ghostFromHistory('   ', ['   extra'])).toBeNull();
  });

  test('returns null with empty history', () => {
    expect(ghostFromHistory('git', [])).toBeNull();
  });
});
