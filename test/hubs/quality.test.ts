import { describe, expect, test } from 'bun:test';
import { passes, categorize, toHubItem, type RawGithubRepo } from '../../src/hubs/quality';

const NOW = new Date('2026-05-17T00:00:00Z');

function makeRepo(overrides: Partial<RawGithubRepo> = {}): RawGithubRepo {
  return {
    id: 1,
    full_name: 'owner/repo',
    name: 'repo',
    owner: { login: 'owner' },
    description: 'A valid MCP server description',
    html_url: 'https://github.com/owner/repo',
    stargazers_count: 50,
    forks_count: 5,
    pushed_at: '2026-04-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    archived: false,
    license: { spdx_id: 'MIT' },
    topics: ['mcp'],
    default_branch: 'main',
    ...overrides
  };
}

describe('passes()', () => {
  test('happy path — returns true for valid repo', () => {
    expect(passes(makeRepo(), NOW)).toBe(true);
  });

  test('archived repo is rejected', () => {
    expect(passes(makeRepo({ archived: true }), NOW)).toBe(false);
  });

  test('fewer than 10 stars is rejected', () => {
    expect(passes(makeRepo({ stargazers_count: 9 }), NOW)).toBe(false);
  });

  test('exactly 10 stars passes', () => {
    expect(passes(makeRepo({ stargazers_count: 10 }), NOW)).toBe(true);
  });

  test('null description is rejected', () => {
    expect(passes(makeRepo({ description: null }), NOW)).toBe(false);
  });

  test('short description (< 10 chars) is rejected', () => {
    expect(passes(makeRepo({ description: 'Too short' }), NOW)).toBe(false);
  });

  test('no license is rejected', () => {
    expect(passes(makeRepo({ license: null }), NOW)).toBe(false);
  });

  test('license with null spdx_id is rejected', () => {
    expect(passes(makeRepo({ license: { spdx_id: null } }), NOW)).toBe(false);
  });

  test('pushed more than 365 days ago is rejected', () => {
    const oldDate = new Date(NOW.getTime() - 366 * 24 * 60 * 60 * 1000).toISOString();
    expect(passes(makeRepo({ pushed_at: oldDate }), NOW)).toBe(false);
  });

  test('pushed exactly 364 days ago passes', () => {
    const recentDate = new Date(NOW.getTime() - 364 * 24 * 60 * 60 * 1000).toISOString();
    expect(passes(makeRepo({ pushed_at: recentDate }), NOW)).toBe(true);
  });
});

describe('categorize()', () => {
  test('topic "mcp" maps to mcp', () => {
    expect(categorize(makeRepo({ topics: ['mcp'] }))).toBe('mcp');
  });

  test('topic "model-context-protocol" maps to mcp', () => {
    expect(categorize(makeRepo({ topics: ['model-context-protocol'] }))).toBe('mcp');
  });

  test('description containing "mcp server" maps to mcp', () => {
    expect(categorize(makeRepo({ topics: [], description: 'A great MCP server for you' }))).toBe(
      'mcp'
    );
  });

  test('topic "claude-skill" maps to skill', () => {
    expect(
      categorize(
        makeRepo({ topics: ['claude-skill'], description: 'A useful skill for developers' })
      )
    ).toBe('skill');
  });

  test('topic "prompt" maps to prompt', () => {
    expect(
      categorize(
        makeRepo({ topics: ['prompt'], description: 'A useful prompt template for developers' })
      )
    ).toBe('prompt');
  });

  test('no matching topic maps to workflow', () => {
    expect(
      categorize(makeRepo({ topics: ['random-tool'], description: 'Some tool for developers' }))
    ).toBe('workflow');
  });
});

describe('toHubItem()', () => {
  test('produces correct shape', () => {
    const repo = makeRepo();
    const item = toHubItem(repo, NOW.toISOString());
    expect(item.id).toBe('gh:owner/repo');
    expect(item.source).toBe('github');
    expect(item.pricing).toEqual({ kind: 'free' });
    expect(item.stars).toBe(50);
    expect(item.installs).toBe(50); // proxy
    expect(item.license).toBe('MIT');
    expect(item.tags).toContain('MIT');
    expect(item.tags).toContain('mcp');
  });
});
