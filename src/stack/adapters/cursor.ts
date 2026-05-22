import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConfiguredServer, StackEnv, ToolAdapter, ToolConfigLocation } from '../types.js';

function resolveHome(opts: StackEnv): string {
  return opts.home ?? homedir();
}

function resolveCwd(opts: StackEnv): string {
  return opts.cwd ?? process.cwd();
}

type McpEntry =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { type?: 'sse' | 'http'; url: string };

function isRemoteEntry(entry: McpEntry): entry is { type?: 'sse' | 'http'; url: string } {
  return 'url' in entry;
}

function parseJson(path: string): unknown | null {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function readServersFromFile(filePath: string, scope: 'project' | 'user'): ConfiguredServer[] {
  if (!existsSync(filePath)) return [];
  const parsed = parseJson(filePath);
  if (parsed === null) return [];

  const doc = parsed as Record<string, unknown>;
  const mcpServers = doc['mcpServers'];
  if (typeof mcpServers !== 'object' || mcpServers === null) return [];

  const servers: ConfiguredServer[] = [];
  for (const [name, v] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const entry = v as McpEntry;

    if (isRemoteEntry(entry)) {
      servers.push({
        name,
        tool: 'cursor',
        scope,
        configPath: filePath,
        transport: 'remote',
        url: entry.url,
        enabled: true,
        raw: entry
      });
    } else {
      const argv: string[] = [entry.command, ...(entry.args ?? [])];
      servers.push({
        name,
        tool: 'cursor',
        scope,
        configPath: filePath,
        transport: 'local',
        command: argv,
        env: entry.env,
        enabled: true,
        raw: entry
      });
    }
  }
  return servers;
}

export const cursorAdapter: ToolAdapter = {
  id: 'cursor',
  displayName: 'Cursor',

  locations(opts: StackEnv): ToolConfigLocation[] {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    return [
      { path: join(cwd, '.cursor', 'mcp.json'), scope: 'project' },
      { path: join(home, '.cursor', 'mcp.json'), scope: 'user' }
    ];
  },

  readServers(opts: StackEnv): ConfiguredServer[] {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    return [
      ...readServersFromFile(join(cwd, '.cursor', 'mcp.json'), 'project'),
      ...readServersFromFile(join(home, '.cursor', 'mcp.json'), 'user')
    ];
  }
};
