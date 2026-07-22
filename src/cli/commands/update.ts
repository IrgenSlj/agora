import { checkOutdated } from '../../outdated.js';
import { ALL_ADAPTERS, getAdapter, readAllServers } from '../../stack/registry.js';
import type { AgentToolId, DesiredServer, StackEnv } from '../../stack/types.js';
import { buildUpdatePlan, bumpCommand, collectPackages } from '../../update.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { status } from '../pages/components.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export const commandUpdate: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const env: StackEnv = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  // --write / --yes gating
  const doWrite = Boolean(parsed.flags.write);
  const doYes = Boolean(parsed.flags.yes);

  if (doWrite && !doYes) {
    return usageError(
      io,
      'Refusing to write: --write requires --yes to confirm. ' +
        'Run with --write --yes to apply, or without --write to preview (dry-run).'
    );
  }

  // --scope (default project)
  const scopeFlag = stringFlag(parsed, 'scope');
  if (scopeFlag !== undefined && scopeFlag !== 'project' && scopeFlag !== 'user') {
    return usageError(io, `Invalid scope: ${scopeFlag}. Must be "project" or "user".`);
  }
  const scope: 'project' | 'user' = scopeFlag === 'user' ? 'user' : 'project';

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

  // Optional positional server name filter
  const serverArg = parsed.args[0];
  if (serverArg !== undefined) {
    const filtered = servers.filter((s) => s.name.toLowerCase() === serverArg.toLowerCase());
    if (filtered.length === 0) {
      return usageError(
        io,
        `No server named "${serverArg}" found. Run \`agora installed\` to see configured server names.`
      );
    }
    servers = filtered;
  }

  // Apply --tool filter
  if (toolFlag) {
    servers = servers.filter((s) => s.tool === toolFlag);
  }

  // Empty state
  if (servers.length === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, {
        mode: doWrite ? 'applied' : 'plan',
        entries: [],
        summary: { updatable: 0, 'up-to-date': 0, 'tracks-latest': 0, unknown: 0 }
      });
      return 0;
    }
    writeLine(io.stdout, theme.muted('No MCP servers configured.'));
    writeLine(
      io.stdout,
      theme.muted(
        'Run `agora installed` to see configured servers, `agora search` to find new ones.'
      )
    );
    return 0;
  }

  // Collect unique npm package names and fetch latest versions
  const names = collectPackages(servers);
  const outdatedResult = await checkOutdated(names, { fetcher: io.fetcher });

  const latestByPkg = new Map<string, string | null>(
    outdatedResult.entries.map((e) => [e.pkg, e.latestVersion])
  );

  const entries = buildUpdatePlan(servers, latestByPkg);

  // Summary counts
  const summary = {
    updatable: entries.filter((e) => e.status === 'updatable').length,
    'up-to-date': entries.filter((e) => e.status === 'up-to-date').length,
    'tracks-latest': entries.filter((e) => e.status === 'tracks-latest').length,
    unknown: entries.filter((e) => e.status === 'unknown').length
  };

  if (doWrite && doYes) {
    // ── WRITE MODE ──────────────────────────────────────────────────────────
    const updatableEntries = entries.filter((e) => e.status === 'updatable');

    // Group updatable entries by tool
    const byTool = new Map<AgentToolId, typeof updatableEntries>();
    for (const entry of updatableEntries) {
      const tool = entry.tool as AgentToolId;
      const toolEntries = byTool.get(tool);
      if (toolEntries) {
        toolEntries.push(entry);
      } else {
        byTool.set(tool, [entry]);
      }
    }

    interface ToolResult {
      tool: AgentToolId;
      location: string | null;
      updated: { server: string; from: string; to: string; path: string }[];
      skipped: { server: string; reason: string }[];
    }

    const toolResults: ToolResult[] = [];
    const filesWritten = new Set<string>();

    for (const [tool, toolEntries] of byTool) {
      const adapter = getAdapter(tool);
      if (!adapter) continue;

      const location = adapter.writeLocation(env, scope);
      const result: ToolResult = {
        tool,
        location: location?.path ?? null,
        updated: [],
        skipped: []
      };

      if (location === null) {
        for (const entry of toolEntries) {
          result.skipped.push({
            server: entry.server,
            reason: `no writable location for scope ${scope}`
          });
        }
        toolResults.push(result);
        continue;
      }

      // Only bump servers whose configPath matches the writable location
      const toWrite: DesiredServer[] = [];
      const updatedMeta: { server: string; from: string; to: string; path: string }[] = [];

      for (const entry of toolEntries) {
        if (entry.configPath !== location.path) {
          result.skipped.push({
            server: entry.server,
            reason: 'server lives in a different config file than the writable location'
          });
          continue;
        }

        // Find the original ConfiguredServer to preserve env/url/enabled
        const original = servers.find(
          (s) => s.name === entry.server && s.tool === tool && s.configPath === entry.configPath
        );
        if (!original?.command) {
          result.skipped.push({ server: entry.server, reason: 'original server record not found' });
          continue;
        }

        if (entry.current === null || entry.latest === null) {
          result.skipped.push({
            server: entry.server,
            reason: 'version data missing for updatable entry'
          });
          continue;
        }

        const newCommand = bumpCommand(original.command, entry.latest);
        const ds: DesiredServer = {
          name: entry.server,
          command: newCommand
        };
        if (original.url) ds.url = original.url;
        if (original.env && Object.keys(original.env).length > 0) ds.env = original.env;
        if (original.enabled === false) ds.enabled = false;

        toWrite.push(ds);
        updatedMeta.push({
          server: entry.server,
          from: entry.current,
          to: entry.latest,
          path: location.path
        });
      }

      if (toWrite.length > 0) {
        adapter.writeServers(location, toWrite, { prune: false });
        for (const m of updatedMeta) {
          result.updated.push(m);
          filesWritten.add(m.path);
        }
      }

      toolResults.push(result);
    }

    if (parsed.flags.json) {
      const allUpdated = toolResults.flatMap((r) => r.updated);
      writeJson(io.stdout, { mode: 'applied', tools: toolResults, updated: allUpdated });
      return 0;
    }

    writeLine(io.stdout, theme.accent('agora update — applied'));
    writeLine(io.stdout);

    for (const result of toolResults) {
      const locationLabel = result.location ?? '(no location)';
      writeLine(io.stdout, `  ${result.tool}  →  ${locationLabel}`);
      for (const u of result.updated) {
        writeLine(io.stdout, `    ~ ${u.server} (${u.from} → ${u.to})`);
      }
      for (const s of result.skipped) {
        writeLine(io.stdout, `    ${theme.dim(`skipped: ${s.server} (${s.reason})`)}`);
      }
      if (result.updated.length === 0 && result.skipped.length === 0) {
        writeLine(io.stdout, `    ${theme.dim('(no changes)')}`);
      }
    }

    writeLine(io.stdout);

    const writtenPaths = [...filesWritten];
    if (writtenPaths.length > 0) {
      writeLine(io.stdout, 'Files written:');
      for (const f of writtenPaths) {
        writeLine(io.stdout, `  ${f}`);
      }
    } else {
      writeLine(io.stdout, theme.muted('No files changed.'));
    }

    return 0;
  }

  // ── DRY-RUN MODE (default) ─────────────────────────────────────────────────
  if (parsed.flags.json) {
    writeJson(io.stdout, { mode: 'plan', entries, summary });
    return 0;
  }

  writeLine(io.stdout, theme.accent('agora update — version check'));
  writeLine(io.stdout);

  const nameWidth = Math.max(...entries.map((e) => e.server.length));
  for (const entry of entries) {
    const icon =
      entry.status === 'up-to-date'
        ? status('success', '', theme)
        : entry.status === 'updatable'
          ? status('warning', '', theme)
          : entry.status === 'tracks-latest'
            ? theme.muted('~')
            : theme.info('?');
    writeLine(io.stdout, `  ${icon}  ${entry.server.padEnd(nameWidth)}  ${entry.message}`);
  }

  writeLine(io.stdout);
  const { updatable } = summary;
  const upToDate = summary['up-to-date'];
  const tracksLatest = summary['tracks-latest'];
  const unknown = summary.unknown;
  writeLine(
    io.stdout,
    `${updatable} updatable · ${upToDate} up-to-date · ${tracksLatest} tracks-latest · ${unknown} unknown`
  );
  writeLine(io.stdout);

  if (updatable > 0) {
    writeLine(
      io.stdout,
      theme.muted(`${updatable} update(s) available. Run \`agora update --write --yes\` to apply.`)
    );
  } else {
    writeLine(io.stdout, theme.muted('Everything is up to date.'));
  }

  return 0;
};
