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

type McpEntry = Record<string, unknown>;

const REMOTE_TYPES = new Set(['sse', 'http', 'streamable-http']);
const LOCAL_TYPES = new Set(['stdio']);

/** Fix 2: robust transport detection */
function isRemoteEntry(entry: McpEntry): boolean {
  const t = typeof entry['type'] === 'string' ? entry['type'] : undefined;
  const tr = typeof entry['transport'] === 'string' ? entry['transport'] : undefined;
  const hasUrl = 'url' in entry;
  const hasCommand = 'command' in entry;

  if (t && REMOTE_TYPES.has(t)) return true;
  if (tr && REMOTE_TYPES.has(tr)) return true;
  if (t && LOCAL_TYPES.has(t)) return false;
  if (tr && LOCAL_TYPES.has(tr)) return false;

  if (hasCommand) return false;
  return hasUrl;
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
      url: typeof entry['url'] === 'string' ? entry['url'] : undefined,
      enabled: true,
      raw: entry
    };
  }

  const cmd = typeof entry['command'] === 'string' ? entry['command'] : '';
  const args = Array.isArray(entry['args']) ? (entry['args'] as string[]) : [];
  const env =
    typeof entry['env'] === 'object' && entry['env'] !== null
      ? (entry['env'] as Record<string, string>)
      : undefined;
  const argv: string[] = [cmd, ...args];
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

/**
 * Fix 1: Merge a DesiredServer into an existing entry, preserving unknown keys.
 * Returns null when the server should not be written (disabled).
 */
function mergeEntry(ds: DesiredServer, existing: McpEntry | undefined): McpEntry | null {
  // claude-code has no enabled field — skip disabled servers
  if (ds.enabled === false) return null;

  const base: McpEntry = existing !== undefined ? { ...existing } : {};

  if (ds.url) {
    // REMOTE: set url; preserve existing sse/http type if present; remove local keys
    base['url'] = ds.url;
    delete base['command'];
    delete base['args'];
    delete base['env'];
    const t = typeof base['type'] === 'string' ? base['type'] : undefined;
    if (t && LOCAL_TYPES.has(t)) delete base['type'];
    const tr = typeof base['transport'] === 'string' ? base['transport'] : undefined;
    if (tr && LOCAL_TYPES.has(tr)) delete base['transport'];
  } else {
    // LOCAL: set command/args/env; remove remote keys
    const [cmd, ...args] = ds.command ?? [];
    base['command'] = cmd ?? '';
    if (args.length > 0) {
      base['args'] = args;
    } else {
      delete base['args'];
    }
    if (ds.env && Object.keys(ds.env).length > 0) {
      base['env'] = ds.env;
    } else {
      delete base['env'];
    }
    delete base['url'];
    const t = typeof base['type'] === 'string' ? base['type'] : undefined;
    if (t && REMOTE_TYPES.has(t)) delete base['type'];
    const tr = typeof base['transport'] === 'string' ? base['transport'] : undefined;
    if (tr && REMOTE_TYPES.has(tr)) delete base['transport'];
  }

  return base;
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
          `claude-code config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e }
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
      const existingEntry =
        typeof existingMcp[ds.name] === 'object' && existingMcp[ds.name] !== null
          ? (existingMcp[ds.name] as McpEntry)
          : undefined;

      const mergedEntry = mergeEntry(ds, existingEntry);

      if (mergedEntry === null) {
        // disabled — skip writing
        skippedDisabled.push(ds.name);
        if (opts.prune && existingEntry !== undefined) {
          delete newMcp[ds.name];
        }
        continue;
      }

      if (existingEntry === undefined) {
        added.push(ds.name);
      } else {
        if (!entriesEqual(existingEntry, mergedEntry)) {
          updated.push(ds.name);
        }
      }
      newMcp[ds.name] = mergedEntry;
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
                    ? [
                        typeof entry['command'] === 'string' ? entry['command'] : '',
                        ...(Array.isArray(entry['args']) ? (entry['args'] as string[]) : [])
                      ]
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
