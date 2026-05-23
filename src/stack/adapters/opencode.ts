import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { loadOpenCodeConfig } from '../../config-files.js';
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

function toOpencodeEntry(ds: DesiredServer): Record<string, unknown> {
  if (ds.url) {
    const entry: Record<string, unknown> = { type: 'remote', url: ds.url };
    if (ds.enabled === false) entry.enabled = false;
    return entry;
  }
  const entry: Record<string, unknown> = {
    type: 'local',
    command: ds.command ?? []
  };
  if (ds.env && Object.keys(ds.env).length > 0) {
    entry.environment = ds.env;
  }
  if (ds.enabled === false) entry.enabled = false;
  return entry;
}

function entriesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const opencodeAdapter: ToolAdapter = {
  id: 'opencode',
  displayName: 'opencode',

  locations(opts: StackEnv): ToolConfigLocation[] {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    return [
      { path: join(cwd, 'opencode.json'), scope: 'project' },
      { path: join(home, '.config', 'opencode', 'opencode.json'), scope: 'user' },
      { path: join(home, '.opencode.json'), scope: 'user' }
    ];
  },

  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    if (scope === 'project') {
      return { path: join(cwd, 'opencode.json'), scope: 'project' };
    }
    return { path: join(home, '.config', 'opencode', 'opencode.json'), scope: 'user' };
  },

  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange {
    const filePath = location.path;

    // Read existing file
    let doc: Record<string, unknown> = {};
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(
          `opencode config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      if (typeof parsed === 'object' && parsed !== null) {
        doc = parsed as Record<string, unknown>;
      }
    }

    // Deep-clone to avoid mutation of original
    const result: Record<string, unknown> = { ...doc };

    // Get existing MCP container
    const existingMcp: Record<string, unknown> =
      typeof doc['mcp'] === 'object' && doc['mcp'] !== null
        ? { ...(doc['mcp'] as Record<string, unknown>) }
        : {};

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];

    // Build desired map
    const desiredMap = new Map<string, DesiredServer>(desired.map((d) => [d.name, d]));

    // New MCP container
    const newMcp: Record<string, unknown> = opts.prune ? {} : { ...existingMcp };

    // Apply desired
    for (const ds of desired) {
      const newEntry = toOpencodeEntry(ds);
      const existingEntry = existingMcp[ds.name];
      if (existingEntry === undefined) {
        added.push(ds.name);
      } else {
        const existingNorm = existingEntry as Record<string, unknown>;
        if (!entriesEqual(existingNorm, newEntry)) {
          updated.push(ds.name);
        }
      }
      newMcp[ds.name] = newEntry;
    }

    // Handle pruning
    if (opts.prune) {
      for (const name of Object.keys(existingMcp)) {
        if (!desiredMap.has(name)) {
          removed.push(name);
        }
      }
    }

    result['mcp'] = newMcp;

    atomicWriteFile(filePath, JSON.stringify(result, null, 2) + '\n', 0o644);

    return { added, updated, removed };
  },

  readServers(opts: StackEnv): ConfiguredServer[] {
    // Iterate all known locations so scope is preserved correctly.
    const locations = this.locations(opts);
    const servers: ConfiguredServer[] = [];

    for (const loc of locations) {
      if (!existsSync(loc.path)) continue;

      const loaded = loadOpenCodeConfig(loc.path);
      if (!loaded.config.mcp) continue;

      for (const [name, entry] of Object.entries(loaded.config.mcp)) {
        const raw = entry as Record<string, unknown>;

        // opencode only supports type:'local' formally, but handle url-bearing
        // entries as remote for forward-compatibility.
        const isRemote = (entry as { type?: string }).type === 'remote' || 'url' in raw;

        if (isRemote) {
          const remoteEntry = entry as { url?: string; enabled?: boolean };
          servers.push({
            name,
            tool: 'opencode',
            scope: loc.scope,
            configPath: loc.path,
            transport: 'remote',
            url: remoteEntry.url,
            enabled: remoteEntry.enabled !== false,
            raw: entry
          });
        } else {
          const localEntry = entry as {
            command: string[];
            environment?: Record<string, string>;
            enabled?: boolean;
          };
          const [cmd, ...args] = localEntry.command ?? [];
          servers.push({
            name,
            tool: 'opencode',
            scope: loc.scope,
            configPath: loc.path,
            transport: 'local',
            command: cmd !== undefined ? [cmd, ...args] : [],
            env: localEntry.environment,
            enabled: localEntry.enabled !== false,
            raw: entry
          });
        }
      }
    }

    return servers;
  }
};
