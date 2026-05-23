import { readAllServers, groupServersByName } from '../stack/registry.js';
import { checkStack } from '../stack/doctor.js';
import type { StackHealth } from '../stack/doctor.js';
import { readCapabilityCache } from '../stack/capability-cache.js';
import type { ServerCapabilities } from '../stack/capability-cache.js';
import { manifestPath, readManifest } from '../stack/manifest.js';
import type { StackManifest } from '../stack/manifest.js';
import { getHotItems } from '../marketplace.js';
import type { MarketplaceItem } from '../marketplace.js';
import type { ConfiguredServer, StackEnv } from '../stack/types.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface StackSummary {
  serverCount: number; // distinct server names across all tools
  toolCount: number; // distinct agent tools with ≥1 server
  capabilityCount: number; // total tools advertised, from the capability cache (ok entries)
  health: { ok: number; warn: number; error: number };
}

export type OpportunityKind = 'getting-started' | 'health' | 'untracked' | 'drift' | 'gap';

export interface Opportunity {
  id: string;
  kind: OpportunityKind;
  title: string; // one-line, human, present-tense
  detail?: string; // optional secondary line
  command?: string; // a suggested `agora …` command the user can run
  priority: number; // higher = more important; used for ranking
}

// ── Pure functions ────────────────────────────────────────────────────────────

export function summarizeStack(
  servers: ConfiguredServer[],
  health: StackHealth,
  caps: ServerCapabilities[]
): StackSummary {
  const byName = groupServersByName(servers);
  const serverCount = byName.size;

  const tools = new Set(servers.map((s) => s.tool));
  const toolCount = tools.size;

  const capabilityCount = caps.filter((c) => c.ok).reduce((sum, c) => sum + c.tools.length, 0);

  return {
    serverCount,
    toolCount,
    capabilityCount,
    health: health.summary
  };
}

export function computeOpportunities(input: {
  servers: ConfiguredServer[];
  manifest: StackManifest | null;
  health: StackHealth;
  hot: MarketplaceItem[];
}): Opportunity[] {
  const { servers, manifest, health, hot } = input;
  const opportunities: Opportunity[] = [];

  // getting-started (priority 100) — no servers configured at all
  if (servers.length === 0) {
    opportunities.push({
      id: 'getting-started',
      kind: 'getting-started',
      title: 'No MCP servers configured yet',
      detail: 'Search the marketplace to find and install MCP servers.',
      command: 'agora search',
      priority: 100
    });
  }

  // health (priority 90 for error, 75 for warn-only)
  if (health.summary.error > 0) {
    const failingNames = health.servers.filter((s) => s.status === 'error').map((s) => s.name);
    const count = failingNames.length;
    opportunities.push({
      id: 'health',
      kind: 'health',
      title: `${count} server${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`,
      detail: failingNames.join(', '),
      command: 'agora doctor',
      priority: 90
    });
  } else if (health.summary.warn > 0) {
    const warnNames = health.servers.filter((s) => s.status === 'warn').map((s) => s.name);
    const count = warnNames.length;
    opportunities.push({
      id: 'health',
      kind: 'health',
      title: `${count} server${count === 1 ? '' : 's'} ha${count === 1 ? 's' : 've'} warnings`,
      detail: warnNames.join(', '),
      command: 'agora doctor',
      priority: 75
    });
  }

  // untracked (priority 70) — servers present but no manifest
  if (servers.length > 0 && manifest === null) {
    opportunities.push({
      id: 'untracked',
      kind: 'untracked',
      title: "Your stack isn't captured in agora.toml",
      detail: 'Freeze your current config to track it.',
      command: 'agora freeze --write',
      priority: 70
    });
  }

  // drift (priority 80) — manifest present but names differ
  if (manifest !== null) {
    const configuredNames = new Set(
      [...groupServersByName(servers).keys()].map((n) => n.toLowerCase())
    );
    const manifestNames = new Set(Object.keys(manifest.mcp).map((n) => n.toLowerCase()));

    const toAdd = [...manifestNames].filter((n) => !configuredNames.has(n));
    const missing = [...configuredNames].filter((n) => !manifestNames.has(n));

    if (toAdd.length > 0 || missing.length > 0) {
      opportunities.push({
        id: 'drift',
        kind: 'drift',
        title: `Your agora.toml is out of sync with your live config (${toAdd.length} to add / ${missing.length} missing)`,
        detail: [
          toAdd.length > 0 ? `Not configured: ${toAdd.join(', ')}` : '',
          missing.length > 0 ? `Not in manifest: ${missing.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('; '),
        command: 'agora sync',
        priority: 80
      });
    }
  }

  // gap (priority 60) — trending items the user doesn't have, packages only, cap 2
  const configuredLower = new Set([
    ...servers.map((s) => s.name.toLowerCase()),
    ...servers.map((s) => s.name.toLowerCase())
  ]);

  let gapCount = 0;
  for (const item of hot) {
    if (gapCount >= 2) break;
    if (item.kind !== 'package') continue;
    if (configuredLower.has(item.id.toLowerCase())) continue;
    if (configuredLower.has(item.name.toLowerCase())) continue;
    opportunities.push({
      id: `gap:${item.id}`,
      kind: 'gap',
      title: `Trending you don't have: ${item.name}`,
      detail: item.description,
      command: `agora scan ${item.id}`,
      priority: 60
    });
    gapCount++;
  }

  // Sort by priority desc, then id asc; cap at 6
  opportunities.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  });

  return opportunities.slice(0, 6);
}

// ── Gather wrapper (does the I/O) ─────────────────────────────────────────────

export async function buildHomeFeed(
  env: StackEnv,
  dataDir: string
): Promise<{ summary: StackSummary; opportunities: Opportunity[] }> {
  let servers: ConfiguredServer[];
  try {
    servers = readAllServers(env);
  } catch {
    servers = [];
  }

  let health: StackHealth;
  try {
    health = await checkStack(servers, { ...env });
  } catch {
    health = { servers: [], summary: { ok: 0, warn: 0, error: 0 } };
  }

  let caps: ServerCapabilities[];
  try {
    caps = readCapabilityCache(dataDir);
  } catch {
    caps = [];
  }

  let manifest: StackManifest | null;
  try {
    manifest = readManifest(manifestPath(env));
  } catch {
    manifest = null;
  }

  let hot: MarketplaceItem[];
  try {
    hot = getHotItems({ category: 'package', limit: 8 });
  } catch {
    hot = [];
  }

  return {
    summary: summarizeStack(servers, health, caps),
    opportunities: computeOpportunities({ servers, manifest, health, hot })
  };
}
