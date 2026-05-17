import { describe, expect, test } from 'bun:test';
import { searchGithub, type FetchLike } from '../../src/hubs/github';
import type { RawGithubRepo } from '../../src/hubs/quality';

const NOW = new Date('2026-05-17T00:00:00Z');

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

const REPO_A: RawGithubRepo = makeRepo({
  id: 1,
  full_name: 'owner/repo-a',
  name: 'repo-a',
  stars: 200
} as any);
const REPO_B: RawGithubRepo = makeRepo({
  id: 2,
  full_name: 'owner/repo-b',
  name: 'repo-b',
  stargazers_count: 50
});
const REPO_ARCHIVED: RawGithubRepo = makeRepo({
  id: 3,
  full_name: 'owner/archived',
  name: 'archived',
  archived: true
});

function makeFetcher(repos: RawGithubRepo[]): FetchLike {
  return async (_url: string | URL, _init?: RequestInit) => {
    return {
      ok: true,
      json: async () => ({ items: repos })
    } as Response;
  };
}

describe('searchGithub()', () => {
  test('filters out archived repos', async () => {
    const fetcher = makeFetcher([REPO_A, REPO_ARCHIVED]);
    const items = await searchGithub({ fetcher, topics: ['mcp'], now: NOW });
    expect(items.some((i) => i.id === 'gh:owner/archived')).toBe(false);
    expect(items.some((i) => i.id === 'gh:owner/repo-a')).toBe(true);
  });

  test('deduplicates repos that appear in multiple topic results', async () => {
    // Both topics return REPO_A — should only appear once
    let callCount = 0;
    const fetcher: FetchLike = async (_url, _init) => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ items: [REPO_A] })
      } as Response;
    };
    const items = await searchGithub({
      fetcher,
      topics: ['mcp', 'model-context-protocol'],
      now: NOW
    });
    expect(callCount).toBe(2);
    const ids = items.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.filter((id) => id === 'gh:owner/repo-a').length).toBe(1);
  });

  test('returns correct HubItem shape', async () => {
    const fetcher = makeFetcher([REPO_B]);
    const items = await searchGithub({ fetcher, topics: ['mcp'], now: NOW });
    expect(items.length).toBe(1);
    const item = items[0];
    expect(item.id).toBe('gh:owner/repo-b');
    expect(item.source).toBe('github');
    expect(item.pricing).toEqual({ kind: 'free' });
    expect(typeof item.stars).toBe('number');
    expect(typeof item.fetchedAt).toBe('string');
  });

  test('gracefully handles fetch error — skips topic and continues', async () => {
    let callCount = 0;
    const fetcher: FetchLike = async (_url, _init) => {
      callCount++;
      if (callCount === 1) throw new Error('network error');
      return {
        ok: true,
        json: async () => ({ items: [REPO_B] })
      } as Response;
    };
    // Should not throw; returns items from second topic
    const items = await searchGithub({ fetcher, topics: ['mcp', 'opencode'], now: NOW });
    expect(callCount).toBe(2);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  test('sorts results by stars descending', async () => {
    const repoHigh = makeRepo({
      id: 10,
      full_name: 'owner/high',
      name: 'high',
      stargazers_count: 999
    });
    const repoLow = makeRepo({ id: 11, full_name: 'owner/low', name: 'low', stargazers_count: 11 });
    const fetcher = makeFetcher([repoLow, repoHigh]);
    const items = await searchGithub({ fetcher, topics: ['mcp'], now: NOW });
    expect(items[0].stars).toBeGreaterThanOrEqual(items[items.length - 1].stars);
  });
});
