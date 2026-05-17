import { describe, expect, test } from 'bun:test';
import { searchHuggingFace, type RawHfItem, type FetchLike } from '../../src/hubs/huggingface';
import type { HubItem } from '../../src/hubs/types';

const NOW = new Date('2026-05-17T00:00:00Z');

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

function makeFetcher(items: RawHfItem[]): FetchLike {
  return async (_url: string | URL, _init?: RequestInit) => {
    return {
      ok: true,
      json: async () => items
    } as Response;
  };
}

describe('searchHuggingFace()', () => {
  test('returns expected HubItem shape from fixture', async () => {
    const raw = makeHfItem({ id: 'meta-llama/Llama-2-7b', author: 'meta-llama' });
    const fetcher = makeFetcher([raw]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items.find((i) => i.id === 'hf:meta-llama/Llama-2-7b');
    expect(item).toBeDefined();
    expect(item!.source).toBe('hf');
    expect(item!.name).toBe('Llama-2-7b');
    expect(item!.author).toBe('meta-llama');
    expect(item!.pricing).toEqual({ kind: 'free' });
    expect(item!.category).toBe('workflow');
    expect(item!.version).toBe('main');
    expect(typeof item!.stars).toBe('number');
    expect(typeof item!.installs).toBe('number');
    expect(typeof item!.fetchedAt).toBe('string');
    expect(item!.repository).toBe('https://huggingface.co/meta-llama/Llama-2-7b');
    expect(item!.license).toBeNull();
  });

  test('deduplicates items with the same id across multiple queries', async () => {
    const raw = makeHfItem({ id: 'owner/shared-model', author: 'owner' });
    // Fetcher always returns the same item regardless of URL
    const fetcher = makeFetcher([raw]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    const ids = items.map((i) => i.id);
    const occurrences = ids.filter((id) => id === 'hf:owner/shared-model').length;
    expect(occurrences).toBe(1);
  });

  test('rejects private items', async () => {
    const privateItem = makeHfItem({ id: 'owner/private-model', author: 'owner', private: true });
    const publicItem = makeHfItem({ id: 'owner/public-model', author: 'owner', private: false });
    const fetcher = makeFetcher([privateItem, publicItem]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.some((i) => i.id === 'hf:owner/private-model')).toBe(false);
    expect(items.some((i) => i.id === 'hf:owner/public-model')).toBe(true);
  });

  test('rejects low-engagement items (downloads < 100 and likes < 5)', async () => {
    const lowItem = makeHfItem({
      id: 'owner/low-engagement',
      author: 'owner',
      downloads: 50,
      likes: 2
    });
    const highItem = makeHfItem({
      id: 'owner/high-downloads',
      author: 'owner',
      downloads: 200,
      likes: 2
    });
    const fetcher = makeFetcher([lowItem, highItem]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.some((i) => i.id === 'hf:owner/low-engagement')).toBe(false);
    expect(items.some((i) => i.id === 'hf:owner/high-downloads')).toBe(true);
  });

  test('passes item with low downloads but sufficient likes', async () => {
    const item = makeHfItem({
      id: 'owner/liked-model',
      author: 'owner',
      downloads: 10,
      likes: 50
    });
    const fetcher = makeFetcher([item]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.some((i) => i.id === 'hf:owner/liked-model')).toBe(true);
  });

  test('rejects items without an author', async () => {
    const noAuthor = makeHfItem({ id: 'owner/no-author', author: undefined });
    const fetcher = makeFetcher([noAuthor]);
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.some((i) => i.id === 'hf:owner/no-author')).toBe(false);
  });

  test('rejects items with id that has no slash', async () => {
    // Orphan items occasionally appear without a slash
    const orphan: RawHfItem = {
      id: 'orphanmodel',
      author: 'someone',
      downloads: 50000,
      likes: 999,
      private: false
    };
    const valid = makeHfItem({ id: 'owner/valid', author: 'owner' });
    let callCount = 0;
    const fetcher: FetchLike = async (_url, _init) => {
      callCount++;
      return {
        ok: true,
        json: async () => (callCount === 1 ? [orphan, valid] : [valid])
      } as Response;
    };
    const items = await searchHuggingFace({ fetcher, now: NOW });

    expect(items.some((i) => i.id === 'hf:orphanmodel')).toBe(false);
    expect(items.some((i) => i.id === 'hf:owner/valid')).toBe(true);
  });

  test('gracefully handles fetch error — skips query and continues', async () => {
    let callCount = 0;
    const goodItem = makeHfItem({ id: 'owner/good', author: 'owner' });
    const fetcher: FetchLike = async (_url, _init) => {
      callCount++;
      if (callCount === 1) throw new Error('network error');
      return {
        ok: true,
        json: async () => [goodItem]
      } as Response;
    };
    // Should not throw; returns items from subsequent queries
    const items = await searchHuggingFace({ fetcher, now: NOW });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('handles non-ok response gracefully', async () => {
    const fetcher: FetchLike = async (_url, _init) => {
      return { ok: false, status: 429 } as Response;
    };
    const items = await searchHuggingFace({ fetcher, now: NOW });
    expect(items).toEqual([]);
  });

  test('toHubItem: type-level conformance — result assignable to HubItem', async () => {
    const raw = makeHfItem({ id: 'bert-base/uncased', author: 'bert-base' });
    const fetcher = makeFetcher([raw]);
    const items: HubItem[] = await searchHuggingFace({ fetcher, now: NOW });
    // If this compiles, type conformance is verified
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('tags are deduped and include pipeline_tag and library_name', async () => {
    const raw = makeHfItem({
      id: 'owner/tagged',
      author: 'owner',
      tags: ['pytorch', 'text-generation'],
      pipeline_tag: 'text-generation',
      library_name: 'transformers'
    });
    const fetcher = makeFetcher([raw]);
    const items = await searchHuggingFace({ fetcher, now: NOW });
    const item = items.find((i) => i.id === 'hf:owner/tagged');
    expect(item).toBeDefined();
    // 'text-generation' appears in tags and pipeline_tag — should be deduped
    const tagOccurrences = item!.tags.filter((t) => t === 'text-generation').length;
    expect(tagOccurrences).toBe(1);
    expect(item!.tags).toContain('transformers');
  });

  test('sorts results by downloads descending', async () => {
    const low = makeHfItem({ id: 'owner/low', author: 'owner', downloads: 500, likes: 10 });
    const high = makeHfItem({ id: 'owner/high', author: 'owner', downloads: 99999, likes: 999 });
    const fetcher = makeFetcher([low, high]);
    const items = await searchHuggingFace({ fetcher, now: NOW });
    if (items.length >= 2) {
      expect(items[0].installs).toBeGreaterThanOrEqual(items[items.length - 1].installs);
    }
  });
});
