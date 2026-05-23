/**
 * Tests for src/stack/manifest.ts
 */
import { describe, expect, test } from 'bun:test';
import {
  serializeManifest,
  parseManifest,
  serverToEntry,
  type StackManifest
} from '../../src/stack/manifest';
import type { ConfiguredServer } from '../../src/stack/types';

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('round-trip: serializeManifest → parseManifest', () => {
  test('local server with env and enabled:false, remote server, and name that needs quoting', () => {
    const m: StackManifest = {
      mcp: {
        postgres: {
          command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
          env: { DATABASE_URL: 'postgres://localhost/db' },
          enabled: false
        },
        linear: {
          url: 'https://mcp.linear.app/sse'
        },
        'weird.name': {
          command: ['node', 'server.js']
        }
      }
    };

    const serialized = serializeManifest(m);
    const parsed = parseManifest(serialized);

    expect(parsed.mcp['postgres']).toEqual({
      command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: 'postgres://localhost/db' },
      enabled: false
    });
    expect(parsed.mcp['linear']).toEqual({ url: 'https://mcp.linear.app/sse' });
    expect(parsed.mcp['weird.name']).toEqual({ command: ['node', 'server.js'] });
  });

  test('skills and workflows sections round-trip', () => {
    const m: StackManifest = {
      mcp: {},
      skills: { 'my-skill': { url: 'https://example.com/skill' } },
      workflows: { 'my-wf': { command: ['python', 'wf.py'] } }
    };
    const parsed = parseManifest(serializeManifest(m));
    expect(parsed.skills?.['my-skill']).toEqual({ url: 'https://example.com/skill' });
    expect(parsed.workflows?.['my-wf']).toEqual({ command: ['python', 'wf.py'] });
  });

  test('empty sections are omitted from output', () => {
    const m: StackManifest = { mcp: {}, skills: {}, workflows: {} };
    const text = serializeManifest(m);
    expect(text).not.toContain('[mcp.');
    expect(text).not.toContain('[skills.');
    expect(text).not.toContain('[workflows.');
  });
});

// ── serializeManifest ─────────────────────────────────────────────────────────

describe('serializeManifest', () => {
  test('starts with # agora stack manifest comment', () => {
    const text = serializeManifest({ mcp: {} });
    expect(text.startsWith('# agora stack manifest')).toBe(true);
  });

  test('omits enabled when true', () => {
    const m: StackManifest = { mcp: { alpha: { url: 'https://x.com', enabled: true } } };
    const text = serializeManifest(m);
    expect(text).not.toContain('enabled');
  });

  test('emits enabled = false when false', () => {
    const m: StackManifest = { mcp: { alpha: { url: 'https://x.com', enabled: false } } };
    const text = serializeManifest(m);
    expect(text).toContain('enabled = false');
  });

  test('omits env table when env is empty or absent', () => {
    const m: StackManifest = { mcp: { alpha: { url: 'https://x.com', env: {} } } };
    const text = serializeManifest(m);
    expect(text).not.toContain('.env]');
  });

  test('names are sorted within each section', () => {
    const m: StackManifest = {
      mcp: {
        zebra: { url: 'https://z.com' },
        apple: { url: 'https://a.com' },
        mango: { url: 'https://m.com' }
      }
    };
    const text = serializeManifest(m);
    const appleIdx = text.indexOf('[mcp.apple]');
    const mangoIdx = text.indexOf('[mcp.mango]');
    const zebraIdx = text.indexOf('[mcp.zebra]');
    expect(appleIdx).toBeLessThan(mangoIdx);
    expect(mangoIdx).toBeLessThan(zebraIdx);
  });

  test('output is deterministic across calls', () => {
    const m: StackManifest = {
      mcp: {
        beta: { command: ['node', 'b.js'], env: { KEY: 'val' } },
        alpha: { url: 'https://a.com' }
      }
    };
    expect(serializeManifest(m)).toBe(serializeManifest(m));
  });

  test('names needing quoting are double-quoted in headers', () => {
    const m: StackManifest = { mcp: { 'dot.ted': { url: 'https://x.com' } } };
    const text = serializeManifest(m);
    expect(text).toContain('[mcp."dot.ted"]');
  });

  test('sections emitted in order mcp, skills, workflows', () => {
    const m: StackManifest = {
      mcp: { a: { url: 'https://a.com' } },
      skills: { b: { url: 'https://b.com' } },
      workflows: { c: { url: 'https://c.com' } }
    };
    const text = serializeManifest(m);
    const mcpIdx = text.indexOf('[mcp.');
    const skillsIdx = text.indexOf('[skills.');
    const wfIdx = text.indexOf('[workflows.');
    expect(mcpIdx).toBeLessThan(skillsIdx);
    expect(skillsIdx).toBeLessThan(wfIdx);
  });
});

// ── parseManifest ─────────────────────────────────────────────────────────────

describe('parseManifest', () => {
  test('parses the spec example exactly', () => {
    const toml = `# agora stack manifest

[mcp.postgres]
command = ["npx", "-y", "@modelcontextprotocol/server-postgres"]
enabled = false

[mcp.postgres.env]
DATABASE_URL = "postgres://localhost/db"

[mcp.linear]
url = "https://mcp.linear.app/sse"
`;
    const m = parseManifest(toml);
    expect(m.mcp['postgres']).toEqual({
      command: ['npx', '-y', '@modelcontextprotocol/server-postgres'],
      enabled: false,
      env: { DATABASE_URL: 'postgres://localhost/db' }
    });
    expect(m.mcp['linear']).toEqual({ url: 'https://mcp.linear.app/sse' });
  });

  test('ignores blank lines and # comment lines', () => {
    const toml = `
# this is a comment
# another comment

[mcp.srv]
# inline-like but it's a full line comment
url = "https://example.com"
`;
    const m = parseManifest(toml);
    expect(m.mcp['srv']?.url).toBe('https://example.com');
  });

  test('throws on unknown section', () => {
    const toml = `[plugins.x]\nurl = "https://x.com"\n`;
    expect(() => parseManifest(toml)).toThrow(/unknown section/i);
  });

  test('throws on unknown entry key', () => {
    const toml = `[mcp.srv]\nbadkey = "oops"\n`;
    expect(() => parseManifest(toml)).toThrow(/unknown key/i);
  });

  test('throws on malformed value (bare, not string/bool/array)', () => {
    const toml = `[mcp.srv]\nurl = not-a-string\n`;
    expect(() => parseManifest(toml)).toThrow();
  });

  test('throws on malformed array', () => {
    const toml = `[mcp.srv]\ncommand = [oops]\n`;
    expect(() => parseManifest(toml)).toThrow();
  });

  test('returns empty mcp for file with only comments', () => {
    const m = parseManifest('# just a comment\n');
    expect(m.mcp).toEqual({});
  });

  test('parses quoted name with dot', () => {
    const toml = `[mcp."weird.name"]\nurl = "https://x.com"\n`;
    const m = parseManifest(toml);
    expect(m.mcp['weird.name']?.url).toBe('https://x.com');
  });
});

// ── serverToEntry ─────────────────────────────────────────────────────────────

describe('serverToEntry', () => {
  function makeServer(overrides: Partial<ConfiguredServer>): ConfiguredServer {
    return {
      name: 'test',
      tool: 'opencode',
      scope: 'project',
      configPath: '/x',
      transport: 'local',
      enabled: true,
      raw: {},
      ...overrides
    };
  }

  test('maps local server with command', () => {
    const entry = serverToEntry(makeServer({ command: ['npx', 'mcp-server'], transport: 'local' }));
    expect(entry.command).toEqual(['npx', 'mcp-server']);
    expect(entry.url).toBeUndefined();
  });

  test('maps remote server with url', () => {
    const entry = serverToEntry(
      makeServer({ transport: 'remote', url: 'https://mcp.example.com/sse' })
    );
    expect(entry.url).toBe('https://mcp.example.com/sse');
    expect(entry.command).toBeUndefined();
  });

  test('includes env when non-empty', () => {
    const entry = serverToEntry(makeServer({ env: { FOO: 'bar' } }));
    expect(entry.env).toEqual({ FOO: 'bar' });
  });

  test('omits env when empty', () => {
    const entry = serverToEntry(makeServer({ env: {} }));
    expect(entry.env).toBeUndefined();
  });

  test('omits env when absent', () => {
    const entry = serverToEntry(makeServer({ env: undefined }));
    expect(entry.env).toBeUndefined();
  });

  test('sets enabled:false when server is disabled', () => {
    const entry = serverToEntry(makeServer({ enabled: false }));
    expect(entry.enabled).toBe(false);
  });

  test('omits enabled when server is enabled', () => {
    const entry = serverToEntry(makeServer({ enabled: true }));
    expect(entry.enabled).toBeUndefined();
  });
});
