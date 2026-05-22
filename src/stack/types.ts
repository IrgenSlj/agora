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

export interface ToolAdapter {
  id: AgentToolId;
  displayName: string;
  locations(opts: StackEnv): ToolConfigLocation[]; // priority order
  readServers(opts: StackEnv): ConfiguredServer[]; // skip missing/invalid files gracefully
}
