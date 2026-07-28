import { readFileSync } from 'node:fs';
import type { PluginInput, ToolContext, ToolDefinition } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const AGORA_VERSION = pkg.version;

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''
    )
    .join('');
}

async function chatWithOpenCodeClient(
  input: PluginInput | undefined,
  context: ToolContext,
  message: string,
  model: string
): Promise<string | null> {
  if (!input?.client?.session?.prompt || !context.sessionID) return null;
  const body: {
    parts: Array<{ type: 'text'; text: string }>;
    model?: { providerID: string; modelID: string };
  } = { parts: [{ type: 'text', text: message }] };
  if (model.includes('/')) {
    const [providerID, ...modelParts] = model.split('/');
    body.model = { providerID, modelID: modelParts.join('/') };
  }

  try {
    const result = await input.client.session.prompt({
      path: { id: context.sessionID },
      query: { directory: context.directory },
      body
    });
    const text = textFromParts(result.data?.parts);
    return text || null;
  } catch {
    return null;
  }
}

export function createAgoraRuntimeTools(input?: PluginInput): Record<string, ToolDefinition> {
  return {
    agora_chat: tool({
      description: 'Chat with an AI assistant about MCP servers and agent tooling',
      args: {
        message: tool.schema.string().describe('Question or message'),
        model: tool.schema
          .string()
          .optional()
          .describe('Model override (default: deepseek-v4-flash-free)')
      },
      async execute(args, context) {
        const message = args.message;
        const model = args.model || 'deepseek-v4-flash-free';
        const clientResponse = await chatWithOpenCodeClient(input, context, message, model);
        if (clientResponse) return clientResponse;

        const { selectProvider } = await import('../inference/index.js');
        const selection = selectProvider({ env: process.env });
        const provider = selection.provider;
        if (!provider) return selection.problem ?? 'No inference provider available.';
        const translate = provider.createTranslator();

        return new Promise<string>((resolve) => {
          let child: ReturnType<typeof provider.spawn>;
          try {
            child = provider.spawn(
              provider.buildArgs({ model: model || provider.defaultModel, prompt: message }),
              { stdio: ['ignore', 'pipe', 'pipe'] }
            );
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            resolve(`Failed to run ${provider.label}: ${detail}. ${provider.installHint}`);
            return;
          }

          let stdout = '';
          let response = '';

          child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
          });

          child.stderr?.on('data', () => {});

          child.on('close', (code) => {
            if (code !== 0) {
              resolve(`Error: ${provider.label} exited with code ${code}.`);
              return;
            }

            for (const line of stdout.split('\n').filter(Boolean)) {
              for (const raw of translate(line)) {
                const ev = raw as { type?: string; part?: { text?: string } };
                if (ev.type === 'text' && ev.part?.text) response += ev.part.text;
              }
            }

            resolve(response || 'No response generated. Try a different question.');
          });

          child.on('error', (err) => {
            resolve(`Failed to run ${provider.label}: ${err.message}. ${provider.installHint}`);
          });
        });
      }
    }),

    agora_config: tool({
      description: 'Check your OpenCode config health, optionally auto-fix issues',
      args: {
        fix: tool.schema
          .boolean()
          .optional()
          .describe(
            'Auto-heal common issues (missing $schema, duplicate plugins, empty MCP entries)'
          ),
        configPath: tool.schema
          .string()
          .optional()
          .describe('Explicit path to opencode.json (auto-detected if not set)')
      },
      async execute(args) {
        const {
          detectOpenCodeConfigPath,
          doctorOpenCodeConfig,
          loadOpenCodeConfig,
          writeOpenCodeConfig
        } = await import('../config-files.js');
        const configPath = detectOpenCodeConfigPath({
          explicitPath: args.configPath || process.env.OPENCODE_CONFIG,
          cwd: process.cwd(),
          env: process.env
        });
        let report = doctorOpenCodeConfig(configPath);

        if (args.fix) {
          const loaded = loadOpenCodeConfig(configPath);
          const fixes: string[] = [];
          let changed = false;
          if (!loaded.config.$schema) {
            loaded.config.$schema = 'https://opencode.ai/config.json';
            fixes.push('Added missing $schema');
            changed = true;
          }
          if (loaded.config.plugin) {
            const deduped = [...new Set(loaded.config.plugin)];
            if (deduped.length !== loaded.config.plugin.length) {
              loaded.config.plugin = deduped;
              fixes.push('Removed duplicate plugins');
              changed = true;
            }
          }
          if (loaded.config.mcp) {
            for (const [key, entry] of Object.entries(loaded.config.mcp)) {
              if (!entry.command?.length) {
                delete loaded.config.mcp[key];
                fixes.push(`Removed empty MCP entry "${key}"`);
                changed = true;
              }
            }
          }
          if (changed) {
            writeOpenCodeConfig(configPath, loaded.config);
            report = doctorOpenCodeConfig(configPath);
          }
          return `## Config Health Report\n\n**Path**: ${report.path}\n**Status**: ${report.valid ? '✅ Valid' : '⚠️ Issues'}${report.error ? `\n**Error**: ${report.error}` : ''}\n**MCP Servers**: ${report.mcpServers}\n**Plugins**: ${report.plugins}\n**Packages**: ${report.packages.length ? report.packages.join(', ') : '(none)'}${fixes.length ? `\n\n**Auto-fixes applied**:\n${fixes.map((f) => `- ${f}`).join('\n')}` : ''}\n\nRun \`agora config doctor --fix\` in your terminal for a more detailed output.`;
        }

        return `## Config Health Report\n\n**Path**: ${report.path}\n**Status**: ${report.valid ? '✅ Valid' : '⚠️ Issues'}${report.error ? `\n**Error**: ${report.error}` : ''}\n**MCP Servers**: ${report.mcpServers}\n**Plugins**: ${report.plugins}\n**Packages**: ${report.packages.length ? report.packages.join(', ') : '(none)'}\n\nRun \`agora config doctor --fix\` in your terminal to auto-heal common issues.`;
      }
    }),

    agora_info: tool({
      description: 'Show information about Agora plugin',
      args: {},
      async execute() {
        return `🏛️ **Agora** v${AGORA_VERSION}

The trust plane for agentic tooling.

Type \`/agora <request>\` in OpenCode and it routes to the right tool:
- \`/agora search <query> [category]\` - Search the catalog
- \`/agora today\` - Daily news and catalog highlights
- \`/agora browse <id>\` - View package details
- \`/agora browse_category <category>\` - Browse a category
- \`/agora install <id>\` - Install steps / config for a package
- \`/agora scan <id>\` - Offline trust scan preview
- \`/agora acquire <id|query>\` - Preview scan-gated acquisition
- \`/agora chat <message>\` - Free AI chat via opencode run
- \`/agora config\` - Check OpenCode config health (with optional --fix)
- \`/agora info\` - This help

The \`/agora\` slash command is installed by \`agora init\` (or copy
\`.opencode/command/agora.md\` into your project). Without it, the
\`agora_*\` tools are still callable directly by the assistant.

**CLI-only features** (not plugin tools):
- \`agora mcp\` — Run an MCP server exposing Agora tools
- \`agora shell\` — Interactive bash+chat hybrid shell
- \`agora init\`, \`agora config doctor\`, \`agora doctor\`
- \`agora run -- <cmd>\` / \`agora observe\` — supervise a server and see what it did
- \`agora policy check\`, \`agora plan\`, \`agora apply\`, \`agora sync\`
- \`agora export\`, \`agora watch\`, \`agora completions\`

**Categories:** mcp, prompt, skill, other`;
      }
    })
  };
}
