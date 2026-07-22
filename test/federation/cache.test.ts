import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  readSourceCache,
  readSourceMeta,
  readSourceStoreCache,
  refreshOfficialCache
} from '../../src/federation/cache';
import { buildPurl } from '../../src/model/purl';
import type { FetchLike } from '../../src/retry';
import { AgoraStore } from '../../src/store';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/federation');

function loadFixture(name: string): { servers: unknown[] } {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

// Always strips any `nextCursor` from the fixture's own metadata — the real
// recorded postgres fixture carries one, and a fetcher that ignores query
// params would otherwise "paginate" forever over an identical page.
function pageFetcher(servers: unknown[]): FetchLike {
  return async () =>
    new Response(JSON.stringify({ servers, metadata: { count: servers.length } }), { status: 200 });
}

function throwingFetcher(): FetchLike {
  return async () => {
    throw new Error('network down');
  };
}

describe('refreshOfficialCache()', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agora-federation-cache-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('bootstrap sync (no prior lastSyncAt) populates the cache and records lastSyncAt', async () => {
    const fixture = loadFixture('official-search-postgres.json');
    const result = await refreshOfficialCache({
      fetcher: pageFetcher(fixture.servers),
      cacheDir: dir
    });

    expect(result.error).toBeUndefined();
    expect(result.added).toBe(5);
    expect(result.updated).toBe(0);
    expect(result.pruned).toBe(0);
    expect(result.total).toBe(5);

    const cached = readSourceCache(dir, 'official');
    expect(cached.length).toBe(5);
    const meta = readSourceMeta(dir, 'official');
    expect(meta.lastSyncAt).toBe(result.syncedAt);
  });

  test('bootstrap sync also populates the SQLite source index and CAS blobs', async () => {
    const fixture = loadFixture('official-search-postgres.json');
    const storePath = join(dir, 'agora.db');
    const casDir = join(dir, 'cas');
    const result = await refreshOfficialCache({
      fetcher: pageFetcher(fixture.servers),
      cacheDir: join(dir, 'federation'),
      storePath,
      casDir
    });

    expect(result.error).toBeUndefined();
    expect(result.storeError).toBeUndefined();

    const purl = buildPurl({
      type: 'npm',
      namespace: '@hovecapital',
      name: 'read-only-postgres-mcp-server',
      version: '0.1.0'
    });
    const store = new AgoraStore(storePath);
    try {
      expect(store.getArtifact(purl)).toMatchObject({
        purl,
        kind: 'mcp-server',
        display_name: 'capital.hove/read-only-local-postgres-mcp-server'
      });
      expect(store.getArtifactSources(purl)).toEqual([
        expect.objectContaining({
          adapter: 'official',
          upstream_id: 'capital.hove/read-only-local-postgres-mcp-server'
        })
      ]);
      const indexed = store.listSourceItems('official');
      expect(indexed).toHaveLength(5);
      expect(indexed.some((item) => item.purl === purl)).toBe(true);
    } finally {
      store.close();
    }

    const storedItems = readSourceStoreCache(storePath, casDir, 'official');
    expect(storedItems.map((item) => item.id)).toContain(
      'capital.hove/read-only-local-postgres-mcp-server'
    );
    expect(storedItems).toHaveLength(5);
  });

  test('incremental sync upserts changed servers and adds new ones', async () => {
    const seed = loadFixture('official-search-postgres.json');
    await refreshOfficialCache({ fetcher: pageFetcher(seed.servers), cacheDir: dir });

    const delta = loadFixture('official-updated-since.json');
    const result = await refreshOfficialCache({
      fetcher: pageFetcher(delta.servers),
      cacheDir: dir
    });

    // delta = capital.hove/... (already cached -> updated) + ai.agenticshelf/graffeo
    // (new -> added) + ac.inference.sh/inference (deleted, never cached -> no-op prune).
    expect(result.updated).toBe(1);
    expect(result.added).toBe(1);
    expect(result.pruned).toBe(0);
    expect(result.total).toBe(6);

    const cached = readSourceCache(dir, 'official');
    expect(cached.some((i) => i.id === 'ai.agenticshelf/graffeo')).toBe(true);
    expect(cached.some((i) => i.id === 'ac.inference.sh/inference')).toBe(false);
  });

  test('deleted tombstones prune a previously-cached entry', async () => {
    const rawEntries = loadFixture('official-updated-since.json').servers as Array<{
      server: { name: string };
      _meta: Record<string, { status: string }>;
    }>;
    const deletedEntry = rawEntries.find((e) => e.server.name === 'ac.inference.sh/inference');
    if (!deletedEntry) throw new Error('fixture missing ac.inference.sh/inference tombstone');
    // Seed the cache with an *active* twin of the same server, as if it had
    // been picked up before the registry tombstoned it.
    const activeTwin = JSON.parse(JSON.stringify(deletedEntry));
    activeTwin._meta['io.modelcontextprotocol.registry/official'].status = 'active';
    const storePath = join(dir, 'agora.db');
    const casDir = join(dir, 'cas');
    await refreshOfficialCache({
      fetcher: pageFetcher([activeTwin]),
      cacheDir: dir,
      storePath,
      casDir
    });
    expect(readSourceCache(dir, 'official').some((i) => i.id === 'ac.inference.sh/inference')).toBe(
      true
    );
    expect(
      readSourceStoreCache(storePath, casDir, 'official').some(
        (i) => i.id === 'ac.inference.sh/inference'
      )
    ).toBe(true);

    const delta = loadFixture('official-updated-since.json');
    const result = await refreshOfficialCache({
      fetcher: pageFetcher(delta.servers),
      cacheDir: dir,
      storePath,
      casDir
    });

    expect(result.pruned).toBe(1);
    expect(readSourceCache(dir, 'official').some((i) => i.id === 'ac.inference.sh/inference')).toBe(
      false
    );
    expect(
      readSourceStoreCache(storePath, casDir, 'official').some(
        (i) => i.id === 'ac.inference.sh/inference'
      )
    ).toBe(false);
  });

  test('a failed crawl reports a partial result and never throws', async () => {
    const result = await refreshOfficialCache({ fetcher: throwingFetcher(), cacheDir: dir });
    expect(result.error).toBeDefined();
    expect(result.total).toBe(0);
    // Nothing should have been written on a total failure.
    expect(readSourceCache(dir, 'official')).toEqual([]);
  });
});
