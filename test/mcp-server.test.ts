import { describe, test, expect } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgoraMcpServer } from '../src/cli/mcp-server';
import { writeCapabilityCache } from '../src/stack/capability-cache';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

function extractText(result: Record<string, unknown>): string {
  const contents = result.content as { type: string; text?: string }[];
  const text = contents?.find((c) => c.type === 'text');
  return text?.text ?? '';
}

async function createTestClient(opts?: Parameters<typeof createAgoraMcpServer>[0]) {
  const server = createAgoraMcpServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0' }, { capabilities: {} });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client };
}

describe('Agora MCP Server', () => {
  test('lists all 12 tools', async () => {
    const { client } = await createTestClient();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'acquire',
      'browse',
      'install_plan',
      'outdated',
      'scan',
      'search',
      'stack_capabilities',
      'stack_doctor',
      'stack_installed',
      'trending',
      'tutorial',
      'tutorials'
    ]);
  });

  test('search tool finds postgres MCP server', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'postgres' }
    });
    const text = extractText(result);
    expect(text).toContain('mcp-postgres');
  });

  test('search tool returns empty message for no matches', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'zzzznonexistent' }
    });
    const text = extractText(result);
    expect(text).toContain('No results found');
  });

  test('browse tool returns package details', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'mcp-github' }
    });
    const text = extractText(result);
    expect(text).toContain('@modelcontextprotocol/server-github');
  });

  test('browse tool returns workflow details', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'wf-tdd-cycle' }
    });
    const text = extractText(result);
    expect(text).toContain('TDD Development Cycle');
  });

  test('browse tool returns not found for unknown id', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'does-not-exist' }
    });
    const text = extractText(result);
    expect(text).toContain('not found');
  });

  test('trending tool returns items', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'trending',
      arguments: {}
    });
    const text = extractText(result);
    expect(text).toContain('Trending in Agora');
  });

  test('install_plan tool returns install instructions for a package', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'install_plan',
      arguments: { id: 'mcp-github' }
    });
    const text = extractText(result);
    expect(text).toContain('npm install');
  });

  test('install_plan tool returns workflow instructions', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'install_plan',
      arguments: { id: 'wf-tdd-cycle' }
    });
    const text = extractText(result);
    expect(text).toContain('agora use');
  });

  test('tutorials tool returns available tutorials', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorials',
      arguments: {}
    });
    const text = extractText(result);
    expect(text).toContain('tut-mcp-basics');
  });

  test('tutorial tool returns a specific step', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'tut-mcp-basics', step: 1 }
    });
    const text = extractText(result);
    expect(text).toContain('What is MCP');
  });

  test('tutorial tool shows completion for out-of-range step', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'tut-mcp-basics', step: 99 }
    });
    const text = extractText(result);
    expect(text).toContain('completed');
  });

  test('tutorial tool shows not found for unknown tutorial', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'does-not-exist' }
    });
    const text = extractText(result);
    expect(text).toContain('not found');
  });

  test('scan tool returns checks for a known item', async () => {
    // Inject a fetcher that always 200s so we never hit the network from tests.
    const fakeFetcher = async () =>
      ({
        status: 200,
        json: async () => ({ version: '1.0.0' })
      }) as unknown as Response;
    const { client } = await createTestClient({ scan: { fetcher: fakeFetcher } });

    const result = await client.callTool({
      name: 'scan',
      arguments: { id: 'mcp-github' }
    });
    const text = extractText(result);
    expect(text).toContain('Scan');
    expect(text).toContain('mcp-github');
    expect(text).toMatch(/\d+ pass · \d+ warning\(s\) · \d+ failure\(s\)/);
  });

  test('scan tool returns not found for unknown id', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'scan',
      arguments: { id: 'does-not-exist' }
    });
    const text = extractText(result);
    expect(text).toContain('not found');
  });

  test('acquire dry_run returns plan and does not write config', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-mcp-acquire-'));
    const configPath = join(temp, 'opencode.json');
    const fakeFetcher = async () =>
      ({
        status: 200,
        json: async () => ({ version: '1.0.0' })
      }) as unknown as Response;
    const { client } = await createTestClient({
      scan: { fetcher: fakeFetcher },
      stack: { cwd: temp, env: { HOME: temp } }
    });

    try {
      const result = await client.callTool({
        name: 'acquire',
        arguments: { id: 'mcp-postgres', configPath, dry_run: true }
      });
      const text = extractText(result);
      expect(text).toContain('Acquire dry run');
      expect(text).toContain('Scan');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('outdated tool returns per-package freshness using injected fetcher', async () => {
    const fakeFetcher = async () =>
      ({
        status: 200,
        json: async () => ({
          'dist-tags': { latest: '1.2.3' },
          time: { modified: new Date(Date.now() - 30 * 86400_000).toISOString() }
        })
      }) as unknown as Response;
    const { client } = await createTestClient({ outdated: { fetcher: fakeFetcher } });

    const result = await client.callTool({
      name: 'outdated',
      arguments: { packages: ['@scope/foo', '@scope/bar'] }
    });
    const text = extractText(result);
    expect(text).toContain('@scope/foo');
    expect(text).toContain('@scope/bar');
    expect(text).toMatch(/\d+ fresh · \d+ stale · \d+ unknown/);
  });
});

describe('Agora MCP Server — stack introspection tools', () => {
  function makeStackEnv() {
    const root = mkdtempSync(join(tmpdir(), 'agora-mcp-stack-'));
    const proj = join(root, 'proj');
    const home = join(root, 'home');
    const data = join(root, 'data');
    mkdirSync(proj, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(data, { recursive: true });
    // an opencode config with a resolvable + a missing-binary server
    writeFileSync(
      join(proj, 'opencode.json'),
      JSON.stringify({
        mcp: {
          faker: { type: 'local', command: ['node', '/tmp/x.js'] },
          broken: { type: 'local', command: ['definitely-not-a-real-binary-xyz'] }
        }
      })
    );
    return {
      root,
      stack: { env: { HOME: home, PATH: process.env.PATH }, cwd: proj, dataDir: data }
    };
  }

  test('stack_installed lists configured servers', async () => {
    const { root, stack } = makeStackEnv();
    try {
      const { client } = await createTestClient({ stack });
      const result = await client.callTool({ name: 'stack_installed', arguments: {} });
      const text = extractText(result);
      expect(text).toContain('faker');
      expect(text).toContain('broken');
      expect(text).toMatch(/server\(s\) configured/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stack_installed friendly text when nothing configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agora-mcp-empty-'));
    try {
      const { client } = await createTestClient({
        stack: { env: { HOME: join(root, 'h') }, cwd: join(root, 'c'), dataDir: join(root, 'd') }
      });
      const result = await client.callTool({ name: 'stack_installed', arguments: {} });
      expect(extractText(result)).toContain('No MCP servers configured');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stack_doctor reports a summary and flags the missing binary', async () => {
    const { root, stack } = makeStackEnv();
    try {
      const { client } = await createTestClient({ stack });
      const result = await client.callTool({ name: 'stack_doctor', arguments: {} });
      const text = extractText(result);
      expect(text).toMatch(/ok: \d+ {2}warn: \d+ {2}error: \d+/);
      expect(text).toContain('broken');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stack_capabilities lists and searches cached tools', async () => {
    const { root, stack } = makeStackEnv();
    try {
      writeCapabilityCache(stack.dataDir, [
        {
          key: 'faker@aaaa1111',
          name: 'faker',
          command: ['node', '/tmp/x.js'],
          serverInfo: { name: 'faker', version: '1.0' },
          tools: [
            { name: 'query_database', description: 'run a sql query' },
            { name: 'echo', description: 'echo text' }
          ],
          ok: true,
          probedAt: new Date().toISOString()
        }
      ]);
      const { client } = await createTestClient({ stack });

      const listed = extractText(
        await client.callTool({ name: 'stack_capabilities', arguments: {} })
      );
      expect(listed).toContain('query_database');
      expect(listed).toContain('echo');

      const searched = extractText(
        await client.callTool({ name: 'stack_capabilities', arguments: { query: 'database' } })
      );
      expect(searched).toContain('query_database');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stack_capabilities hints when the cache is empty', async () => {
    const { root, stack } = makeStackEnv();
    try {
      const { client } = await createTestClient({ stack });
      const text = extractText(
        await client.callTool({ name: 'stack_capabilities', arguments: {} })
      );
      expect(text).toContain('No capability data found');
      expect(text).toContain('agora doctor --probe');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
