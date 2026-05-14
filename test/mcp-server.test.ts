import { describe, test, expect } from 'bun:test';
import { createAgoraMcpServer } from '../src/cli/mcp-server';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

function extractText(result: Record<string, unknown>): string {
  const contents = result.content as { type: string; text?: string }[];
  const text = contents?.find((c) => c.type === 'text');
  return text?.text ?? '';
}

async function createTestClient() {
  const server = createAgoraMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'test-client', version: '1.0' },
    { capabilities: {} }
  );

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { server, client };
}

describe('Agora MCP Server', () => {
  test('lists all 6 tools', async () => {
    const { client } = await createTestClient();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'browse',
      'install_plan',
      'search',
      'trending',
      'tutorial',
      'tutorials',
    ]);
  });

  test('search tool finds postgres MCP server', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'postgres' },
    });
    const text = extractText(result);
    expect(text).toContain('mcp-postgres');
  });

  test('search tool returns empty message for no matches', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'search',
      arguments: { query: 'zzzznonexistent' },
    });
    const text = extractText(result);
    expect(text).toContain('No results found');
  });

  test('browse tool returns package details', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'mcp-github' },
    });
    const text = extractText(result);
    expect(text).toContain('@modelcontextprotocol/server-github');
  });

  test('browse tool returns workflow details', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'wf-tdd-cycle' },
    });
    const text = extractText(result);
    expect(text).toContain('TDD Development Cycle');
  });

  test('browse tool returns not found for unknown id', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'browse',
      arguments: { id: 'does-not-exist' },
    });
    const text = extractText(result);
    expect(text).toContain('not found');
  });

  test('trending tool returns items', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'trending',
      arguments: {},
    });
    const text = extractText(result);
    expect(text).toContain('Trending in Agora');
  });

  test('install_plan tool returns install instructions for a package', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'install_plan',
      arguments: { id: 'mcp-github' },
    });
    const text = extractText(result);
    expect(text).toContain('npm install');
  });

  test('install_plan tool returns workflow instructions', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'install_plan',
      arguments: { id: 'wf-tdd-cycle' },
    });
    const text = extractText(result);
    expect(text).toContain('agora use');
  });

  test('tutorials tool returns available tutorials', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorials',
      arguments: {},
    });
    const text = extractText(result);
    expect(text).toContain('tut-mcp-basics');
  });

  test('tutorial tool returns a specific step', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'tut-mcp-basics', step: 1 },
    });
    const text = extractText(result);
    expect(text).toContain('What is MCP');
  });

  test('tutorial tool shows completion for out-of-range step', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'tut-mcp-basics', step: 99 },
    });
    const text = extractText(result);
    expect(text).toContain('completed');
  });

  test('tutorial tool shows not found for unknown tutorial', async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: 'tutorial',
      arguments: { id: 'does-not-exist' },
    });
    const text = extractText(result);
    expect(text).toContain('not found');
  });
});
