export type AgentToolId = 'opencode' | 'claude-code' | 'cursor' | 'windsurf';

export interface StackEnv {
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
}

export interface ToolConfigLocation {
  path: string;
  scope: 'project' | 'user';
}

export interface ConfiguredServer {
  name: string;
  tool: AgentToolId;
  scope: 'project' | 'user';
  configPath: string;
  transport: 'local' | 'remote';
  command?: string[]; // local: normalized argv ([cmd, ...args])
  url?: string; // remote
  env?: Record<string, string>;
  enabled: boolean; // default true when unspecified
  raw: unknown; // original entry, untouched
}

export interface DesiredServer {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface SyncChange {
  added: string[];
  updated: string[];
  removed: string[];
}

export interface ToolAdapter {
  id: AgentToolId;
  displayName: string;
  locations(opts: StackEnv): ToolConfigLocation[]; // priority order
  readServers(opts: StackEnv): ConfiguredServer[]; // skip missing/invalid files gracefully
  /** Config location this adapter can WRITE to for the given scope. Subset of locations(). */
  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null;
  /**
   * Reconcile the given desired servers into the config file at `location`.
   * MUST preserve every other key in the existing file untouched; only the
   * MCP section is modified. Atomic write. `prune` removes configured servers
   * whose name is not in `desired`; without prune, only add/update.
   * Returns the applied change set.
   */
  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange;
}
