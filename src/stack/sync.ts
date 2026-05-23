import { existsSync, readFileSync } from 'node:fs';
import { getAdapter } from './registry.js';
import type {
  AgentToolId,
  DesiredServer,
  StackEnv,
  SyncChange,
  ToolConfigLocation
} from './types.js';
import type { ManifestEntry, StackManifest } from './manifest.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ToolSyncPlan {
  tool: AgentToolId;
  location: ToolConfigLocation | null;
  change: SyncChange;
  skipped: { name: string; reason: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function manifestEntryToDesired(name: string, entry: ManifestEntry): DesiredServer {
  const ds: DesiredServer = { name };
  if (entry.command) ds.command = entry.command;
  if (entry.url) ds.url = entry.url;
  if (entry.env && Object.keys(entry.env).length > 0) ds.env = entry.env;
  if (entry.enabled === false) ds.enabled = false;
  return ds;
}

function manifestToDesired(manifest: StackManifest): DesiredServer[] {
  return Object.entries(manifest.mcp).map(([name, entry]) => manifestEntryToDesired(name, entry));
}

/**
 * Compute a diff between the current on-disk MCP config and the desired
 * servers WITHOUT writing anything.
 */
function computeDiff(
  filePath: string,
  tool: AgentToolId,
  desired: DesiredServer[],
  prune: boolean
): { change: SyncChange; skipped: { name: string; reason: string }[] } {
  const skipped: { name: string; reason: string }[] = [];

  // Determine which desired entries are "writable" for this tool
  const needsEnabled = tool === 'opencode';
  const writableDesired: DesiredServer[] = [];
  for (const ds of desired) {
    if (ds.enabled === false && !needsEnabled) {
      skipped.push({
        name: ds.name,
        reason: `${tool} does not support disabled servers; skipped`
      });
    } else {
      writableDesired.push(ds);
    }
  }

  // Read existing MCP container
  let existingMcp: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Can't diff an unparseable file — report as empty
      parsed = {};
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const doc = parsed as Record<string, unknown>;
      const mcpKey = tool === 'opencode' ? 'mcp' : 'mcpServers';
      const mcpVal = doc[mcpKey];
      if (typeof mcpVal === 'object' && mcpVal !== null) {
        existingMcp = mcpVal as Record<string, unknown>;
      }
    }
  }

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  const desiredMap = new Map<string, DesiredServer>(writableDesired.map((d) => [d.name, d]));

  for (const ds of writableDesired) {
    const existing = existingMcp[ds.name];
    if (existing === undefined) {
      added.push(ds.name);
    } else {
      // Check if it differs — build the would-be new entry and compare
      const newEntry = buildEntry(tool, ds, existing as Record<string, unknown>);
      if (JSON.stringify(existing) !== JSON.stringify(newEntry)) {
        updated.push(ds.name);
      }
    }
  }

  if (prune) {
    for (const name of Object.keys(existingMcp)) {
      if (!desiredMap.has(name)) {
        removed.push(name);
      }
    }
  }

  return { change: { added, updated, removed }, skipped };
}

const REMOTE_TYPES = new Set(['sse', 'http', 'streamable-http']);
const LOCAL_TYPES = new Set(['stdio']);

/**
 * Build what the new entry would look like for comparison purposes.
 * Mirrors the merge logic in each adapter: starts from existingRaw, applies
 * managed fields, removes keys that no longer apply.
 */
function buildEntry(
  tool: AgentToolId,
  ds: DesiredServer,
  existingRaw: Record<string, unknown>
): Record<string, unknown> {
  if (tool === 'opencode') {
    const base = { ...existingRaw };
    if (ds.url) {
      base['type'] = 'remote';
      base['url'] = ds.url;
      delete base['command'];
      delete base['environment'];
    } else {
      base['type'] = 'local';
      base['command'] = ds.command ?? [];
      if (ds.env && Object.keys(ds.env).length > 0) {
        base['environment'] = ds.env;
      } else {
        delete base['environment'];
      }
      delete base['url'];
    }
    if (ds.enabled === false) {
      base['enabled'] = false;
    } else {
      delete base['enabled'];
    }
    return base;
  }

  // claude-code, cursor, windsurf — same merge format
  const base = { ...existingRaw };
  if (ds.url) {
    base['url'] = ds.url;
    delete base['command'];
    delete base['args'];
    delete base['env'];
    const t = typeof base['type'] === 'string' ? base['type'] : undefined;
    if (t && LOCAL_TYPES.has(t)) delete base['type'];
    const tr = typeof base['transport'] === 'string' ? base['transport'] : undefined;
    if (tr && LOCAL_TYPES.has(tr)) delete base['transport'];
  } else {
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * PURE / read-only: compute what would change for each target tool without writing.
 */
export function planSync(
  manifest: StackManifest,
  opts: StackEnv,
  targets: AgentToolId[],
  scope: 'project' | 'user',
  prune: boolean
): ToolSyncPlan[] {
  const desired = manifestToDesired(manifest);
  const plans: ToolSyncPlan[] = [];

  for (const toolId of targets) {
    const adapter = getAdapter(toolId);
    if (!adapter) continue;

    const location = adapter.writeLocation(opts, scope);
    if (location === null) {
      plans.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [{ name: '*', reason: `${toolId} has no ${scope} config location` }]
      });
      continue;
    }

    const { change, skipped } = computeDiff(location.path, toolId, desired, prune);
    plans.push({ tool: toolId, location, change, skipped });
  }

  return plans;
}

/**
 * Apply the sync — calls each adapter's writeServers and returns actually-applied changes.
 */
export function applySync(
  manifest: StackManifest,
  opts: StackEnv,
  targets: AgentToolId[],
  scope: 'project' | 'user',
  prune: boolean
): ToolSyncPlan[] {
  const desired = manifestToDesired(manifest);
  const results: ToolSyncPlan[] = [];

  for (const toolId of targets) {
    const adapter = getAdapter(toolId);
    if (!adapter) continue;

    const location = adapter.writeLocation(opts, scope);
    if (location === null) {
      results.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [{ name: '*', reason: `${toolId} has no ${scope} config location` }]
      });
      continue;
    }

    // Separate skipped (disabled on tools that can't represent them) from writable
    const needsEnabled = toolId === 'opencode';
    const skipped: { name: string; reason: string }[] = [];
    const writableDesired: DesiredServer[] = [];

    for (const ds of desired) {
      if (ds.enabled === false && !needsEnabled) {
        skipped.push({
          name: ds.name,
          reason: `${toolId} does not support disabled servers; skipped`
        });
      } else {
        writableDesired.push(ds);
      }
    }

    const change = adapter.writeServers(location, writableDesired, { prune });
    results.push({ tool: toolId, location, change, skipped });
  }

  return results;
}
