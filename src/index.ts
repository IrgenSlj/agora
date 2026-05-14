import { readFileSync } from 'node:fs';
import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { sampleTutorials } from './data.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  getTrendingItems,
  getTrendingTags,
  searchMarketplaceItems
} from './marketplace.js';
import { formatConfigJson } from './config.js';
import { formatInstalls, formatStars } from './format.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const AGORA_VERSION = pkg.version;

export const Agora: Plugin = async (_ctx) => {
  return {
    tool: {
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
    const shortDesc =
      item.description.slice(0, 72) + (item.description.length > 72 ? '...' : '');
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
    const shortDesc =
      item.description.slice(0, 72) + (item.description.length > 72 ? '...' : '');
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
              .map((p, i) => `${i + 1}. ${p.id} — 📥 ${formatInstalls(p.installs)} installs`)
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
        description: 'Install a package or workflow to your OpenCode config',
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

      agora_info: tool({
        description: 'Show information about Agora plugin',
        args: {},
        async execute() {
          return `🏛️ **Agora** v${AGORA_VERSION}

The Developer's Terminal Marketplace for OpenCode.

Type \`/agora <request>\` in OpenCode and it routes to the right tool:
- \`/agora search <query> [category]\` - Search the marketplace
- \`/agora browse <id>\` - View package or workflow details
- \`/agora browse_category <category>\` - Browse a category
- \`/agora trending [type]\` - See trending packages and workflows
- \`/agora install <id>\` - Install steps / config for a package
- \`/agora tutorial <id> [step]\` - Interactive tutorials
- \`/agora info\` - This help

The \`/agora\` slash command is installed by \`agora init\` (or copy
\`.opencode/command/agora.md\` into your project). Without it, the
\`agora_*\` tools are still callable directly by the assistant.

Community features — profiles, reviews, discussions, publishing — live
in the \`agora\` CLI and need a connected backend.

**Categories:** mcp, prompt, workflow, skill`;
        }
      })
    }
  };
};

export default Agora;
