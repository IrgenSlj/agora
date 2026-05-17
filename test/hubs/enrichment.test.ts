import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enrichmentPath,
  readEnrichmentStore,
  writeEnrichmentStore,
  getEnrichment,
  setEnrichment,
  fetchRepoMetadata,
  enrichItem,
  type EnrichmentEntry,
  type EnrichmentStore,
  type FetchLike
} from '../../src/hubs/enrichment';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'agora-enrichment-test-'));
}

describe('enrichmentPath()', () => {
  test('returns expected path', () => {
    expect(enrichmentPath('/tmp/agora')).toBe('/tmp/agora/hubs-enrichment.json');
  });
});

describe('readEnrichmentStore() / writeEnrichmentStore()', () => {
  test('round-trip: write then read returns same store', () => {
    const dir = makeTmpDir();
    try {
      const store: EnrichmentStore = {
        'owner/repo@abc123': {
          repoId: 'owner/repo',
          commitSha: 'abc123',
          description: 'A test repo',
          installHint: 'npm install test-pkg',
          fetchedAt: '2026-05-17T00:00:00Z'
        }
      };
      writeEnrichmentStore(dir, store);
      const loaded = readEnrichmentStore(dir);
      expect(loaded).toEqual(store);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('returns empty object when file does not exist', () => {
    const dir = makeTmpDir();
    try {
      const store = readEnrichmentStore(dir);
      expect(store).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('returns empty object when file is corrupt JSON', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, 'hubs-enrichment.json'), 'not-json', 'utf8');
      const store = readEnrichmentStore(dir);
      expect(store).toEqual({});
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('getEnrichment() / setEnrichment()', () => {
  test('setEnrichment keys by repoId@commitSha', () => {
    const entry: EnrichmentEntry = {
      repoId: 'owner/repo',
      commitSha: 'deadbeef',
      description: 'desc',
      installHint: 'npm i foo',
      fetchedAt: '2026-05-17T00:00:00Z'
    };
    const store = setEnrichment({}, entry);
    expect(store['owner/repo@deadbeef']).toEqual(entry);
  });

  test('getEnrichment returns entry for matching repoId+sha', () => {
    const entry: EnrichmentEntry = {
      repoId: 'owner/repo',
      commitSha: 'deadbeef',
      fetchedAt: '2026-05-17T00:00:00Z'
    };
    const store = setEnrichment({}, entry);
    expect(getEnrichment(store, 'owner/repo', 'deadbeef')).toEqual(entry);
  });

  test('getEnrichment returns undefined for wrong sha', () => {
    const entry: EnrichmentEntry = {
      repoId: 'owner/repo',
      commitSha: 'deadbeef',
      fetchedAt: '2026-05-17T00:00:00Z'
    };
    const store = setEnrichment({}, entry);
    expect(getEnrichment(store, 'owner/repo', 'otherhash')).toBeUndefined();
  });
});

describe('fetchRepoMetadata()', () => {
  const README_CONTENT = '# My Repo\n\nThis is the readme.';
  const README_B64 = Buffer.from(README_CONTENT).toString('base64');

  function makeMetaFetcher(sha: string, readmeContent: string): FetchLike {
    return async (url: string | URL, _init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/commits')) {
        return {
          ok: true,
          json: async () => [{ sha }]
        } as Response;
      }
      if (urlStr.includes('/readme')) {
        return {
          ok: true,
          json: async () => ({
            content: Buffer.from(readmeContent).toString('base64'),
            encoding: 'base64'
          })
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    };
  }

  test('happy path: returns commitSha and decoded readme', async () => {
    const fetcher = makeMetaFetcher('abc123sha', README_CONTENT);
    const result = await fetchRepoMetadata('owner/repo', { fetcher });
    expect(result).not.toBeNull();
    expect(result!.commitSha).toBe('abc123sha');
    expect(result!.readme).toBe(README_CONTENT);
  });

  test('returns null when commits endpoint returns 404', async () => {
    const fetcher: FetchLike = async (_url, _init) => {
      return { ok: false, status: 404 } as Response;
    };
    const result = await fetchRepoMetadata('owner/repo', { fetcher });
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    const fetcher: FetchLike = async (_url, _init) => {
      throw new Error('network failure');
    };
    const result = await fetchRepoMetadata('owner/repo', { fetcher });
    expect(result).toBeNull();
  });

  test('returns null when readme endpoint returns non-200', async () => {
    const fetcher: FetchLike = async (url, _init) => {
      const urlStr = url.toString();
      if (urlStr.includes('/commits')) {
        return { ok: true, json: async () => [{ sha: 'abc' }] } as Response;
      }
      return { ok: false, status: 404 } as Response;
    };
    const result = await fetchRepoMetadata('owner/repo', { fetcher });
    expect(result).toBeNull();
  });
});

describe('enrichItem() cache hit', () => {
  const CACHED_SHA = 'cachedsha';

  function makeCommitsFetcher(sha: string): FetchLike {
    return async (url: string | URL, _init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/commits')) {
        return {
          ok: true,
          json: async () => [{ sha }]
        } as Response;
      }
      // readme should NOT be fetched on cache hit
      if (urlStr.includes('/readme')) {
        throw new Error('readme should not be fetched on cache hit');
      }
      return { ok: false, status: 404 } as Response;
    };
  }

  test('returns cached entry without calling opencode when sha matches', async () => {
    const dir = makeTmpDir();
    try {
      const entry: EnrichmentEntry = {
        repoId: 'owner/repo',
        commitSha: CACHED_SHA,
        description: 'Cached description',
        installHint: 'npm install cached',
        fetchedAt: '2026-05-17T00:00:00Z'
      };
      writeEnrichmentStore(dir, setEnrichment({}, entry));

      const fetcher = makeCommitsFetcher(CACHED_SHA);
      const result = await enrichItem('owner/repo', dir, { fetcher });

      expect(result).not.toBeNull();
      expect(result!.commitSha).toBe(CACHED_SHA);
      expect(result!.description).toBe('Cached description');
      expect(result!.installHint).toBe('npm install cached');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('returns null when metadata fetch fails and no cache exists', async () => {
    const dir = makeTmpDir();
    try {
      const fetcher: FetchLike = async (_url, _init) => {
        throw new Error('network failure');
      };
      const result = await enrichItem('owner/nonexistent', dir, { fetcher });
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
