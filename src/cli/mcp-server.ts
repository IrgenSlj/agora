import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  searchMarketplaceItems,
  findMarketplaceItem,
  getTrendingItems,
  getTrendingTags,
  createInstallPlan
} from '../marketplace.js';
import { getTutorials, findTutorial } from '../marketplace.js';
import { formatNumber } from '../format.js';
import type { MarketplaceItem } from '../marketplace.js';
import { scanItem, type ScanResult, type ScanOptions } from '../scan.js';
import { checkOutdated, type OutdatedOptions } from '../outdated.js';
import { AGORA_VERSION } from './app.js';
import { readAllServers, groupServersByName } from '../stack/registry.js';
import { checkStack } from '../stack/doctor.js';
import { readCapabilityCache } from '../stack/capability-cache.js';
import { buildIndex, searchIndex, type IndexableItem } from '../search/catalog-index.js';
import { detectAgoraDataDir } from '../state.js';
import type { StackEnv, AgentToolId } from '../stack/types.js';
import { acquire, renderAcquireResult } from '../acquire.js';

function backtick(s: string): string {
  return '`' + s + '`';
}

function describeItem(item: MarketplaceItem): string {
  const base = [
    `**${item.name}** (${backtick(item.id)})`,
    `${item.description}`,
    `by ${item.author} · ${item.category}`
  ].join('\n');

  if (item.kind === 'package') {
    return `${base}\n📥 ${formatNumber(item.installs)} installs · ⭐ ${formatNumber(item.stars)}`;
  }

  return `${base}\n⭐ ${formatNumber(item.stars)} · ${item.forks} forks`;
}

function formatTags(tags: string[]): string {
  return tags.map(backtick).join(', ');
}

function formatItemList(items: MarketplaceItem[]): string {
  if (items.length === 0) return 'No results found.';
  return items.map((item, i) => `${i + 1}. ${describeItem(item)}`).join('\n\n');
}

export interface AgoraMcpServerOptions {
  scan?: ScanOptions;
  outdated?: OutdatedOptions;
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

export function createAgoraMcpServer(opts: AgoraMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'agora-marketplace',
    version: AGORA_VERSION
  });

  server.registerTool(
    'search',
    {
      description: 'Search the Agora marketplace for MCP servers, prompts, and workflows',
      inputSchema: z.object({
        query: z.string().describe('Search keywords'),
        category: z
          .enum(['all', 'mcp', 'prompt', 'workflow', 'skill'])
          .optional()
          .default('all')
          .describe('Category to search in'),
        limit: z.number().optional().default(10).describe('Maximum number of results')
      })
    },
    async ({ query, category, limit }) => {
      const results = searchMarketplaceItems({ query, category, limit });
      return {
        content: [
          {
            type: 'text',
            text:
              results.length === 0
                ? `No results found for "${query}".`
                : `**Search results for "${query}"** (${results.length} found)\n\n${formatItemList(results)}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'browse',
    {
      description: 'Get full details for a specific marketplace item',
      inputSchema: z.object({
        id: z.string().describe('Item ID (e.g. mcp-github, wf-tdd-cycle)'),
        type: z
          .enum(['package', 'workflow'])
          .optional()
          .describe('Item type hint for disambiguation')
      })
    },
    async ({ id, type }) => {
      const item = findMarketplaceItem(id, type ? { type } : undefined);
      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: `Item "${id}" not found. Try \`search\` to find it.`
            }
          ]
        };
      }

      if (item.kind === 'workflow') {
        return {
          content: [
            {
              type: 'text',
              text: [
                '🔄 ' + `**${item.name}** (${backtick(item.id)})`,
                `by ${item.author} | ⭐ ${formatNumber(item.stars)} | ${item.forks} forks`,
                '',
                item.description,
                '',
                '**Tags**: ' + formatTags(item.tags),
                '',
                '**Prompt**:',
                '```',
                item.prompt,
                '```'
              ].join('\n')
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              '📦 ' + `**${item.name}** (${backtick(item.id)})`,
              `v${item.version} by ${item.author} | 📥 ${formatNumber(item.installs)} installs | ⭐ ${formatNumber(item.stars)}`,
              '',
              item.description,
              '',
              '**Tags**: ' + formatTags(item.tags),
              '**Category**: ' + item.category,
              '**Added**: ' + item.createdAt,
              item.repository ? '**Repo**: ' + item.repository : '',
              item.npmPackage ? '**npm**: ' + backtick(item.npmPackage) : ''
            ]
              .filter(Boolean)
              .join('\n')
          }
        ]
      };
    }
  );

  server.registerTool(
    'trending',
    {
      description: 'Show trending packages and workflows in the marketplace',
      inputSchema: z.object({
        category: z
          .enum(['all', 'packages', 'workflows'])
          .optional()
          .default('all')
          .describe('Which category to show'),
        limit: z.number().optional().default(5).describe('Number of items to show')
      })
    },
    async ({ category, limit }) => {
      const mcat =
        category === 'packages' ? 'package' : category === 'workflows' ? 'workflow' : 'all';
      const items = getTrendingItems({ category: mcat, limit });
      const tags = getTrendingTags(8);

      return {
        content: [
          {
            type: 'text',
            text: `📈 **Trending in Agora**\n\n${formatItemList(items)}\n\n🏷️ **Tags**: ${tags.join(', ')}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'install_plan',
    {
      description: 'Get install instructions for a marketplace item',
      inputSchema: z.object({
        id: z.string().describe('Item ID to install'),
        type: z.enum(['package', 'workflow']).optional().describe('Item type hint')
      })
    },
    async ({ id, type }) => {
      const item = findMarketplaceItem(id, type ? { type } : undefined);
      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: `Item "${id}" not found.`
            }
          ]
        };
      }

      if (item.kind === 'workflow') {
        return {
          content: [
            {
              type: 'text',
              text: `🔄 **Workflow**: ${item.name}\n\nTo use this workflow, run:\n\`\`\`bash\nagora use ${item.id}\n\`\`\`\n\nThis writes it to \`.opencode/skills/\` and registers it in your config.`
            }
          ]
        };
      }

      const plan = createInstallPlan(item);
      if (!plan.installable) {
        return {
          content: [
            {
              type: 'text',
              text: `❌ ${plan.reason || 'This item cannot be installed automatically.'}`
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `📦 **Install**: ${item.name}\n\n1. Install the package:\n\`\`\`bash\n${plan.commands[0]}\n\`\`\`\n\n2. Add to \`opencode.json\`:\n\`\`\`json\n${JSON.stringify(plan.config, null, 2)}\n\`\`\`\n\nOr run:\n\`\`\`bash\nagora install ${item.id} --write\n\`\`\``
          }
        ]
      };
    }
  );

  server.registerTool(
    'acquire',
    {
      description:
        'Acquire a marketplace MCP server by id or capability query. Runs the scan gate first: failures block writes, warnings require acceptWarnings, and dry_run writes nothing.',
      inputSchema: z.object({
        id: z.string().optional().describe('Exact item ID to acquire, such as mcp-postgres'),
        query: z
          .string()
          .optional()
          .describe('Capability query to resolve to the top marketplace match'),
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
          .describe('Proceed when the scan has warnings but no failures'),
        save: z
          .boolean()
          .optional()
          .default(false)
          .describe('Also record the acquired server in agora.toml'),
        dry_run: z
          .boolean()
          .optional()
          .default(false)
          .describe('Plan and scan only; do not write config')
      })
    },
    async ({ id, query, tool, configPath, acceptWarnings, save, dry_run }) => {
      const result = await acquire({
        id,
        query,
        tool,
        configPath,
        acceptWarnings,
        save,
        dryRun: dry_run,
        cwd: opts.stack?.cwd,
        env: opts.stack?.env,
        dataDir: opts.stack?.dataDir ?? detectAgoraDataDir({ env: opts.stack?.env }),
        scanOptions: opts.scan
      });
      return { content: [{ type: 'text', text: renderAcquireResult(result) }] };
    }
  );

  server.registerTool(
    'scan',
    {
      description:
        'Run a pre-install safety scan on a marketplace item. Checks permissions declaration, install-kind consistency, repo reachability, npm package existence, recency, and community flag count. Returns pass/warn/fail per check.',
      inputSchema: z.object({
        id: z.string().describe('Item ID to scan (e.g. mcp-github)'),
        type: z.enum(['package', 'workflow']).optional().describe('Item type hint')
      })
    },
    async ({ id, type }) => {
      const item = findMarketplaceItem(id, type ? { type } : undefined);
      if (!item) {
        return {
          content: [
            {
              type: 'text',
              text: `Item "${id}" not found. Try \`search\` to find it.`
            }
          ]
        };
      }

      const result: ScanResult = await scanItem(item, opts.scan ?? {});
      const lines = result.checks.map((c) => {
        const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
        return `${icon} **${c.label}** — ${c.message}`;
      });
      const { pass, warn, fail } = result.summary;
      const summary = `${pass} pass · ${warn} warning(s) · ${fail} failure(s)`;
      const heading = `🛡️ **Scan**: ${item.name} (${backtick(item.id)})`;
      return {
        content: [
          {
            type: 'text',
            text: `${heading}\n\n${lines.join('\n')}\n\n${summary}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'outdated',
    {
      description:
        'Check the npm registry freshness of a list of MCP package names. For each package returns latest version, days since last publish, and a freshness status (fresh / stale / unknown). Pass the names you find via `browse` or from an opencode.json.',
      inputSchema: z.object({
        packages: z
          .array(z.string())
          .min(1)
          .describe(
            'List of npm package names to check (e.g. ["@modelcontextprotocol/server-github"])'
          )
      })
    },
    async ({ packages }) => {
      const result = await checkOutdated(packages, opts.outdated ?? {});
      if (result.entries.length === 0) {
        return {
          content: [{ type: 'text', text: 'No packages provided.' }]
        };
      }
      const lines = result.entries.map((e) => {
        const icon = e.status === 'fresh' ? '✓' : e.status === 'stale' ? '⚠' : '?';
        return `${icon} **${e.pkg}** — ${e.message}`;
      });
      const { fresh, stale, unknown } = result.summary;
      const summary = `${fresh} fresh · ${stale} stale · ${unknown} unknown`;
      return {
        content: [
          {
            type: 'text',
            text: `📦 **Outdated check**\n\n${lines.join('\n')}\n\n${summary}`
          }
        ]
      };
    }
  );

  server.registerTool(
    'tutorials',
    {
      description: 'Browse available tutorials',
      inputSchema: z.object({
        query: z.string().optional().describe('Search tutorials by keyword'),
        level: z
          .enum(['all', 'beginner', 'intermediate', 'advanced'])
          .optional()
          .default('all')
          .describe('Filter by difficulty level')
      })
    },
    async ({ query, level }) => {
      const lvl = level === 'all' ? undefined : level;
      const tutorials = getTutorials({ query, level: lvl });

      if (tutorials.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: query ? `No tutorials match "${query}".` : 'No tutorials available.'
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: tutorials
              .map((t, i) => `${i + 1}. **${t.id}** — ${t.title} (${t.level}, ${t.duration})`)
              .join('\n')
          }
        ]
      };
    }
  );

  server.registerTool(
    'tutorial',
    {
      description: 'Read a specific tutorial step by step',
      inputSchema: z.object({
        id: z.string().describe('Tutorial ID (e.g. tut-mcp-basics)'),
        step: z.number().optional().default(1).describe('Step number to read')
      })
    },
    async ({ id, step }) => {
      const tutorial = findTutorial(id);
      if (!tutorial) {
        return {
          content: [
            {
              type: 'text',
              text: `Tutorial "${id}" not found. Use \`tutorials\` to see available ones.`
            }
          ]
        };
      }

      if (step > tutorial.steps.length) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ You've completed "${tutorial.title}"!`
            }
          ]
        };
      }

      const s = tutorial.steps[step - 1];
      return {
        content: [
          {
            type: 'text',
            text: `**${tutorial.title}** (${tutorial.level}, ${tutorial.duration})
**Step ${step}/${tutorial.steps.length}**: ${s.title}

${s.content}
${s.code ? `\n\`\`\`\n${s.code}\n\`\`\`` : ''}`
          }
        ]
      };
    }
  );

  // ── Stack introspection tools (read-only) ──────────────────────────────────

  // Resolve stack env once in the factory closure — deterministic for the
  // lifetime of this server instance.
  const stackEnv: StackEnv = {
    cwd: opts.stack?.cwd ?? process.cwd(),
    home: (opts.stack?.env ?? process.env).HOME,
    env: opts.stack?.env ?? process.env
  };
  const stackDataDir =
    opts.stack?.dataDir ?? detectAgoraDataDir({ env: opts.stack?.env ?? process.env });

  server.registerTool(
    'stack_installed',
    {
      description:
        "List the MCP servers configured across the user's agent tools (opencode, Claude Code, Cursor, Windsurf).",
      inputSchema: z.object({
        tool: z
          .enum([...AGENT_TOOL_IDS, 'all'] as [string, ...string[]])
          .optional()
          .default('all')
          .describe('Filter by agent tool id, or "all" for every tool')
      })
    },
    async ({ tool }) => {
      let servers = readAllServers(stackEnv);
      if (tool && tool !== 'all') {
        servers = servers.filter((s) => s.tool === tool);
      }

      if (servers.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No MCP servers configured. Run `agora search` to find servers.'
            }
          ]
        };
      }

      // Best-effort capability cache for tool counts
      const capCache = readCapabilityCache(stackDataDir);
      const toolCountByName = new Map<string, number>();
      for (const entry of capCache) {
        if (entry.ok) {
          toolCountByName.set(entry.name, entry.tools.length);
        }
      }

      const grouped = groupServersByName(servers);
      const agentToolCount = new Set(servers.map((s) => s.tool)).size;

      const lines: string[] = [];
      lines.push(`${grouped.size} server(s) configured across ${agentToolCount} agent tool(s)\n`);

      for (const [name, instances] of grouped) {
        const transport = instances.every((i) => i.transport === 'remote') ? 'remote' : 'local';
        const locations = instances
          .map((inst) => {
            const label = `${inst.tool} (${inst.scope})`;
            return inst.enabled === false ? label + ' [disabled]' : label;
          })
          .join(', ');
        const cachedTools = toolCountByName.get(name);
        const toolsSuffix = cachedTools !== undefined ? ` · ${cachedTools} tools` : '';
        lines.push(`${name}  [${transport}]  ${locations}${toolsSuffix}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.registerTool(
    'stack_doctor',
    {
      description:
        "Health-check the user's configured MCP servers (config valid, command resolvable, conflicting definitions). Static checks only — does not start servers. Probing/starting servers is available only via the `agora doctor --probe` CLI.",
      inputSchema: z.object({
        tool: z
          .enum([...AGENT_TOOL_IDS, 'all'] as [string, ...string[]])
          .optional()
          .default('all')
          .describe('Filter by agent tool id, or "all" for every tool')
      })
    },
    async ({ tool }) => {
      let servers = readAllServers(stackEnv);
      if (tool && tool !== 'all') {
        servers = servers.filter((s) => s.tool === tool);
      }

      if (servers.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No MCP servers configured. Run `agora search` to find servers.'
            }
          ]
        };
      }

      // No probe — static checks only
      const health = await checkStack(servers, { ...stackEnv });

      const lines: string[] = [];
      for (const serverHealth of health.servers) {
        const glyph =
          serverHealth.status === 'ok' ? '✓' : serverHealth.status === 'warn' ? '⚠' : '✗';
        lines.push(`${glyph}  ${serverHealth.name}`);
        if (serverHealth.status !== 'ok') {
          for (const check of serverHealth.checks) {
            if (!check.ok && check.detail) {
              lines.push(`     ${check.detail}`);
            }
          }
        }
      }

      lines.push('');
      const { ok, warn, error } = health.summary;
      lines.push(`ok: ${ok}  warn: ${warn}  error: ${error}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.registerTool(
    'stack_capabilities',
    {
      description:
        'Search the tools exposed by the user\'s MCP servers (discovered by probing via the CLI), or list them. Answers "which of the user\'s servers can do X".',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Search query to rank tools by relevance (BM25). Omit to list all.'),
        server: z
          .string()
          .optional()
          .describe('Filter to tools from a specific server name (exact or substring match)')
      })
    },
    async ({ query, server }) => {
      const entries = readCapabilityCache(stackDataDir);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: [
                'No capability data found. Tools are discovered by probing configured MCP servers.',
                'Hints:',
                '  agora doctor --probe   (probe all configured servers)',
                '  agora try <id>         (test-drive a marketplace item)'
              ].join('\n')
            }
          ]
        };
      }

      interface FlatTool {
        server: string;
        name: string;
        description: string;
      }

      // Flatten, skip failed probes
      let allTools: FlatTool[] = [];
      for (const entry of entries) {
        if (entry.ok === false) continue;
        for (const t of entry.tools) {
          allTools.push({
            server: entry.name,
            name: t.name,
            description: t.description ?? ''
          });
        }
      }

      // Server filter
      if (server !== undefined) {
        const lower = server.toLowerCase();
        const exact = allTools.filter((t) => t.server.toLowerCase() === lower);
        allTools =
          exact.length > 0 ? exact : allTools.filter((t) => t.server.toLowerCase().includes(lower));
      }

      if (query && query.trim()) {
        // BM25 ranked query
        const items: IndexableItem[] = allTools.map((t) => ({
          id: `${t.server}::${t.name}`,
          name: t.name,
          description: t.description,
          author: t.server,
          category: 'tool',
          tags: [t.server]
        }));

        const index = buildIndex(items);
        const scored = searchIndex(index, query);

        const toolById = new Map<string, FlatTool>();
        for (const t of allTools) {
          toolById.set(`${t.server}::${t.name}`, t);
        }

        const rankedTools: FlatTool[] = [];
        for (const { id } of scored) {
          const t = toolById.get(id);
          if (t) rankedTools.push(t);
        }

        if (rankedTools.length === 0) {
          return {
            content: [{ type: 'text', text: `No tools matched: ${query}` }]
          };
        }

        const lines = rankedTools.map((t) => `${t.name} — ${t.description} (${t.server})`);
        const serverSet = new Set(rankedTools.map((t) => t.server));
        lines.push('');
        lines.push(`${rankedTools.length} tool(s) across ${serverSet.size} server(s)`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // List mode: grouped by server
      const byServer = new Map<string, FlatTool[]>();
      for (const t of allTools) {
        let list = byServer.get(t.server);
        if (!list) {
          list = [];
          byServer.set(t.server, list);
        }
        list.push(t);
      }

      const sortedServers = Array.from(byServer.keys()).sort();
      const lines: string[] = [];
      for (const serverName of sortedServers) {
        const tools = byServer
          .get(serverName)!
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
        lines.push(serverName);
        for (const t of tools) {
          lines.push(`  ${t.name}${t.description ? ' — ' + t.description : ''}`);
        }
        lines.push('');
      }

      const serverSet = new Set(allTools.map((t) => t.server));
      lines.push(`${allTools.length} tool(s) across ${serverSet.size} server(s)`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createAgoraMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
