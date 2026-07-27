import { getMarketplaceItems } from '../../catalog/bundled.js';
import { aggregate, divergences } from '../../observe/profile.js';
import { readSessions } from '../../observe/session.js';
import { npmPackageFromCommand } from '../../revocation/installed.js';
import { readAllServers } from '../../stack/registry.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

/** Declared network hosts for a command, from the bundled catalog manifest. */
function declaredNetFor(command: string[]): string[] | undefined {
  const pkg = npmPackageFromCommand(command);
  if (!pkg) return undefined;
  const item = getMarketplaceItems().find((i) => i.kind === 'package' && i.npmPackage === pkg);
  return item && item.kind === 'package' ? item.permissions?.net : undefined;
}

export const commandObserve: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'status';
  const theme = cliTheme(style, io);
  const dataDir = detectDataDir(parsed, io);

  if (sub !== 'status') {
    return usageError(
      io,
      `Unknown observe subcommand: ${sub}. Currently supported: status.\n` +
        'Wrap a server manually with: agora run -- <command…>'
    );
  }

  const sessions = readSessions(dataDir);
  const observations = aggregate(sessions);

  // Attach declared capabilities so divergence means something.
  const rows = observations.map((observation) => ({
    observation,
    divergence: divergences(observation, { net: declaredNetFor(observation.command) })
  }));

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      sessions: sessions.length,
      servers: rows.map((r) => ({ ...r.observation, divergence: r.divergence }))
    });
    return rows.some((r) => r.divergence.some((d) => d.severity === 'critical'))
      ? ExitCode.POLICY_FORBID
      : ExitCode.OK;
  }

  if (sessions.length === 0) {
    writeLine(io.stdout, theme.muted('No observed sessions recorded yet.'));
    writeLine(io.stdout, '');
    writeLine(io.stdout, 'Observation records what a server does while you actually use it.');
    writeLine(io.stdout, 'Wrap a server by routing it through Agora in your host config:');
    writeLine(io.stdout, '');
    writeLine(io.stdout, theme.dim('  command = ["agora", "run", "--", "npx", "<server>"]'));
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      theme.muted('Nothing is uploaded; tool arguments and results are never recorded.')
    );
    return ExitCode.OK;
  }

  const configured = readAllServers({ cwd: io.cwd, home: io.env?.HOME, env: io.env });
  const wrapped = configured.filter((s) => s.command?.[0] === 'agora').length;

  writeLine(io.stdout, theme.bold('Observed servers'));
  writeLine(io.stdout, '');

  for (const { observation, divergence } of rows) {
    const calls = Object.values(observation.toolCalls).reduce((a, b) => a + b, 0);
    writeLine(
      io.stdout,
      `  ${theme.accent(observation.key)}  ${theme.dim(
        `${observation.sessions} session(s) · ${calls} tool call(s)`
      )}`
    );

    const tools = Object.entries(observation.toolCalls).sort((a, b) => b[1] - a[1]);
    if (tools.length > 0) {
      writeLine(io.stdout, `       ${theme.dim(tools.map(([t, n]) => `${t}×${n}`).join(', '))}`);
    }

    if (!observation.networkSampled) {
      // Not "contacted nothing" — never looked.
      writeLine(io.stdout, `       ${theme.muted('network: not observed')}`);
    } else if (observation.hostsContacted.length === 0) {
      writeLine(io.stdout, `       ${theme.dim('network: no peers seen while sampling')}`);
    } else {
      writeLine(
        io.stdout,
        `       ${theme.dim(`network: ${observation.hostsContacted.join(', ')}`)}`
      );
    }

    for (const d of divergence) {
      const glyph = d.severity === 'critical' ? theme.error('⚠') : theme.warning('⚠');
      writeLine(io.stdout, `       ${glyph}  ${d.kind}: ${d.detail}`);
    }

    if (observation.failures > 0) {
      writeLine(io.stdout, `       ${theme.warning(`${observation.failures} non-zero exit(s)`)}`);
    }
    writeLine(io.stdout, '');
  }

  writeLine(
    io.stdout,
    theme.muted(
      `${sessions.length} session(s) recorded · ${wrapped} of ${configured.length} configured server(s) routed through agora run`
    )
  );
  writeLine(
    io.stdout,
    theme.muted(
      'Connection sampling polls; a short-lived connection between polls is not seen. Absence of a host is not proof of none.'
    )
  );

  return rows.some((r) => r.divergence.some((d) => d.severity === 'critical'))
    ? ExitCode.POLICY_FORBID
    : ExitCode.OK;
};

export const commandRun: CommandHandler = async (parsed, io, _style) => {
  // Everything after `--` is the real server's argv. parseArgs keeps it in
  // args, so find the separator ourselves to avoid interpreting the server's
  // own flags as Agora's.
  const raw = parsed.args;
  const command = raw[0] === '--' ? raw.slice(1) : raw;

  if (command.length === 0) {
    return usageError(io, 'agora run requires a command: agora run -- <command…>');
  }

  const { runSupervised } = await import('../../observe/run.js');
  const { createSessionRecorder } = await import('../../observe/session.js');
  const { sampleConnections } = await import('../../observe/connections.js');
  const { npmPurl, npmPackageFromCommand: pkgFrom } = await import('../../revocation/installed.js');

  const pkg = pkgFrom(command);
  const dataDir = detectDataDir(parsed, io);

  const recorder = createSessionRecorder({
    dataDir,
    key: pkg ? npmPurl(pkg) : command.join(' '),
    sampleConnections
  });

  return runSupervised({ command, recorder, env: process.env, cwd: io.cwd });
};
