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

export function createAgoraMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agora-marketplace',
    version: '0.3.0'
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

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createAgoraMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
