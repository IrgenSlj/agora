import { readAllServers, detectTools, ALL_ADAPTERS } from '../../stack/registry.js';
import { checkStack } from '../../stack/doctor.js';
import type { AgentToolId } from '../../stack/types.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError, detectDataDir } from '../helpers.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export const commandDoctor: CommandHandler = async (parsed, io, style) => {
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

  const probe = Boolean(parsed.flags.probe);
  const strict = Boolean(parsed.flags.strict);

  let servers = readAllServers(env);
  if (toolFlag) {
    servers = servers.filter((s) => s.tool === toolFlag);
  }

  if (servers.length === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { servers: [], summary: { ok: 0, warn: 0, error: 0 } });
      return 0;
    }
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

  if (probe) {
    writeLine(
      io.stdout,
      style.dim('Probing: starting each local server briefly to verify it runs…')
    );
  }

  const dataDir = detectDataDir(parsed, io);
  const health = await checkStack(servers, { ...env, probe, dataDir });

  if (parsed.flags.json) {
    writeJson(io.stdout, health);
    return 0;
  }

  for (const server of health.servers) {
    const glyph =
      server.status === 'ok'
        ? style.accent('✓')
        : server.status === 'warn'
          ? style.orange('⚠')
          : style.dim('✗');

    let serverLine = `${glyph}  ${style.bold(server.name)}`;

    if (probe && server.status === 'ok') {
      const probeCheck = server.checks.find((c) => c.name === 'probe');
      if (probeCheck?.ok && probeCheck.detail) {
        const toolMatch = probeCheck.detail.match(/(\d+) tool\(s\)/);
        if (toolMatch) {
          serverLine += style.dim(` (${toolMatch[1]} tools)`);
        }
      }
    }

    writeLine(io.stdout, serverLine);

    if (server.status !== 'ok') {
      for (const check of server.checks) {
        if (!check.ok && check.detail) {
          writeLine(io.stdout, `     ${style.dim(check.detail)}`);
        }
      }
    }
  }

  writeLine(io.stdout);
  const { ok, warn, error } = health.summary;
  writeLine(
    io.stdout,
    `${style.accent(`ok: ${ok}`)}  ${style.orange(`warn: ${warn}`)}  ${style.dim(`error: ${error}`)}`
  );

  if (strict && error > 0) return 1;
  return 0;
};
