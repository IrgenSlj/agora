import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import type {
  ConfiguredServer,
  DesiredServer,
  StackEnv,
  SyncChange,
  ToolAdapter,
  ToolConfigLocation
} from '../types.js';

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

function toCursorEntry(ds: DesiredServer): McpEntry | null {
  // cursor has no enabled field — skip disabled servers
  if (ds.enabled === false) return null;

  if (ds.url) {
    return { url: ds.url };
  }

  const [cmd, ...args] = ds.command ?? [];
  const entry: { command: string; args?: string[]; env?: Record<string, string> } = {
    command: cmd ?? ''
  };
  if (args.length > 0) entry.args = args;
  if (ds.env && Object.keys(ds.env).length > 0) entry.env = ds.env;
  return entry;
}

function entriesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function writeServersToFile(
  filePath: string,
  desired: DesiredServer[],
  opts: { prune: boolean }
): SyncChange {
  let doc: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `cursor config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (typeof parsed === 'object' && parsed !== null) {
      doc = parsed as Record<string, unknown>;
    }
  }

  const result: Record<string, unknown> = { ...doc };

  const existingMcp: Record<string, unknown> =
    typeof doc['mcpServers'] === 'object' && doc['mcpServers'] !== null
      ? { ...(doc['mcpServers'] as Record<string, unknown>) }
      : {};

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  const desiredMap = new Map<string, DesiredServer>(desired.map((d) => [d.name, d]));

  const newMcp: Record<string, unknown> = opts.prune ? {} : { ...existingMcp };

  for (const ds of desired) {
    const newEntry = toCursorEntry(ds);
    if (newEntry === null) {
      // disabled — skip writing
      if (opts.prune) delete newMcp[ds.name];
      continue;
    }

    const existingEntry = existingMcp[ds.name];
    if (existingEntry === undefined) {
      added.push(ds.name);
    } else {
      if (!entriesEqual(existingEntry, newEntry)) {
        updated.push(ds.name);
      }
    }
    newMcp[ds.name] = newEntry;
  }

  if (opts.prune) {
    for (const name of Object.keys(existingMcp)) {
      if (!desiredMap.has(name)) {
        removed.push(name);
      }
    }
  }

  result['mcpServers'] = newMcp;

  atomicWriteFile(filePath, JSON.stringify(result, null, 2) + '\n', 0o644);

  return { added, updated, removed };
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

  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    if (scope === 'project') {
      return { path: join(cwd, '.cursor', 'mcp.json'), scope: 'project' };
    }
    return { path: join(home, '.cursor', 'mcp.json'), scope: 'user' };
  },

  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange {
    return writeServersToFile(location.path, desired, opts);
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
