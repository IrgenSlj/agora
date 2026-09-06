// VS Code — the largest editor install base in the market, and until now the
// one Agora could not see.
//
// Its config is close enough to the others to look interchangeable and is not.
// Three differences matter, and getting any of them wrong writes a file VS Code
// silently ignores:
//
//   1. The map is `servers`, not `mcpServers`. Every other adapter in this
//      directory uses the latter.
//   2. `type` is required on stdio entries. Cursor and Claude Code infer it
//      from the presence of `command`; VS Code does not.
//   3. The file carries two sibling sections Agora has no business touching —
//      `inputs` (the `${input:id}` prompts that keep secrets out of the file)
//      and `sandbox` (filesystem and network rules). They are preserved
//      wholesale on write, and a value containing `${input:...}` is left
//      exactly as written rather than resolved, because resolving it would
//      bake a secret into a file the user deliberately kept it out of.
//
// The user-scope file is `~/.copilot/mcp-config.json`, which VS Code documents
// as the portable location the Agent Host reads natively. The profile-internal
// location is not used: it is per-profile, opaque, and not a path a user can
// point at.

import { existsSync, readFileSync } from 'node:fs';
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
import {
  isRemoteEntry,
  LOCAL_TYPES,
  type McpEntry,
  parseJson,
  REMOTE_TYPES,
  resolveCwd,
  resolveHome
} from './shared.js';

/** `.vscode/mcp.json` in the workspace; `~/.copilot/mcp-config.json` for the user. */
function projectPath(opts: StackEnv): string {
  return join(resolveCwd(opts), '.vscode', 'mcp.json');
}
function userPath(opts: StackEnv): string {
  return join(resolveHome(opts), '.copilot', 'mcp-config.json');
}

function readServersFromFile(filePath: string, scope: 'project' | 'user'): ConfiguredServer[] {
  if (!existsSync(filePath)) return [];
  const parsed = parseJson(filePath);
  if (parsed === null) return [];

  const doc = parsed as Record<string, unknown>;
  // `servers` is the documented key. `mcpServers` is accepted on read only:
  // config gets copied between editors constantly, and a user who pasted the
  // Cursor shape here has a file VS Code ignores — which is worth reporting,
  // not worth pretending is empty.
  const raw = doc['servers'] ?? doc['mcpServers'];
  if (typeof raw !== 'object' || raw === null) return [];

  const servers: ConfiguredServer[] = [];
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const entry = v as McpEntry;

    if (isRemoteEntry(entry)) {
      servers.push({
        name,
        tool: 'vscode',
        scope,
        configPath: filePath,
        transport: 'remote',
        url: typeof entry['url'] === 'string' ? entry['url'] : undefined,
        enabled: true,
        raw: entry
      });
      continue;
    }

    const cmd = typeof entry['command'] === 'string' ? entry['command'] : '';
    const args = Array.isArray(entry['args']) ? (entry['args'] as string[]) : [];
    // VS Code permits string, number and null env values; everything downstream
    // wants strings. null means "unset this variable" and is dropped rather
    // than stringified into the literal "null".
    let env: Record<string, string> | undefined;
    if (typeof entry['env'] === 'object' && entry['env'] !== null) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(entry['env'] as Record<string, unknown>)) {
        if (val === null || val === undefined) continue;
        out[k] = String(val);
      }
      env = Object.keys(out).length > 0 ? out : undefined;
    }

    servers.push({
      name,
      tool: 'vscode',
      scope,
      configPath: filePath,
      transport: 'local',
      command: [cmd, ...args],
      env,
      enabled: true,
      raw: entry
    });
  }
  return servers;
}

/**
 * Merge a desired server into an existing entry, preserving every key Agora
 * does not own — `dev`, `envFile`, `sandboxEnabled`, `headers`, `oauth`, `cwd`
 * and anything a future VS Code release adds.
 *
 * Returns null when the server should not be written. VS Code has no disabled
 * flag, so a disabled server is an absent one.
 */
function mergeEntry(ds: DesiredServer, existing: McpEntry | undefined): McpEntry | null {
  if (ds.enabled === false) return null;

  const base: McpEntry = existing !== undefined ? { ...existing } : {};

  if (ds.url) {
    base['url'] = ds.url;
    // `type` is required here, and unlike the local case there are two valid
    // remote values. An existing sse entry stays sse; anything else becomes
    // http, which is the transport VS Code documents first.
    const existingType = typeof base['type'] === 'string' ? base['type'] : undefined;
    base['type'] = existingType && REMOTE_TYPES.has(existingType) ? existingType : 'http';
    delete base['command'];
    delete base['args'];
    delete base['env'];
    delete base['envFile'];
    delete base['cwd'];
  } else {
    const [cmd, ...args] = ds.command ?? [];
    base['type'] = 'stdio';
    base['command'] = cmd ?? '';
    if (args.length > 0) base['args'] = args;
    else delete base['args'];
    if (ds.env && Object.keys(ds.env).length > 0) base['env'] = ds.env;
    else delete base['env'];
    delete base['url'];
    delete base['headers'];
    delete base['oauth'];
  }

  // A type left over from the other shape would contradict what we just set.
  const t = typeof base['type'] === 'string' ? base['type'] : undefined;
  if (t && !LOCAL_TYPES.has(t) && !REMOTE_TYPES.has(t)) delete base['type'];

  return base;
}

function entriesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function writeServersToFile(
  filePath: string,
  desired: DesiredServer[],
  opts: { prune: boolean }
): SyncChange {
  let doc: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const rawText = readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      throw new Error(
        `vscode config at ${filePath} is not valid JSON — refusing to overwrite: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    if (typeof parsed === 'object' && parsed !== null) doc = parsed as Record<string, unknown>;
  }

  // Spreading the whole document first is what keeps `inputs` and `sandbox`.
  const result: Record<string, unknown> = { ...doc };

  // Read tolerates `mcpServers`; write always produces `servers`. If the file
  // carried the wrong key we correct it rather than maintaining both, or VS
  // Code would keep ignoring half the file.
  const existingMcp: Record<string, unknown> = (() => {
    const under = doc['servers'] ?? doc['mcpServers'];
    return typeof under === 'object' && under !== null
      ? { ...(under as Record<string, unknown>) }
      : {};
  })();
  delete result['mcpServers'];

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

    const merged = mergeEntry(ds, existingEntry);
    if (merged === null) {
      if (opts.prune) delete newMcp[ds.name];
      continue;
    }

    if (existingEntry === undefined) added.push(ds.name);
    else if (!entriesEqual(existingEntry, merged)) updated.push(ds.name);

    newMcp[ds.name] = merged;
  }

  if (opts.prune) {
    for (const name of Object.keys(existingMcp)) {
      if (!desiredMap.has(name)) removed.push(name);
    }
  }

  result['servers'] = newMcp;

  atomicWriteFile(filePath, JSON.stringify(result, null, 2) + '\n', 0o644);

  return { added, updated, removed };
}

export const vscodeAdapter: ToolAdapter = {
  id: 'vscode',
  displayName: 'VS Code',

  locations(opts: StackEnv): ToolConfigLocation[] {
    return [
      { path: projectPath(opts), scope: 'project' },
      { path: userPath(opts), scope: 'user' }
    ];
  },

  writeLocation(opts: StackEnv, scope: 'project' | 'user'): ToolConfigLocation | null {
    return scope === 'project'
      ? { path: projectPath(opts), scope: 'project' }
      : { path: userPath(opts), scope: 'user' };
  },

  writeServers(
    location: ToolConfigLocation,
    desired: DesiredServer[],
    opts: { prune: boolean }
  ): SyncChange {
    return writeServersToFile(location.path, desired, opts);
  },

  readServers(opts: StackEnv): ConfiguredServer[] {
    return [
      ...readServersFromFile(projectPath(opts), 'project'),
      ...readServersFromFile(userPath(opts), 'user')
    ];
  }
};
