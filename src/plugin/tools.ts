import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { type AcquireInput, acquire, renderAcquireResult } from '../acquire.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  getTrendingItems,
  type MarketplaceItem,
  searchMarketplaceItems
} from '../catalog/bundled.js';
import { formatConfigJson } from '../config.js';
import { formatInstalls, formatStars } from '../format.js';

/** `📥 N installs · ` when measured, and nothing at all when not. */
function installsPrefix(installs: number | undefined): string {
  return installs === undefined ? '' : `📥 ${formatInstalls(installs)} installs · `;
}

import { readCache } from '../news/cache.js';
import { rankItems } from '../news/score.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../news/types.js';
import { type ScanResult, scanItem } from '../scan.js';
import { detectAgoraDataDir } from '../state.js';
import { createAgoraRuntimeTools } from './runtime-tools.js';

function statusIcon(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
}

function renderScanResult(
  item: MarketplaceItem,
  result: ScanResult,
  mode = 'Scan Results'
): string {
  const checks = result.checks
    .map((check) => `${statusIcon(check.status)} **${check.label}** — ${check.message}`)
    .join('\n');
  const { pass, warn, fail } = result.summary;
  return `🛡️ **${mode}** for ${item.name} (\`${item.id}\`)

${checks}

${pass} pass · ${warn} warning(s) · ${fail} failure(s)

Run \`agora scan ${item.id}\` in your terminal for live repository and npm verification.`;
}

function pluginDataDir(directory?: string, env?: Record<string, string | undefined>): string {
  return detectAgoraDataDir({ cwd: directory, env: env ?? process.env });
}

function ageLabel(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function renderToday(directory?: string, section = 'all'): string {
  const dataDir = pluginDataDir(directory);
  const cached = readCache(dataDir);
  const news = rankItems(cached, DEFAULT_NEWS_CONFIG, new Date()).slice(0, 3);
  const trending = getTrendingItems().slice(0, 3);
  const lines: string[] = ['📅 **Agora Today**', ''];
  const wantsNews = section === 'all' || section === 'news';
  const wantsMarket = section === 'all' || section === 'market' || section === 'catalog';

  if (wantsNews) {
    lines.push('**News**');
    if (news.length === 0) {
      lines.push('No cached news yet. Run `agora today` in your terminal to fetch.');
    } else {
      for (const item of news) {
        lines.push(`- ${item.title} · ${hostFromUrl(item.url)} · ${ageLabel(item.publishedAt)}`);
      }
    }
  }

  if (wantsMarket) {
    if (lines.length > 2) lines.push('');
    lines.push('**Trending**');
    for (const item of trending) {
      lines.push(`- **${item.id}** — ${installsPrefix(item.installs)}${item.name}`);
    }
  }

  if (!wantsNews && !wantsMarket) {
    lines.push('Unknown section. Use `news`, `market`, or `all`.');
  }

  lines.push(
    '',
    'Run `/agora browse <id>` for details or `/agora acquire <id>` for a safe preview.'
  );
  return lines.join('\n');
}

async function pluginAcquirePreview(input: Pick<AcquireInput, 'id' | 'query' | 'cwd' | 'env'>) {
  return acquire({
    ...input,
    dryRun: true,
    scanOptions: { offline: true },
    deps: {
      scan: (item, opts) => scanItem(item, { ...opts, offline: true })
    }
  });
}

export function createAgoraTools(input?: PluginInput): Record<string, ToolDefinition> {
  return {
    agora_search: tool({
      description: 'Search the Agora catalog for MCP servers, packages, and workflows',
      args: {
        query: tool.schema.string().describe('Search query'),
        category: tool.schema
          .string()
          .optional()
          .describe('Filter by category: mcp, prompt, workflow, all')
      },
      async execute(args, _context) {
        const query = args.query;
        const category = args.category || 'all';
        const filtered = searchMarketplaceItems({ query, category, limit: 10 });

        if (filtered.length === 0) {
          return `No results found for "${query}". Try a different search term.`;
        }

        return `🔍 **Search Results** for "${query}" (${filtered.length} found)

${filtered
  .map((item, i) => {
    const shortDesc = item.description.slice(0, 72) + (item.description.length > 72 ? '...' : '');
    const icon = item.kind === 'package' ? '📦' : '🔄';
    return `${i + 1}. ${icon} **${item.id}** — ${item.name}
   ${shortDesc}
   ${installsPrefix(item.installs)}⭐ ${formatStars(item.stars)} · by ${item.author}`;
  })
  .join('\n\n')}

---
Run \`/agora browse <id>\` for details or \`/agora install <id>\` to install.`;
      }
    }),

    agora_today: tool({
      description: 'Show today’s Agora news and catalog highlights',
      args: {
        section: tool.schema.string().optional().describe('Section to show: news, market, or all')
      },
      async execute(args, context) {
        return renderToday(context.directory, args.section || 'all');
      }
    }),

    agora_scan: tool({
      description: 'Scan an Agora item for trust and install-risk signals',
      args: {
        id: tool.schema.string().describe('Package or workflow ID to scan'),
        type: tool.schema
          .string()
          .optional()
          .describe('Type hint: package or workflow (default: auto-detect)')
      },
      async execute(args) {
        const item = findMarketplaceItem(args.id, { type: args.type });
        if (!item) {
          return `Item "${args.id}" not found. Run \`/agora search <query>\` to find packages.`;
        }
        const result = await scanItem(item, { offline: true });
        return renderScanResult(item, result, 'Offline Scan Preview');
      }
    }),

    agora_acquire: tool({
      description: 'Preview acquiring a capability through the scan-gated Agora installer',
      args: {
        id: tool.schema.string().optional().describe('Exact package or workflow ID to acquire'),
        query: tool.schema
          .string()
          .optional()
          .describe('Capability query to resolve when no exact ID is provided')
      },
      async execute(args, context) {
        if (!args.id && !args.query) {
          return 'Provide `id` or `query`. Run `/agora search <query>` to find packages first.';
        }
        const result = await pluginAcquirePreview({
          id: args.id,
          query: args.query,
          cwd: context.directory,
          env: process.env
        });
        return `${renderAcquireResult(result)}

Plugin acquire is preview-only. To write config after reviewing the scan gate, run \`agora acquire ${result.item?.id ?? args.id ?? args.query ?? '<id>'}\` in your terminal or call the \`agora mcp\` acquire tool.`;
      }
    }),

    agora_browse_category: tool({
      description: 'Browse packages and workflows by category',
      args: {
        category: tool.schema.string().describe('Category: mcp, prompt, skill, all'),
        limit: tool.schema.number().optional().describe('Number to show (default: 10)')
      },
      async execute(args) {
        const category = args.category || 'all';
        const limit = args.limit || 10;
        const items = searchMarketplaceItems({ category, limit });
        const title =
          category === 'prompt'
            ? '💬 Prompts'
            : category === 'skill'
              ? '🧩 Skills'
              : category === 'all'
                ? '🏛️ Catalog'
                : '📦 Packages';

        if (items.length === 0) {
          return `No items in category "${category}". Try: mcp, prompt, skill, all`;
        }

        return `${title} (${items.length} shown, ranked by installs)

${items
  .map((item, i) => {
    const shortDesc = item.description.slice(0, 72) + (item.description.length > 72 ? '...' : '');
    return `${i + 1}. **${item.id}** — ${item.name}
   ${shortDesc}
   ${installsPrefix(item.installs)}⭐ ${formatStars(item.stars)}`;
  })
  .join('\n\n')}

---
Run \`/agora browse <id>\` for details.`;
      }
    }),

    agora_browse: tool({
      description: 'Browse an individual package or workflow with full details',
      args: {
        id: tool.schema.string().describe('Package or workflow ID'),
        type: tool.schema
          .string()
          .optional()
          .describe('Type: package, workflow (default: auto-detect)')
      },
      async execute(args, _ctx) {
        const id = args.id;
        const type = args.type;
        const item = findMarketplaceItem(id, { type });

        if (!item) {
          return `Item "${id}" not found. Run \`/agora search <query>\` to find packages.`;
        }

        const p = item;
        return `📦 **${p.name}** (\`${p.id}\`)
v${p.version} by ${p.author} | ${installsPrefix(p.installs).replace(' · ', ' | ')}⭐ ${formatStars(p.stars)}

${p.description}

**Tags**: ${p.tags.map((t) => `\`${t}\``).join(', ')}
**Category**: ${p.category}
**Added**: ${p.createdAt}
${p.repository ? `**Repo**: ${p.repository}` : ''}
${p.npmPackage ? `**npm**: \`${p.npmPackage}\`` : ''}

Run \`/agora install ${p.id}\` to install to your OpenCode config.`;
      }
    }),

    agora_install: tool({
      description: 'Generate install steps for a package or workflow',
      args: {
        id: tool.schema.string().describe('Package or workflow ID to install'),
        type: tool.schema.string().optional().describe('Type: package, workflow'),
        write: tool.schema.boolean().optional().describe('Write to config file (default: false)')
      },
      async execute(args, _ctx) {
        const id = args.id;
        const type = args.type;
        const write = args.write || false;
        const item = findMarketplaceItem(id, { type });

        if (!item) {
          return `Item "${id}" not found. Run \`/agora search <query>\` to find packages.`;
        }

        const plan = createInstallPlan(item);

        if (!plan.installable) {
          return `❌ ${plan.reason}`;
        }

        if (write) {
          return `📦 **Config Generated** for ${item.name}

Add this to your \`opencode.json\`:

\`\`\`json
${formatConfigJson(plan.config)}
\`\`\`

Use the standalone CLI for safe file writes:

\`\`\`bash
agora install ${item.id} --write
\`\`\``;
        }

        const command = plan.commands[0];

        return `📦 **Installing**: ${item.name}

1. Install the package:

\`\`\`bash
${command}
\`\`\`

2. Add this to your \`opencode.json\`:

\`\`\`json
${formatConfigJson(plan.config)}
\`\`\`

Or run \`agora install ${item.id} --write\` in your terminal to do both automatically.`;
      }
    }),

    ...createAgoraRuntimeTools(input)
  };
}
