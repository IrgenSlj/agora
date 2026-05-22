import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadOpenCodeConfig } from '../../config-files.js';
import type { ConfiguredServer, StackEnv, ToolAdapter, ToolConfigLocation } from '../types.js';

function resolveHome(opts: StackEnv): string {
  return opts.home ?? homedir();
}

function resolveCwd(opts: StackEnv): string {
  return opts.cwd ?? process.cwd();
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
