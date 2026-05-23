import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCapabilityCache, type ServerCapabilities } from '../../src/stack/capability-cache';
import { runCli } from '../../src/cli/app';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-capabilities-test-'));
}

function makeIo(cwd: string, extraEnv?: Record<string, string | undefined>) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
      env: { HOME: cwd, ...extraEnv },
      cwd
    },
    out: () => out.join(''),
    err: () => err.join('')
  };
}

const POSTGRES_ENTRY: ServerCapabilities = {
  key: 'postgres@aabb0001',
  name: 'postgres',
  command: ['npx', '@mcp/postgres'],
  serverInfo: { name: 'postgres-mcp', version: '1.2.3' },
  tools: [
    { name: 'query', description: 'Execute a SQL query against the database' },
    { name: 'list_tables', description: 'List all tables in the database schema' }
  ],
  ok: true,
  probedAt: new Date().toISOString()
};

const GITHUB_ENTRY: ServerCapabilities = {
  key: 'github@aabb0002',
  name: 'github',
  command: ['npx', '@mcp/github'],
  serverInfo: { name: 'github-mcp', version: '2.0.0' },
  tools: [
    { name: 'create_issue', description: 'Create a new issue in a GitHub repository' },
    { name: 'search_repos', description: 'Search GitHub repositories by keyword' }
  ],
  ok: true,
  probedAt: new Date().toISOString()
};

describe('agora capabilities — empty cache', () => {
  test('shows friendly probe/try hints, exits 0', async () => {
    const dir = makeTmp();
    try {
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`], io);
      expect(code).toBe(0);
      expect(out()).toMatch(/No capability data found/);
      expect(out()).toMatch(/agora doctor --probe/);
      expect(out()).toMatch(/agora try/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('empty cache --json returns documented shape, exits 0', async () => {
    const dir = makeTmp();
    try {
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`, '--json'], io);
      expect(code).toBe(0);
      const result = JSON.parse(out());
      expect(result).toMatchObject({
        query: null,
        server: null,
        results: [],
        summary: { tools: 0, servers: 0 }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora capabilities — list mode (no query)', () => {
  test('lists all tools grouped by server; summary correct', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`], io);
      expect(code).toBe(0);
      const text = out();
      // Both server headers present
      expect(text).toContain('postgres');
      expect(text).toContain('github');
      // Tools listed
      expect(text).toContain('query');
      expect(text).toContain('list_tables');
      expect(text).toContain('create_issue');
      expect(text).toContain('search_repos');
      // Summary
      expect(text).toMatch(/4 tool\(s\) across 2 server\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('servers sorted alphabetically (github before postgres)', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      await runCli(['capabilities', `--dataDir=${dir}`], io);
      const text = out();
      const githubPos = text.indexOf('github');
      const postgresPos = text.indexOf('postgres');
      expect(githubPos).toBeLessThan(postgresPos);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json list mode returns documented shape without score', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`, '--json'], io);
      expect(code).toBe(0);
      const result = JSON.parse(out());
      expect(result.query).toBeNull();
      expect(result.server).toBeNull();
      expect(result.summary.tools).toBe(4);
      expect(result.summary.servers).toBe(2);
      expect(result.results).toHaveLength(4);
      // No score field in list mode
      for (const r of result.results) {
        expect(r).not.toHaveProperty('score');
        expect(r).toHaveProperty('server');
        expect(r).toHaveProperty('name');
        expect(r).toHaveProperty('description');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora capabilities — query mode (BM25)', () => {
  test('query "database" ranks postgres tools first / includes them', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', 'database', `--dataDir=${dir}`], io);
      expect(code).toBe(0);
      const text = out();
      // postgres tools should appear
      expect(text).toContain('query');
      expect(text).toContain('list_tables');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('query "sql" returns postgres tools (synonym expansion)', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', 'sql', `--dataDir=${dir}`], io);
      expect(code).toBe(0);
      const text = out();
      expect(text).toContain('query');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('irrelevant query "zzz-nonsense" yields empty results', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', 'zzz-nonsense', `--dataDir=${dir}`], io);
      expect(code).toBe(0);
      const text = out();
      expect(text).not.toContain('query');
      expect(text).not.toContain('create_issue');
      expect(text).toMatch(/No tools matched/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json query mode includes score field', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', 'database', `--dataDir=${dir}`, '--json'], io);
      expect(code).toBe(0);
      const result = JSON.parse(out());
      expect(result.query).toBe('database');
      expect(result.server).toBeNull();
      // Results should have score
      for (const r of result.results) {
        expect(r).toHaveProperty('score');
        expect(typeof r.score).toBe('number');
      }
      // Summary counts correct
      expect(result.summary.tools).toBe(result.results.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora capabilities — --server filter', () => {
  test('--server github shows only github tools', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`, '--server', 'github'], io);
      expect(code).toBe(0);
      const text = out();
      expect(text).toContain('create_issue');
      expect(text).toContain('search_repos');
      expect(text).not.toContain('list_tables');
      expect(text).toMatch(/2 tool\(s\) across 1 server\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--server filter is case-insensitive', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(['capabilities', `--dataDir=${dir}`, '--server', 'POSTGRES'], io);
      expect(code).toBe(0);
      const text = out();
      expect(text).toContain('query');
      expect(text).toContain('list_tables');
      expect(text).not.toContain('create_issue');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--server with no match shows friendly note', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(
        ['capabilities', `--dataDir=${dir}`, '--server', 'zzz-no-such'],
        io
      );
      expect(code).toBe(0);
      const text = out();
      expect(text).toMatch(/No tools found for server/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--server --json returns only that server tools without score', async () => {
    const dir = makeTmp();
    try {
      writeCapabilityCache(dir, [POSTGRES_ENTRY, GITHUB_ENTRY]);
      const { io, out } = makeIo(dir);
      const code = await runCli(
        ['capabilities', `--dataDir=${dir}`, '--server', 'github', '--json'],
        io
      );
      expect(code).toBe(0);
      const result = JSON.parse(out());
      expect(result.server).toBe('github');
      expect(result.results.every((r: { server: string }) => r.server === 'github')).toBe(true);
      expect(result.results).toHaveLength(2);
      for (const r of result.results) {
        expect(r).not.toHaveProperty('score');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agora capabilities — ok:false entries excluded', () => {
  test('entry with ok:false is excluded from tool list', async () => {
    const dir = makeTmp();
    try {
      const badEntry: ServerCapabilities = {
        ...POSTGRES_ENTRY,
        key: 'bad@ffffffff',
        name: 'bad-server',
        tools: [{ name: 'secret_tool', description: 'should not appear' }],
        ok: false
      };
      writeCapabilityCache(dir, [GITHUB_ENTRY, badEntry]);
      const { io, out } = makeIo(dir);
      await runCli(['capabilities', `--dataDir=${dir}`], io);
      const text = out();
      expect(text).not.toContain('secret_tool');
      expect(text).not.toContain('bad-server');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
