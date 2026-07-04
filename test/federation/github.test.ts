import { describe, test, expect } from 'bun:test';
import { githubSource } from '../../src/federation/sources/github';
import type { RawGithubRepo } from '../../src/hubs/quality';
import type { FetchLike } from '../../src/retry';

// Hand-modeled fixtures — matches the convention already established in
// test/hubs/github.test.ts (RawGithubRepo literals), since this source is a
// thin FederatedItem-mapping wrapper around searchGithub()/a single-repo GET
// rather than an independent wire client.
function makeRepo(overrides: Partial<RawGithubRepo> = {}): RawGithubRepo {
  return {
    id: 1,
    full_name: 'owner/repo',
    name: 'repo',
    owner: { login: 'owner' },
    description: 'A valid MCP server description',
    html_url: 'https://github.com/owner/repo',
    stargazers_count: 100,
    forks_count: 10,
    pushed_at: '2026-04-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    license: { spdx_id: 'MIT' },
    topics: ['mcp'],
    default_branch: 'main',
    ...overrides
  };
}

function searchFetcher(repos: RawGithubRepo[]): FetchLike {
  return async () => new Response(JSON.stringify({ items: repos }), { status: 200 });
}

function throwingFetcher(message = 'network unreachable'): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

const POSTGRES_REPO = makeRepo({
  id: 42,
  full_name: 'acme/postgres-mcp',
  name: 'postgres-mcp',
  owner: { login: 'acme' },
  description: 'An MCP server for postgres',
  html_url: 'https://github.com/acme/postgres-mcp',
  stargazers_count: 250,
  topics: ['mcp', 'postgres']
});

describe('githubSource.search() — wraps searchGithub()', () => {
  test('maps HubItem -> FederatedItem with github provenance', async () => {
    const items = await githubSource.search('postgres', {}, { fetcher: searchFetcher([POSTGRES_REPO]) });

    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.id).toBe('gh:acme/postgres-mcp');
    expect(item.kind).toBe('package');
    if (item.kind !== 'package') throw new Error('unreachable');
    expect(item.name).toBe('postgres-mcp');
    expect(item.author).toBe('acme');
    expect(item.stars).toBe(250);
    expect(item.repository).toBe('https://github.com/acme/postgres-mcp');
    expect(item.source).toBe('github');
    expect(item.provenance).toEqual([
      {
        source: 'github',
        sourceUrl: 'https://github.com/acme/postgres-mcp',
        fetchedAt: item.provenance[0]!.fetchedAt
      }
    ]);
  });

  test('applies the query as a client-side name/description/tag filter (searchGithub has no query param of its own)', async () => {
    const other = makeRepo({ id: 2, full_name: 'owner/unrelated-tool', name: 'unrelated-tool' });
    const items = await githubSource.search('postgres', {}, {
      fetcher: searchFetcher([POSTGRES_REPO, other])
    });
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe('gh:acme/postgres-mcp');
  });

  test('an empty query returns everything the quality gate lets through', async () => {
    const other = makeRepo({ id: 2, full_name: 'owner/unrelated-tool', name: 'unrelated-tool' });
    const items = await githubSource.search('', {}, { fetcher: searchFetcher([POSTGRES_REPO, other]) });
    expect(items.length).toBe(2);
  });

  test('respects opts.limit', async () => {
    const other = makeRepo({ id: 2, full_name: 'owner/postgres-two', name: 'postgres-two' });
    const items = await githubSource.search('postgres', { limit: 1 }, {
      fetcher: searchFetcher([POSTGRES_REPO, other])
    });
    expect(items.length).toBe(1);
  });

  // searchGithub() retries each of its ~8 sequential topic requests
  // (maxRetries: 2, real non-signal-aware backoff) — a fetcher that always
  // throws genuinely takes several seconds to exhaust every topic. Headroom
  // above bun's default 5000ms test timeout instead of racing it.
  test(
    'never throws — resolves to [] when the fetcher throws',
    async () => {
      const items = await githubSource.search('postgres', {}, { fetcher: throwingFetcher() });
      expect(items).toEqual([]);
    },
    15000
  );
});

describe('githubSource.isEnabled()', () => {
  test('enabled by default (searchGithub works unauthenticated)', () => {
    expect(githubSource.isEnabled({})).toBe(true);
  });

  test('disabled when AGORA_OFFLINE=1', () => {
    expect(githubSource.isEnabled({ env: { AGORA_OFFLINE: '1' } })).toBe(false);
  });
});

describe('githubSource.fetchItem()', () => {
  function detailFetcher(repo: RawGithubRepo | null, status = 200): FetchLike {
    return async () =>
      repo
        ? new Response(JSON.stringify(repo), { status })
        : new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  }

  test('resolves "gh:owner/repo" via a single-repo GET, reusing toHubItem()', async () => {
    const item = await githubSource.fetchItem('gh:acme/postgres-mcp', {
      fetcher: detailFetcher(POSTGRES_REPO)
    });
    expect(item?.id).toBe('gh:acme/postgres-mcp');
    expect(item?.provenance[0]?.source).toBe('github');
  });

  test('resolves a bare "owner/repo" ref (no gh: prefix)', async () => {
    const item = await githubSource.fetchItem('acme/postgres-mcp', {
      fetcher: detailFetcher(POSTGRES_REPO)
    });
    expect(item?.id).toBe('gh:acme/postgres-mcp');
  });

  test('returns null for a ref that is not a repo shape ("owner/repo")', async () => {
    const item = await githubSource.fetchItem('not-a-repo-ref', { fetcher: detailFetcher(null) });
    expect(item).toBeNull();
  });

  test('returns null on 404', async () => {
    const item = await githubSource.fetchItem('gh:nope/nope', { fetcher: detailFetcher(null, 404) });
    expect(item).toBeNull();
  });

  test(
    'never throws — returns null when the fetcher throws',
    async () => {
      const item = await githubSource.fetchItem('gh:acme/postgres-mcp', { fetcher: throwingFetcher() });
      expect(item).toBeNull();
    },
    // fetchWithRetry does real (jittered) backoff sleeps between retries; give
    // this the same generous budget as the search sibling so it never brushes
    // the default 5s timeout under full-suite load (was an intermittent flake).
    15000
  );
});
