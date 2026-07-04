import { describe, test, expect } from 'bun:test';
import { huggingfaceSource } from '../../src/federation/sources/huggingface';
import type { RawHfItem } from '../../src/hubs/huggingface';
import type { FetchLike } from '../../src/retry';

// Hand-modeled fixtures — matches the convention already established in
// test/hubs/huggingface.test.ts (RawHfItem literals), since this source is a
// thin FederatedItem-mapping wrapper around searchHuggingFace()/a single-item
// detail GET rather than an independent wire client.
function makeHfItem(overrides: Partial<RawHfItem> = {}): RawHfItem {
  return {
    id: 'owner/model',
    author: 'owner',
    downloads: 10000,
    likes: 100,
    tags: ['pytorch', 'transformers'],
    pipeline_tag: 'text-generation',
    library_name: 'transformers',
    createdAt: '2025-01-01T00:00:00Z',
    lastModified: '2026-04-01T00:00:00Z',
    private: false,
    ...overrides
  };
}

function searchFetcher(items: RawHfItem[]): FetchLike {
  return async () => new Response(JSON.stringify(items), { status: 200 });
}

function throwingFetcher(message = 'network unreachable'): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

const LLAMA = makeHfItem({ id: 'meta-llama/Llama-3.1-8B', author: 'meta-llama', downloads: 500000 });

describe('huggingfaceSource.search() — wraps searchHuggingFace()', () => {
  test('maps HubItem -> FederatedItem with huggingface provenance', async () => {
    const items = await huggingfaceSource.search('llama', {}, { fetcher: searchFetcher([LLAMA]) });

    expect(items.length).toBe(1);
    const item = items[0]!;
    expect(item.id).toBe('hf:meta-llama/Llama-3.1-8B');
    expect(item.kind).toBe('package');
    if (item.kind !== 'package') throw new Error('unreachable');
    expect(item.name).toBe('Llama-3.1-8B');
    expect(item.author).toBe('meta-llama');
    expect(item.installs).toBe(500000);
    expect(item.repository).toBe('https://huggingface.co/meta-llama/Llama-3.1-8B');
    expect(item.source).toBe('hf');
    expect(item.provenance).toEqual([
      {
        source: 'huggingface',
        sourceUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B',
        fetchedAt: item.provenance[0]!.fetchedAt
      }
    ]);
  });

  test('applies the query as a client-side name/description/tag filter (searchHuggingFace has no query param of its own)', async () => {
    const other = makeHfItem({ id: 'owner/unrelated-model', author: 'owner' });
    const items = await huggingfaceSource.search('llama', {}, {
      fetcher: searchFetcher([LLAMA, other])
    });
    expect(items.length).toBe(1);
    expect(items[0]!.id).toBe('hf:meta-llama/Llama-3.1-8B');
  });

  test('an empty query returns everything the quality gate lets through', async () => {
    const other = makeHfItem({ id: 'owner/other-model', author: 'owner' });
    const items = await huggingfaceSource.search('', {}, { fetcher: searchFetcher([LLAMA, other]) });
    expect(items.length).toBe(2);
  });

  test('respects opts.limit', async () => {
    const other = makeHfItem({ id: 'meta-llama/llama-two', author: 'meta-llama' });
    const items = await huggingfaceSource.search('llama', { limit: 1 }, {
      fetcher: searchFetcher([LLAMA, other])
    });
    expect(items.length).toBe(1);
  });

  // searchHuggingFace() retries each of its 5 sequential category requests
  // (maxRetries: 2, real non-signal-aware backoff) — headroom above bun's
  // default 5000ms in case of CI jitter (observed ~3.5-4s locally).
  test(
    'never throws — resolves to [] when the fetcher throws',
    async () => {
      const items = await huggingfaceSource.search('llama', {}, { fetcher: throwingFetcher() });
      expect(items).toEqual([]);
    },
    10000
  );
});

describe('huggingfaceSource.isEnabled()', () => {
  test('enabled by default (public API, no auth needed)', () => {
    expect(huggingfaceSource.isEnabled({})).toBe(true);
  });

  test('disabled when AGORA_OFFLINE=1', () => {
    expect(huggingfaceSource.isEnabled({ env: { AGORA_OFFLINE: '1' } })).toBe(false);
  });
});

describe('huggingfaceSource.fetchItem()', () => {
  function detailFetcher(item: RawHfItem | null, status = 200): FetchLike {
    return async () =>
      item
        ? new Response(JSON.stringify(item), { status })
        : new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }

  test('resolves "hf:owner/name" via the /api/models detail endpoint', async () => {
    const item = await huggingfaceSource.fetchItem('hf:meta-llama/Llama-3.1-8B', {
      fetcher: detailFetcher(LLAMA)
    });
    expect(item?.id).toBe('hf:meta-llama/Llama-3.1-8B');
    expect(item?.provenance[0]?.source).toBe('huggingface');
  });

  test('resolves a bare "owner/name" ref (no hf: prefix)', async () => {
    const item = await huggingfaceSource.fetchItem('meta-llama/Llama-3.1-8B', {
      fetcher: detailFetcher(LLAMA)
    });
    expect(item?.id).toBe('hf:meta-llama/Llama-3.1-8B');
  });

  test('falls back to /api/datasets then /api/spaces when /api/models 404s', async () => {
    let call = 0;
    const fetcher: FetchLike = async (input) => {
      call++;
      const url = String(input);
      if (url.includes('/api/spaces/')) {
        return new Response(JSON.stringify(LLAMA), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    };
    const item = await huggingfaceSource.fetchItem('meta-llama/Llama-3.1-8B', { fetcher });
    expect(call).toBe(3); // models (404) -> datasets (404) -> spaces (200)
    expect(item?.id).toBe('hf:meta-llama/Llama-3.1-8B');
  });

  test('returns null for a ref with no owner/name split', async () => {
    const item = await huggingfaceSource.fetchItem('no-slash-here', { fetcher: detailFetcher(null) });
    expect(item).toBeNull();
  });

  test('returns null when every endpoint 404s', async () => {
    const item = await huggingfaceSource.fetchItem('owner/nope', { fetcher: detailFetcher(null, 404) });
    expect(item).toBeNull();
  });

  test(
    'never throws — returns null when the fetcher throws',
    async () => {
      const item = await huggingfaceSource.fetchItem('meta-llama/Llama-3.1-8B', {
        fetcher: throwingFetcher()
      });
      expect(item).toBeNull();
    },
    // Real jittered retry backoff — generous budget so it never brushes the
    // default 5s timeout under full-suite load (matches the search sibling).
    15000
  );
});
