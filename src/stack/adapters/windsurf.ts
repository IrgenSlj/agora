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

function toWindsurfEntry(ds: DesiredServer): McpEntry | null {
  // windsurf has no enabled field — skip disabled servers
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

export const windsurfAdapter: ToolAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',

  locations(opts: StackEnv): ToolConfigLocation[] {
    const home = resolveHome(opts);
    return [
      {
        path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        scope: 'user'
      }
    ];
  },

  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null {
    if (scope === 'project') return null; // windsurf has no project config
    const home = resolveHome(opts);
    return {
      path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      scope: 'user'
    };
  },

  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange {
    const filePath = location.path;

    let doc: Record<string, unknown> = {};
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(
          `windsurf config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`
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
      const newEntry = toWindsurfEntry(ds);
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
  },

  readServers(opts: StackEnv): ConfiguredServer[] {
    const home = resolveHome(opts);
    const filePath = join(home, '.codeium', 'windsurf', 'mcp_config.json');

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
          tool: 'windsurf',
          scope: 'user',
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
          tool: 'windsurf',
          scope: 'user',
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
};
