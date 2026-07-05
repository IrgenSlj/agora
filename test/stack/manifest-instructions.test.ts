/**
 * Tests for the P3 `instructions` manifest table: TOML parse/serialize
 * round-trip, and resolveInstructionContent (inline | file | url).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  serializeManifest,
  parseManifest,
  hashContent,
  resolveInstructionContent,
  type StackManifest
} from '../../src/stack/manifest';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-instructions-test-'));
}

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('round-trip: instructions section', () => {
  test('inline entry with content, ref-file entry, ref-url entry, and enabled:false', () => {
    const m: StackManifest = {
      mcp: {},
      instructions: {
        'claude-md': {
          source: 'inline',
          content: 'Follow the house style.\nAlways run tests before committing.',
          contentHash: 'sha256:abc'
        },
        contributing: {
          source: 'file',
          ref: 'CONTRIBUTING.md'
        },
        remote: {
          source: 'url',
          ref: 'https://example.com/AGENTS.md',
          enabled: false
        }
      }
    };

    const serialized = serializeManifest(m);
    const parsed = parseManifest(serialized);

    expect(parsed.instructions?.['claude-md']).toEqual({
      source: 'inline',
      content: 'Follow the house style.\nAlways run tests before committing.',
      contentHash: 'sha256:abc'
    });
    expect(parsed.instructions?.['contributing']).toEqual({
      source: 'file',
      ref: 'CONTRIBUTING.md'
    });
    expect(parsed.instructions?.['remote']).toEqual({
      source: 'url',
      ref: 'https://example.com/AGENTS.md',
      enabled: false
    });
  });

  test('multi-line inline content with quotes and backslashes survives the round-trip', () => {
    const tricky = 'Line one.\nLine "two" has quotes.\nA \\ backslash too.\nLine four.';
    const m: StackManifest = {
      mcp: {},
      instructions: { tricky: { source: 'inline', content: tricky } }
    };
    const parsed = parseManifest(serializeManifest(m));
    expect(parsed.instructions?.['tricky']?.content).toBe(tricky);
  });

  test('output is deterministic and instructions section comes after mcp/skills/workflows', () => {
    const m: StackManifest = {
      mcp: { a: { url: 'https://a.com' } },
      skills: { b: { url: 'https://b.com' } },
      workflows: { c: { url: 'https://c.com' } },
      instructions: { d: { source: 'inline', content: 'hi' } }
    };
    const text1 = serializeManifest(m);
    const text2 = serializeManifest(m);
    expect(text1).toBe(text2);

    const wfIdx = text1.indexOf('[workflows.');
    const instrIdx = text1.indexOf('[instructions.');
    expect(wfIdx).toBeLessThan(instrIdx);
  });

  test('empty instructions section is omitted from output', () => {
    const m: StackManifest = { mcp: {}, instructions: {} };
    const text = serializeManifest(m);
    expect(text).not.toContain('[instructions.');
  });

  test('names needing quoting are double-quoted in instructions headers too', () => {
    const m: StackManifest = {
      mcp: {},
      instructions: { 'dot.ted': { source: 'inline', content: 'x' } }
    };
    const text = serializeManifest(m);
    expect(text).toContain('[instructions."dot.ted"]');
  });
});

describe('parseManifest: instructions validation', () => {
  test('throws on unknown key in instructions entry', () => {
    const toml = `[instructions.x]\nbadkey = "oops"\n`;
    expect(() => parseManifest(toml)).toThrow(/unknown key/i);
  });

  test('throws on invalid source value', () => {
    const toml = `[instructions.x]\nsource = "ftp"\n`;
    expect(() => parseManifest(toml)).toThrow(/source must be/i);
  });

  test('throws on .env sub-table under instructions', () => {
    const toml = `[instructions.x]\nsource = "inline"\ncontent = "hi"\n\n[instructions.x.env]\nFOO = "bar"\n`;
    expect(() => parseManifest(toml)).toThrow(/do not support \.env/i);
  });

  test('parses a hand-written instructions table (spec shape)', () => {
    const toml = `# agora stack manifest

[instructions.claude-md]
source = "inline"
content = "Be terse."
content_hash = "sha256:deadbeef"
`;
    const m = parseManifest(toml);
    expect(m.instructions?.['claude-md']).toEqual({
      source: 'inline',
      content: 'Be terse.',
      contentHash: 'sha256:deadbeef'
    });
  });
});

// ── hashContent ───────────────────────────────────────────────────────────────

describe('hashContent', () => {
  test('is deterministic and prefixed with sha256:', () => {
    const h1 = hashContent('hello world');
    const h2 = hashContent('hello world');
    expect(h1).toBe(h2);
    expect(h1.startsWith('sha256:')).toBe(true);
  });

  test('differs for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});

// ── resolveInstructionContent ─────────────────────────────────────────────────

describe('resolveInstructionContent', () => {
  test('inline source returns content directly', async () => {
    const text = await resolveInstructionContent({ source: 'inline', content: 'hello inline' }, {});
    expect(text).toBe('hello inline');
  });

  test('undefined source defaults to inline', async () => {
    const text = await resolveInstructionContent({ content: 'default inline' }, {});
    expect(text).toBe('default inline');
  });

  test('file source reads from cwd-relative path', async () => {
    const cwd = makeTmp();
    try {
      writeFileSync(join(cwd, 'CONTRIBUTING.md'), 'contribution rules');
      const text = await resolveInstructionContent(
        { source: 'file', ref: 'CONTRIBUTING.md' },
        { cwd }
      );
      expect(text).toBe('contribution rules');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('file source throws a descriptive error when missing', async () => {
    const cwd = makeTmp();
    try {
      await expect(
        resolveInstructionContent({ source: 'file', ref: 'nope.md' }, { cwd })
      ).rejects.toThrow(/not found/i);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('url source fetches via the injected fetcher (DI, no network)', async () => {
    const fakeFetcher = async (_url: string | URL) =>
      ({ ok: true, status: 200, text: async () => 'remote content' }) as Response;
    const text = await resolveInstructionContent(
      { source: 'url', ref: 'https://example.com/AGENTS.md' },
      { fetcher: fakeFetcher }
    );
    expect(text).toBe('remote content');
  });

  test('url source throws on HTTP error', async () => {
    const fakeFetcher = async (_url: string | URL) =>
      ({ ok: false, status: 404, text: async () => '' }) as Response;
    await expect(
      resolveInstructionContent(
        { source: 'url', ref: 'https://example.com/missing.md' },
        { fetcher: fakeFetcher }
      )
    ).rejects.toThrow(/404/);
  });

  test('file source resolves relative to a remote baseSource by fetching', async () => {
    const fakeFetcher = async (url: string | URL) =>
      ({ ok: true, status: 200, text: async () => `content for ${url}` }) as Response;
    const text = await resolveInstructionContent(
      { source: 'file', ref: 'CONTRIBUTING.md' },
      { fetcher: fakeFetcher, baseSource: 'https://raw.example.com/profile/agora.toml' }
    );
    expect(text).toBe('content for https://raw.example.com/profile/CONTRIBUTING.md');
  });

  test('missing ref on file/url source throws', async () => {
    await expect(resolveInstructionContent({ source: 'file' }, {})).rejects.toThrow(/no ref/i);
  });
});
