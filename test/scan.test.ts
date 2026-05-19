import { describe, expect, test } from 'bun:test';
import { scanItem } from '../src/scan';
import type { PackageMarketplaceItem, WorkflowMarketplaceItem } from '../src/marketplace';

function makePackage(overrides: Partial<PackageMarketplaceItem> = {}): PackageMarketplaceItem {
  return {
    kind: 'package',
    id: 'test-pkg',
    name: 'Test Package',
    description: 'A test package',
    author: 'tester',
    version: '1.0.0',
    category: 'mcp',
    tags: ['test'],
    stars: 10,
    installs: 100,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides
  };
}

function makeWorkflow(overrides: Partial<WorkflowMarketplaceItem> = {}): WorkflowMarketplaceItem {
  return {
    kind: 'workflow',
    id: 'wf-test',
    name: 'Test Workflow',
    description: 'A test workflow',
    author: 'tester',
    prompt: 'Do something',
    tags: ['test'],
    stars: 5,
    forks: 2,
    installs: 2,
    category: 'workflow',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides
  };
}

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

// ── permissions_declared ───────────────────────────────────────────────────

describe('permissions_declared', () => {
  test('pass when permissions are declared', async () => {
    const item = makePackage({ permissions: { fs: ['./**/*'], net: ['example.com'] } });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permissions_declared')!;
    expect(check.status).toBe('pass');
    expect(check.message).toContain('fs');
    expect(check.message).toContain('net');
  });

  test('warn when no permissions declared', async () => {
    const item = makePackage({ permissions: undefined });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permissions_declared')!;
    expect(check.status).toBe('warn');
    expect(check.message).toBe('no permissions manifest declared');
  });
});

// ── permission_consistency ─────────────────────────────────────────────────

describe('permission_consistency', () => {
  test('warn for git-clone without exec', async () => {
    const item = makePackage({
      repository: 'https://github.com/owner/repo',
      source: 'github',
      npmPackage: undefined,
      permissions: { fs: ['./**/*'] }
    });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permission_consistency')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('git-clone');
  });

  test('pass for git-clone with exec declared', async () => {
    const item = makePackage({
      repository: 'https://github.com/owner/repo',
      source: 'github',
      npmPackage: undefined,
      permissions: { exec: ['git'] }
    });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permission_consistency')!;
    expect(check.status).toBe('pass');
  });

  test('warn for mcp-config-patch with npmPackage and no exec', async () => {
    const item = makePackage({
      npmPackage: 'some-mcp-server',
      permissions: { net: ['api.example.com'] }
    });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permission_consistency')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('npx');
  });

  test('pass for mcp-config-patch with exec declared', async () => {
    const item = makePackage({
      npmPackage: 'some-mcp-server',
      permissions: { exec: ['npx'] }
    });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'permission_consistency')!;
    expect(check.status).toBe('pass');
  });
});

// ── repo_reachable ─────────────────────────────────────────────────────────

describe('repo_reachable', () => {
  test('pass on 200', async () => {
    const item = makePackage({ repository: 'https://github.com/owner/repo' });
    const fetcher = makeFetcher({ 'api.github.com': { status: 200, body: { full_name: 'owner/repo' } } });
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'repo_reachable')!;
    expect(check.status).toBe('pass');
    expect(check.message).toContain('github.com/owner/repo');
  });

  test('fail on 404', async () => {
    const item = makePackage({ repository: 'https://github.com/owner/repo' });
    const fetcher = makeFetcher({ 'api.github.com': { status: 404 } });
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'repo_reachable')!;
    expect(check.status).toBe('fail');
    expect(check.message).toBe('repo not found');
  });

  test('warn on 403 (rate limited)', async () => {
    const item = makePackage({ repository: 'https://github.com/owner/repo' });
    const fetcher = makeFetcher({ 'api.github.com': { status: 403 } });
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'repo_reachable')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('rate limited');
  });

  test('warn on network error', async () => {
    const item = makePackage({ repository: 'https://github.com/owner/repo' });
    const fetcher = async () => { throw new Error('network failure'); };
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'repo_reachable')!;
    expect(check.status).toBe('warn');
  });

  test('pass (skipped) for non-github repo', async () => {
    const item = makePackage({ repository: 'https://gitlab.com/owner/repo' });
    const fetcher = makeFetcher({});
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'repo_reachable')!;
    expect(check.status).toBe('pass');
    expect(check.message).toContain('non-github');
  });
});

// ── npm_exists ─────────────────────────────────────────────────────────────

describe('npm_exists', () => {
  test('pass on 200 with version', async () => {
    const item = makePackage({ npmPackage: 'my-pkg' });
    const fetcher = makeFetcher({ 'registry.npmjs.org': { status: 200, body: { version: '2.3.4' } } });
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'npm_exists')!;
    expect(check.status).toBe('pass');
    expect(check.message).toBe('my-pkg@2.3.4');
  });

  test('fail on 404', async () => {
    const item = makePackage({ npmPackage: 'nonexistent-pkg' });
    const fetcher = makeFetcher({ 'registry.npmjs.org': { status: 404 } });
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'npm_exists')!;
    expect(check.status).toBe('fail');
    expect(check.message).toBe('package not found on npm');
  });

  test('warn on network error', async () => {
    const item = makePackage({ npmPackage: 'some-pkg' });
    const fetcher = async () => { throw new Error('timeout'); };
    const result = await scanItem(item, { fetcher });
    const check = result.checks.find((c) => c.name === 'npm_exists')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('network');
  });
});

// ── recently_active ────────────────────────────────────────────────────────

describe('recently_active', () => {
  test('pass when pushed within 365 days', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const item = makePackage({ pushedAt: '2025-12-01T00:00:00Z' });
    const result = await scanItem(item, { fetcher: makeFetcher({}), now: () => now });
    const check = result.checks.find((c) => c.name === 'recently_active')!;
    expect(check.status).toBe('pass');
    expect(check.message).toContain('d ago');
  });

  test('warn when pushed more than 365 days ago', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const item = makePackage({ pushedAt: '2024-01-01T00:00:00Z' });
    const result = await scanItem(item, { fetcher: makeFetcher({}), now: () => now });
    const check = result.checks.find((c) => c.name === 'recently_active')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('unmaintained');
  });
});

// ── flag_count_low ─────────────────────────────────────────────────────────

describe('flag_count_low', () => {
  test('pass when 0 flags', async () => {
    const item = makePackage({ flagCount: 0 });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'flag_count_low')!;
    expect(check.status).toBe('pass');
    expect(check.message).toBe('0 flags');
  });

  test('warn when 5 flags', async () => {
    const item = makePackage({ flagCount: 5 });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'flag_count_low')!;
    expect(check.status).toBe('warn');
    expect(check.message).toContain('under review threshold');
  });

  test('fail when 10+ flags', async () => {
    const item = makePackage({ flagCount: 10 });
    const result = await scanItem(item, { fetcher: makeFetcher({}) });
    const check = result.checks.find((c) => c.name === 'flag_count_low')!;
    expect(check.status).toBe('fail');
    expect(check.message).toContain('auto-hide');
  });
});

// ── workflow scan ──────────────────────────────────────────────────────────

describe('workflow scan', () => {
  test('returns workflow_kind + flag_count_low only', async () => {
    const item = makeWorkflow();
    const result = await scanItem(item);
    expect(result.itemKind).toBe('workflow');
    expect(result.checks.length).toBe(2);
    expect(result.checks[0].name).toBe('workflow_kind');
    expect(result.checks[0].status).toBe('pass');
    expect(result.checks[1].name).toBe('flag_count_low');
  });

  test('workflow flag_count_low pass when no flags', async () => {
    const item = makeWorkflow();
    const result = await scanItem(item);
    const check = result.checks.find((c) => c.name === 'flag_count_low')!;
    expect(check.status).toBe('pass');
    expect(check.message).toBe('0 flags');
  });
});

// ── summary counts ─────────────────────────────────────────────────────────

describe('summary counts', () => {
  test('summary adds up to total checks for package', async () => {
    const item = makePackage({ permissions: { net: ['example.com'] }, npmPackage: 'my-pkg' });
    const fetcher = makeFetcher({ 'registry.npmjs.org': { status: 200, body: { version: '1.0.0' } } });
    const result = await scanItem(item, { fetcher });
    const total = result.summary.pass + result.summary.warn + result.summary.fail;
    expect(total).toBe(result.checks.length);
  });

  test('summary adds up for workflow', async () => {
    const item = makeWorkflow();
    const result = await scanItem(item);
    const total = result.summary.pass + result.summary.warn + result.summary.fail;
    expect(total).toBe(result.checks.length);
  });
});
