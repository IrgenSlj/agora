import { describe, test, expect } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgoraMcpServer } from '../src/cli/mcp-server';
import { writeCapabilityCache } from '../src/stack/capability-cache';
import { manifestPath, writeManifest, type StackManifest } from '../src/stack/manifest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

function extractJson(result: Record<string, unknown>): any {
  const contents = result.content as { type: string; text?: string }[];
  const text = contents?.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

async function createTestClient(opts?: Parameters<typeof createAgoraMcpServer>[0]) {
  const server = createAgoraMcpServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '1.0' }, { capabilities: {} });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return { server, client };
}

// The `agora_search`/`agora_browse` tools federate the official MCP registry
// with the local catalog, so they need a DI fetcher to stay hermetic — an
// empty official response leaves the assertions resting entirely on the
// bundled catalog.
const emptyOfficialFetcher = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ servers: [], metadata: { count: 0 } })
  }) as unknown as Response;

describe('Agora MCP Server — tool surface', () => {
  test('exposes exactly the 5 consolidated tools (brief §5b)', async () => {
    const { client } = await createTestClient();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'agora_acquire',
      'agora_browse',
      'agora_plan',
      'agora_search',
      'agora_stack_status'
    ]);
  });

  test('server identity is "agora", not "agora-marketplace"', async () => {
    const { client } = await createTestClient();
    expect(client.getServerVersion()?.name).toBe('agora');
  });

  test('every tool declares an annotations object (honest hints)', async () => {
    const { client } = await createTestClient();
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.annotations).toBeDefined();
    }
    const byName = new Map(result.tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('agora_search')?.readOnlyHint).toBe(true);
    expect(byName.get('agora_browse')?.readOnlyHint).toBe(true);
    expect(byName.get('agora_stack_status')?.readOnlyHint).toBe(true);
    expect(byName.get('agora_plan')?.readOnlyHint).toBe(true);
    expect(byName.get('agora_plan')?.idempotentHint).toBe(true);
    expect(byName.get('agora_acquire')?.destructiveHint).toBe(true);
  });
});

describe('agora_search', () => {
  test('finds a known package via the federated catalog', async () => {
    const { client } = await createTestClient({ federation: { fetcher: emptyOfficialFetcher } });
    const result = await client.callTool({
      name: 'agora_search',
      arguments: { query: 'postgres' }
    });
    const payload = extractJson(result);
    expect(payload.query).toBe('postgres');
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.items.some((i: { id: string }) => i.id === 'mcp-postgres')).toBe(true);
    expect(Array.isArray(payload.statuses)).toBe(true);
  });

  test('returns an empty result set for a nonsense query', async () => {
    const { client } = await createTestClient({ federation: { fetcher: emptyOfficialFetcher } });
    const result = await client.callTool({
      name: 'agora_search',
      arguments: { query: 'zzzznonexistent' }
    });
    const payload = extractJson(result);
    expect(payload.count).toBe(0);
    expect(payload.items).toEqual([]);
  });
});

describe('agora_browse', () => {
  const fakeFetcher = async () =>
    ({
      status: 200,
      json: async () => ({ version: '1.0.0' })
    }) as unknown as Response;

  test('returns merged item detail plus a scan verdict for a known item', async () => {
    const { client } = await createTestClient({
      federation: { fetcher: emptyOfficialFetcher },
      scan: { fetcher: fakeFetcher }
    });
    const result = await client.callTool({ name: 'agora_browse', arguments: { id: 'mcp-github' } });
    const payload = extractJson(result);
    expect(payload.found).toBe(true);
    expect(payload.item.id).toBe('mcp-github');
    expect(payload.scan.summary).toBeDefined();
    expect(payload.trust).toBeNull();
  });

  test('reports not-found honestly for an unknown id', async () => {
    const { client } = await createTestClient({ federation: { fetcher: emptyOfficialFetcher } });
    const result = await client.callTool({
      name: 'agora_browse',
      arguments: { id: 'does-not-exist' }
    });
    const payload = extractJson(result);
    expect(payload.found).toBe(false);
  });
});

describe('agora_stack_status', () => {
  function makeStackEnv() {
    const root = mkdtempSync(join(tmpdir(), 'agora-mcp-stack-'));
    const proj = join(root, 'proj');
    const home = join(root, 'home');
    const data = join(root, 'data');
    mkdirSync(proj, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(data, { recursive: true });
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

  test('reports per-server health, grouped, without probing', async () => {
    const { root, stack } = makeStackEnv();
    try {
      const { client } = await createTestClient({ stack });
      const result = await client.callTool({ name: 'agora_stack_status', arguments: {} });
      const payload = extractJson(result);
      const names = payload.servers.map((s: { name: string }) => s.name).sort();
      expect(names).toEqual(['broken', 'faker']);
      expect(payload.summary.error).toBeGreaterThan(0);
      const broken = payload.servers.find((s: { name: string }) => s.name === 'broken');
      expect(broken.status).toBe('error');
      expect(Array.isArray(broken.tools)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('folds in cached tool capabilities per server (consolidates stack_capabilities)', async () => {
    const { root, stack } = makeStackEnv();
    try {
      writeCapabilityCache(stack.dataDir, [
        {
          key: 'faker@aaaa1111',
          name: 'faker',
          command: ['node', '/tmp/x.js'],
          serverInfo: { name: 'faker', version: '1.0' },
          tools: [{ name: 'query_database', description: 'run a sql query' }],
          ok: true,
          probedAt: new Date().toISOString()
        }
      ]);
      const { client } = await createTestClient({ stack });
      const result = await client.callTool({ name: 'agora_stack_status', arguments: {} });
      const payload = extractJson(result);
      const faker = payload.servers.find((s: { name: string }) => s.name === 'faker');
      expect(faker.tools).toEqual([{ name: 'query_database', description: 'run a sql query' }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('filters by tool and reports empty summary when nothing configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agora-mcp-empty-'));
    try {
      const { client } = await createTestClient({
        stack: { env: { HOME: join(root, 'h') }, cwd: join(root, 'c'), dataDir: join(root, 'd') }
      });
      const result = await client.callTool({
        name: 'agora_stack_status',
        arguments: { tool: 'cursor' }
      });
      const payload = extractJson(result);
      expect(payload.servers).toEqual([]);
      expect(payload.summary).toEqual({ ok: 0, warn: 0, error: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agora_plan', () => {
  function makePlanEnv() {
    const root = mkdtempSync(join(tmpdir(), 'agora-mcp-plan-'));
    const proj = join(root, 'proj');
    const home = join(root, 'home');
    mkdirSync(proj, { recursive: true });
    mkdirSync(home, { recursive: true });
    return { root, proj, home };
  }

  test('reports a no-manifest error honestly instead of guessing', async () => {
    const { root, proj, home } = makePlanEnv();
    try {
      const { client } = await createTestClient({ stack: { cwd: proj, env: { HOME: home } } });
      const result = await client.callTool({ name: 'agora_plan', arguments: {} });
      const payload = extractJson(result);
      expect(payload.error).toContain('No agora.toml manifest found');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('diffs agora.toml against a real (empty) opencode config', async () => {
    const { root, proj, home } = makePlanEnv();
    try {
      const manifest: StackManifest = {
        mcp: { fooserver: { command: ['npx', '-y', 'some-mcp'] } }
      };
      writeManifest(manifestPath({ cwd: proj }), manifest);

      const { client } = await createTestClient({ stack: { cwd: proj, env: { HOME: home } } });
      const result = await client.callTool({
        name: 'agora_plan',
        arguments: { tool: 'opencode' }
      });
      const payload = extractJson(result);
      expect(payload.mode).toBe('plan');
      const opencodePlan = payload.tools.find((p: { tool: string }) => p.tool === 'opencode');
      expect(opencodePlan.change.added).toEqual(['fooserver']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agora_acquire — the gate never bypasses on confirm', () => {
  const fakeFetcher = async () =>
    ({
      status: 200,
      json: async () => ({ version: '1.0.0' })
    }) as unknown as Response;

  test('without confirm, is always a dry run and writes nothing', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-mcp-acquire-'));
    const configPath = join(temp, 'opencode.json');
    try {
      const { client } = await createTestClient({
        federation: { fetcher: emptyOfficialFetcher },
        scan: { fetcher: fakeFetcher },
        stack: { cwd: temp, env: { HOME: temp } }
      });
      const result = await client.callTool({
        name: 'agora_acquire',
        arguments: { id: 'mcp-postgres', configPath }
      });
      const payload = extractJson(result);
      expect(payload.status).toBe('dry_run');
      expect(payload.scan).toBeDefined();
      expect(payload.plan).toBeDefined();
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('confirm alone does not bypass a warn verdict', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-mcp-acquire-'));
    const configPath = join(temp, 'opencode.json');
    try {
      const { client } = await createTestClient({
        federation: { fetcher: emptyOfficialFetcher },
        scan: { fetcher: fakeFetcher },
        stack: { cwd: temp, env: { HOME: temp } }
      });
      const result = await client.callTool({
        name: 'agora_acquire',
        arguments: { id: 'mcp-postgres', configPath, confirm: true }
      });
      const payload = extractJson(result);
      expect(payload.status).toBe('needs_confirmation');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('confirm + acceptWarnings writes config after a warn (not fail) verdict', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-mcp-acquire-'));
    const configPath = join(temp, 'opencode.json');
    try {
      const { client } = await createTestClient({
        federation: { fetcher: emptyOfficialFetcher },
        scan: { fetcher: fakeFetcher },
        stack: { cwd: temp, env: { HOME: temp } }
      });
      const result = await client.callTool({
        name: 'agora_acquire',
        arguments: { id: 'mcp-postgres', configPath, confirm: true, acceptWarnings: true }
      });
      const payload = extractJson(result);
      expect(payload.status).toBe('installed');
      expect(payload.written.configPath).toBe(configPath);
      expect(existsSync(configPath)).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
