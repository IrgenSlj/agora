import { describe, expect, test } from 'vitest';
import { localSource } from '../../src/federation/adapters/local';

describe('localSource — the always-works offline source', () => {
  test('is always enabled (no network, no config)', () => {
    expect(localSource.isEnabled({})).toBe(true);
  });

  test('search() wraps MarketplaceItems with local provenance', async () => {
    const items = await localSource.search('github', { limit: 5 }, {});
    expect(items.length).toBeGreaterThan(0);

    const item = items[0]!;
    expect(item.provenance.length).toBe(1);
    expect(item.provenance[0]!.source).toBe('local');
    expect(typeof item.provenance[0]!.fetchedAt).toBe('string');
    expect(item.provenance[0]!.sourceUrl).toBeUndefined();
  });

  test('fetchItem() resolves a known bundled id', async () => {
    const item = await localSource.fetchItem('mcp-github', {});
    expect(item?.id).toBe('mcp-github');
    expect(item?.provenance[0]?.source).toBe('local');
  });

  test('fetchItem() returns null for an unknown id', async () => {
    const item = await localSource.fetchItem('does-not-exist-xyz', {});
    expect(item).toBeNull();
  });

  test('never throws on a nonsense query', async () => {
    const items = await localSource.search('☃️🚀 nonsense query 🌀', {}, {});
    expect(Array.isArray(items)).toBe(true);
  });
});
