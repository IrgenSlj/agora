import type { ToolDefinition } from '@opencode-ai/plugin';
import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { sampleTutorials } from '../data.js';
import { acquire, renderAcquireResult, type AcquireInput } from '../acquire.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  getTrendingItems,
  getTrendingTags,
  type MarketplaceItem,
  searchMarketplaceItems
} from '../marketplace.js';
import { formatConfigJson } from '../config.js';
import { formatInstalls, formatStars } from '../format.js';
import { scanItem, type ScanResult } from '../scan.js';
import { detectAgoraDataDir } from '../state.js';
import { readCache } from '../news/cache.js';
import { rankItems } from '../news/score.js';
import { DEFAULT_NEWS_CONFIG, hostFromUrl } from '../news/types.js';
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
  const wantsMarket = section === 'all' || section === 'market' || section === 'marketplace';

  if (wantsNews) {
    lines.push('**News**');
    if (news.length === 0) {
      lines.push('No cached news yet. Run `agora news --refresh` in your terminal.');
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
      lines.push(`- **${item.id}** — ${formatInstalls(item.installs)} installs · ${item.name}`);
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
      description: 'Search Agora marketplace for packages, workflows, and prompts',
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
   📥 ${formatInstalls(item.installs)} installs · ⭐ ${formatStars(item.stars)} · by ${item.author}`;
  })
  .join('\n\n')}

---
Run \`/agora browse <id>\` for details or \`/agora install <id>\` to install.`;
      }
    }),

    agora_today: tool({
      description: 'Show today’s Agora news and marketplace highlights',
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
        category: tool.schema.string().describe('Category: mcp, prompt, workflow, all'),
        limit: tool.schema.number().optional().describe('Number to show (default: 10)')
      },
      async execute(args) {
        const category = args.category || 'all';
        const limit = args.limit || 10;
        const items = searchMarketplaceItems({ category, limit });
        const title =
          category === 'workflow'
            ? '🔄 Workflows'
            : category === 'prompt'
              ? '💬 Prompts'
              : category === 'all'
                ? '🏛️ Marketplace'
                : '📦 Packages';

        if (items.length === 0) {
          return `No items in category "${category}". Try: mcp, workflow, prompt, all`;
        }

        return `${title} (${items.length} shown, ranked by installs)

${items
  .map((item, i) => {
    const shortDesc = item.description.slice(0, 72) + (item.description.length > 72 ? '...' : '');
    return `${i + 1}. **${item.id}** — ${item.name}
   ${shortDesc}
   📥 ${formatInstalls(item.installs)} installs · ⭐ ${formatStars(item.stars)}`;
  })
  .join('\n\n')}

---
Run \`/agora browse <id>\` for details.`;
      }
    }),

    agora_trending: tool({
      description: 'Show trending packages and workflows in Agora',
      args: {
        category: tool.schema
          .string()
          .optional()
          .describe('Category to show: packages, workflows, all')
      },
      async execute(args) {
        const category = args.category || 'all';

        let output = `📈 **Trending in Agora**\n\n`;

        if (category === 'all' || category === 'packages' || category === 'package') {
          output += `**Top Packages**\n`;
          const topPackages = getTrendingItems({ category: 'package', limit: 5 });
          // Rank and display by installs — stars are repo-level and tie
          // across the modelcontextprotocol/servers monorepo.
          output += topPackages
            .map(
              (p, i) =>
                `${i + 1}. ${p.id} — 📥 ${formatInstalls(p.installs)} installs · ⭐ ${formatStars(p.stars)}`
            )
            .join('\n');
          output += '\n\n';
        }

        if (category === 'all' || category === 'workflows' || category === 'workflow') {
          output += `**Top Workflows**\n`;
          const topWorkflows = getTrendingItems({ category: 'workflow', limit: 5 });
          output += topWorkflows
            .map((w, i) => `${i + 1}. ${w.id} — ${w.name} (⭐ ${formatStars(w.stars)})`)
            .join('\n');
        }

        output += `\n\n🏷️ **Trending Tags**: ${getTrendingTags(8).join(', ')}`;

        return output;
      }
    }),

    agora_tutorial: tool({
      description: 'Learn about AI/MCP with interactive tutorials',
      args: {
        tutorial: tool.schema
          .string()
          .optional()
          .describe('Tutorial ID or "list" to see available tutorials'),
        step: tool.schema.number().optional().describe('Step number (1-based)')
      },
      async execute(args) {
        const tutorial = args.tutorial;
        const step = args.step || 1;

        if (!tutorial || tutorial === 'list') {
          const tutorialList = sampleTutorials
            .map((t, i) => `${i + 1}. **${t.id}** - ${t.title} (${t.level}, ${t.duration})`)
            .join('\n');
          return `📚 **Available Tutorials**\n\n${tutorialList}\n\nRun \`/agora tutorial <id>\` to start a tutorial.`;
        }

        const tut = sampleTutorials.find((t) => t.id === tutorial);
        if (!tut) {
          return `Tutorial "${tutorial}" not found. Run \`/agora tutorial list\` to see available tutorials.`;
        }

        if (step > tut.steps.length) {
          return `✅ You've completed "${tut.title}"!

Run \`/agora tutorial list\` for more tutorials.`;
        }

        const currentStep = tut.steps[step - 1];
        return `📚 **${tut.title}** (${tut.level}, ${tut.duration})
**Step ${step}/${tut.steps.length}**: ${currentStep.title}

${currentStep.content}
${currentStep.code ? `\n\`\`\`\n${currentStep.code}\n\`\`\`` : ''}

Run \`/agora tutorial ${tutorial} ${step + 1}\` for next step.`;
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

        if (item.kind === 'workflow') {
          const w = item;
          return `🔄 **${w.name}** (\`${w.id}\`)
by ${w.author} | ⭐ ${formatStars(w.stars)} | 🍴 ${w.forks}

${w.description}

**Tags**: ${w.tags.map((t) => `\`${t}\``).join(', ')}

**Prompt**:
\`\`\`
${w.prompt}
\`\`\`

Run \`/agora install ${w.id}\` to use this workflow.`;
        }

        const p = item;
        return `📦 **${p.name}** (\`${p.id}\`)
v${p.version} by ${p.author} | 📥 ${formatInstalls(p.installs)} installs | ⭐ ${formatStars(p.stars)}

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

        if (item.kind === 'workflow') {
          const w = item;
          return `🔄 **Workflow**: ${w.name}

To use this workflow as an OpenCode skill, run in your terminal:

\`\`\`bash
agora use ${w.id}
\`\`\`

That writes \`.opencode/skills/\` and registers it. Or copy the prompt:

\`\`\`
${w.prompt}
\`\`\``;
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
