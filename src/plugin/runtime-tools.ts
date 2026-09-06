import { readFileSync } from 'node:fs';
import type { ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const AGORA_VERSION = pkg.version;

export function createAgoraRuntimeTools(): Record<string, ToolDefinition> {
  return {
    agora_config: tool({
      description:
        'Check your OpenCode config health and list the repairs it needs. This tool never edits ' +
        'the config: an agent cannot authorize a host-configuration write, so `fix` reports the ' +
        'exact changes for a human to apply with `agora config doctor --fix`.',
      args: {
        fix: tool.schema
          .boolean()
          .optional()
          .describe(
            'List the repairs that `agora config doctor --fix` would apply (missing $schema, ' +
              'duplicate plugins, empty MCP entries). Nothing is written.'
          ),
        configPath: tool.schema
          .string()
          .optional()
          .describe('Explicit path to opencode.json (auto-detected if not set)')
      },
      async execute(args) {
        // Deliberately does not import the config writer: this tool has no
        // path to one.
        const { detectOpenCodeConfigPath, doctorOpenCodeConfig, loadOpenCodeConfig } = await import(
          '../config-files.js'
        );
        const configPath = detectOpenCodeConfigPath({
          explicitPath: args.configPath || process.env.OPENCODE_CONFIG,
          cwd: process.cwd(),
          env: process.env
        });
        const report = doctorOpenCodeConfig(configPath);

        if (args.fix) {
          // The write this used to perform was the last agent-callable edit of
          // host configuration in the product: a model could rewrite the file
          // that decides which servers run, with no human anywhere. The repairs
          // are still computed and shown — that is the useful half — but the
          // authorization kernel answers the write, and it refuses every
          // host-config mutation an agent asks for, by construction.
          const { authorizeMutation } = await import('../gate/authorization.js');
          const decision = authorizeMutation({
            action: 'ConfigRepair',
            actor: 'agent',
            effects: ['host-config'],
            requiredSignals: [],
            signals: []
          });
          const loaded = loadOpenCodeConfig(configPath);
          const fixes: string[] = [];
          if (!loaded.config.$schema) fixes.push('Add missing $schema');
          if (loaded.config.plugin) {
            const deduped = [...new Set(loaded.config.plugin)];
            if (deduped.length !== loaded.config.plugin.length) {
              fixes.push('Remove duplicate plugins');
            }
          }
          if (loaded.config.mcp) {
            for (const [key, entry] of Object.entries(loaded.config.mcp)) {
              if (!entry.command?.length) fixes.push(`Remove empty MCP entry "${key}"`);
            }
          }
          const refusal =
            decision.verdict === 'allow'
              ? ''
              : `\n\n**Not applied** — ${decision.reasons.join('; ')}.`;
          return `## Config Health Report\n\n**Path**: ${report.path}\n**Status**: ${report.valid ? '✅ Valid' : '⚠️ Issues'}${report.error ? `\n**Error**: ${report.error}` : ''}\n**MCP Servers**: ${report.mcpServers}\n**Plugins**: ${report.plugins}\n**Packages**: ${report.packages.length ? report.packages.join(', ') : '(none)'}${fixes.length ? `\n\n**Repairs needed**:\n${fixes.map((f) => `- ${f}`).join('\n')}` : '\n\nNo repairs needed.'}${refusal}\n\nRun \`agora config doctor --fix\` in your terminal to apply them.`;
        }

        return `## Config Health Report\n\n**Path**: ${report.path}\n**Status**: ${report.valid ? '✅ Valid' : '⚠️ Issues'}${report.error ? `\n**Error**: ${report.error}` : ''}\n**MCP Servers**: ${report.mcpServers}\n**Plugins**: ${report.plugins}\n**Packages**: ${report.packages.length ? report.packages.join(', ') : '(none)'}\n\nRun \`agora config doctor --fix\` in your terminal to auto-heal common issues.`;
      }
    }),

    agora_info: tool({
      description: 'Show information about Agora plugin',
      args: {},
      async execute() {
        return `🏛️ **Agora** v${AGORA_VERSION}

Catch the tool that changed after you trusted it.

Type \`/agora <request>\` in OpenCode and it routes to the right tool:
- \`/agora search <query> [category]\` - Search the catalog
- \`/agora today\` - Daily news and catalog highlights
- \`/agora browse <id>\` - View package details
- \`/agora browse_category <category>\` - Browse a category
- \`/agora install <id>\` - Install steps / config for a package
- \`/agora scan <id>\` - Offline trust scan preview
- \`/agora acquire <id|query>\` - Preview scan-gated acquisition
- \`/agora config\` - Check OpenCode config health (with optional --fix)
- \`/agora info\` - This help

The \`/agora\` slash command is installed by \`agora init\` (or copy
\`.opencode/command/agora.md\` into your project). Without it, the
\`agora_*\` tools are still callable directly by the assistant.

**CLI-only features** (not plugin tools):
- \`agora mcp\` — Run an MCP server exposing Agora tools
- \`agora init\`, \`agora config doctor\`, \`agora doctor\`
- \`agora run -- <cmd>\` / \`agora observe\` — supervise a server and see what it did
- \`agora policy check\`, \`agora plan\`, \`agora apply\`, \`agora sync\`
- \`agora export\`, \`agora watch\`, \`agora completions\`

**Categories:** mcp, prompt, skill, other`;
      }
    })
  };
}
