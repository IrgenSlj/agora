import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SMITHERY_BASE_URL, smitherySource } from '../../src/federation/sources/smithery';
import type { FetchLike } from '../../src/retry';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/federation');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/** Routes a list call (`/servers?...`) to `searchBody` and a detail call
 * (`/servers/{qualifiedName}`) to whichever `detailBodies` entry matches —
 * mirrors Smithery's own routing so one fetcher can stand in for both
 * endpoints, exactly like the live client does. */
function makeFetcher(searchBody: unknown, detailBodies: Record<string, unknown> = {}): FetchLike {
  return async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname === '/servers') {
      return new Response(JSON.stringify(searchBody), { status: 200 });
    }
    const qualifiedName = decodeURIComponent(url.pathname.replace(/^\/servers\//, ''));
    const body = detailBodies[qualifiedName];
    if (!body)
      return new Response(JSON.stringify({ error: 'Namespace not found' }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

function throwingFetcher(message = 'network unreachable'): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

describe('smitherySource.search() — genuine live-captured list + detail shape (2026-07-04)', () => {
  test('maps summaries and enriches each with tools from the detail endpoint', async () => {
    const search = loadFixture('smithery-search-postgres.json');
    const neonDetail = loadFixture('smithery-detail-neon.json');
    const items = await smitherySource.search(
      'postgres',
      {},
      { fetcher: makeFetcher(search, { neon: neonDetail }) }
    );

    expect(items.length).toBe(3);

    const neon = items.find((i) => i.id === 'neon');
    expect(neon).toBeDefined();
    expect(neon!.kind).toBe('package');
    if (neon!.kind !== 'package') throw new Error('unreachable');
    expect(neon!.name).toBe('Neon');
    expect(neon!.author).toBe('neon');
    expect(neon!.stars).toBe(1024); // useCount proxy
    expect(neon!.installs).toBe(1024);
    expect(neon!.provenance).toEqual([
      {
        source: 'smithery',
        sourceUrl: 'https://smithery.ai/servers/neon',
        fetchedAt: neon!.provenance[0]!.fetchedAt,
        verified: true
      }
    ]);
    // The detail endpoint's tools[] flows straight into FederatedItem.tools —
    // this is what makes the P2 gate's annotation_hints / observed_permissions
    // checks see real Smithery tool schemas.
    expect(neon!.tools?.length).toBe(2);
    expect(neon!.tools?.[0]).toEqual({
      name: 'list_projects',
      description: expect.stringContaining('Lists the first 10 Neon projects'),
      inputSchema: expect.any(Object),
      annotations: undefined
    });

    // A qualifiedName with a namespace/slug pair (no detail fixture provided
    // for it here) stays a bare summary — enrichment degrades per-item, not
    // for the whole page.
    const thinair = items.find((i) => i.id === 'thinair/data');
    expect(thinair).toBeDefined();
    expect(thinair!.tools).toBeUndefined();
  });

  test('sets `repository` only when `homepage` is a real github.com URL (genuine field values, from a live q=slack sample) — this is what lets a Smithery listing merge with the same server found via official/github', async () => {
    const search = {
      servers: [
        {
          id: 'd9c2f98a-ad68-47cd-8035-31300f3bd03b',
          qualifiedName: 'node2flow/slack',
          namespace: 'node2flow',
          slug: 'slack',
          displayName: 'Slack',
          description: 'MCP server for Slack Web API',
          verified: false,
          useCount: 96,
          homepage: 'https://github.com/node2flow-th/slack-mcp-community',
          createdAt: '2026-02-13T13:38:25.739Z'
        },
        {
          id: 'a21f1117-31e4-4147-8d30-a5f0d21075d4',
          qualifiedName: 'neon',
          namespace: 'neon',
          slug: '',
          displayName: 'Neon',
          description: 'Manage PostgreSQL projects',
          verified: true,
          useCount: 1024,
          homepage: 'https://smithery.ai/servers/neon', // self-link, not a repo
          createdAt: '2026-01-29T06:26:32.660Z'
        }
      ],
      pagination: { currentPage: 1, pageSize: 2, totalPages: 1, totalCount: 2 }
    };
    const items = await smitherySource.search('slack', {}, { fetcher: makeFetcher(search) });

    const slack = items.find((i) => i.id === 'node2flow/slack');
    if (slack?.kind !== 'package') throw new Error('unreachable');
    expect(slack.repository).toBe('https://github.com/node2flow-th/slack-mcp-community');

    const neon = items.find((i) => i.id === 'neon');
    if (neon?.kind !== 'package') throw new Error('unreachable');
    expect(neon.repository).toBeUndefined();
  });

  test('never throws — resolves to [] when the fetcher throws', async () => {
    const items = await smitherySource.search('postgres', {}, { fetcher: throwingFetcher() });
    expect(items).toEqual([]);
  });

  test('never throws — resolves to [] on a non-ok HTTP response (e.g. pageSize > 100)', async () => {
    // Live-verified: Smithery HTTP 400s a pageSize over 100 rather than
    // clamping server-side — the client-side clamp in fetchSmitheryPage()
    // should make this unreachable in practice, but search() must still
    // degrade honestly if it ever happens.
    const badRequestFetcher: FetchLike = async () =>
      new Response(JSON.stringify({ success: false, error: 'too_big' }), { status: 400 });
    const items = await smitherySource.search('postgres', {}, { fetcher: badRequestFetcher });
    expect(items).toEqual([]);
  });

  test('defensive: a differently-shaped response (e.g. another source sharing the DI fetcher in a test) degrades to no matches, never to undefined-keyed items', async () => {
    // Reuses the official registry's own fixture shape — same top-level
    // `servers` key, entirely different item shape (`{server, _meta}` vs
    // `{qualifiedName, ...}`).
    const officialShaped = loadFixture('official-search-postgres.json');
    const items = await smitherySource.search(
      'postgres',
      {},
      { fetcher: makeFetcher(officialShaped) }
    );
    expect(items).toEqual([]);
  });
});

describe('smitherySource.isEnabled()', () => {
  test('disabled by default as a non-canonical source', () => {
    expect(smitherySource.isEnabled({})).toBe(false);
  });

  test('enabled by the shared or source-specific opt-in flags', () => {
    expect(smitherySource.isEnabled({ env: { AGORA_ENABLE_NONCANONICAL_SOURCES: '1' } })).toBe(
      true
    );
    expect(smitherySource.isEnabled({ env: { AGORA_ENABLE_SMITHERY: 'true' } })).toBe(true);
    expect(smitherySource.isEnabled({ env: { AGORA_NONCANONICAL_SOURCES: 'smithery' } })).toBe(
      true
    );
  });

  test('disabled when AGORA_OFFLINE=1 even with an opt-in flag', () => {
    expect(
      smitherySource.isEnabled({
        env: { AGORA_OFFLINE: '1', AGORA_ENABLE_NONCANONICAL_SOURCES: '1' }
      })
    ).toBe(false);
  });
});

describe('smitherySource.fetchItem()', () => {
  test('resolves a qualifiedName with a `/` in it (namespace/slug) to its detail + tools', async () => {
    const thinairDetail = loadFixture('smithery-detail-thinair-data.json');
    const item = await smitherySource.fetchItem('thinair/data', {
      fetcher: makeFetcher({ servers: [] }, { 'thinair/data': thinairDetail })
    });
    expect(item?.id).toBe('thinair/data');
    expect(item?.tools?.length).toBe(1);
    expect(item?.tools?.[0]?.name).toBe('query_sql');
  });

  test('returns null on 404 ("Namespace not found")', async () => {
    const item = await smitherySource.fetchItem('nope', { fetcher: makeFetcher({ servers: [] }) });
    expect(item).toBeNull();
  });

  test('never throws — returns null when the fetcher throws', async () => {
    const item = await smitherySource.fetchItem('neon', { fetcher: throwingFetcher() });
    expect(item).toBeNull();
  });

  test('annotations flow through when present (HAND-MODELED — no live example exists; see fixture note)', async () => {
    const annotated = loadFixture('smithery-detail-hand-modeled-annotations.json');
    const item = await smitherySource.fetchItem('example/hand-modeled-annotations', {
      fetcher: makeFetcher({ servers: [] }, { 'example/hand-modeled-annotations': annotated })
    });
    expect(item?.tools?.length).toBe(2);
    expect(item?.tools?.[1]).toEqual({
      name: 'delete_database',
      description: 'Permanently delete a database.',
      inputSchema: expect.any(Object),
      annotations: { destructiveHint: true, readOnlyHint: false, openWorldHint: true }
    });
  });
});

test('SMITHERY_BASE_URL is the verified registry host', () => {
  expect(SMITHERY_BASE_URL).toBe('https://registry.smithery.ai');
});
