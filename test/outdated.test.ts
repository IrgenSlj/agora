import { describe, expect, test } from 'bun:test';
import { checkOutdated } from '../src/outdated';

const NOW = new Date('2026-05-19T00:00:00Z');

function makeFetcher(responses: Record<string, { status: number; body?: unknown }>) {
  return async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        const body = response.body ? JSON.stringify(response.body) : '';
        return new Response(body, { status: response.status });
      }
    }
    throw new Error(`No mock for: ${url}`);
  };
}

function makeRegistryBody(opts: { version?: string; modified?: string | null }) {
  const body: Record<string, unknown> = {
    'dist-tags': { latest: opts.version ?? '1.0.0' }
  };
  if (opts.modified !== null) {
    body.time = { modified: opts.modified ?? '2026-05-01T00:00:00Z' };
  }
  return body;
}

function daysAgoIso(days: number): string {
  const d = new Date(NOW.getTime() - days * 86_400_000);
  return d.toISOString();
}

describe('checkOutdated', () => {
  test('empty package list returns empty entries and zeroed summary', async () => {
    const result = await checkOutdated([], { fetcher: makeFetcher({}), now: () => NOW });
    expect(result.entries).toHaveLength(0);
    expect(result.summary).toEqual({ fresh: 0, stale: 0, unknown: 0 });
  });

  test('single fresh package (modifiedAt 30d ago)', async () => {
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 200, body: makeRegistryBody({ version: '2.0.0', modified: daysAgoIso(30) }) }
    });
    const result = await checkOutdated(['my-pkg'], { fetcher, now: () => NOW });
    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0]!;
    expect(entry.pkg).toBe('my-pkg');
    expect(entry.latestVersion).toBe('2.0.0');
    expect(entry.status).toBe('fresh');
    expect(entry.ageDays).toBe(30);
    expect(entry.message).toContain('latest 2.0.0');
    expect(entry.message).toContain('30d ago');
    expect(result.summary.fresh).toBe(1);
    expect(result.summary.stale).toBe(0);
    expect(result.summary.unknown).toBe(0);
  });

  test('single stale package (modifiedAt 400d ago)', async () => {
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 200, body: makeRegistryBody({ version: '0.1.0', modified: daysAgoIso(400) }) }
    });
    const result = await checkOutdated(['old-pkg'], { fetcher, now: () => NOW });
    const entry = result.entries[0]!;
    expect(entry.status).toBe('stale');
    expect(entry.ageDays).toBe(400);
    expect(entry.message).toContain('latest 0.1.0');
    expect(entry.message).toContain('400d ago');
    expect(result.summary.stale).toBe(1);
    expect(result.summary.fresh).toBe(0);
  });

  test('exactly 365 days is fresh, 366 is stale', async () => {
    const fetcher365 = makeFetcher({
      'registry.npmjs.org': { status: 200, body: makeRegistryBody({ modified: daysAgoIso(365) }) }
    });
    const r365 = await checkOutdated(['pkg'], { fetcher: fetcher365, now: () => NOW });
    expect(r365.entries[0]!.status).toBe('fresh');

    const fetcher366 = makeFetcher({
      'registry.npmjs.org': { status: 200, body: makeRegistryBody({ modified: daysAgoIso(366) }) }
    });
    const r366 = await checkOutdated(['pkg'], { fetcher: fetcher366, now: () => NOW });
    expect(r366.entries[0]!.status).toBe('stale');
  });

  test('404 from registry: status unknown with not found message', async () => {
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 404 }
    });
    const result = await checkOutdated(['ghost-pkg'], { fetcher, now: () => NOW });
    const entry = result.entries[0]!;
    expect(entry.status).toBe('unknown');
    expect(entry.message).toBe('not found on npm');
    expect(entry.latestVersion).toBeNull();
    expect(result.summary.unknown).toBe(1);
  });

  test('network error: status unknown with network message', async () => {
    const fetcher = async () => { throw new Error('network failure'); };
    const result = await checkOutdated(['some-pkg'], { fetcher, now: () => NOW });
    const entry = result.entries[0]!;
    expect(entry.status).toBe('unknown');
    expect(entry.message).toContain('network');
    expect(result.summary.unknown).toBe(1);
  });

  test('non-200 non-404 status: status unknown with network message', async () => {
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 503 }
    });
    const result = await checkOutdated(['some-pkg'], { fetcher, now: () => NOW });
    const entry = result.entries[0]!;
    expect(entry.status).toBe('unknown');
    expect(entry.message).toContain('network');
  });

  test('missing time.modified: status unknown with publish date unknown message', async () => {
    const body = { 'dist-tags': { latest: '3.0.0' } };
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 200, body }
    });
    const result = await checkOutdated(['no-time-pkg'], { fetcher, now: () => NOW });
    const entry = result.entries[0]!;
    expect(entry.status).toBe('unknown');
    expect(entry.latestVersion).toBe('3.0.0');
    expect(entry.message).toContain('latest 3.0.0');
    expect(entry.message).toContain('publish date unknown');
    expect(result.summary.unknown).toBe(1);
  });

  test('multiple packages: order preserved, summary tallies correctly', async () => {
    const fetcher = makeFetcher({
      'npmjs.org/fresh-pkg': { status: 200, body: makeRegistryBody({ version: '1.0.0', modified: daysAgoIso(10) }) },
      'npmjs.org/stale-pkg': { status: 200, body: makeRegistryBody({ version: '0.5.0', modified: daysAgoIso(500) }) },
      'npmjs.org/ghost-pkg': { status: 404 }
    });
    const result = await checkOutdated(['fresh-pkg', 'stale-pkg', 'ghost-pkg'], { fetcher, now: () => NOW });
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]!.pkg).toBe('fresh-pkg');
    expect(result.entries[0]!.status).toBe('fresh');
    expect(result.entries[1]!.pkg).toBe('stale-pkg');
    expect(result.entries[1]!.status).toBe('stale');
    expect(result.entries[2]!.pkg).toBe('ghost-pkg');
    expect(result.entries[2]!.status).toBe('unknown');
    expect(result.summary).toEqual({ fresh: 1, stale: 1, unknown: 1 });
  });

  test('scoped name url encoding: @scope/name preserves @ and /', async () => {
    let capturedUrl = '';
    const fetcher = async (input: string | URL): Promise<Response> => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return new Response(JSON.stringify(makeRegistryBody({ modified: daysAgoIso(5) })), { status: 200 });
    };
    await checkOutdated(['@scope/name'], { fetcher, now: () => NOW });
    expect(capturedUrl).toContain('@scope/name');
    expect(capturedUrl).not.toContain('%40');
    expect(capturedUrl).not.toContain('%2F');
  });

  test('summary sums to total entries count', async () => {
    const fetcher = makeFetcher({
      'registry.npmjs.org': { status: 200, body: makeRegistryBody({ modified: daysAgoIso(100) }) }
    });
    const result = await checkOutdated(['a', 'b', 'c'], { fetcher, now: () => NOW });
    const { fresh, stale, unknown } = result.summary;
    expect(fresh + stale + unknown).toBe(result.entries.length);
  });
});
