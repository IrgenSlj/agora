import { describe, expect, test } from 'vitest';
import {
  SKILLS_GITHUB_TOPICS,
  skillsGithubSource
} from '../../src/federation/sources/skills-github';
import type { RawGithubRepo } from '../../src/hubs/quality';
import type { FetchLike } from '../../src/retry';

function makeRepo(overrides: Partial<RawGithubRepo> = {}): RawGithubRepo {
  return {
    id: 1,
    full_name: 'owner/skill-repo',
    name: 'skill-repo',
    owner: { login: 'owner' },
    description: 'A valid agent skill repository',
    html_url: 'https://github.com/owner/skill-repo',
    stargazers_count: 100,
    forks_count: 10,
    pushed_at: '2026-04-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    license: { spdx_id: 'MIT' },
    topics: ['claude-skill', 'agent-skill'],
    default_branch: 'main',
    ...overrides
  };
}

function searchFetcher(repos: RawGithubRepo[]): { fetcher: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetcher: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ items: repos }), { status: 200 });
    }
  };
}

describe('skillsGithubSource.search()', () => {
  test('searches skill-specific GitHub topics and maps repos as skill items', async () => {
    const { fetcher, calls } = searchFetcher([makeRepo()]);

    const items = await skillsGithubSource.search('skill', {}, { fetcher });

    expect(calls.length).toBe(SKILLS_GITHUB_TOPICS.length);
    expect(calls.every((url) => url.includes('topic:'))).toBe(true);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.id).toBe('skill:owner/skill-repo');
    expect(item?.kind).toBe('package');
    expect(item?.category).toBe('skill');
    expect(item?.tags).toContain('agent-skill');
    expect(item?.provenance[0]?.source).toBe('skills-github');
  });

  test('respects opts.limit after query filtering', async () => {
    const { fetcher } = searchFetcher([
      makeRepo({ id: 1, full_name: 'owner/alpha-skill', name: 'alpha-skill' }),
      makeRepo({ id: 2, full_name: 'owner/beta-skill', name: 'beta-skill' })
    ]);

    const items = await skillsGithubSource.search('skill', { limit: 1 }, { fetcher });

    expect(items).toHaveLength(1);
  });
});

describe('skillsGithubSource.isEnabled()', () => {
  test('enabled by default and disabled by AGORA_OFFLINE=1', () => {
    expect(skillsGithubSource.isEnabled({})).toBe(true);
    expect(skillsGithubSource.isEnabled({ env: { AGORA_OFFLINE: '1' } })).toBe(false);
  });
});

describe('skillsGithubSource.fetchItem()', () => {
  test('resolves skill:owner/repo via a single-repo GET', async () => {
    const item = await skillsGithubSource.fetchItem('skill:owner/skill-repo', {
      fetcher: async () => new Response(JSON.stringify(makeRepo()), { status: 200 })
    });

    expect(item?.id).toBe('skill:owner/skill-repo');
    expect(item?.category).toBe('skill');
    expect(item?.provenance[0]?.source).toBe('skills-github');
  });

  test('returns null for non-repo refs and 404s', async () => {
    expect(
      await skillsGithubSource.fetchItem('not-a-repo', { fetcher: async () => new Response() })
    ).toBeNull();
    expect(
      await skillsGithubSource.fetchItem('skill:nope/nope', {
        fetcher: async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      })
    ).toBeNull();
  });
});
