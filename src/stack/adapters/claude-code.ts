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

function parseEntry(
  name: string,
  entry: McpEntry,
  tool: 'claude-code',
  scope: 'project' | 'user',
  configPath: string
): ConfiguredServer {
  if (isRemoteEntry(entry)) {
    return {
      name,
      tool,
      scope,
      configPath,
      transport: 'remote',
      url: entry.url,
      enabled: true,
      raw: entry
    };
  }

  const { command, args, env } = entry;
  const argv: string[] = [command, ...(args ?? [])];
  return {
    name,
    tool,
    scope,
    configPath,
    transport: 'local',
    command: argv,
    env,
    enabled: true,
    raw: entry
  };
}

function readMcpServers(obj: unknown): [string, McpEntry][] | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const map = obj as Record<string, unknown>;
  const result: [string, McpEntry][] = [];
  for (const [k, v] of Object.entries(map)) {
    if (typeof v === 'object' && v !== null) {
      result.push([k, v as McpEntry]);
    }
  }
  return result;
}

function parseJson(path: string): unknown | null {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export const claudeCodeAdapter: ToolAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',

  locations(opts: StackEnv): ToolConfigLocation[] {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    return [
      { path: join(cwd, '.mcp.json'), scope: 'project' },
      { path: join(home, '.claude.json'), scope: 'user' }
    ];
  },

  readServers(opts: StackEnv): ConfiguredServer[] {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    const servers: ConfiguredServer[] = [];

    // --- Project file: <cwd>/.mcp.json ---
    const projectPath = join(cwd, '.mcp.json');
    if (existsSync(projectPath)) {
      const parsed = parseJson(projectPath);
      if (parsed !== null) {
        const doc = parsed as Record<string, unknown>;
        const entries = readMcpServers(doc['mcpServers']);
        if (entries) {
          for (const [name, entry] of entries) {
            servers.push(parseEntry(name, entry, 'claude-code', 'project', projectPath));
          }
        }
      }
    }

    // --- User file: ~/.claude.json ---
    const userPath = join(home, '.claude.json');
    if (existsSync(userPath)) {
      const parsed = parseJson(userPath);
      if (parsed !== null) {
        const doc = parsed as Record<string, unknown>;

        // Top-level mcpServers (scope: user)
        const topEntries = readMcpServers(doc['mcpServers']);
        if (topEntries) {
          for (const [name, entry] of topEntries) {
            servers.push(parseEntry(name, entry, 'claude-code', 'user', userPath));
          }
        }

        // projects[<absCwd>].mcpServers (scope: project)
        const projects = doc['projects'];
        if (typeof projects === 'object' && projects !== null) {
          const projectsMap = projects as Record<string, unknown>;
          const cwdEntry = projectsMap[cwd];
          if (typeof cwdEntry === 'object' && cwdEntry !== null) {
            const projectDoc = cwdEntry as Record<string, unknown>;
            const projEntries = readMcpServers(projectDoc['mcpServers']);
            if (projEntries) {
              for (const [name, entry] of projEntries) {
                // Dedupe: skip if same name+command already added from top-level
                const isDupe = servers.some((s) => {
                  if (s.configPath !== userPath) return false;
                  if (s.name !== name) return false;
                  const newArgv = !isRemoteEntry(entry)
                    ? [entry.command, ...(entry.args ?? [])]
                    : undefined;
                  return JSON.stringify(s.command) === JSON.stringify(newArgv);
                });
                if (!isDupe) {
                  servers.push(parseEntry(name, entry, 'claude-code', 'project', userPath));
                }
              }
            }
          }
        }
      }
    }

    return servers;
  }
};
