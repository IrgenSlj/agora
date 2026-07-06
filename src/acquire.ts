import { resolve } from 'node:path';
import { detectOpenCodeConfigPath, loadOpenCodeConfig } from './config-files.js';
import { federatedFetchItem } from './federation/index.js';
import type { FederatedItem, FederationEnv, SourceId } from './federation/types.js';
import type { FetchLike } from './live.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  type InstallPlan,
  type MarketplaceItem,
  searchMarketplaceItems
} from './marketplace.js';
import { type ScanOptions, type ScanResult, scanItem } from './scan.js';
import { capabilityKey, descriptionDigest, readCapabilityCache } from './stack/capability-cache.js';
import { manifestPath, readManifest, type StackManifest, writeManifest } from './stack/manifest.js';
import { getAdapter } from './stack/registry.js';
import type { AgentToolId, DesiredServer, StackEnv, ToolConfigLocation } from './stack/types.js';
import {
  buildTrustMeta,
  readTrustStore,
  recordTrust,
  TRUST_META_KEY,
  trustStorePath
} from './trust-store.js';

export interface AcquireInput {
  id?: string;
  query?: string;
  /** Restrict federation resolution to a single upstream source (P2). */
  source?: SourceId;
  tool?: AgentToolId;
  configPath?: string;
  acceptWarnings?: boolean;
  save?: boolean;
  dryRun?: boolean;
  cwd?: string;
  home?: string;
  env?: Record<string, string | undefined>;
  dataDir?: string;
  fetcher?: FetchLike;
  githubToken?: string;
  scanOptions?: ScanOptions;
  deps?: AcquireDeps;
}

export interface AcquireDeps {
  findItem?: typeof findMarketplaceItem;
  searchItems?: typeof searchMarketplaceItems;
  createPlan?: typeof createInstallPlan;
  scan?: typeof scanItem;
  /**
   * Federation resolution seam (P2). Override in tests to avoid a real
   * network call — mirrors the existing `scan`/`findItem` DI pattern.
   */
  fetchFederatedItem?: typeof federatedFetchItem;
}

export interface AcquireResult {
  status: 'installed' | 'blocked' | 'needs_confirmation' | 'not_found' | 'dry_run';
  item?: MarketplaceItem;
  plan?: InstallPlan;
  scan?: ScanResult;
  written?: { tool: AgentToolId; configPath: string; serverKey: string };
  nextSteps?: string[];
  reason?: string;
}

const DEFAULT_TOOL: AgentToolId = 'opencode';

function federationEnvFrom(input: AcquireInput): FederationEnv {
  return {
    fetcher: input.fetcher,
    home: input.home,
    env: input.env
  };
}

interface ResolvedItem {
  item: MarketplaceItem;
  /** Set when the item resolved through federation — carries officialStatus/tools for the gate. */
  federated?: FederatedItem;
}

async function findRequestedItem(input: AcquireInput): Promise<ResolvedItem | null> {
  const find = input.deps?.findItem ?? findMarketplaceItem;
  const search = input.deps?.searchItems ?? searchMarketplaceItems;
  const fetchFederated = input.deps?.fetchFederatedItem ?? federatedFetchItem;
  const target = input.id ?? input.query;

  if (target) {
    // Resolve against federation first (brief P2: "acquire resolves against
    // federation, not just the bundled catalog") so the gate gets
    // officialStatus/tools when the registry has them. federatedFetchItem's
    // own `local` source already covers the bundled catalog and never throws
    // by contract; the direct bundled lookup below is kept as a defensive
    // fallback so a stubbed-out or offline federation dependency never
    // regresses plain id resolution.
    const federated = await fetchFederated(target, federationEnvFrom(input), {
      source: input.source
    }).catch(() => null);
    if (federated) return { item: federated, federated };

    const exact = find(target);
    if (exact) return { item: exact };
  }

  if (!input.query) return null;
  const hit = search({ query: input.query, limit: 1 })[0];
  return hit ? { item: hit } : null;
}

function desiredServerFromItem(item: MarketplaceItem): DesiredServer | null {
  if (item.kind !== 'package' || !item.npmPackage) return null;
  return {
    name: item.id,
    command: ['npx', item.npmPackage],
    enabled: true
  };
}

function stackEnv(input: AcquireInput): StackEnv {
  return {
    cwd: input.cwd,
    home: input.home,
    env: input.env
  };
}

function resolveConfigPath(path: string, cwd?: string): string {
  return resolve(cwd ?? process.cwd(), path);
}

/**
 * Where `acquire()` would write for this input/tool — exported so the TUI
 * Acquire page (src/cli/pages/acquire.ts) can show the PLAN stage's "where"
 * before any write happens (a dry run never reaches the code path that
 * computes this). Read-only: only detects/resolves a path, never touches disk.
 */
export function writeLocationFor(
  input: AcquireInput,
  tool: AgentToolId
): ToolConfigLocation | null {
  if (input.configPath) {
    return { path: resolveConfigPath(input.configPath, input.cwd), scope: 'project' };
  }

  if (tool === 'opencode') {
    const path = detectOpenCodeConfigPath({
      cwd: input.cwd,
      home: input.home,
      env: input.env
    });
    return { path, scope: 'project' };
  }

  const adapter = getAdapter(tool);
  return (
    adapter?.writeLocation(stackEnv(input), 'project') ??
    adapter?.writeLocation(stackEnv(input), 'user') ??
    null
  );
}

function manifestEntryFor(
  desired: DesiredServer,
  descriptionDigest?: string
): StackManifest['mcp'][string] {
  const entry: StackManifest['mcp'][string] = {};
  if (desired.url) entry.url = desired.url;
  if (desired.command) entry.command = desired.command;
  if (desired.env && Object.keys(desired.env).length > 0) entry.env = desired.env;
  if (desired.enabled === false) entry.enabled = false;
  if (descriptionDigest) entry.descriptionDigest = descriptionDigest;
  return entry;
}

function buildNextSteps(plan: InstallPlan): string[] {
  const steps = [...plan.commands];
  if (plan.postInstallHint) steps.push(plan.postInstallHint);
  // FUTURE: an in-session MCP proxy could activate a newly acquired server without restart.
  steps.push('Restart your agent or start a new session so the new MCP server is loaded.');
  return steps;
}

export async function acquire(input: AcquireInput): Promise<AcquireResult> {
  const resolved = await findRequestedItem(input);
  if (!resolved) {
    const target = input.id ?? input.query ?? '';
    return {
      status: 'not_found',
      reason: target
        ? `Item "${target}" not found. Run \`agora search ${target}\` to find packages.`
        : 'Provide an item id or capability query.'
    };
  }
  const { item, federated } = resolved;

  const tool = input.tool ?? DEFAULT_TOOL;
  const adapter = getAdapter(tool);
  if (!adapter) {
    return { status: 'blocked', item, reason: `Unsupported target tool: ${tool}` };
  }

  const configPath =
    tool === 'opencode'
      ? input.configPath
        ? resolveConfigPath(input.configPath, input.cwd)
        : detectOpenCodeConfigPath({ cwd: input.cwd, home: input.home, env: input.env })
      : undefined;
  const loaded =
    tool === 'opencode' && configPath ? loadOpenCodeConfig(configPath) : { config: {} };
  if ('error' in loaded && loaded.error) {
    return { status: 'blocked', item, reason: `${configPath}: ${loaded.error}` };
  }

  const createPlan = input.deps?.createPlan ?? createInstallPlan;
  const plan = createPlan(item, loaded.config, { dataDir: input.dataDir });
  if (!plan.installable) {
    return {
      status: 'blocked',
      item,
      plan,
      reason: plan.reason || `${item.name} cannot be installed automatically.`
    };
  }

  // Baseline digest lookup (P2 description-drift check): prefer a baseline
  // already recorded in the trust store (a previous acquire, or one shipped
  // with a cloned profile for `sync --from`'s gate-every-entry demo), fall
  // back to the local capability cache keyed by the command signature.
  const desiredForDigest = desiredServerFromItem(item);
  const trustPath = trustStorePath(stackEnv(input));
  const existingTrust = readTrustStore(trustPath)[item.id]?.[TRUST_META_KEY];
  const cachedDigest =
    input.dataDir && desiredForDigest?.command
      ? readCapabilityCache(input.dataDir).find(
          (entry) => entry.key === capabilityKey(desiredForDigest.name, desiredForDigest.command!)
        )?.descriptionDigest
      : undefined;
  const previousDigest = existingTrust?.descriptionDigestBaseline ?? cachedDigest;

  const scan = await (input.deps?.scan ?? scanItem)(item, {
    ...input.scanOptions,
    fetcher: input.fetcher ?? input.scanOptions?.fetcher,
    githubToken: input.githubToken ?? input.scanOptions?.githubToken,
    officialStatus: federated?.officialStatus ?? input.scanOptions?.officialStatus,
    tools: federated?.tools ?? input.scanOptions?.tools,
    previousDigest: previousDigest ?? input.scanOptions?.previousDigest
  });

  if (input.dryRun) {
    return {
      status: 'dry_run',
      item,
      plan,
      scan,
      nextSteps: buildNextSteps(plan),
      reason: 'Dry run only; no files were written.'
    };
  }

  if (scan.summary.fail > 0) {
    return {
      status: 'blocked',
      item,
      plan,
      scan,
      reason: `${scan.summary.fail} scan check(s) failed. Refusing to write config.`
    };
  }

  if (scan.summary.warn > 0 && !input.acceptWarnings) {
    return {
      status: 'needs_confirmation',
      item,
      plan,
      scan,
      reason: `${scan.summary.warn} scan warning(s). Re-run with --accept-warnings to proceed.`
    };
  }

  if (plan.kind !== 'mcp-config-patch') {
    return {
      status: 'blocked',
      item,
      plan,
      scan,
      reason: `Acquire can write MCP config patches only; ${item.id} is ${plan.kind}.`
    };
  }

  const desired = desiredForDigest;
  if (!desired) {
    return {
      status: 'blocked',
      item,
      plan,
      scan,
      reason: `${item.name} does not expose an MCP npm package to acquire.`
    };
  }

  const location = writeLocationFor(input, tool);
  if (!location) {
    return {
      status: 'blocked',
      item,
      plan,
      scan,
      reason: `No writable ${tool} config location found.`
    };
  }

  try {
    adapter.writeServers(location, [desired], { prune: false });
  } catch (err) {
    return {
      status: 'blocked',
      item,
      plan,
      scan,
      reason: err instanceof Error ? err.message : String(err)
    };
  }

  if (input.save) {
    const mPath = manifestPath(stackEnv(input));
    const manifest: StackManifest = readManifest(mPath) ?? { mcp: {} };
    // Prefer a digest computed fresh from the federation-resolved tool
    // schemas (the freshest baseline for exactly what's being installed)
    // over whatever was previously cached/recorded.
    const federatedDigest =
      federated?.tools && federated.tools.length > 0
        ? descriptionDigest(federated.tools)
        : undefined;
    const digestBaseline = federatedDigest ?? previousDigest;
    manifest.mcp[desired.name] = manifestEntryFor(desired, digestBaseline);
    writeManifest(mPath, manifest);

    // Trust gate data (scan verdict + drift baseline) travels alongside the
    // profile under a namespaced `_meta` key (brief P2) — see src/trust-store.ts
    // for why this is a JSON sidecar rather than a new ManifestEntry field.
    const meta = buildTrustMeta(scan, {
      officialStatus: federated?.officialStatus,
      descriptionDigestBaseline: digestBaseline
    });
    recordTrust(trustPath, desired.name, meta);
  }

  return {
    status: 'installed',
    item,
    plan,
    scan,
    written: { tool, configPath: location.path, serverKey: desired.name },
    nextSteps: buildNextSteps(plan)
  };
}

function iconFor(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
}

function renderScan(scan: ScanResult | undefined): string {
  if (!scan) return '';
  const lines = scan.checks.map((check) => {
    return `${iconFor(check.status)} **${check.label}** — ${check.message}`;
  });
  const { pass, warn, fail } = scan.summary;
  return ['**Scan**', ...lines, '', `${pass} pass · ${warn} warning(s) · ${fail} failure(s)`].join(
    '\n'
  );
}

export function renderAcquireResult(result: AcquireResult): string {
  if (result.status === 'not_found') {
    return `❌ **Acquire failed**\n\n${result.reason ?? 'Item not found.'}`;
  }

  const itemLine = result.item
    ? `**${result.item.name}** (\`${result.item.id}\`)`
    : '**Unknown item**';
  const heading =
    result.status === 'installed'
      ? `✅ **Acquired**: ${itemLine}`
      : result.status === 'dry_run'
        ? `🧪 **Acquire dry run**: ${itemLine}`
        : result.status === 'needs_confirmation'
          ? `⚠ **Acquire needs confirmation**: ${itemLine}`
          : `⛔ **Acquire blocked**: ${itemLine}`;

  const parts: string[] = [heading];
  if (result.reason) parts.push('', result.reason);
  if (result.plan) {
    parts.push('', '**Plan**');
    parts.push(`Kind: \`${result.plan.kind}\``);
    if (result.plan.commands.length > 0) {
      parts.push('Commands to run:');
      parts.push('```bash');
      parts.push(result.plan.commands.join('\n'));
      parts.push('```');
    }
    for (const note of result.plan.notes) parts.push(`- ${note}`);
  }
  const scan = renderScan(result.scan);
  if (scan) parts.push('', scan);
  if (result.written) {
    parts.push('', '**Written**');
    parts.push(
      `Tool: \`${result.written.tool}\` · Config: \`${result.written.configPath}\` · Server: \`${result.written.serverKey}\``
    );
  }
  if (result.nextSteps && result.nextSteps.length > 0) {
    parts.push('', '**Next steps**');
    for (const step of result.nextSteps) parts.push(`- ${step}`);
  }
  if (result.status === 'needs_confirmation') {
    parts.push(
      '',
      `Run \`agora acquire ${result.item?.id ?? '<id>'} --accept-warnings\` to proceed.`
    );
  }
  return parts.join('\n');
}
