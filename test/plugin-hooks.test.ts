import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildStackMemoryContext,
  createAgoraHooks,
  detectCapabilitySuggestion,
  parsePluginOptions
} from '../src/plugin/hooks';
import { capabilityKey, writeCapabilityCache } from '../src/stack/capability-cache';
import type { ConfiguredServer } from '../src/stack/types';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-plugin-hooks-'));
}

function configured(name: string): ConfiguredServer {
  return {
    name,
    tool: 'opencode',
    scope: 'project',
    configPath: '/tmp/opencode.json',
    transport: 'local',
    command: ['npx', name],
    enabled: true,
    raw: {}
  };
}

describe('plugin hooks', () => {
  test('parsePluginOptions keeps suggestions opt-in and stack memory on by default', () => {
    expect(parsePluginOptions()).toEqual({ suggestAcquire: false, stackMemory: true });
    expect(parsePluginOptions({ suggestAcquire: 'true', stackMemory: false })).toEqual({
      suggestAcquire: true,
      stackMemory: false
    });
  });

  test('detectCapabilitySuggestion recommends missing database capability', () => {
    const suggestion = detectCapabilitySuggestion('bash', { command: 'psql "$DATABASE_URL"' }, []);
    expect(suggestion?.id).toBe('mcp-postgres');
  });

  test('detectCapabilitySuggestion skips installed capabilities', () => {
    const suggestion = detectCapabilitySuggestion('bash', { command: 'psql "$DATABASE_URL"' }, [
      configured('mcp-postgres')
    ]);
    expect(suggestion).toBeNull();
  });

  test('buildStackMemoryContext summarizes configured servers and cached tools', () => {
    const cwd = makeTmp();
    const dataDir = makeTmp();
    try {
      const command = ['npx', '@modelcontextprotocol/server-postgres'];
      writeFileSync(
        join(cwd, 'opencode.json'),
        JSON.stringify({
          mcp: {
            'mcp-postgres': { type: 'local', command }
          }
        })
      );
      writeCapabilityCache(dataDir, [
        {
          key: capabilityKey('mcp-postgres', command),
          name: 'mcp-postgres',
          command,
          tools: [{ name: 'list_tables', description: 'List tables' }],
          ok: true,
          probedAt: new Date().toISOString(),
          descriptionDigest: 'digest'
        }
      ]);

      const context = buildStackMemoryContext({ directory: cwd, dataDir, env: { HOME: cwd } });
      expect(context).toContain('Agora current MCP stack');
      expect(context).toContain('mcp-postgres');
      expect(context).toContain('list_tables');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('compacting hook appends stack memory context', async () => {
    const cwd = makeTmp();
    const dataDir = makeTmp();
    const originalHome = process.env.HOME;
    const originalAgoraHome = process.env.AGORA_HOME;
    try {
      process.env.HOME = cwd;
      process.env.AGORA_HOME = dataDir;
      writeFileSync(
        join(cwd, 'opencode.json'),
        JSON.stringify({ mcp: { github: { type: 'local', command: ['npx', 'github-mcp'] } } })
      );

      const hooks = createAgoraHooks({ directory: cwd, client: {} } as any, {});
      const output = { context: [] as string[] };
      await hooks['experimental.session.compacting']?.({ sessionID: 'session-1' }, output);
      expect(output.context.join('\n')).toContain('github');
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalAgoraHome === undefined) delete process.env.AGORA_HOME;
      else process.env.AGORA_HOME = originalAgoraHome;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('tool.execute.before suggestion hook uses client log and no-reply prompt when enabled', async () => {
    const cwd = makeTmp();
    try {
      const calls: string[] = [];
      const hooks = createAgoraHooks(
        {
          directory: cwd,
          client: {
            app: {
              log: async () => {
                calls.push('log');
                return { data: true };
              }
            },
            session: {
              prompt: async () => {
                calls.push('prompt');
                return { data: true };
              }
            }
          }
        } as any,
        { suggestAcquire: true, stackMemory: false }
      );

      await hooks['tool.execute.before']?.(
        { tool: 'bash', sessionID: 'session-1', callID: 'call-1' },
        { args: { command: 'psql "$DATABASE_URL"' } }
      );
      expect(calls).toEqual(['log', 'prompt']);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
