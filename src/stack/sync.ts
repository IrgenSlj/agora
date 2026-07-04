import { existsSync, readFileSync } from 'node:fs';
import { getAdapter } from './registry.js';
import { hashContent, resolveInstructionContent } from './manifest.js';
import { scanItem, type ScanOptions, type ScanResult } from '../scan.js';
import type { MarketplaceItem } from '../marketplace/types.js';
import type { FetchLike } from '../live.js';
import type {
  AdapterInstructionsLocation,
  AgentToolId,
  DesiredInstruction,
  DesiredServer,
  StackEnv,
  SyncChange,
  ToolAdapter,
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

// ── Instruction artifacts: plan/apply (P3) ─────────────────────────────────────

type AdapterWithInstructions = ToolAdapter & Partial<AdapterInstructionsLocation>;

export interface InstructionSyncExtra {
  fetcher?: FetchLike;
  /** Set when the manifest came from a remote `--from` source (a URL). */
  baseSource?: string;
}

async function resolveDesiredInstructions(
  manifest: StackManifest,
  opts: StackEnv,
  extra: InstructionSyncExtra
): Promise<{ desired: DesiredInstruction[]; errors: { name: string; error: string }[] }> {
  const desired: DesiredInstruction[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const [name, entry] of Object.entries(manifest.instructions ?? {})) {
    if (entry.enabled === false) continue;
    try {
      const content = await resolveInstructionContent(entry, {
        cwd: opts.cwd,
        fetcher: extra.fetcher,
        baseSource: extra.baseSource
      });
      desired.push({ name, source: 'inline', content });
    } catch (e) {
      errors.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { desired, errors };
}

function diffInstructions(
  configured: { name: string; contentHash: string }[],
  desired: DesiredInstruction[],
  prune: boolean
): SyncChange {
  const configuredMap = new Map(configured.map((c) => [c.name, c.contentHash]));
  const desiredNames = new Set(desired.map((d) => d.name));

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const d of desired) {
    const existingHash = configuredMap.get(d.name);
    const newHash = hashContent(d.content ?? '');
    if (existingHash === undefined) {
      added.push(d.name);
    } else if (existingHash !== newHash) {
      updated.push(d.name);
    }
  }

  if (prune) {
    for (const name of configuredMap.keys()) {
      if (!desiredNames.has(name)) removed.push(name);
    }
  }

  return { added, updated, removed };
}

function unresolvedSkips(errors: { name: string; error: string }[]): { name: string; reason: string }[] {
  return errors.map((e) => ({ name: e.name, reason: `could not resolve content: ${e.error}` }));
}

/**
 * PURE / read-only: compute what would change for each target tool's
 * instruction artifacts, without writing anything. Mirrors planSync's shape
 * (ToolSyncPlan) so CLI formatting/JSON output can treat servers and
 * instructions uniformly.
 */
export async function planInstructionsSync(
  manifest: StackManifest,
  opts: StackEnv,
  targets: AgentToolId[],
  scope: 'project' | 'user',
  prune: boolean,
  extra: InstructionSyncExtra = {}
): Promise<ToolSyncPlan[]> {
  const { desired, errors } = await resolveDesiredInstructions(manifest, opts, extra);
  const skipped = unresolvedSkips(errors);
  const plans: ToolSyncPlan[] = [];

  for (const toolId of targets) {
    const adapter = getAdapter(toolId) as AdapterWithInstructions | undefined;
    if (!adapter) continue;

    if (!adapter.readInstructions || !adapter.writeInstructions || !adapter.instructionsLocation) {
      plans.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [...skipped, { name: '*', reason: `${toolId} does not manage instruction artifacts` }]
      });
      continue;
    }

    const location = adapter.instructionsLocation(opts, scope);
    if (location === null) {
      plans.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [...skipped, { name: '*', reason: `${toolId} has no ${scope} instructions location` }]
      });
      continue;
    }

    const configured = adapter.readInstructions(opts).filter((c) => c.scope === scope);
    const change = diffInstructions(configured, desired, prune);
    plans.push({ tool: toolId, location, change, skipped });
  }

  return plans;
}

/**
 * Apply the sync for instruction artifacts — calls each adapter's
 * writeInstructions and returns actually-applied changes.
 */
export async function applyInstructionsSync(
  manifest: StackManifest,
  opts: StackEnv,
  targets: AgentToolId[],
  scope: 'project' | 'user',
  prune: boolean,
  extra: InstructionSyncExtra = {}
): Promise<ToolSyncPlan[]> {
  const { desired, errors } = await resolveDesiredInstructions(manifest, opts, extra);
  const skipped = unresolvedSkips(errors);
  const results: ToolSyncPlan[] = [];

  for (const toolId of targets) {
    const adapter = getAdapter(toolId) as AdapterWithInstructions | undefined;
    if (!adapter) continue;

    if (!adapter.writeInstructions || !adapter.instructionsLocation) {
      results.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [...skipped, { name: '*', reason: `${toolId} does not manage instruction artifacts` }]
      });
      continue;
    }

    const location = adapter.instructionsLocation(opts, scope);
    if (location === null) {
      results.push({
        tool: toolId,
        location: null,
        change: { added: [], updated: [], removed: [] },
        skipped: [...skipped, { name: '*', reason: `${toolId} has no ${scope} instructions location` }]
      });
      continue;
    }

    const change = adapter.writeInstructions(location, desired, { prune });
    results.push({ tool: toolId, location, change, skipped });
  }

  return results;
}

// ── sync --from: trust gate over every entry in a fetched profile (P3) ────────
//
// Reuses the EXISTING exported scan gate (scanItem, src/scan.ts) as-is — it is
// not reimplemented or modified here. Each mcp/instruction entry in a `--from`
// manifest is projected into a MarketplaceItem shape scanItem already knows
// how to check (permission/repo/npm checks for mcp "packages"; description-
// injection + flag-count checks for instruction "workflows", using the
// resolved instruction text AS the scanned description — a poisoned
// CLAUDE.md/AGENTS.md snippet is exactly what checkDescriptionInjection is
// built to catch). Any `fail` blocks the whole sync before anything is
// written (exit 3 at the CLI layer).

export interface GateEntry {
  name: string;
  kind: 'mcp' | 'instruction';
  scan: ScanResult;
}

export interface GateReport {
  ok: boolean;
  entries: GateEntry[];
  blocked: GateEntry[];
}

export interface GateOptions {
  fetcher?: FetchLike;
  cwd?: string;
  baseSource?: string;
  scanOptions?: ScanOptions;
  /** Test seam — override scanItem itself, mirroring AcquireDeps.scan. */
  deps?: { scan?: typeof scanItem };
}

function extractNpmPackage(command?: string[]): string | undefined {
  if (!command || command.length === 0) return undefined;
  const [bin, ...rest] = command;
  if (bin !== 'npx' && bin !== 'npm') return undefined;
  return rest.find((arg) => !arg.startsWith('-'));
}

function mcpEntryToScanItem(name: string, entry: ManifestEntry): MarketplaceItem {
  return {
    id: name,
    kind: 'package',
    name,
    description: entry.command ? entry.command.join(' ') : (entry.url ?? ''),
    author: 'agora-sync-from',
    version: '0.0.0',
    category: 'mcp',
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: new Date(0).toISOString(),
    npmPackage: extractNpmPackage(entry.command)
  } as MarketplaceItem;
}

function instructionToScanItem(name: string, content: string): MarketplaceItem {
  return {
    id: name,
    kind: 'workflow',
    name,
    description: content,
    author: 'agora-sync-from',
    prompt: content,
    tags: [],
    stars: 0,
    forks: 0,
    createdAt: new Date(0).toISOString(),
    category: 'workflow',
    installs: 0
  } as MarketplaceItem;
}

function failedResolveScan(name: string, message: string): ScanResult {
  return {
    id: name,
    itemKind: 'workflow',
    checks: [
      {
        name: 'content_resolvable',
        label: 'Instruction content resolvable',
        status: 'fail',
        message
      }
    ],
    summary: { pass: 0, warn: 0, fail: 1 }
  };
}

/**
 * Run the scan gate over every mcp server and instruction entry in `manifest`
 * (skipping entries explicitly `enabled: false`). Nothing is written by this
 * function — it is pure read/scan. Callers refuse to plan/apply when
 * `report.ok` is false.
 */
export async function gateManifestForSync(
  manifest: StackManifest,
  opts: GateOptions = {}
): Promise<GateReport> {
  const scan = opts.deps?.scan ?? scanItem;
  const entries: GateEntry[] = [];

  for (const [name, entry] of Object.entries(manifest.mcp)) {
    if (entry.enabled === false) continue;
    const item = mcpEntryToScanItem(name, entry);
    const result = await scan(item, { ...opts.scanOptions, fetcher: opts.fetcher });
    entries.push({ name, kind: 'mcp', scan: result });
  }

  for (const [name, entry] of Object.entries(manifest.instructions ?? {})) {
    if (entry.enabled === false) continue;
    let content: string;
    try {
      content = await resolveInstructionContent(entry, {
        cwd: opts.cwd,
        fetcher: opts.fetcher,
        baseSource: opts.baseSource
      });
    } catch (e) {
      entries.push({
        name,
        kind: 'instruction',
        scan: failedResolveScan(name, e instanceof Error ? e.message : String(e))
      });
      continue;
    }
    const item = instructionToScanItem(name, content);
    const result = await scan(item, { ...opts.scanOptions, fetcher: opts.fetcher });
    entries.push({ name, kind: 'instruction', scan: result });
  }

  const blocked = entries.filter((e) => e.scan.summary.fail > 0);
  return { ok: blocked.length === 0, entries, blocked };
}
