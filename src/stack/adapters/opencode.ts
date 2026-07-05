import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { loadOpenCodeConfig } from '../../config-files.js';
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

/**
 * Fix 1: Merge a DesiredServer into an existing opencode entry, preserving unknown keys.
 * opencode uses `type:'local'|'remote'`, `command`(array), `environment`, `enabled`.
 */
function mergeOpencodeEntry(
  ds: DesiredServer,
  existing: Record<string, unknown> | undefined
): Record<string, unknown> {
  const base: Record<string, unknown> = existing !== undefined ? { ...existing } : {};

  if (ds.url) {
    // REMOTE
    base['type'] = 'remote';
    base['url'] = ds.url;
    // Remove local-only keys
    delete base['command'];
    delete base['environment'];
  } else {
    // LOCAL
    base['type'] = 'local';
    base['command'] = ds.command ?? [];
    if (ds.env && Object.keys(ds.env).length > 0) {
      base['environment'] = ds.env;
    } else {
      delete base['environment'];
    }
    // Remove remote-only keys
    delete base['url'];
  }

  if (ds.enabled === false) {
    base['enabled'] = false;
  } else {
    // If it was previously disabled and now enabled, remove the flag
    delete base['enabled'];
  }

  return base;
}

function entriesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Instruction artifacts (P3) ──────────────────────────────────────────────
// OpenCode natively reads an `instructions` array of paths/globs in
// opencode.json (e.g. ["CONTRIBUTING.md", ".cursor/rules/*.md"]) — it does
// NOT own a dedicated directory for them. So agora manages its own instruction
// files under `.agora/instructions/<name>.md` (relative to the config file's
// directory) and registers each one's relative path in that `instructions`
// array. Any pre-existing entries in the array (a user's own "CONTRIBUTING.md"
// or glob) are left completely untouched — only paths matching agora's own
// `.agora/instructions/*.md` pattern are ever added, updated, or (with
// --prune) removed, both from the array and from disk.

const MANAGED_PREFIX = '.agora/instructions/';
const MANAGED_SUFFIX = '.md';

function managedRelPath(name: string): string {
  return `${MANAGED_PREFIX}${name}${MANAGED_SUFFIX}`;
}

function isManagedPath(p: string): boolean {
  return p.startsWith(MANAGED_PREFIX) && p.endsWith(MANAGED_SUFFIX);
}

function nameFromManagedPath(p: string): string {
  return p.slice(MANAGED_PREFIX.length, -MANAGED_SUFFIX.length);
}

function managedAbsPath(configDir: string, name: string): string {
  return join(configDir, '.agora', 'instructions', `${name}${MANAGED_SUFFIX}`);
}

function readOpencodeInstructions(
  configPath: string,
  scope: 'project' | 'user'
): ConfiguredInstruction[] {
  if (!existsSync(configPath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const doc = parsed as Record<string, unknown>;
  const arr = Array.isArray(doc['instructions']) ? (doc['instructions'] as unknown[]) : [];
  const configDir = dirname(configPath);

  const results: ConfiguredInstruction[] = [];
  for (const entry of arr) {
    if (typeof entry !== 'string' || !isManagedPath(entry)) continue;
    const name = nameFromManagedPath(entry);
    const absPath = managedAbsPath(configDir, name);
    if (!existsSync(absPath)) continue;
    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    results.push({
      name,
      tool: 'opencode',
      scope,
      path: absPath,
      contentHash: hashContent(content)
    });
  }
  return results;
}

function writeOpencodeInstructions(
  configPath: string,
  desired: DesiredInstruction[],
  opts: { prune: boolean }
): SyncChange {
  let doc: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `opencode config at ${configPath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    if (typeof parsed === 'object' && parsed !== null) {
      doc = parsed as Record<string, unknown>;
    }
  }

  const result: Record<string, unknown> = { ...doc };
  const existingArr = Array.isArray(doc['instructions'])
    ? [...(doc['instructions'] as unknown[])]
    : [];
  const configDir = dirname(configPath);

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const desiredNames = new Set(desired.map((d) => d.name));

  const existingManagedNames = new Set<string>();
  for (const entry of existingArr) {
    if (typeof entry === 'string' && isManagedPath(entry)) {
      existingManagedNames.add(nameFromManagedPath(entry));
    }
  }

  for (const d of desired) {
    const absPath = managedAbsPath(configDir, d.name);
    const newContent = d.content ?? '';
    const previousContent = existsSync(absPath) ? readFileSync(absPath, 'utf8') : undefined;

    if (!existingManagedNames.has(d.name)) {
      added.push(d.name);
    } else if (previousContent !== newContent) {
      updated.push(d.name);
    }
    if (previousContent !== newContent) {
      atomicWriteFile(absPath, newContent, 0o644);
    }
  }

  const newArr = existingArr.filter((entry) => {
    if (typeof entry !== 'string' || !isManagedPath(entry)) return true; // untouched foreign entries
    const name = nameFromManagedPath(entry);
    if (opts.prune && !desiredNames.has(name)) {
      removed.push(name);
      try {
        unlinkSync(managedAbsPath(configDir, name));
      } catch {
        /* best-effort */
      }
      return false;
    }
    return true;
  });

  for (const d of desired) {
    if (!existingManagedNames.has(d.name)) {
      newArr.push(managedRelPath(d.name));
    }
  }

  if (newArr.length > 0 || 'instructions' in doc) {
    result['instructions'] = newArr;
  } else {
    delete result['instructions'];
  }

  atomicWriteFile(configPath, JSON.stringify(result, null, 2) + '\n', 0o644);

  return { added, updated, removed };
}

function opencodeInstructionsLocation(
  opts: StackEnv,
  scope: 'project' | 'user'
): ToolConfigLocation | null {
  const cwd = resolveCwd(opts);
  const home = resolveHome(opts);
  if (scope === 'project') {
    return { path: join(cwd, 'opencode.json'), scope: 'project' };
  }
  return { path: join(home, '.config', 'opencode', 'opencode.json'), scope: 'user' };
}

export const opencodeAdapter: ToolAdapter & AdapterInstructionsLocation = {
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
          `opencode config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e }
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
      const existingEntry =
        typeof existingMcp[ds.name] === 'object' && existingMcp[ds.name] !== null
          ? (existingMcp[ds.name] as Record<string, unknown>)
          : undefined;

      const mergedEntry = mergeOpencodeEntry(ds, existingEntry);

      if (existingEntry === undefined) {
        added.push(ds.name);
      } else {
        if (!entriesEqual(existingEntry, mergedEntry)) {
          updated.push(ds.name);
        }
      }
      newMcp[ds.name] = mergedEntry;
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
  },

  instructionsLocation: opencodeInstructionsLocation,

  readInstructions(opts: StackEnv): ConfiguredInstruction[] {
    const project = opencodeInstructionsLocation(opts, 'project')!;
    const user = opencodeInstructionsLocation(opts, 'user')!;
    return [
      ...readOpencodeInstructions(project.path, 'project'),
      ...readOpencodeInstructions(user.path, 'user')
    ];
  },

  writeInstructions(
    location: ToolConfigLocation,
    desired: DesiredInstruction[],
    opts: { prune: boolean }
  ): SyncChange {
    return writeOpencodeInstructions(location.path, desired, opts);
  }
};
