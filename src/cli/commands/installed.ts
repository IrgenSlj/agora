import { readCapabilityCache } from '../../stack/capability-cache.js';
import {
  ALL_ADAPTERS,
  detectTools,
  groupServersByName,
  readAllServers
} from '../../stack/registry.js';
import type { AgentToolId } from '../../stack/types.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export const commandInstalled: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
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

  // Best-effort: read capability cache for tool counts
  let capCache: import('../../stack/capability-cache.js').ServerCapabilities[] = [];
  try {
    capCache = readCapabilityCache(detectDataDir(parsed, io));
  } catch {
    // non-fatal
  }

  // Build a lookup: server name → tool count (only when ok:true)
  const toolCountByName = new Map<string, number>();
  for (const entry of capCache) {
    if (entry.ok) {
      toolCountByName.set(entry.name, entry.tools.length);
    }
  }

  if (parsed.flags.json) {
    const toolResults = detectTools(env).map((t) => ({
      id: t.adapter.id,
      present: t.present
    }));
    writeJson(io.stdout, {
      servers: servers.map((s) => {
        const toolCount = toolCountByName.get(s.name);
        return toolCount !== undefined ? { ...s, tools: toolCount } : s;
      }),
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
    writeLine(io.stdout, theme.muted('No MCP servers configured.'));
    if (detected.length > 0) {
      writeLine(io.stdout, theme.muted('Detected tools: ' + detected.join(', ')));
    } else {
      writeLine(io.stdout, theme.muted('No supported agent tools detected.'));
    }
    writeLine(
      io.stdout,
      theme.muted('Run `agora search` to find servers, `agora install` to add them.')
    );
    return 0;
  }

  const grouped = groupServersByName(servers);
  const toolCount = new Set(servers.map((s) => s.tool)).size;

  writeLine(io.stdout, theme.accent('Installed MCP servers'));
  writeLine(io.stdout);

  const nameWidth = Math.max(...Array.from(grouped.keys()).map((n) => n.length));

  for (const [name, instances] of grouped) {
    const transport = instances.every((i) => i.transport === 'remote') ? 'remote' : 'local';

    const parts = instances.map((inst) => {
      const label = `${inst.tool} (${inst.scope})`;
      return inst.enabled === false ? theme.dim(label + ' (disabled)') : label;
    });

    const cachedTools = toolCountByName.get(name);
    const toolsSuffix = cachedTools !== undefined ? theme.dim(` · ${cachedTools} tools`) : '';

    writeLine(
      io.stdout,
      `  ${theme.accent(name.padEnd(nameWidth))}  ${theme.dim(transport)}  · ${parts.join(', ')}${toolsSuffix}`
    );
  }

  writeLine(io.stdout);
  writeLine(io.stdout, theme.muted(`${grouped.size} server(s) across ${toolCount} tool(s)`));

  return 0;
};
