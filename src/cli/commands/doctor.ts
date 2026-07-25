import { checkRevocations, refreshFeed } from '../../revocation/client.js';
import { installedPurls } from '../../revocation/installed.js';
import { isBlocking } from '../../revocation/match.js';
import { checkStack } from '../../stack/doctor.js';
import { ALL_ADAPTERS, detectTools, readAllServers } from '../../stack/registry.js';
import type { AgentToolId } from '../../stack/types.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { status } from '../pages/components.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

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
    const theme = cliTheme(style, io);
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

  const theme = cliTheme(style, io);

  if (probe) {
    writeLine(
      io.stdout,
      theme.muted('Probing: starting each local server briefly to verify it runs…')
    );
  }

  const dataDir = detectDataDir(parsed, io);
  const health = await checkStack(servers, { ...env, probe, dataDir, quarantineOnDrift: probe });

  // Revocation is opportunistic: refresh at most every 6h and never let a feed
  // failure affect the health report the user asked for. The lookup itself is
  // offline, against whatever is cached.
  await refreshFeed({ dataDir, fetcher: io.fetcher });
  const addressed = installedPurls(servers);
  const revocations = checkRevocations(
    dataDir,
    addressed.addressable.map((a) => a.purl)
  );
  // `doctor` groups a server by name across hosts, so key the lookup by name:
  // if any instance resolves to a revoked purl, the group is revoked.
  const matchByPurl = new Map(revocations.matches.map((m) => [m.purl, m]));
  const revokedByName = new Map(
    addressed.addressable
      .map((a) => [a.server.name, matchByPurl.get(a.purl)] as const)
      .filter((pair): pair is [string, NonNullable<(typeof pair)[1]>] => Boolean(pair[1]))
  );
  const driftOrQuarantine = health.servers.some((server) =>
    server.checks.some((check) => check.name === 'description-drift' || check.name === 'quarantine')
  );

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      ...health,
      revocations: {
        feedVersion: revocations.feedVersion,
        // `unknown` is not "clean" — it means no feed has ever been fetched.
        unknown: revocations.unknown,
        stale: revocations.stale,
        blocked: revocations.blocked,
        matches: revocations.matches.map((m) => ({
          purl: m.purl,
          id: m.entry.id,
          reason: m.entry.reason,
          severity: m.entry.severity,
          refs: m.entry.refs
        })),
        uncheckable: addressed.unaddressable.map((s2) => s2.name)
      }
    });
    if (revocations.blocked) return ExitCode.POLICY_FORBID;
    return driftOrQuarantine ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  for (const server of health.servers) {
    const glyph =
      server.status === 'ok'
        ? status('success', '', theme)
        : server.status === 'warn'
          ? status('warning', '', theme)
          : status('error', '', theme);

    let serverLine = `${glyph}  ${theme.bold(server.name)}`;

    if (probe) {
      if (server.status === 'ok') {
        const probeCheck = server.checks.find((c) => c.name === 'probe');
        if (probeCheck?.ok && probeCheck.detail) {
          const toolMatch = probeCheck.detail.match(/(\d+) tool\(s\)/);
          if (toolMatch) {
            serverLine += theme.dim(` (${toolMatch[1]} tools)`);
          }
        }
      }
      // Additive DRIFT chip (P2): checkStack already computes description-drift
      // on --probe; surface it inline next to the server name rather than
      // only inside the detail lines below.
      if (server.checks.some((c) => c.name === 'description-drift')) {
        serverLine += `  ${theme.warning('DRIFT')}`;
      }
    }

    const revoked = revokedByName.get(server.name);
    if (revoked) {
      serverLine += `  ${isBlocking(revoked.entry) ? theme.error('REVOKED') : theme.warning('ADVISORY')}`;
    }

    writeLine(io.stdout, serverLine);

    if (revoked) {
      writeLine(
        io.stdout,
        `     ${theme.dim(`${revoked.entry.id} — ${revoked.entry.reason} (${revoked.entry.severity})`)}`
      );
      for (const ref of revoked.entry.refs.slice(0, 2)) {
        writeLine(io.stdout, `     ${theme.dim(ref)}`);
      }
    }

    if (server.status !== 'ok') {
      for (const check of server.checks) {
        if (!check.ok && check.detail) {
          writeLine(io.stdout, `     ${theme.dim(check.detail)}`);
        }
      }
    }
  }

  writeLine(io.stdout);
  const { ok, warn, error } = health.summary;
  writeLine(
    io.stdout,
    `${theme.success(`ok: ${ok}`)}  ${theme.warning(`warn: ${warn}`)}  ${theme.error(`error: ${error}`)}`
  );

  if (revocations.unknown) {
    writeLine(
      io.stdout,
      theme.muted('revocations: no feed cached yet — nothing has been checked against it')
    );
  } else if (revocations.stale) {
    const days = Math.floor((revocations.ageMs ?? 0) / 86_400_000);
    writeLine(
      io.stdout,
      theme.warning(`revocations: feed is ${days}d old — it may be missing recent entries`)
    );
  }
  if (addressed.unaddressable.length > 0) {
    writeLine(
      io.stdout,
      theme.muted(
        `revocations: ${addressed.unaddressable.length} server(s) could not be checked (remote or non-npm launcher)`
      )
    );
  }

  if (revocations.blocked) return ExitCode.POLICY_FORBID;
  if (driftOrQuarantine) return ExitCode.POLICY_FORBID;
  if (strict && error > 0) return ExitCode.POLICY_FORBID;
  return ExitCode.OK;
};
