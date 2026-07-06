import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendTranscript,
  cwdHash,
  getTranscriptPath,
  listSessions,
  loadSessionMeta,
  readTranscript,
  recentBashContext,
  type SessionMeta,
  searchTranscripts,
  writeSessionMeta
} from '../src/transcript';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-transcript-test-'));
}

describe('cwdHash', () => {
  test('returns 16 hex chars', () => {
    const h = cwdHash('/some/path');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  test('is deterministic', () => {
    expect(cwdHash('/tmp/project')).toBe(cwdHash('/tmp/project'));
  });

  test('differs for different paths', () => {
    expect(cwdHash('/tmp/a')).not.toBe(cwdHash('/tmp/b'));
  });
});

describe('getTranscriptPath', () => {
  test('path ends with .jsonl and contains the hash', () => {
    const dir = makeTmp();
    try {
      const p = getTranscriptPath(dir, '/my/project');
      expect(p).toContain(dir);
      expect(p).toMatch(/\.jsonl$/);
      expect(p).toContain(cwdHash('/my/project'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('creates transcripts dir on demand', () => {
    const dir = makeTmp();
    try {
      const p = getTranscriptPath(dir, '/my/project');
      // path should be under <dataDir>/transcripts/
      expect(p).toContain(join(dir, 'transcripts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('appendTranscript / readTranscript round-trip', () => {
  test('empty file returns []', () => {
    const dir = makeTmp();
    try {
      const entries = readTranscript(dir, '/no/project');
      expect(entries).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('appended entries are read back in order', () => {
    const dir = makeTmp();
    const cwd = '/my/project';
    try {
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T00:00:00.000Z',
        kind: 'bash',
        input: 'ls',
        output: 'a\nb'
      });
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T00:00:01.000Z',
        kind: 'chat-user',
        input: 'hello'
      });
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T00:00:02.000Z',
        kind: 'chat-assistant',
        output: 'hi'
      });

      const entries = readTranscript(dir, cwd);
      expect(entries).toHaveLength(3);
      expect(entries[0].kind).toBe('bash');
      expect(entries[1].kind).toBe('chat-user');
      expect(entries[2].kind).toBe('chat-assistant');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tail option limits returned entries', () => {
    const dir = makeTmp();
    const cwd = '/tail/test';
    try {
      for (let i = 0; i < 5; i++) {
        appendTranscript(dir, cwd, {
          ts: new Date().toISOString(),
          kind: 'meta',
          input: `entry${i}`
        });
      }
      const entries = readTranscript(dir, cwd, { tail: 2 });
      expect(entries).toHaveLength(2);
      expect(entries[1].input).toBe('entry4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('recentBashContext', () => {
  test('returns empty string when no bash entries', () => {
    const dir = makeTmp();
    const cwd = '/empty/project';
    try {
      appendTranscript(dir, cwd, {
        ts: new Date().toISOString(),
        kind: 'chat-user',
        input: 'hello'
      });
      const ctx = recentBashContext(dir, cwd, { commands: 3, lines: 20 });
      expect(ctx).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes recent bash commands', () => {
    const dir = makeTmp();
    const cwd = '/bash/project';
    try {
      appendTranscript(dir, cwd, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: 'ls',
        output: 'file1\nfile2'
      });
      appendTranscript(dir, cwd, {
        ts: new Date().toISOString(),
        kind: 'bash',
        input: 'pwd',
        output: '/bash/project'
      });
      const ctx = recentBashContext(dir, cwd, { commands: 3, lines: 20 });
      expect(ctx).toContain('Recent shell output in this session:');
      expect(ctx).toContain('$ ls');
      expect(ctx).toContain('$ pwd');
      expect(ctx).toContain('file1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('limits to N most recent commands', () => {
    const dir = makeTmp();
    const cwd = '/limit/project';
    try {
      for (let i = 0; i < 5; i++) {
        appendTranscript(dir, cwd, {
          ts: new Date().toISOString(),
          kind: 'bash',
          input: `cmd${i}`,
          output: `out${i}`
        });
      }
      const ctx = recentBashContext(dir, cwd, { commands: 2, lines: 20 });
      expect(ctx).not.toContain('$ cmd0');
      expect(ctx).toContain('$ cmd3');
      expect(ctx).toContain('$ cmd4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadSessionMeta / writeSessionMeta', () => {
  test('returns undefined when no file exists', () => {
    const dir = makeTmp();
    try {
      const m = loadSessionMeta(dir, '/no/session');
      expect(m).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('round-trip persists and reads back meta', () => {
    const dir = makeTmp();
    const cwd = '/my/project';
    try {
      const meta: SessionMeta = {
        sessionId: 'abc123',
        cwd,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T01:00:00.000Z',
        turnCount: 5
      };
      writeSessionMeta(dir, cwd, meta);
      const loaded = loadSessionMeta(dir, cwd);
      expect(loaded).toEqual(meta);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('overwrites existing meta atomically', () => {
    const dir = makeTmp();
    const cwd = '/overwrite/project';
    try {
      const meta1: SessionMeta = {
        sessionId: 'first',
        cwd,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T00:00:00.000Z',
        turnCount: 1
      };
      writeSessionMeta(dir, cwd, meta1);

      const meta2: SessionMeta = { ...meta1, sessionId: 'second', turnCount: 2 };
      writeSessionMeta(dir, cwd, meta2);

      const loaded = loadSessionMeta(dir, cwd);
      expect(loaded?.sessionId).toBe('second');
      expect(loaded?.turnCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('listSessions', () => {
  test('returns empty array when transcripts dir does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-list-sessions-'));
    try {
      const sessions = listSessions(dir);
      expect(sessions).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns sessions sorted most-recent first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-list-sessions-'));
    const cwdA = '/projects/alpha';
    const cwdB = '/projects/beta';
    try {
      const metaA: SessionMeta = {
        sessionId: 'sess-a',
        cwd: cwdA,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-01-01T10:00:00.000Z',
        turnCount: 3
      };
      const metaB: SessionMeta = {
        sessionId: 'sess-b',
        cwd: cwdB,
        createdAt: '2024-01-02T00:00:00.000Z',
        lastUsedAt: '2024-01-02T10:00:00.000Z',
        turnCount: 7
      };
      writeSessionMeta(dir, cwdA, metaA);
      writeSessionMeta(dir, cwdB, metaB);

      const sessions = listSessions(dir);
      expect(sessions).toHaveLength(2);
      // beta is more recent
      expect(sessions[0].cwd).toBe(cwdB);
      expect(sessions[0].turnCount).toBe(7);
      expect(sessions[1].cwd).toBe(cwdA);
      expect(sessions[1].turnCount).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('includes sessionId and lastActivity fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-list-sessions-'));
    const cwd = '/projects/test';
    try {
      const meta: SessionMeta = {
        sessionId: 'abc123',
        cwd,
        createdAt: '2024-03-01T00:00:00.000Z',
        lastUsedAt: '2024-03-01T12:00:00.000Z',
        turnCount: 2
      };
      writeSessionMeta(dir, cwd, meta);
      const sessions = listSessions(dir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('abc123');
      expect(sessions[0].lastActivity).toBe('2024-03-01T12:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('searchTranscripts', () => {
  test('returns empty array when transcripts dir does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-search-'));
    try {
      const results = searchTranscripts(dir, 'anything');
      expect(results).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('finds matching entries across sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-search-'));
    const cwdA = '/projects/alpha';
    const cwdB = '/projects/beta';
    try {
      appendTranscript(dir, cwdA, {
        ts: '2024-01-01T10:00:00.000Z',
        kind: 'bash',
        input: 'ls -la',
        output: 'total 8'
      });
      appendTranscript(dir, cwdA, {
        ts: '2024-01-01T10:01:00.000Z',
        kind: 'chat-user',
        input: 'what is MCP protocol?'
      });
      appendTranscript(dir, cwdB, {
        ts: '2024-01-02T09:00:00.000Z',
        kind: 'bash',
        input: 'agora search mcp',
        output: 'Found 5 results'
      });

      // Write session meta so cwd can be resolved
      writeSessionMeta(dir, cwdA, {
        sessionId: null,
        cwd: cwdA,
        createdAt: '2024-01-01T10:00:00.000Z',
        lastUsedAt: '2024-01-01T10:01:00.000Z',
        turnCount: 2
      });
      writeSessionMeta(dir, cwdB, {
        sessionId: null,
        cwd: cwdB,
        createdAt: '2024-01-02T09:00:00.000Z',
        lastUsedAt: '2024-01-02T09:00:00.000Z',
        turnCount: 1
      });

      const results = searchTranscripts(dir, 'mcp');
      expect(results.length).toBeGreaterThanOrEqual(2);
      const snippets = results.map((r) => r.snippet);
      expect(snippets.some((s) => s.toLowerCase().includes('mcp'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('is case-insensitive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-search-'));
    const cwd = '/projects/test';
    try {
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T10:00:00.000Z',
        kind: 'chat-user',
        input: 'Tell me about OPENCODE'
      });
      writeSessionMeta(dir, cwd, {
        sessionId: null,
        cwd,
        createdAt: '2024-01-01T10:00:00.000Z',
        lastUsedAt: '2024-01-01T10:00:00.000Z',
        turnCount: 1
      });

      const results = searchTranscripts(dir, 'opencode');
      expect(results).toHaveLength(1);
      expect(results[0].kind).toBe('chat-user');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns no matches for a query that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-search-'));
    const cwd = '/projects/test';
    try {
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T10:00:00.000Z',
        kind: 'bash',
        input: 'ls',
        output: 'file.txt'
      });
      const results = searchTranscripts(dir, 'xyzzy-no-match');
      expect(results).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('results are sorted most-recent first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-search-'));
    const cwd = '/projects/sorted';
    try {
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T08:00:00.000Z',
        kind: 'bash',
        input: 'agora today',
        output: ''
      });
      appendTranscript(dir, cwd, {
        ts: '2024-01-01T09:00:00.000Z',
        kind: 'bash',
        input: 'agora search',
        output: ''
      });
      writeSessionMeta(dir, cwd, {
        sessionId: null,
        cwd,
        createdAt: '2024-01-01T08:00:00.000Z',
        lastUsedAt: '2024-01-01T09:00:00.000Z',
        turnCount: 2
      });

      const results = searchTranscripts(dir, 'agora');
      expect(results.length).toBe(2);
      expect(results[0].timestamp > results[1].timestamp).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
