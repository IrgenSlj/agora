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

function toClaudeEntry(ds: DesiredServer, existingEntry?: McpEntry): McpEntry | null {
  // claude-code has no enabled field — skip disabled servers
  if (ds.enabled === false) return null;

  if (ds.url) {
    // Preserve pre-existing type (e.g. 'sse') when updating
    const existingType =
      existingEntry && isRemoteEntry(existingEntry) ? existingEntry.type : undefined;
    const entry: { type?: 'sse' | 'http'; url: string } = { url: ds.url };
    if (existingType) entry.type = existingType;
    return entry;
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

  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null {
    const cwd = resolveCwd(opts);
    const home = resolveHome(opts);
    if (scope === 'project') {
      return { path: join(cwd, '.mcp.json'), scope: 'project' };
    }
    return { path: join(home, '.claude.json'), scope: 'user' };
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
          `claude-code config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      if (typeof parsed === 'object' && parsed !== null) {
        doc = parsed as Record<string, unknown>;
      }
    }

    // Preserve all sibling keys; only mutate mcpServers
    const result: Record<string, unknown> = { ...doc };

    const existingMcp: Record<string, unknown> =
      typeof doc['mcpServers'] === 'object' && doc['mcpServers'] !== null
        ? { ...(doc['mcpServers'] as Record<string, unknown>) }
        : {};

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const skippedDisabled: string[] = [];

    const desiredMap = new Map<string, DesiredServer>(desired.map((d) => [d.name, d]));

    const newMcp: Record<string, unknown> = opts.prune ? {} : { ...existingMcp };

    for (const ds of desired) {
      const existingEntry = existingMcp[ds.name] as McpEntry | undefined;
      const newEntry = toClaudeEntry(ds, existingEntry);

      if (newEntry === null) {
        // disabled — skip writing
        skippedDisabled.push(ds.name);
        if (opts.prune && existingEntry !== undefined) {
          // remove from newMcp if pruning (it was already removed by the prune-start)
          delete newMcp[ds.name];
        }
        continue;
      }

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
        if (!desiredMap.has(name) && !skippedDisabled.includes(name)) {
          removed.push(name);
        }
      }
    }

    result['mcpServers'] = newMcp;

    atomicWriteFile(filePath, JSON.stringify(result, null, 2) + '\n', 0o644);

    return { added, updated, removed };
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
