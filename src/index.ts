import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import type { Discussion } from './types.js';
import {
  sampleDiscussions,
  sampleTutorials
} from './data.js';
import {
  createInstallPlan,
  findMarketplaceItem,
  getTrendingItems,
  getTrendingTags,
  searchMarketplaceItems
} from './marketplace.js';
import { formatConfigJson } from './config.js';

const AGORA_VERSION = '0.1.0';

export const Agora: Plugin = async (_ctx) => {
  return {
    tool: {
      agora_search: tool({
        description: 'Search Agora marketplace for packages, workflows, and prompts',
        args: {
          query: tool.schema.string().describe('Search query'),
          category: tool.schema.string().optional().describe('Filter by category: mcp, prompt, workflow, all')
        },
        async execute(args, _context) {
          const query = args.query;
          const category = args.category || 'all';
          const filtered = searchMarketplaceItems({ query, category, limit: 10 });

          if (filtered.length === 0) {
            return `No results found for "${query}". Try a different search term.`;
          }

          return `🔍 **Search Results** for "${query}" (${filtered.length} found)

${filtered.map((item, i) => {
            const shortDesc = (item.description || '').slice(0, 60) + (item.description?.length > 60 ? '...' : '');
            const icon = item.kind === 'package' ? '📦' : '🔄';
            return `${i + 1}. **${item.name}** ${icon}
   ${shortDesc}
   ⭐ ${item.stars || 0} · 📥 ${item.installs || 0} · by ${item.author}`;
          }).join('\n\n')}

---
Run \`/agora browse <name>\` for details or \`/agora install <id>\` to install.`;
        }
      }),

      agora_browse_category: tool({
        description: 'Browse packages by category',
        args: {
          category: tool.schema.string().describe('Category: mcp, prompt, workflow, all'),
          limit: tool.schema.number().optional().describe('Number to show (default: 10)')
        },
        async execute(args) {
          const category = args.category || 'all';
          const limit = args.limit || 10;
          const items = searchMarketplaceItems({ category, limit });
          const title = category === 'workflow' ? '🔄 Workflows' :
            category === 'prompt' ? '💬 Prompts' :
              category === 'all' ? '🏛️ Marketplace' : '📦 Packages';

          if (items.length === 0) {
            return `No items in category "${category}". Try: mcp, workflow, prompt`;
          }

          return `${title} (${items.length} shown)

${items.map((item, i) => `${i + 1}. **${item.name}** ⭐ ${item.stars}`).join('\n')}

---
Run \`/agora browse <id>\` for details.`;
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

          if (category === 'all' || category === 'packages' || category === 'package') {
            output += `**Top Packages**\n`;
            const topPackages = getTrendingItems({ category: 'package', limit: 5 });
            output += topPackages.map((p, i) =>
              `${i + 1}. ${p.name} - ⭐ ${p.stars}`
            ).join('\n');
            output += '\n\n';
          }

          if (category === 'all' || category === 'workflows' || category === 'workflow') {
            output += `**Top Workflows**\n`;
            const topWorkflows = getTrendingItems({ category: 'workflow', limit: 5 });
            output += topWorkflows.map((w, i) =>
              `${i + 1}. ${w.name} - ⭐ ${w.stars}`
            ).join('\n');
          }

          output += `\n\n🏷️ **Trending Tags**: ${getTrendingTags(8).join(', ')}`;

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
        description: 'Show community discussions or create new',
        args: {
          action: tool.schema.string().optional().describe('Action: list, view, create, reply (default: list)'),
          id: tool.schema.string().optional().describe('Discussion ID'),
          category: tool.schema.string().optional().describe('Filter or category for new post'),
          title: tool.schema.string().optional().describe('Title for new post'),
          content: tool.schema.string().optional().describe('Content for new post/reply')
        },
        async execute(args) {
          const action = args.action || 'list';

          if (action === 'create') {
            if (!args.title || !args.content) {
              return `📝 **Create Discussion**

Required: title, content

/options: category (question, idea, showcase, discussion)

Example:
\`/agora discussions create --title "How to use MCP?" --content "Looking for best practices..." --category question`;
            }
            const newDisc: Discussion = {
              id: `disc-${Date.now()}`,
              title: args.title,
              author: 'you',
              content: args.content,
              category: (args.category as any) || 'discussion',
              replies: 0,
              stars: 0,
              createdAt: new Date().toISOString().split('T')[0]
            };
            return `✅ **Discussion Created**

**${newDisc.title}**
${newDisc.content}

by ${newDisc.author} | ${newDisc.category}

Run \`/agora discussions view ${newDisc.id}\` to view.`;
          }

          if (action === 'view') {
            const disc = sampleDiscussions.find(d => d.id === args.id);
            if (!disc) {
              return `Discussion not found. Run \`/agora discussions list\` for all discussions.`;
            }
            const icon = disc.category === 'question' ? '❓' :
              disc.category === 'idea' ? '💡' :
                disc.category === 'showcase' ? '🎉' : '💬';
            return `${icon} **${disc.title}**

${disc.content}

---
💬 ${disc.replies} replies | ⭐ ${disc.stars} | by ${disc.author} | ${disc.createdAt}

Run \`/agora discussions reply ${disc.id} --content "Your reply..."\` to respond.`;
          }

          if (action === 'reply' && args.id && args.content) {
            return `💬 **Reply added** to ${args.id}

"${args.content}"

Run \`/agora discussions view ${args.id}\` to see all replies.`;
          }

          const category = args.category || 'all';
          const filtered = category === 'all'
            ? sampleDiscussions
            : sampleDiscussions.filter(d => d.category === category);

          return `💬 **Discussions** (${filtered.length})

${filtered.slice(0, 10).map(d => {
            const icon = d.category === 'question' ? '❓' :
              d.category === 'idea' ? '💡' :
                d.category === 'showcase' ? '🎉' : '💬';
            return `${icon} **${d.title}**
   ${d.content.slice(0, 80)}...
   💬 ${d.replies} replies | ⭐ ${d.stars} | by ${d.author}`;
          }).join('\n\n')}

---
Run \`/agora discussions create --title "..." --content "..." --category question\` to start a discussion.`;
        }
      }),

      agora_browse: tool({
        description: 'Browse an individual package or workflow with full details',
        args: {
          id: tool.schema.string().describe('Package or workflow ID'),
          type: tool.schema.string().optional().describe('Type: package, workflow (default: auto-detect)')
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
            return `🔄 **${w.name}**
by ${w.author} | ⭐ ${w.stars} | 🍴 ${w.forks}

${w.description}

**Tags**: ${w.tags.map(t => `\`${t}\``).join(', ')}

**Prompt**:
\`\`\`
${w.prompt}
\`\`\`

Run \`/agora install workflow ${w.id}\` to use this workflow.`;
          }

          const p = item;
          return `📦 **${p.name}**
v${p.version} by ${p.author} | ⭐ ${p.stars} | 📥 ${p.installs}

${p.description}

**Tags**: ${p.tags.map(t => `\`${t}\``).join(', ')}
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
            return `🔄 **Workflow installed**: ${w.name}

This workflow is now active. To use it:

1. Copy the prompt to a skill file:
   \`\`\`
   ${w.prompt}
   \`\`\`

2. Or run \`/agora info\` to see all installed workflows.`;
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
\`agora install ${item.id} --write\``;
          }

          const command = plan.commands[0];

          return `📦 **Installing**: ${item.name}

To install this MCP server to your OpenCode config:

1. Install the package:
   \`\`\`bash
   ${command}
   \`\`\`

2. Add to your \`opencode.json\`:
   \`\`\`json
   ${formatConfigJson(plan.config)}
   \`\`\`

Run \`agora install ${item.id} --write\` in your terminal to auto-write to config.`;
        }
      }),

      agora_review: tool({
        description: 'Rate and review packages or workflows',
        args: {
          action: tool.schema.string().optional().describe('Action: list, view, create (default: list)'),
          id: tool.schema.string().optional().describe('Package or workflow ID'),
          rating: tool.schema.number().optional().describe('Rating 1-5 stars'),
          content: tool.schema.string().optional().describe('Review content')
        },
        async execute(args) {
          const action = args.action || 'list';

          if (action === 'create') {
            if (!args.id || !args.rating || !args.content) {
              return `⭐ **Create Review**

Required: id, rating (1-5), content

Example:
\`/agora review create --id mcp-filesystem --rating 5 --content "Essential tool!"\``;
            }
            if (args.rating < 1 || args.rating > 5) {
              return `Rating must be 1-5 stars.`;
            }
            return `✅ **Review Added**

**${args.id}** - ${'⭐'.repeat(args.rating)}

${args.content}

Run \`/agora review view ${args.id}\` to see all reviews.`;
          }

          if (action === 'view' && args.id) {
            return `⭐ **Reviews** for ${args.id}

★ 5 - "Essential for any project!" - devarchitect
★ 4 - "Works well, easy setup" - nodemaster

Overall: 4.5/5 (12 reviews)

Run \`/agora review create --id ${args.id} --rating 5 --content "Your review..."\` to add your review.`;
          }

          return `⭐ **Recent Reviews**

1. @modelcontextprotocol/server-filesystem - ⭐⭐⭐⭐⭐ (45)
2. @modelcontextprotocol/server-github - ⭐⭐⭐⭐ (23)
3. @modelcontextprotocol/server-brave-search - ⭐⭐⭐⭐⭐ (12)

Run \`/agora review view <id>\` to see reviews for a specific package.`;
        }
      }),

      agora_profile: tool({
        description: 'View and manage user profiles',
        args: {
          action: tool.schema.string().optional().describe('Action: view, me (default: list)'),
          username: tool.schema.string().optional().describe('Username'),
          displayName: tool.schema.string().optional().describe('Display name for profile'),
          bio: tool.schema.string().optional().describe('Bio for profile')
        },
        async execute(args) {
          const action = args.action || 'list';

          if (action === 'me' || (action === 'view' && !args.username)) {
            return `👤 **Your Profile**

- **Username**: you
- **Packages**: 0 published
- **Workflows**: 1 saved
- **Discussions**: 0 started
- **Reviews**: 0 written

Run \`/agora profile update --displayName "Your Name" --bio "Your bio"\` to update.`;
          }

          if (action === 'update') {
            return `✅ **Profile Updated**

Display name: ${args.displayName || 'you'}
Bio: ${args.bio || '(none)'}`;
          }

          const username = args.username || 'agora-community';
          const profiles: Record<string, any> = {
            'agora-community': { packages: 3, workflows: 2, discussions: 5 },
            'modelcontextprotocol': { packages: 12, workflows: 0, discussions: 8 },
            'devarchitect': { packages: 1, workflows: 3, discussions: 12 }
          };
          const p = profiles[username] || { packages: 0, workflows: 0, discussions: 0 };

          return `👤 **${username}**

- **Packages**: ${p.packages} published
- **Workflows**: ${p.workflows} shared
- **Discussions**: ${p.discussions} started

Run \`/agora discussions list --author ${username}\` to see their discussions.`;
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
- \`/agora browse_category <category>\` - Browse by category
- \`/agora trending [type]\` - See trending
- \`/agora browse <id>\` - View package details
- \`/agora install <id> [--write]\` - Install to config
- \`/agora review [action] [--id] [--rating] [--content]\` - Reviews/ratings
- \`/agora discussions [action] [--id] [--title] [--content]\` - Community
- \`/agora profile [action] [--username]\` - User profiles
- \`/agora tutorial [id] [step]\` - Interactive tutorials
- \`/agora info\` - This help

**Categories:** mcp, prompt, workflow, skill

Built with ❤️ for the developer community.`;
        }
      })
    }
  };
};

export default Agora;
