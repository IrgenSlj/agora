import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { federatedFetchItem, federatedSearch, SOURCES } from '../../src/federation/index';
import type { FetchLike } from '../../src/retry';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/federation');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function makeFetcher(body: unknown, status = 200): FetchLike {
  return async () => new Response(JSON.stringify(body), { status });
}

function throwingFetcher(message = 'network unreachable'): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

function tempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'agora-federation-cache-'));
}

describe('SOURCES registry — the seam for follow-on sources', () => {
  test('ships official, smithery, glama, github, huggingface, local — official first, local last', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([
      'official',
      'smithery',
      'glama',
      'github',
      'huggingface',
      'local'
    ]);
  });
});

describe('federatedSearch() — dedupe / canonicalization', () => {
  test('merges the same server found via official + local into one item with two provenances', async () => {
    const cacheDir = tempCacheDir();
    try {
      const fixture = loadFixture('official-search-github.json');
      const { items, statuses } = await federatedSearch(
        'github',
        {},
        { fetcher: makeFetcher(fixture), cacheDir }
      );

      // official's fixture id is the reverse-DNS name; it shares
      // repository + npmPackage with the bundled local `mcp-github` entry, so
      // canonicalize() must fold them into a single merged item.
      const merged = items.find((i) => i.id === 'io.github.modelcontextprotocol/server-github');
      expect(merged).toBeDefined();
      expect(items.some((i) => i.id === 'mcp-github')).toBe(false);

      expect(merged!.provenance.map((p) => p.source)).toEqual(['official', 'local']);
      // official metadata wins (status/serverJson only ever come from official).
      expect(merged!.officialStatus).toBe('active');
      expect(merged!.serverJson?.name).toBe('io.github.modelcontextprotocol/server-github');
      // official always reports stars/installs as 0 — the merge keeps local's
      // real popularity numbers instead of clobbering them.
      expect(merged!.stars).toBeGreaterThan(0);
      expect(merged!.installs).toBeGreaterThan(0);

      const officialStatus = statuses.find((s) => s.source === 'official');
      const localStatus = statuses.find((s) => s.source === 'local');
      expect(officialStatus).toEqual({ source: 'official', state: 'ok', count: 1 });
      expect(localStatus?.state).toBe('ok');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test('items that only appear in one source pass through unmerged', async () => {
    const cacheDir = tempCacheDir();
    try {
      const fixture = loadFixture('official-search-postgres.json');
      const { items } = await federatedSearch(
        'postgres',
        {},
        { fetcher: makeFetcher(fixture), cacheDir }
      );
      // None of these official postgres entries share a repo/npm package with
      // the bundled local mcp-postgres (@modelcontextprotocol/server-postgres),
      // so they must all stay distinct, singleton items.
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('mcp-postgres');
      expect(ids).toContain('ai.waystation/postgres');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe('federatedSearch() — offline fallback', () => {
  // github/huggingface reuse src/hubs/*.ts, which retries each of their own
  // several sequential sub-requests (topics / category queries) with a real
  // backoff delay that isn't signal-aware — so a fully-down network can
  // legitimately ride the engine's own per-source timeout ceiling
  // (DEFAULT_TIMEOUT_MS = 5000) rather than fail instantly. Give this test
  // headroom above that ceiling instead of racing bun's default 5000ms.
  test('a throwing fetcher still returns local results, reports official unreachable, and never throws', async () => {
    const cacheDir = tempCacheDir();
    try {
      const { items, statuses } = await federatedSearch(
        'github',
        {},
        { fetcher: throwingFetcher(), cacheDir }
      );

      const officialStatus = statuses.find((s) => s.source === 'official');
      const localStatus = statuses.find((s) => s.source === 'local');
      expect(officialStatus?.state).toBe('unreachable');
      expect(officialStatus && 'reason' in officialStatus && officialStatus.reason.length > 0).toBe(
        true
      );
      expect(localStatus?.state).toBe('ok');

      expect(items.some((i) => i.id === 'mcp-github')).toBe(true);
      expect(items.every((i) => i.provenance.every((p) => p.source !== 'official'))).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 10000);

  test('AGORA_OFFLINE=1 disables official cleanly (offline, not unreachable) and local still works', async () => {
    const cacheDir = tempCacheDir();
    try {
      const { items, statuses } = await federatedSearch(
        'github',
        {},
        { env: { AGORA_OFFLINE: '1' }, cacheDir }
      );
      expect(statuses.find((s) => s.source === 'official')?.state).toBe('offline');
      expect(statuses.find((s) => s.source === 'local')?.state).toBe('ok');
      expect(items.some((i) => i.id === 'mcp-github')).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  test('--source restricts the query to a single source', async () => {
    const { items, statuses } = await federatedSearch('github', { source: 'local' }, {});
    expect(statuses.length).toBe(1);
    expect(statuses[0]!.source).toBe('local');
    expect(items.every((i) => i.provenance.every((p) => p.source === 'local'))).toBe(true);
  });
});

describe('federatedFetchItem()', () => {
  test('falls back to local when official has no match', async () => {
    const item = await federatedFetchItem('mcp-github', {
      fetcher: makeFetcher({}, 404)
    });
    expect(item?.id).toBe('mcp-github');
  });

  test('returns null when no source resolves the ref', async () => {
    const item = await federatedFetchItem('nothing-matches-this-xyz', {
      fetcher: makeFetcher({}, 404)
    });
    expect(item).toBeNull();
  });
});
