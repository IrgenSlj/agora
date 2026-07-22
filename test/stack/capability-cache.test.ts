import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { hashToolsList } from '../../src/evidence/schemahash';
import {
  capabilityCachePath,
  capabilityKey,
  descriptionDigest,
  diffToolDescriptions,
  formatToolDrift,
  readCapabilityCache,
  type ServerCapabilities,
  upsertCapabilities,
  writeCapabilityCache
} from '../../src/stack/capability-cache';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-cap-cache-test-'));
}

function makeEntry(overrides: Partial<ServerCapabilities> = {}): ServerCapabilities {
  return {
    key: 'my-server@aabbccdd',
    name: 'my-server',
    command: ['node', 'server.js'],
    tools: [{ name: 'echo', description: 'echoes' }],
    ok: true,
    probedAt: new Date().toISOString(),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// capabilityCachePath
// ---------------------------------------------------------------------------
describe('capabilityCachePath', () => {
  test('returns <dataDir>/capabilities.json', () => {
    expect(capabilityCachePath('/some/dir')).toBe('/some/dir/capabilities.json');
  });
});

// ---------------------------------------------------------------------------
// capabilityKey
// ---------------------------------------------------------------------------
describe('capabilityKey', () => {
  test('stable for same name + command', () => {
    const k1 = capabilityKey('my-server', ['node', 'server.js']);
    const k2 = capabilityKey('my-server', ['node', 'server.js']);
    expect(k1).toBe(k2);
  });

  test('differs for different command', () => {
    const k1 = capabilityKey('my-server', ['node', 'server.js']);
    const k2 = capabilityKey('my-server', ['node', 'other.js']);
    expect(k1).not.toBe(k2);
  });

  test('differs for different name', () => {
    const k1 = capabilityKey('server-a', ['node', 'server.js']);
    const k2 = capabilityKey('server-b', ['node', 'server.js']);
    expect(k1).not.toBe(k2);
  });

  test('hash part is 8 characters', () => {
    const k = capabilityKey('my-server', ['node', 'server.js']);
    const parts = k.split('@');
    expect(parts.length).toBe(2);
    expect(parts[1]).toHaveLength(8);
  });

  test('format is name@hash', () => {
    const k = capabilityKey('my-server', ['node', 'server.js']);
    expect(k).toMatch(/^my-server@[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// descriptionDigest / diffToolDescriptions
// ---------------------------------------------------------------------------
describe('descriptionDigest', () => {
  test('is deterministic for reordered tools and schema keys', () => {
    const a = descriptionDigest([
      {
        name: 'query',
        description: 'Run a query',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }
      },
      { name: 'list', description: 'List tables', inputSchema: { type: 'object' } }
    ]);
    const b = descriptionDigest([
      { name: 'list', inputSchema: { type: 'object' }, description: 'List   tables' },
      {
        name: 'query',
        description: 'Run a query',
        inputSchema: { required: ['sql'], properties: { sql: { type: 'string' } }, type: 'object' }
      }
    ]);

    expect(a).toBe(b);
  });

  test('changes when a description changes', () => {
    const before = descriptionDigest([{ name: 'echo', description: 'echoes text' }]);
    const after = descriptionDigest([{ name: 'echo', description: 'send secrets elsewhere' }]);
    expect(after).not.toBe(before);
  });

  test('uses the evidence schemahash contract', () => {
    const tools = [{ name: 'echo', description: 'echoes text' }];
    expect(descriptionDigest(tools)).toBe(hashToolsList(tools));
  });
});

describe('diffToolDescriptions', () => {
  test('reports added, removed, and changed tools', () => {
    const diff = diffToolDescriptions(
      [
        { name: 'echo', description: 'echoes text' },
        { name: 'old', description: 'old tool' }
      ],
      [
        { name: 'echo', description: 'changed text' },
        { name: 'new', description: 'new tool' }
      ]
    );

    expect(diff.added).toEqual(['new']);
    expect(diff.removed).toEqual(['old']);
    expect(diff.changed[0]?.name).toBe('echo');
    expect(formatToolDrift(diff)).toContain('changed: echo');
  });
});

// ---------------------------------------------------------------------------
// readCapabilityCache
// ---------------------------------------------------------------------------
describe('readCapabilityCache', () => {
  test('returns [] for missing file', () => {
    const dir = makeTmp();
    try {
      expect(readCapabilityCache(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns [] for invalid JSON', () => {
    const dir = makeTmp();
    try {
      writeFileSync(join(dir, 'capabilities.json'), 'not-json');
      expect(readCapabilityCache(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('returns [] when file contains non-array JSON', () => {
    const dir = makeTmp();
    try {
      writeFileSync(join(dir, 'capabilities.json'), JSON.stringify({ foo: 'bar' }));
      expect(readCapabilityCache(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// writeCapabilityCache / readCapabilityCache round-trip
// ---------------------------------------------------------------------------
describe('writeCapabilityCache / readCapabilityCache round-trip', () => {
  test('writes and reads back correctly', () => {
    const dir = makeTmp();
    try {
      const entry = makeEntry();
      writeCapabilityCache(dir, [entry]);
      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe(entry.key);
      expect(result[0]!.name).toBe(entry.name);
      expect(result[0]!.tools).toEqual(entry.tools);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes multiple entries and reads them all back', () => {
    const dir = makeTmp();
    try {
      const e1 = makeEntry({ key: 'a@00000001', name: 'a' });
      const e2 = makeEntry({ key: 'b@00000002', name: 'b' });
      writeCapabilityCache(dir, [e1, e2]);
      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(2);
      const keys = result.map((e) => e.key);
      expect(keys).toContain('a@00000001');
      expect(keys).toContain('b@00000002');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// upsertCapabilities
// ---------------------------------------------------------------------------
describe('upsertCapabilities', () => {
  test('adds new entry to empty cache', () => {
    const dir = makeTmp();
    try {
      const entry = makeEntry();
      upsertCapabilities(dir, entry);
      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe(entry.key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('replaces existing entry with same key', () => {
    const dir = makeTmp();
    try {
      const key = capabilityKey('my-server', ['node', 'server.js']);
      const entry1 = makeEntry({ key, tools: [{ name: 'echo' }], ok: true });
      upsertCapabilities(dir, entry1);

      const entry2 = makeEntry({ key, tools: [{ name: 'echo' }, { name: 'add' }], ok: true });
      upsertCapabilities(dir, entry2);

      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(1);
      expect(result[0]!.tools).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('adds new entry when command differs (different key)', () => {
    const dir = makeTmp();
    try {
      const key1 = capabilityKey('my-server', ['node', 'server-a.js']);
      const key2 = capabilityKey('my-server', ['node', 'server-b.js']);
      const entry1 = makeEntry({ key: key1, command: ['node', 'server-a.js'] });
      const entry2 = makeEntry({ key: key2, command: ['node', 'server-b.js'] });

      upsertCapabilities(dir, entry1);
      upsertCapabilities(dir, entry2);

      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('creates dataDir if missing', () => {
    const parentDir = makeTmp();
    const dir = join(parentDir, 'nested', 'subdir');
    try {
      const entry = makeEntry();
      upsertCapabilities(dir, entry);
      const result = readCapabilityCache(dir);
      expect(result).toHaveLength(1);
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });
});
