import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { githubSource } from '../../src/federation/sources/github';
import { glamaSource } from '../../src/federation/sources/glama';
import { huggingfaceSource } from '../../src/federation/sources/huggingface';
import { localSource } from '../../src/federation/sources/local';
import { officialSource } from '../../src/federation/sources/official';
import { pulseMcpSource } from '../../src/federation/sources/pulsemcp';
import { skillsGithubSource } from '../../src/federation/sources/skills-github';
import { smitherySource } from '../../src/federation/sources/smithery';
import type {
  FederatedItem,
  FederationEnv,
  RegistrySource,
  SourceId
} from '../../src/federation/types';
import type { RawHfItem } from '../../src/hubs/huggingface';
import type { RawGithubRepo } from '../../src/hubs/quality';
import type { FetchLike } from '../../src/retry';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/federation');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function jsonFetcher(body: unknown): FetchLike {
  return async () => new Response(JSON.stringify(body), { status: 200 });
}

function repo(overrides: Partial<RawGithubRepo> = {}): RawGithubRepo {
  return {
    id: 1,
    full_name: 'owner/postgres-mcp',
    name: 'postgres-mcp',
    owner: { login: 'owner' },
    description: 'An MCP server for postgres',
    html_url: 'https://github.com/owner/postgres-mcp',
    stargazers_count: 100,
    forks_count: 10,
    pushed_at: '2026-04-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    license: { spdx_id: 'MIT' },
    topics: ['mcp', 'postgres'],
    default_branch: 'main',
    ...overrides
  };
}

function hfItem(overrides: Partial<RawHfItem> = {}): RawHfItem {
  return {
    id: 'meta-llama/Llama-3.1-8B',
    author: 'meta-llama',
    downloads: 500000,
    likes: 100,
    tags: ['transformers', 'text-generation'],
    pipeline_tag: 'text-generation',
    library_name: 'transformers',
    createdAt: '2025-01-01T00:00:00Z',
    lastModified: '2026-04-01T00:00:00Z',
    private: false,
    ...overrides
  };
}

function pulseEntry() {
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
        status: 'active'
      }
    }
  };
}

function smitheryFetcher(): FetchLike {
  const search = fixture('smithery-search-postgres.json');
  const neonDetail = fixture('smithery-detail-neon.json');
  return async (input) => {
    const url = new URL(input);
    if (url.pathname === '/servers') return new Response(JSON.stringify(search), { status: 200 });
    if (url.pathname === '/servers/neon') {
      return new Response(JSON.stringify(neonDetail), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'Namespace not found' }), { status: 404 });
  };
}

interface ContractCase {
  source: RegistrySource;
  query: string;
  env?: FederationEnv['env'];
  fetcher?: FetchLike;
  minItems?: number;
}

const CONTRACT_CASES: ContractCase[] = [
  {
    source: officialSource,
    query: 'postgres',
    fetcher: jsonFetcher(fixture('official-search-postgres.json'))
  },
  {
    source: glamaSource,
    query: 'postgres',
    fetcher: jsonFetcher(fixture('glama-search-postgres.json'))
  },
  {
    source: pulseMcpSource,
    query: 'filesystem',
    env: {
      AGORA_PULSEMCP_API_KEY: 'pulse-key',
      AGORA_PULSEMCP_TENANT_ID: 'tenant-a'
    },
    fetcher: jsonFetcher({ servers: [pulseEntry()], metadata: { count: 1 } })
  },
  {
    source: skillsGithubSource,
    query: 'skill',
    fetcher: jsonFetcher({
      items: [
        repo({
          full_name: 'owner/reviewer-skill',
          name: 'reviewer-skill',
          description: 'A valid agent skill repository',
          topics: ['agent-skill', 'claude-skill']
        })
      ]
    })
  },
  {
    source: smitherySource,
    query: 'postgres',
    env: { AGORA_ENABLE_SMITHERY: '1' },
    fetcher: smitheryFetcher()
  },
  {
    source: githubSource,
    query: 'postgres',
    fetcher: jsonFetcher({ items: [repo()] })
  },
  {
    source: huggingfaceSource,
    query: 'llama',
    env: { AGORA_ENABLE_HUGGINGFACE: '1' },
    fetcher: jsonFetcher([hfItem()])
  },
  {
    source: localSource,
    query: 'github'
  }
];

function expectContractItems(source: SourceId, items: FederatedItem[], minItems = 1): void {
  expect(items.length).toBeGreaterThanOrEqual(minItems);
  for (const item of items) {
    expect(item.id).toBeTruthy();
    expect(item.name).toBeTruthy();
    expect(item.kind).toBeTruthy();
    expect(item.category).toBeTruthy();
    expect(item.provenance.length).toBeGreaterThan(0);
    expect(item.provenance.every((p) => p.source === source)).toBe(true);
  }
}

describe('federation adapter contract', () => {
  test.each(
    CONTRACT_CASES
  )('$source.id normalizes recorded upstream data without live network', async ({
    source,
    query,
    env,
    fetcher,
    minItems
  }) => {
    const federationEnv: FederationEnv = { env, fetcher };

    expect(source.isEnabled(federationEnv)).toBe(true);
    const items = await source.search(query, { limit: 5 }, federationEnv);

    expectContractItems(source.id, items, minItems);
  });
});
