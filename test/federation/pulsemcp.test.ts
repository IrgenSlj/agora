import { describe, expect, test } from 'vitest';
import {
  fetchPulseMcpPage,
  PULSEMCP_BASE_URL,
  pulseMcpSource
} from '../../src/federation/sources/pulsemcp';
import type { FetchLike } from '../../src/retry';

const AUTH_ENV = {
  AGORA_PULSEMCP_API_KEY: 'pulse-key',
  AGORA_PULSEMCP_TENANT_ID: 'tenant-a'
};

function pulseEntry(status: string = 'active') {
  return {
    server: {
      name: 'io.github.modelcontextprotocol/filesystem',
      title: 'Filesystem Server',
      description: 'Secure filesystem operations',
      version: '1.2.0',
      repository: {
        url: 'https://github.com/modelcontextprotocol/servers',
        source: 'github'
      },
      packages: [
        {
          registryType: 'npm',
          identifier: '@modelcontextprotocol/server-filesystem',
          version: '1.2.0'
        }
      ]
    },
    _meta: {
      'com.pulsemcp/server': {
        visitorsEstimateLastFourWeeks: 12500,
        isOfficial: true
      },
      'com.pulsemcp/server-version': {
        status
      }
    }
  };
}

function captureFetcher(body: unknown, status = 200): { fetcher: FetchLike; calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetcher: async (input, init) => {
      calls.push(new Request(input, init));
      return new Response(JSON.stringify(body), { status });
    }
  };
}

describe('pulseMcpSource', () => {
  test('is disabled unless partner credentials are present', () => {
    expect(pulseMcpSource.isEnabled({})).toBe(false);
    expect(pulseMcpSource.isEnabled({ env: { ...AUTH_ENV, AGORA_OFFLINE: '1' } })).toBe(false);
    expect(pulseMcpSource.isEnabled({ env: AUTH_ENV })).toBe(true);
  });

  test('search sends partner headers, maps provenance, and skips deleted entries', async () => {
    const { fetcher, calls } = captureFetcher({
      servers: [pulseEntry('active'), pulseEntry('deleted')],
      metadata: { count: 2 }
    });

    const items = await fetchPulseMcpPage(
      { search: 'filesystem', limit: 500, version: 'latest' },
      {},
      { env: AUTH_ENV, fetcher }
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('io.github.modelcontextprotocol/filesystem');
    expect(items[0]?.installs).toBe(12500);
    expect(items[0]?.provenance).toEqual([
      {
        source: 'pulsemcp',
        sourceUrl: `${PULSEMCP_BASE_URL}/v0.1/servers/${encodeURIComponent('io.github.modelcontextprotocol/filesystem')}/versions/latest`,
        fetchedAt: items[0]?.provenance[0]?.fetchedAt,
        verified: true
      }
    ]);

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('search')).toBe('filesystem');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('version')).toBe('latest');
    expect(calls[0]?.headers.get('X-API-Key')).toBe('pulse-key');
    expect(calls[0]?.headers.get('X-Tenant-ID')).toBe('tenant-a');
  });

  test('source search degrades to [] when credentials are absent', async () => {
    const { fetcher } = captureFetcher({ servers: [pulseEntry()] });

    const items = await pulseMcpSource.search('filesystem', {}, { fetcher });

    expect(items).toEqual([]);
  });

  test('fetchItem calls the latest-version detail endpoint', async () => {
    const { fetcher, calls } = captureFetcher(pulseEntry());

    const item = await pulseMcpSource.fetchItem('io.github.modelcontextprotocol/filesystem', {
      env: AUTH_ENV,
      fetcher
    });

    expect(item?.provenance[0]?.source).toBe('pulsemcp');
    expect(calls[0]?.url).toBe(
      `${PULSEMCP_BASE_URL}/v0.1/servers/${encodeURIComponent('io.github.modelcontextprotocol/filesystem')}/versions/latest`
    );
  });
});
