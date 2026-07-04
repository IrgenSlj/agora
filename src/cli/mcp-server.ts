import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AGORA_VERSION } from './app.js';
import { scanItem, type ScanOptions } from '../scan.js';
import { federatedSearch, federatedFetchItem, SOURCES } from '../federation/index.js';
import type { FederationEnv, SourceId } from '../federation/types.js';
import { readAllServers, detectTools, ALL_ADAPTERS } from '../stack/registry.js';
import { checkStack } from '../stack/doctor.js';
import { readCapabilityCache } from '../stack/capability-cache.js';
import { manifestPath, readManifest, loadManifestFromSource } from '../stack/manifest.js';
import { planSync, planInstructionsSync, gateManifestForSync } from '../stack/sync.js';
import { detectAgoraDataDir } from '../state.js';
import type { StackEnv, AgentToolId } from '../stack/types.js';
import { acquire } from '../acquire.js';
import { trustStorePath, readTrustStore, TRUST_META_KEY } from '../trust-store.js';

/**
 * The `agora mcp` tool surface (brief §5b) — the universal plugin. Kept small
 * on purpose (≤8 tools; MCP tool definitions cost context in every session)
 * and honest: every tool's result mirrors the matching CLI `--json` shape
 * 1:1, sourced directly from `src/federation` + `src/stack` (no re-derived
 * logic living only in this file). `agora_acquire` can never bypass the
 * trust gate — `confirm` only toggles dry-run; the gate inside `acquire()`
 * still decides whether a confirmed call is allowed to write.
 */

export interface AgoraMcpServerOptions {
  scan?: ScanOptions;
  /** Federation env for `agora_search` / `agora_browse` (DI fetcher/cache dir keeps tests hermetic). */
  federation?: FederationEnv;
  stack?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    dataDir?: string;
  };
}

const AGENT_TOOL_IDS: [AgentToolId, ...AgentToolId[]] = [
  'opencode',
  'claude-code',
  'cursor',
  'windsurf'
];

// The sources actually wired into federation (SOURCES is the single source
// of truth in src/federation/index.ts) — not the full SourceId union, which
// also names sources not implemented yet (smithery/glama/github/huggingface).
const SOURCE_IDS = SOURCES.map((s) => s.id) as [SourceId, ...SourceId[]];

function jsonContent(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function createAgoraMcpServer(opts: AgoraMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'agora',
    version: AGORA_VERSION
  });

  const stackEnv: StackEnv = {
    cwd: opts.stack?.cwd ?? process.cwd(),
    home: (opts.stack?.env ?? process.env).HOME,
    env: opts.stack?.env ?? process.env
  };
  const stackDataDir =
    opts.stack?.dataDir ?? detectAgoraDataDir({ env: opts.stack?.env ?? process.env });
  const federationEnv: FederationEnv = opts.federation ?? {};

  // ── agora_search ───────────────────────────────────────────────────────────
  server.registerTool(
    'agora_search',
    {
      description:
        'Search the federated MCP catalog (official MCP Registry + local bundled catalog, ' +
        'deduped across sources) for MCP servers and workflows. Mirrors `agora search --json`.',
      inputSchema: z.object({
        query: z.string().describe('Search keywords'),
        source: z
          .enum(SOURCE_IDS)
          .optional()
          .describe('Restrict the search to a single upstream source'),
        limit: z.number().optional().default(10).describe('Maximum number of results')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ query, source, limit }) => {
      const { items, statuses } = await federatedSearch(query, { source, limit }, federationEnv);
      const results = items.slice(0, limit);
      return jsonContent({
        query,
        source: source ?? 'all',
        statuses,
        count: results.length,
        items: results
      });
    }
  );

  // ── agora_browse ───────────────────────────────────────────────────────────
  server.registerTool(
    'agora_browse',
    {
      description:
        'Full merged catalog item detail, including trust-panel data: a fresh scan-gate ' +
        'verdict, official-registry status, and any trust record from a prior `agora_acquire`. ' +
        'Resolves against the same federation the CLI `agora browse` uses.',
      inputSchema: z.object({
        id: z.string().describe('Item id or ref, e.g. mcp-github or io.github.user/server'),
        source: z
          .enum(SOURCE_IDS)
          .optional()
          .describe('Restrict resolution to a single upstream source')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ id, source }) => {
      const item = await federatedFetchItem(id, federationEnv, { source });
      if (!item) {
        return jsonContent({ id, found: false, reason: `Item "${id}" not found.` });
      }

      const scan = await scanItem(item, {
        ...opts.scan,
        officialStatus: item.officialStatus,
        tools: item.tools
      });

      const trustPath = trustStorePath({ cwd: opts.stack?.cwd, env: opts.stack?.env });
      const trust = readTrustStore(trustPath)[item.id]?.[TRUST_META_KEY] ?? null;

      return jsonContent({ id, found: true, item, scan, trust });
    }
  );

  // ── agora_stack_status ─────────────────────────────────────────────────────
  server.registerTool(
    'agora_stack_status',
    {
      description:
        "Doctor summary of the user's configured MCP stack across opencode/Claude Code/Cursor/" +
        'Windsurf: per-server static health (command resolvable, valid remote url, disabled, ' +
        'conflicting definitions) plus discovered tool capabilities from the local probe cache. ' +
        'Static checks only — never starts servers (use `agora doctor --probe` in the CLI for that). ' +
        'Mirrors `agora doctor --json`, enriched with each server\'s cached tool list.',
      inputSchema: z.object({
        tool: z
          .enum([...AGENT_TOOL_IDS, 'all'] as [string, ...string[]])
          .optional()
          .default('all')
          .describe('Filter by agent tool id, or "all" for every tool')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ tool }) => {
      let servers = readAllServers(stackEnv);
      if (tool && tool !== 'all') {
        servers = servers.filter((s) => s.tool === tool);
      }

      const health = await checkStack(servers, { ...stackEnv, dataDir: stackDataDir });

      const capCache = readCapabilityCache(stackDataDir);
      const toolsByName = new Map(
        capCache.filter((entry) => entry.ok).map((entry) => [entry.name, entry.tools])
      );

      const enrichedServers = health.servers.map((s) => ({
        ...s,
        tools: toolsByName.get(s.name) ?? []
      }));

      return jsonContent({ servers: enrichedServers, summary: health.summary });
    }
  );

  // ── agora_plan ─────────────────────────────────────────────────────────────
  server.registerTool(
    'agora_plan',
    {
      description:
        'Read-only diff between agora.toml and the real MCP config / instruction files of every ' +
        'detected agent tool. Never writes anything. `from` previews a shared profile (git url, ' +
        'gist, or path) and runs the same scan gate `agora sync --from` runs before diffing — a ' +
        'hard fail short-circuits to a gate-blocked result. Mirrors `agora plan --json`.',
      inputSchema: z.object({
        tool: z
          .enum(AGENT_TOOL_IDS)
          .optional()
          .describe('Target a single agent tool; default is every detected tool'),
        scope: z
          .enum(['project', 'user'])
          .optional()
          .default('project')
          .describe('Config scope to diff'),
        prune: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include removal of unmanaged servers/instructions in the diff'),
        from: z
          .string()
          .optional()
          .describe('Preview a shared profile from a git url, gist, or file path instead of ./agora.toml')
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    async ({ tool, scope, prune, from }) => {
      let manifest;
      try {
        manifest = from
          ? await loadManifestFromSource(from, { cwd: stackEnv.cwd })
          : readManifest(manifestPath(stackEnv));
      } catch (e) {
        return jsonContent({ error: e instanceof Error ? e.message : String(e) });
      }

      if (!manifest) {
        return jsonContent({
          error: `No agora.toml manifest found at ${manifestPath(stackEnv)}. Run \`agora freeze --write\` first.`
        });
      }

      const isRemote = from !== undefined && /^https?:\/\//i.test(from);

      if (from) {
        const gate = await gateManifestForSync(manifest, {
          cwd: stackEnv.cwd,
          baseSource: isRemote ? from : undefined
        });
        if (!gate.ok) {
          return jsonContent({ mode: 'gate-blocked', blocked: gate.blocked });
        }
      }

      let targets: AgentToolId[];
      if (tool) {
        targets = [tool];
      } else {
        const detected = detectTools(stackEnv);
        targets = detected.filter((t) => t.present).map((t) => t.adapter.id as AgentToolId);
        if (targets.length === 0) targets = ALL_ADAPTERS.map((a) => a.id);
      }

      const servers = planSync(manifest, stackEnv, targets, scope, prune);
      const instructions = await planInstructionsSync(manifest, stackEnv, targets, scope, prune, {
        baseSource: isRemote ? from : undefined
      });

      return jsonContent({ mode: 'plan', tools: servers, instructions });
    }
  );

  // ── agora_acquire ──────────────────────────────────────────────────────────
  server.registerTool(
    'agora_acquire',
    {
      description:
        'Gated capability acquisition: resolve an item by id or capability query, build an install ' +
        'plan, and run the trust gate. Without `confirm`, this call is always a dry run — it returns ' +
        'the plan and gate verdict and writes nothing. To actually install, call again with ' +
        '`confirm: true`; the gate still decides — a `fail` verdict never writes, and a `warn` ' +
        'verdict additionally requires `acceptWarnings: true` on the confirming call. `confirm` can ' +
        'never bypass the gate. Mirrors `agora acquire --json`.',
      inputSchema: z.object({
        id: z.string().optional().describe('Exact item id to acquire, e.g. mcp-postgres'),
        query: z
          .string()
          .optional()
          .describe('Capability query to resolve to the top catalog match'),
        source: z
          .enum(SOURCE_IDS)
          .optional()
          .describe('Restrict resolution to a single upstream source'),
        tool: z
          .enum(AGENT_TOOL_IDS)
          .optional()
          .default('opencode')
          .describe('Target agent config to write'),
        configPath: z
          .string()
          .optional()
          .describe('Explicit config path for the target agent tool'),
        acceptWarnings: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Proceed when the gate has warnings but no failures — only takes effect together with confirm: true'
          ),
        save: z
          .boolean()
          .optional()
          .default(false)
          .describe('Also record the acquired server in agora.toml'),
        confirm: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Second-call confirmation. Without it, the call is always a dry run (plan + gate ' +
              'verdict, nothing written). The gate decides whether a confirmed call is allowed to write.'
          )
      }),
      annotations: { destructiveHint: true }
    },
    async ({ id, query, source, tool, configPath, acceptWarnings, save, confirm }) => {
      const result = await acquire({
        id,
        query,
        source,
        tool,
        configPath,
        acceptWarnings,
        save,
        dryRun: !confirm,
        cwd: opts.stack?.cwd,
        env: opts.stack?.env,
        dataDir: stackDataDir,
        scanOptions: opts.scan,
        // Route acquire's federation resolution through the same federation env
        // as agora_search/agora_browse. In production `federationEnv` is `{}`, so
        // acquire's own derived env passes through unchanged; under test the
        // injected DI fetcher wins, keeping resolution hermetic (no live fan-out
        // to the six sources on `agora_acquire`).
        deps: {
          fetchFederatedItem: (ref, env, o) =>
            federatedFetchItem(ref, { ...env, ...federationEnv }, o)
        }
      });
      return jsonContent(result);
    }
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createAgoraMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // `connect()` only finishes the stdio handshake/setup — it resolves almost
  // immediately, it does NOT block for the life of the session. Every CLI
  // command follows "resolve once, then src/cli.ts calls process.exit()", so
  // without this the whole MCP server would be torn down moments after
  // startup instead of servicing requests until the client disconnects.
  // Wait for the underlying transport to actually close (in practice: the
  // parent process managing this child — OpenCode, Claude Code, etc. —
  // terminates it directly; this promise is here so a future/explicit
  // `server.close()` still exits cleanly with code 0 instead of hanging).
  await new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
}
