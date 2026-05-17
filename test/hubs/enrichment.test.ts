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
  enrichHfItem,
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

describe('enrichHfItem()', () => {
  const LAST_MODIFIED = '2026-05-17T10:00:00.000Z';
  const README_TEXT = '# My HF Model\n\nThis model does text generation.';

  function makeHfFetcher(opts: {
    lastModified?: string;
    readmeText?: string;
    modelCardStatus?: number;
    readmeEndpoint?: 'models' | 'datasets' | 'spaces';
  } = {}): FetchLike {
    const lm = opts.lastModified ?? LAST_MODIFIED;
    const readme = opts.readmeText ?? README_TEXT;
    const readmeEndpoint = opts.readmeEndpoint ?? 'models';

    return async (url: string | URL, _init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('huggingface.co/api/models/')) {
        if (opts.modelCardStatus && opts.modelCardStatus !== 200) {
          return { ok: false, status: opts.modelCardStatus } as Response;
        }
        return {
          ok: true,
          json: async () => ({ lastModified: lm })
        } as Response;
      }
      if (urlStr.endsWith('/raw/main/README.md')) {
        const isModelsPath = urlStr.includes('/datasets/') === false && urlStr.includes('/spaces/') === false;
        const isDatasetsPath = urlStr.includes('/datasets/');
        const isSpacesPath = urlStr.includes('/spaces/');
        if (
          (readmeEndpoint === 'models' && isModelsPath) ||
          (readmeEndpoint === 'datasets' && isDatasetsPath) ||
          (readmeEndpoint === 'spaces' && isSpacesPath)
        ) {
          return {
            ok: true,
            text: async () => readme
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as Response;
      }
      return { ok: false, status: 404 } as Response;
    };
  }

  const fakeOpencode = async (_prompt: string) => 'Fake AI response';

  test('cache hit: same lastModified skips opencode and returns existing entry', async () => {
    const dir = makeTmpDir();
    try {
      const existing: EnrichmentEntry = {
        repoId: 'hf:owner/mymodel',
        commitSha: LAST_MODIFIED,
        description: 'Cached HF description',
        installHint: 'pip install mymodel',
        fetchedAt: '2026-05-17T00:00:00Z'
      };
      writeEnrichmentStore(dir, setEnrichment({}, existing));

      let opencodeCalled = false;
      const trackingOpencode = async (prompt: string) => {
        opencodeCalled = true;
        return fakeOpencode(prompt);
      };

      const fetcher = makeHfFetcher();
      const result = await enrichHfItem('owner/mymodel', dir, { fetcher, opencode: trackingOpencode });

      expect(result).not.toBeNull();
      expect(result!.repoId).toBe('hf:owner/mymodel');
      expect(result!.commitSha).toBe(LAST_MODIFIED);
      expect(result!.description).toBe('Cached HF description');
      expect(opencodeCalled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('cache miss: fetches metadata + README and writes new entry', async () => {
    const dir = makeTmpDir();
    try {
      const fetcher = makeHfFetcher();
      const result = await enrichHfItem('owner/mymodel', dir, { fetcher, opencode: fakeOpencode });

      expect(result).not.toBeNull();
      expect(result!.repoId).toBe('hf:owner/mymodel');
      expect(result!.commitSha).toBe(LAST_MODIFIED);
      expect(result!.description).toBe('Fake AI response');

      const store = readEnrichmentStore(dir);
      expect(store[`hf:owner/mymodel@${LAST_MODIFIED}`]).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test('404 on models README falls through to datasets', async () => {
    const dir = makeTmpDir();
    try {
      const fetcher = makeHfFetcher({ readmeEndpoint: 'datasets' });
      const result = await enrichHfItem('owner/mydataset', dir, { fetcher, opencode: fakeOpencode });

      expect(result).not.toBeNull();
      expect(result!.repoId).toBe('hf:owner/mydataset');
      expect(result!.commitSha).toBe(LAST_MODIFIED);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
