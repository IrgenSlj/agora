import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OFFICIAL_BASE_URL, officialSource } from '../../src/federation/sources/official';
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

describe('officialSource.search() — official → FederatedItem mapping', () => {
  test('maps a recorded registry page into FederatedItems with honest provenance', async () => {
    const fixture = loadFixture('official-search-postgres.json');
    const items = await officialSource.search('postgres', {}, { fetcher: makeFetcher(fixture) });

    expect(items.length).toBe(5);

    const waystation = items.find((i) => i.id === 'ai.waystation/postgres');
    expect(waystation).toBeDefined();
    expect(waystation!.kind).toBe('package');
    if (waystation!.kind !== 'package') throw new Error('unreachable');
    expect(waystation!.name).toBe('ai.waystation/postgres');
    expect(waystation!.author).toBe('ai.waystation');
    expect(waystation!.description).toBe(
      'Connect to your PostgreSQL database to query data and schemas.'
    );
    expect(waystation!.version).toBe('0.3.1');
    expect(waystation!.category).toBe('mcp');
    expect(waystation!.tags).toEqual([]);
    expect(waystation!.stars).toBe(0);
    expect(waystation!.installs).toBe(0);
    expect(waystation!.createdAt).toBe('2025-09-09T14:46:09.489652Z');
    expect(waystation!.repository).toBe('https://github.com/waystation-ai/mcp');
    expect(waystation!.npmPackage).toBeUndefined();
    expect(waystation!.officialStatus).toBe('active');
    expect(waystation!.serverJson?.remotes?.[0]).toEqual({
      type: 'streamable-http',
      url: 'https://waystation.ai/postgres/mcp'
    });
    expect(waystation!.provenance).toEqual([
      {
        source: 'official',
        sourceUrl: `${OFFICIAL_BASE_URL}/v0.1/servers/${encodeURIComponent('ai.waystation/postgres')}/versions`,
        fetchedAt: waystation!.provenance[0]!.fetchedAt,
        verified: true
      }
    ]);

    // npm-packaged entry: repository + npmPackage derive from the server object.
    const npmItem = items.find((i) => i.id === 'capital.hove/read-only-local-postgres-mcp-server');
    expect(npmItem).toBeDefined();
    if (npmItem!.kind !== 'package') throw new Error('unreachable');
    expect(npmItem!.npmPackage).toBe('@hovecapital/read-only-postgres-mcp-server');
    expect(npmItem!.repository).toBe(
      'https://github.com/hovecapital/read-only-local-postgres-mcp-server'
    );
  });

  test('preserves deleted and deprecated official statuses (tombstones included)', async () => {
    const fixture = loadFixture('official-updated-since.json');
    const items = await officialSource.search('', { limit: 50 }, { fetcher: makeFetcher(fixture) });

    expect(items.find((i) => i.id === 'ac.inference.sh/inference')?.officialStatus).toBe('deleted');
    expect(items.find((i) => i.id === 'ai.agenticshelf/graffeo')?.officialStatus).toBe(
      'deprecated'
    );
    expect(
      items.find((i) => i.id === 'capital.hove/read-only-local-postgres-mcp-server')?.officialStatus
    ).toBe('active');
  });

  test('never throws — resolves to [] when the fetcher throws', async () => {
    const items = await officialSource.search('postgres', {}, { fetcher: throwingFetcher() });
    expect(items).toEqual([]);
  });

  test('never throws — resolves to [] on a non-ok HTTP response', async () => {
    const items = await officialSource.search(
      'postgres',
      {},
      { fetcher: makeFetcher({ error: 'boom' }, 500) }
    );
    expect(items).toEqual([]);
  });
});

describe('officialSource.isEnabled()', () => {
  test('enabled by default (no auth required for reads)', () => {
    expect(officialSource.isEnabled({})).toBe(true);
  });

  test('disabled when AGORA_OFFLINE=1', () => {
    expect(officialSource.isEnabled({ env: { AGORA_OFFLINE: '1' } })).toBe(false);
  });
});

describe('officialSource.fetchItem()', () => {
  test('resolves the isLatest version from the /versions detail endpoint', async () => {
    const fixture = {
      servers: [
        {
          server: { name: 'io.github.x/y', description: 'v2', version: '2.0.0' },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'active',
              isLatest: true,
              publishedAt: '2026-01-01T00:00:00Z'
            }
          }
        },
        {
          server: { name: 'io.github.x/y', description: 'v1', version: '1.0.0' },
          _meta: {
            'io.modelcontextprotocol.registry/official': {
              status: 'active',
              isLatest: false,
              publishedAt: '2025-01-01T00:00:00Z'
            }
          }
        }
      ]
    };
    const item = await officialSource.fetchItem('io.github.x/y', { fetcher: makeFetcher(fixture) });
    expect(item?.version).toBe('2.0.0');
  });

  test('returns null when the registry has no such server', async () => {
    const item = await officialSource.fetchItem('nope', { fetcher: makeFetcher({}, 404) });
    expect(item).toBeNull();
  });

  test('never throws — returns null when the fetcher throws', async () => {
    const item = await officialSource.fetchItem('nope', { fetcher: throwingFetcher() });
    expect(item).toBeNull();
  });
});
