import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectOpenCodeConfigPath, loadOpenCodeConfig } from '../../config-files.js';
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
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);

    // Use detectOpenCodeConfigPath to find the active config file.
    // We also check all known locations so we can emit scope correctly.
    const locations = this.locations(opts);
    const servers: ConfiguredServer[] = [];

    for (const loc of locations) {
      if (!existsSync(loc.path)) continue;

      const loaded = loadOpenCodeConfig(loc.path);
      if (!loaded.config.mcp) continue;

      for (const [name, entry] of Object.entries(loaded.config.mcp)) {
        const raw = entry as Record<string, unknown>;

        // opencode only supports type:'local' in the spec we read,
        // but we handle url-bearing entries as remote for forward-compat.
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

    // Suppress unused-variable lint: cwd/home are used above in locations()
    void cwd;
    void home;

    return servers;
  }
};
