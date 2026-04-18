import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import {
  samplePackages,
  sampleWorkflows,
  sampleDiscussions,
  sampleTutorials,
  trendingTags
} from './data';

const AGORA_VERSION = '0.1.0';

export const Agora: Plugin = async (ctx) => {
  return {
    tool: {
      agora_search: tool({
        description: 'Search Agora marketplace for packages, workflows, and prompts',
        args: {
          query: tool.schema.string().describe('Search query'),
          category: tool.schema.string().optional().describe('Filter by category: mcp, prompt, workflow, all')
        },
        async execute(args, context) {
          const query = args.query;
          const category = args.category || 'all';

          const allItems = [
            ...samplePackages.map(p => ({ ...p, type: 'package' as const })),
            ...sampleWorkflows.map(w => ({ ...w, type: 'workflow' as const, category: 'workflow' as const }))
          ];

          const filtered = allItems.filter(item => {
            const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase()) ||
              item.description.toLowerCase().includes(query.toLowerCase());
            const matchesCategory = category === 'all' || item.category === category;
            return matchesQuery && matchesCategory;
          });

          if (filtered.length === 0) {
            return `No results found for "${query}". Try a different search term.`;
          }

          return filtered.slice(0, 10).map(item => {
            return `${item.type === 'package' ? '📦' : '🔄'} **${item.name}**
   ${item.description}
   ⭐ ${item.stars} | by ${item.author}`;
          }).join('\n\n');
        }
      }),

      agora_trending: tool({
        description: 'Show trending packages and workflows in Agora',
        args: {
          category: tool.schema.string().optional().describe('Category to show: packages, workflows, all')
        },
        async execute(args) {
          const category = args.category || 'all';

          let output = `📈 **Trending in Agora**\n\n`;

          if (category === 'all' || category === 'packages') {
            output += `**Top Packages**\n`;
            const topPackages = [...samplePackages].sort((a, b) => b.stars - a.stars).slice(0, 5);
            output += topPackages.map((p, i) =>
              `${i + 1}. ${p.name} - ⭐ ${p.stars}`
            ).join('\n');
            output += '\n\n';
          }

          if (category === 'all' || category === 'workflows') {
            output += `**Top Workflows**\n`;
            const topWorkflows = [...sampleWorkflows].sort((a, b) => b.stars - a.stars).slice(0, 5);
            output += topWorkflows.map((w, i) =>
              `${i + 1}. ${w.name} - ⭐ ${w.stars}`
            ).join('\n');
          }

          output += `\n\n🏷️ **Trending Tags**: ${trendingTags.slice(0, 8).join(', ')}`;

          return output;
        }
      }),

      agora_tutorial: tool({
        description: 'Learn about AI/MCP with interactive tutorials',
        args: {
          tutorial: tool.schema.string().optional().describe('Tutorial ID or "list" to see available tutorials'),
          step: tool.schema.number().optional().describe('Step number (1-based)')
        },
        async execute(args) {
          const tutorial = args.tutorial;
          const step = args.step || 1;

          if (!tutorial || tutorial === 'list') {
            return `📚 **Available Tutorials**

1. **mcp-basics** - MCP Servers 101 (Beginner, 15 min)
2. **agents-skills** - OpenCode Agents & Skills (Intermediate, 30 min)

Run \`/agora tutorial <id>\` to start a tutorial.`;
          }

          const tut = sampleTutorials.find(t => t.id === tutorial);
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

      agora_discussions: tool({
        description: 'Show recent discussions from the Agora community',
        args: {
          category: tool.schema.string().optional().describe('Filter: question, idea, showcase, discussion, all')
        },
        async execute(args) {
          const category = args.category || 'all';

          const filtered = category === 'all'
            ? sampleDiscussions
            : sampleDiscussions.filter(d => d.category === category);

          return filtered.map(d => {
            const icon = d.category === 'question' ? '❓' :
              d.category === 'idea' ? '💡' :
                d.category === 'showcase' ? '🎉' : '💬';
            return `${icon} **${d.title}**
   ${d.content.slice(0, 100)}...
   💬 ${d.replies} replies | ⭐ ${d.stars} | by ${d.author}`;
          }).join('\n\n');
        }
      }),

      agora_info: tool({
        description: 'Show information about Agora plugin',
        args: {},
        async execute() {
          return `🏛️ **Agora** v${AGORA_VERSION}

The Developer's Terminal Marketplace & Community

**Commands:**
- \`/agora search <query> [category]\` - Search marketplace
- \`/agora trending [category]\` - See trending
- \`/agora tutorial [id] [step]\` - Learn AI/MCP
- \`/agora discussions [category]\` - Community discussions

**Categories:** mcp, prompt, workflow, skill

Built with ❤️ for the developer community.`;
        }
      })
    }
  };
};

export default Agora;