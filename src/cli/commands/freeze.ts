import { existsSync } from 'node:fs';
import { capabilityKey, readCapabilityCache } from '../../stack/capability-cache.js';
import {
  manifestPath,
  type StackManifest,
  serializeManifest,
  serverToEntry,
  writeManifest
} from '../../stack/manifest.js';
import { ALL_ADAPTERS, groupServersByName, readAllServers } from '../../stack/registry.js';
import type { AgentToolId } from '../../stack/types.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export const commandFreeze: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  // --tool filter
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

  // Empty stack
  if (servers.length === 0) {
    writeLine(io.stdout, theme.muted('No MCP servers configured.'));
    writeLine(
      io.stdout,
      theme.muted('Run `agora search` to find servers, `agora install` to add them.')
    );
    return 0;
  }

  // Dedupe by name: keep first instance; warn on conflicts
  const grouped = groupServersByName(servers);
  const mcp: Record<string, ReturnType<typeof serverToEntry>> = {};
  const dataDir = detectDataDir(parsed, io);
  const cached = dataDir ? readCapabilityCache(dataDir) : [];

  for (const [name, instances] of grouped) {
    const winner = instances[0]!;
    mcp[name] = serverToEntry(winner);
    if (winner.command) {
      const digest = cached.find(
        (entry) => entry.key === capabilityKey(name, winner.command!)
      )?.descriptionDigest;
      if (digest) mcp[name].descriptionDigest = digest;
    }

    if (instances.length > 1) {
      const loserTools = instances
        .slice(1)
        .map((i) => `${i.tool} (${i.scope})`)
        .join(', ');
      writeLine(
        io.stderr,
        theme.dim(
          `Warning: "${name}" configured in multiple tools; kept ${winner.tool} (${winner.scope}), ignored ${loserTools}`
        )
      );
    }
  }

  const manifest: StackManifest = { mcp };

  // --json: print manifest as JSON
  if (parsed.flags.json) {
    writeJson(io.stdout, manifest);
    return 0;
  }

  const doWrite = Boolean(parsed.flags.write);
  const force = Boolean(parsed.flags.force);
  const outFlag = stringFlag(parsed, 'out');

  if (!doWrite) {
    // Preview: print TOML to stdout
    writeLine(io.stdout, serializeManifest(manifest).trimEnd());
    return 0;
  }

  // Write mode
  const dest = outFlag ?? manifestPath(env);

  if (!force && existsSync(dest)) {
    return usageError(io, `${dest} already exists. Pass --force to overwrite.`);
  }

  writeManifest(dest, manifest);
  writeLine(io.stdout, `Written to ${dest}`);
  return 0;
};
