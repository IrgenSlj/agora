import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { hashContent } from '../manifest.js';
import type {
  AdapterInstructionsLocation,
  ConfiguredInstruction,
  ConfiguredServer,
  DesiredInstruction,
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

  // Explicit type wins
  if (t && REMOTE_TYPES.has(t)) return true;
  if (tr && REMOTE_TYPES.has(tr)) return true;
  if (t && LOCAL_TYPES.has(t)) return false;
  if (tr && LOCAL_TYPES.has(tr)) return false;

  // Fall back to key presence; prefer local when both present
  if (hasCommand) return false;
  return hasUrl;
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
        url: typeof entry['url'] === 'string' ? entry['url'] : undefined,
        enabled: true,
        raw: entry
      });
    } else {
      const cmd = typeof entry['command'] === 'string' ? entry['command'] : '';
      const args = Array.isArray(entry['args']) ? (entry['args'] as string[]) : [];
      const env =
        typeof entry['env'] === 'object' && entry['env'] !== null
          ? (entry['env'] as Record<string, string>)
          : undefined;
      const argv: string[] = [cmd, ...args];
      servers.push({
        name,
        tool: 'cursor',
        scope,
        configPath: filePath,
        transport: 'local',
        command: argv,
        env,
        enabled: true,
        raw: entry
      });
    }
  }
  return servers;
}

/**
 * Fix 1: Merge a DesiredServer into an existing entry, preserving unknown keys.
 * Returns the merged entry, or null if the server should not be written (disabled).
 */
function mergeEntry(ds: DesiredServer, existing: McpEntry | undefined): McpEntry | null {
  // cursor has no enabled field — skip disabled servers
  if (ds.enabled === false) return null;

  const base: McpEntry = existing !== undefined ? { ...existing } : {};

  if (ds.url) {
    // REMOTE: set url; remove local-only keys
    base['url'] = ds.url;
    delete base['command'];
    delete base['args'];
    delete base['env'];
    // Remove stdio/local type markers but keep sse/http type markers
    const t = typeof base['type'] === 'string' ? base['type'] : undefined;
    if (t && LOCAL_TYPES.has(t)) delete base['type'];
    const tr = typeof base['transport'] === 'string' ? base['transport'] : undefined;
    if (tr && LOCAL_TYPES.has(tr)) delete base['transport'];
  } else {
    // LOCAL: set command/args/env; remove remote-only keys
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
    // Remove remote type markers
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

// ── Instruction artifacts (P3) ──────────────────────────────────────────────
// Cursor reads a DIRECTORY of rule files rather than one shared file. Each
// named instruction entry becomes its own `<name>.md` file under
// `.cursor/rules/` (project: <cwd>/.cursor/rules, user: <home>/.cursor/rules
// — mirroring Cursor's MCP config, which is also present at both scopes).
// Only files agora itself writes (`.md` under this directory) are managed;
// prune only ever removes `.md` files, never other file types someone else
// placed in the same directory.
// NOTE (judgment call): real Cursor rule files commonly use a `.mdc`
// extension with YAML frontmatter; `.md` is used here since no strict format
// is specified by the manifest contract and keeping it plain markdown keeps
// the artifact readable/portable across harnesses.

const MANAGED_EXT = '.md';

function cursorInstructionsLocation(
  opts: StackEnv,
  scope: 'project' | 'user'
): ToolConfigLocation | null {
  const cwd = resolveCwd(opts);
  const home = resolveHome(opts);
  if (scope === 'project') {
    return { path: join(cwd, '.cursor', 'rules'), scope: 'project' };
  }
  return { path: join(home, '.cursor', 'rules'), scope: 'user' };
}

function readCursorInstructions(
  dirPath: string,
  scope: 'project' | 'user'
): ConfiguredInstruction[] {
  if (!existsSync(dirPath)) return [];
  let names: string[];
  try {
    names = readdirSync(dirPath);
  } catch {
    return [];
  }
  const results: ConfiguredInstruction[] = [];
  for (const fileName of names) {
    if (!fileName.endsWith(MANAGED_EXT)) continue;
    const filePath = join(dirPath, fileName);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    results.push({
      name: basename(fileName, MANAGED_EXT),
      tool: 'cursor',
      scope,
      path: filePath,
      contentHash: hashContent(content)
    });
  }
  return results;
}

function writeCursorInstructions(
  dirPath: string,
  desired: DesiredInstruction[],
  opts: { prune: boolean }
): SyncChange {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  const existingNames = new Set<string>();
  if (existsSync(dirPath)) {
    try {
      for (const fileName of readdirSync(dirPath)) {
        if (fileName.endsWith(MANAGED_EXT)) existingNames.add(basename(fileName, MANAGED_EXT));
      }
    } catch {
      /* directory unreadable — treat as empty, same as existsSync guard elsewhere */
    }
  }

  const desiredNames = new Set(desired.map((d) => d.name));

  for (const d of desired) {
    const filePath = join(dirPath, `${d.name}${MANAGED_EXT}`);
    const newContent = d.content ?? '';
    if (!existingNames.has(d.name)) {
      added.push(d.name);
      atomicWriteFile(filePath, newContent, 0o644);
    } else {
      const existingContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : undefined;
      if (existingContent !== newContent) {
        updated.push(d.name);
        atomicWriteFile(filePath, newContent, 0o644);
      }
    }
  }

  if (opts.prune) {
    for (const name of existingNames) {
      if (!desiredNames.has(name)) {
        removed.push(name);
        try {
          unlinkSync(join(dirPath, `${name}${MANAGED_EXT}`));
        } catch {
          /* best-effort */
        }
      }
    }
  }

  return { added, updated, removed };
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
        `cursor config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
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
    const existingEntry =
      typeof existingMcp[ds.name] === 'object' && existingMcp[ds.name] !== null
        ? (existingMcp[ds.name] as McpEntry)
        : undefined;

    const mergedEntry = mergeEntry(ds, existingEntry);
    if (mergedEntry === null) {
      // disabled — skip writing
      if (opts.prune) delete newMcp[ds.name];
      continue;
    }

    if (existingEntry === undefined) {
      added.push(ds.name);
    } else {
      // Compare merged result against existing to detect real changes
      if (!entriesEqual(existingEntry, mergedEntry)) {
        updated.push(ds.name);
      }
    }
    newMcp[ds.name] = mergedEntry;
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

export const cursorAdapter: ToolAdapter & AdapterInstructionsLocation = {
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
  },

  instructionsLocation: cursorInstructionsLocation,

  readInstructions(opts: StackEnv): ConfiguredInstruction[] {
    const project = cursorInstructionsLocation(opts, 'project')!;
    const user = cursorInstructionsLocation(opts, 'user')!;
    return [
      ...readCursorInstructions(project.path, 'project'),
      ...readCursorInstructions(user.path, 'user')
    ];
  },

  writeInstructions(
    location: ToolConfigLocation,
    desired: DesiredInstruction[],
    opts: { prune: boolean }
  ): SyncChange {
    return writeCursorInstructions(location.path, desired, opts);
  }
};
