import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glamaSource, GLAMA_BASE_URL, mapGlamaServer } from '../../src/federation/sources/glama';
import type { FetchLike } from '../../src/retry';

const FIXTURES_DIR = join(import.meta.dir, '../fixtures/federation');

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

describe('glamaSource.search() — genuine live-captured list shape (2026-07-04)', () => {
  test('maps servers into FederatedItems, never fabricating tools', async () => {
    const fixture = loadFixture('glama-search-postgres.json');
    const items = await glamaSource.search('postgres', {}, { fetcher: makeFetcher(fixture) });

    expect(items.length).toBe(3);

    const pg = items.find((i) => i.id === 'vallaksa/postgresql-mcp');
    expect(pg).toBeDefined();
    expect(pg!.kind).toBe('package');
    if (pg!.kind !== 'package') throw new Error('unreachable');
    expect(pg!.name).toBe('PostgreSQL MCP');
    expect(pg!.author).toBe('vallaksa');
    expect(pg!.repository).toBe('https://github.com/vallaksa/postgresql-mcp');
    expect(pg!.tags).toEqual(['hosting:remote-capable']);
    expect(pg!.tools).toBeUndefined(); // OQ-3: Glama has no per-tool schemas — never fabricated
    expect(pg!.provenance).toEqual([
      {
        source: 'glama',
        sourceUrl: 'https://glama.ai/mcp/servers/y5l0n5s474',
        fetchedAt: pg!.provenance[0]!.fetchedAt,
        verified: false // no `author:official` attribute on this sample
      }
    ]);
  });

  test('folds `author:official` into Provenance.verified and `hosting:*` into tags (genuine capture)', async () => {
    const fixture = loadFixture('glama-official-attribute.json');
    const items = await glamaSource.search('', {}, { fetcher: makeFetcher(fixture) });

    const official = items.find((i) => i.id === 'scavio-ai/arcade-scavio');
    expect(official).toBeDefined();
    expect(official!.provenance[0]!.verified).toBe(true);
    expect(official!.tags).toEqual(['hosting:remote-capable']);

    const nonOfficial = items.find((i) => i.name === 'toshi-mcp');
    expect(nonOfficial).toBeDefined();
    expect(nonOfficial!.provenance[0]!.verified).toBe(false);
    expect(nonOfficial!.tags).toEqual(['hosting:local-only']);
  });

  test('never throws — resolves to [] when the fetcher throws', async () => {
    const items = await glamaSource.search('postgres', {}, { fetcher: throwingFetcher() });
    expect(items).toEqual([]);
  });

  test('never throws — resolves to [] on a non-ok HTTP response', async () => {
    const items = await glamaSource.search('postgres', {}, { fetcher: makeFetcher({}, 500) });
    expect(items).toEqual([]);
  });

  test('defensive: a differently-shaped response degrades to no matches, never to "undefined/undefined" ids', async () => {
    const officialShaped = loadFixture('official-search-postgres.json');
    const items = await glamaSource.search(
      'postgres',
      {},
      { fetcher: makeFetcher(officialShaped) }
    );
    expect(items).toEqual([]);
  });
});

describe('glamaSource.isEnabled()', () => {
  test('enabled by default (no auth required)', () => {
    expect(glamaSource.isEnabled({})).toBe(true);
  });

  test('disabled when AGORA_OFFLINE=1', () => {
    expect(glamaSource.isEnabled({ env: { AGORA_OFFLINE: '1' } })).toBe(false);
  });
});

describe('glamaSource.fetchItem()', () => {
  test('resolves "{namespace}/{slug}" to its detail endpoint', async () => {
    const detail = loadFixture('glama-detail-vallaksa.json');
    const item = await glamaSource.fetchItem('vallaksa/postgresql-mcp', {
      fetcher: makeFetcher(detail)
    });
    expect(item?.id).toBe('vallaksa/postgresql-mcp');
    expect(item?.tools).toBeUndefined();
  });

  test('returns null on a non-ok response (e.g. 404 "Server not found")', async () => {
    const item = await glamaSource.fetchItem('nope/nope', {
      fetcher: makeFetcher({ error: { code: 'not_found', message: 'Server not found' } }, 404)
    });
    expect(item).toBeNull();
  });

  test('never throws — returns null when the fetcher throws', async () => {
    const item = await glamaSource.fetchItem('vallaksa/postgresql-mcp', {
      fetcher: throwingFetcher()
    });
    expect(item).toBeNull();
  });
});

describe('mapGlamaServer()', () => {
  test('is exported for direct mapper-level assertions', () => {
    const fetchedAt = '2026-07-04T00:00:00.000Z';
    const item = mapGlamaServer(
      {
        name: 'Example',
        namespace: 'acme',
        slug: 'example',
        description: 'desc',
        attributes: ['author:official', 'hosting:hybrid'],
        repository: { url: 'https://github.com/acme/example' },
        url: 'https://glama.ai/mcp/servers/xyz'
      },
      fetchedAt
    );
    expect(item.id).toBe('acme/example');
    expect(item.provenance[0]!.verified).toBe(true);
    if (item.kind !== 'package') throw new Error('unreachable');
    expect(item.tags).toEqual(['hosting:hybrid']);
  });
});

test('GLAMA_BASE_URL is the verified API host', () => {
  expect(GLAMA_BASE_URL).toBe('https://glama.ai/api/mcp/v1');
});
