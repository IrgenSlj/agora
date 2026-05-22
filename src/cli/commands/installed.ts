import {
  readAllServers,
  detectTools,
  groupServersByName,
  ALL_ADAPTERS
} from '../../stack/registry.js';
import type { AgentToolId } from '../../stack/types.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError } from '../helpers.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export const commandInstalled: CommandHandler = async (parsed, io, style) => {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  const toolFlag = stringFlag(parsed, 'tool');
  if (toolFlag !== undefined) {
    if (!KNOWN_TOOL_IDS.includes(toolFlag as AgentToolId)) {
      return usageError(
        io,
        `Unknown tool: ${toolFlag}. Valid values: ${KNOWN_TOOL_IDS.join(', ')}`
      );
    }
  }

  let servers = readAllServers(env);
  if (toolFlag) {
    servers = servers.filter((s) => s.tool === toolFlag);
  }

  if (parsed.flags.json) {
    const toolResults = detectTools(env).map((t) => ({
      id: t.adapter.id,
      present: t.present
    }));
    writeJson(io.stdout, {
      servers,
      tools: toolResults,
      summary: {
        servers: servers.length,
        tools: new Set(servers.map((s) => s.tool)).size
      }
    });
    return 0;
  }

  if (servers.length === 0) {
    const toolResults = detectTools(env);
    const detected = toolResults.filter((t) => t.present).map((t) => t.adapter.displayName);
    writeLine(io.stdout, style.dim('No MCP servers configured.'));
    if (detected.length > 0) {
      writeLine(io.stdout, style.dim('Detected tools: ' + detected.join(', ')));
    } else {
      writeLine(io.stdout, style.dim('No supported agent tools detected.'));
    }
    writeLine(
      io.stdout,
      style.dim('Run `agora search` to find servers, `agora install` to add them.')
    );
    return 0;
  }

  const grouped = groupServersByName(servers);
  const toolCount = new Set(servers.map((s) => s.tool)).size;

  writeLine(io.stdout, style.accent('Installed MCP servers'));
  writeLine(io.stdout);

  const nameWidth = Math.max(...Array.from(grouped.keys()).map((n) => n.length));

  for (const [name, instances] of grouped) {
    const transport = instances.every((i) => i.transport === 'remote') ? 'remote' : 'local';

    const parts = instances.map((inst) => {
      const label = `${inst.tool} (${inst.scope})`;
      return inst.enabled === false ? style.dim(label + ' (disabled)') : label;
    });

    writeLine(
      io.stdout,
      `  ${style.accent(name.padEnd(nameWidth))}  ${style.dim(transport)}  · ${parts.join(', ')}`
    );
  }

  writeLine(io.stdout);
  writeLine(io.stdout, style.dim(`${grouped.size} server(s) across ${toolCount} tool(s)`));

  return 0;
};
