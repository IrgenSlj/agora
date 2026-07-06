import { buildOpenCodeConfig, findMarketplaceItem } from '../../marketplace.js';
import { type ScanResult, scanItem } from '../../scan.js';
import { capabilityKey, upsertCapabilities } from '../../stack/capability-cache.js';
import { type McpProbeResult, probeMcpServer } from '../../stack/mcp-probe.js';
import { detectDataDir, numberFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { status } from '../pages/components.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandTry: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'try requires an item id');

  const item = findMarketplaceItem(id);
  if (!item) return usageError(io, `Item not found: ${id}`);

  // Derive the launch command from buildOpenCodeConfig
  const cfg = buildOpenCodeConfig([item], {});
  const mcpEntries = Object.values(cfg.mcp ?? {});

  if (mcpEntries.length === 0) {
    writeLine(io.stdout, `${item.name} does not expose an MCP server entry — nothing to try-run.`);
    return 0;
  }

  const mcpEntry = mcpEntries[0]!;

  if (!Array.isArray(mcpEntry.command) || mcpEntry.command.length === 0) {
    writeLine(
      io.stdout,
      `${item.name} uses a remote (URL-based) MCP transport. agora try currently supports only local (command-based) MCP servers.`
    );
    return 0;
  }

  const command: string[] = mcpEntry.command as string[];

  // ── Scan gate ────────────────────────────────────────────────────────────────
  const skipScan = Boolean(parsed.flags.skipScan);
  let scanResult: ScanResult | null = null;

  if (!skipScan) {
    try {
      scanResult = await scanItem(item, {
        fetcher: io.fetcher,
        githubToken: io.env?.AGORA_GITHUB_TOKEN
      });
    } catch {
      // Offline / unreachable — proceed without scan
    }
  }

  if (parsed.flags.json) {
    const timeoutMs = numberFlag(parsed, 'timeout') ?? 15000;
    let probe: McpProbeResult = { ok: false, error: 'scan failed' };

    if (!scanResult || scanResult.summary.fail === 0) {
      probe = await probeMcpServer(command, {
        env: io.env,
        cwd: io.cwd,
        timeoutMs
      });
      try {
        upsertCapabilities(detectDataDir(parsed, io), {
          key: capabilityKey(item.id, command),
          name: item.id,
          command,
          serverInfo: probe.serverInfo,
          tools: probe.tools ?? [],
          ok: probe.ok,
          probedAt: new Date().toISOString()
        });
      } catch {
        // best-effort
      }
    }

    writeJson(io.stdout, {
      item: { id: item.id, name: item.name },
      command,
      scan: scanResult,
      probe
    });

    if (scanResult && scanResult.summary.fail > 0) return 1;
    return probe.ok ? 0 : 1;
  }

  // Human output
  const theme = cliTheme(style, io);

  if (scanResult) {
    writeLine(io.stdout, 'Scan:');
    for (const c of scanResult.checks) {
      const icon =
        c.status === 'pass'
          ? status('success', '', theme)
          : c.status === 'warn'
            ? status('warning', '', theme)
            : status('error', '', theme);
      writeLine(io.stdout, `  ${icon}  ${c.label}: ${c.message}`);
    }
    const { pass, warn, fail } = scanResult.summary;
    writeLine(io.stdout, `  ${pass} pass · ${warn} warning(s) · ${fail} failure(s)`);
    writeLine(io.stdout, '');

    if (fail > 0) {
      writeLine(
        io.stderr,
        `${theme.error('Refusing try-run')} — ${fail} scan check(s) failed. Re-run with --skip-scan to override.`
      );
      return 1;
    }
  }

  writeLine(io.stdout, `Starting ${theme.accent(item.name)} — ephemeral, nothing will be saved.`);
  writeLine(
    io.stdout,
    theme.dim(`This runs the server (may npx-download on first use): ${command.join(' ')}`)
  );
  writeLine(io.stdout, '');

  const timeoutMs = numberFlag(parsed, 'timeout') ?? 15000;
  const probe = await probeMcpServer(command, {
    env: io.env,
    cwd: io.cwd,
    timeoutMs
  });
  try {
    upsertCapabilities(detectDataDir(parsed, io), {
      key: capabilityKey(item.id, command),
      name: item.id,
      command,
      serverInfo: probe.serverInfo,
      tools: probe.tools ?? [],
      ok: probe.ok,
      probedAt: new Date().toISOString()
    });
  } catch {
    // best-effort
  }

  if (probe.ok) {
    writeLine(io.stdout, `${status('success', '', theme)} ${item.name} started`);
    if (probe.serverInfo?.name || probe.serverInfo?.version) {
      const info = [probe.serverInfo.name, probe.serverInfo.version].filter(Boolean).join(' ');
      writeLine(io.stdout, `  Server: ${info}`);
    }
    writeLine(io.stdout, '');
    if (probe.tools && probe.tools.length > 0) {
      writeLine(io.stdout, `Tools (${probe.tools.length}):`);
      for (const tool of probe.tools) {
        const desc = tool.description ? ` — ${tool.description}` : '';
        writeLine(io.stdout, `  ${theme.accent(tool.name)}${desc}`);
      }
    } else {
      writeLine(io.stdout, '(no tools advertised)');
    }
    if (probe.error) {
      writeLine(io.stdout, theme.dim(`Note: ${probe.error}`));
    }
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      theme.dim('Nothing was saved. To keep this server: agora install ' + id + ' --write --save')
    );
    return 0;
  }

  // Probe failed
  writeLine(io.stdout, `${status('error', '', theme)} could not start ${item.name}`);
  if (probe.error) writeLine(io.stdout, `  Error: ${probe.error}`);
  if (probe.exitCode !== undefined && probe.exitCode !== null) {
    writeLine(io.stdout, `  Exit code: ${probe.exitCode}`);
  }
  if (probe.stderr) {
    const lines = probe.stderr.split('\n');
    const displayed = lines.slice(-8);
    writeLine(io.stdout, theme.dim('  stderr:'));
    for (const l of displayed) {
      writeLine(io.stdout, theme.dim(`    ${l}`));
    }
  }
  return 1;
};
