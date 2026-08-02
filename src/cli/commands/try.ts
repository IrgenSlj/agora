import { resolvedPurlFor, revocationPurlsFor } from '../../acquire.js';
import { buildOpenCodeConfig, findMarketplaceItem } from '../../catalog/bundled.js';
import { authorizeLegacyMutation } from '../../gate/adapters.js';
import { appendGateAudit, auditRecordFor } from '../../gate/audit.js';
import { evaluatePolicy } from '../../policy/engine.js';
import { checkRevocations } from '../../revocation/client.js';
import { type ScanResult, scanItem } from '../../scan.js';
import { capabilityKey, upsertCapabilities } from '../../stack/capability-cache.js';
import { manifestPath, readManifest } from '../../stack/manifest.js';
import { type McpProbeResult, probeMcpServer } from '../../stack/mcp-probe.js';
import { ExitCode } from '../exit-codes.js';
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

  // ── The gate ─────────────────────────────────────────────────────────────
  //
  // `try` writes no host config, but it *runs the server's code* on this
  // machine, which is the effect the scan existed to inform. `--skip-scan` used
  // to run it with nothing known at all, and a scan that merely failed did the
  // same thing silently. Both now produce an explicit unknown that only
  // `--accept-risk` can clear, while revocation and policy always decide.
  const dataDir = detectDataDir(parsed, io);
  const skipScan = Boolean(parsed.flags.skipScan);
  let scanResult: ScanResult | null = null;

  if (!skipScan) {
    try {
      scanResult = await scanItem(item, {
        fetcher: io.fetcher,
        githubToken: io.env?.AGORA_GITHUB_TOKEN
      });
    } catch {
      // Unreachable scan: left null, which the gate reads as unknown rather
      // than as permission to run the thing anyway.
    }
  }

  const revocation = checkRevocations(dataDir, revocationPurlsFor(item));
  const authorization = authorizeLegacyMutation({
    action: 'TryRun',
    actor: 'human-cli',
    effects: ['external-process', 'cache'],
    ...(scanResult ? { scan: scanResult } : {}),
    policy: await evaluatePolicy({
      purl: revocationPurlsFor(item)[0] ?? `pkg:generic/${item.id}`,
      action: 'Install',
      policyFiles: readManifest(manifestPath({ cwd: io.cwd, env: io.env }))?.policy?.files ?? [],
      cwd: io.cwd,
      ...(scanResult ? { scan: scanResult } : {}),
      revoked: revocation.unknown ? undefined : revocation.blocked,
      kind: item.kind === 'package' ? 'mcp-server' : item.kind,
      permissions: item.kind === 'package' ? item.permissions : undefined
    }),
    revocation,
    ...(parsed.flags.acceptRisk === true ? { acknowledged: ['scan'] } : {})
  });
  const allowed =
    authorization.verdict === 'allow' ||
    (authorization.verdict === 'review' && parsed.flags.acceptWarnings === true);

  if (parsed.flags.json) {
    const timeoutMs = numberFlag(parsed, 'timeout') ?? 15000;
    // Only replaced when the gate allows the run, so the reported error is the
    // refusal itself rather than a probe that never happened.
    let probe: McpProbeResult = { ok: false, error: 'refused before running' };

    if (allowed) {
      probe = await probeMcpServer(command, {
        env: io.env,
        cwd: io.cwd,
        timeoutMs
      });
      try {
        upsertCapabilities(dataDir, {
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
      authorization,
      probe
    });

    if (!allowed) return ExitCode.POLICY_FORBID;
    return probe.ok ? ExitCode.OK : ExitCode.POLICY_FORBID;
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
  }

  if (!allowed) {
    writeLine(
      io.stderr,
      `${theme.error('Refusing try-run')} — ${authorization.reasons.join('; ')}.`
    );
    writeLine(
      io.stderr,
      authorization.verdict === 'review'
        ? 'Re-run with --accept-warnings to run it anyway.'
        : authorization.verdict === 'inconclusive'
          ? 'Re-run with --accept-risk to run it without a scan; the acceptance will be recorded.'
          : `Run \`agora trust ${item.id}\` to see the evidence behind this.`
    );
    return ExitCode.POLICY_FORBID;
  }

  if (authorization.acknowledged.length) {
    // `try` runs the code. An acceptance to run something unscanned is exactly
    // the kind of decision that should still be findable a week later.
    const recorded = appendGateAudit(
      dataDir,
      auditRecordFor(authorization, {
        actor: 'human-cli',
        subject: item.id,
        ...(resolvedPurlFor(item) ? { purl: resolvedPurlFor(item) as string } : {})
      })
    );
    for (const accepted of authorization.acknowledged) {
      writeLine(io.stdout, theme.dim(`Accepted risk — ${accepted}`));
    }
    if (!recorded) {
      writeLine(io.stderr, `Warning: the risk acceptance could not be recorded in ${dataDir}.`);
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
    upsertCapabilities(dataDir, {
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
    return ExitCode.OK;
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
  return ExitCode.POLICY_FORBID;
};
