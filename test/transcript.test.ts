import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendTranscript,
  cwdHash,
  getTranscriptPath,
  loadSessionMeta,
  readTranscript,
  recentBashContext,
  writeSessionMeta,
  type SessionMeta
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
