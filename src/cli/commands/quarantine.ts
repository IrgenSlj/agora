// `agora quarantine` / `agora unquarantine` (brief §9).
//
// The quarantine *machinery* has shipped since drift detection landed: when a
// server's tool descriptions change under it, `doctor --probe` records the
// drift and `sync`/`update` refuse to reintroduce the entry. What was missing
// was any way to see what is quarantined or to release it — so the only exit
// was hand-editing `capabilities.json`, which is exactly the kind of thing a
// user does wrong at 2am.
//
// Releasing requires `--accept-risk`. A quarantine means a server's advertised
// tools changed after you approved them, which is the rug-pull shape this
// product exists to catch. Re-enabling it should be a deliberate act with a
// record, not a default.

import {
  readCapabilityCache,
  type ServerCapabilities,
  upsertCapabilities
} from '../../stack/capability-cache.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

function quarantined(dataDir: string): ServerCapabilities[] {
  return readCapabilityCache(dataDir).filter((entry) => entry.state === 'quarantined');
}

function ageLabel(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const commandQuarantine: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'list';
  if (sub !== 'list') {
    return usageError(
      io,
      `Unknown quarantine subcommand: ${sub}. Use \`agora quarantine list\`.\n` +
        'Release one with `agora unquarantine <name> --accept-risk`.'
    );
  }

  const dataDir = detectDataDir(parsed, io);
  const entries = quarantined(dataDir);
  const theme = cliTheme(style, io);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      count: entries.length,
      servers: entries.map((e) => ({
        name: e.name,
        command: e.command,
        reason: e.quarantineReason,
        quarantinedAt: e.quarantinedAt,
        driftDetectedAt: e.driftDetectedAt
      }))
    });
    return ExitCode.OK;
  }

  if (entries.length === 0) {
    writeLine(io.stdout, theme.muted('Nothing is quarantined.'));
    // Absence of a quarantine is not evidence of good behaviour — it only
    // means no probe has caught a change. Say which, so it cannot be misread.
    writeLine(
      io.stdout,
      theme.dim('Quarantine records drift found by `agora doctor --probe`; run it to check now.')
    );
    return ExitCode.OK;
  }

  writeLine(io.stdout, theme.bold(`Quarantined (${entries.length})`));
  writeLine(io.stdout, '');
  for (const entry of entries) {
    writeLine(io.stdout, `  ${theme.error('✗')} ${theme.accent(entry.name)}`);
    writeLine(io.stdout, `      ${theme.dim(entry.command.join(' '))}`);
    if (entry.quarantineReason) {
      writeLine(io.stdout, `      ${theme.warning(entry.quarantineReason)}`);
    }
    writeLine(io.stdout, `      ${theme.dim('quarantined ' + ageLabel(entry.quarantinedAt))}`);
    writeLine(io.stdout, '');
  }
  writeLine(io.stdout, theme.muted('Release with: agora unquarantine <name> --accept-risk'));
  writeLine(
    io.stdout,
    theme.muted('These servers are skipped by `agora sync` and `agora apply` until released.')
  );

  // Exit 1: a quarantined server is an unresolved policy/drift state, and the
  // brief's §9 contract maps that to 1 so CI can gate on it.
  return ExitCode.POLICY_FORBID;
};

export const commandUnquarantine: CommandHandler = async (parsed, io, style) => {
  const name = parsed.args[0];
  if (!name) {
    return usageError(
      io,
      'unquarantine requires a server name: agora unquarantine <name> --accept-risk'
    );
  }

  const dataDir = detectDataDir(parsed, io);
  const theme = cliTheme(style, io);
  const entry = quarantined(dataDir).find((e) => e.name === name);

  if (!entry) {
    return usageError(
      io,
      `"${name}" is not quarantined. Run \`agora quarantine list\` to see what is.`
    );
  }

  if (!parsed.flags.acceptRisk) {
    writeLine(io.stderr, `${theme.bold(name)} is quarantined.`);
    if (entry.quarantineReason) writeLine(io.stderr, `  ${entry.quarantineReason}`);
    writeLine(io.stderr, '');
    writeLine(
      io.stderr,
      'Its advertised tools changed after you approved them — the rug-pull shape Agora exists'
    );
    writeLine(io.stderr, 'to catch. Inspect the drift with `agora doctor --probe` first.');
    writeLine(io.stderr, '');
    writeLine(io.stderr, `Re-enable anyway: agora unquarantine ${name} --accept-risk`);
    return ExitCode.USAGE;
  }

  // Approve the drifted digest as the new baseline. Leaving the old baseline in
  // place would re-quarantine on the next probe, which reads as the release
  // having silently failed.
  const now = new Date().toISOString();
  upsertCapabilities(dataDir, {
    ...entry,
    state: 'installed',
    quarantineReason: undefined,
    quarantinedAt: undefined,
    descriptionDigest: entry.liveDescriptionDigest ?? entry.descriptionDigest,
    descriptionDigestAt: now,
    tools: entry.liveTools ?? entry.tools,
    liveDescriptionDigest: undefined,
    liveTools: undefined,
    driftDetectedAt: undefined
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, { released: name, acceptedRisk: true, at: now });
    return ExitCode.OK;
  }

  writeLine(io.stdout, `${theme.accent('✓')} Released ${theme.bold(name)} from quarantine.`);
  writeLine(io.stdout, theme.dim('Its current tool descriptions are now the approved baseline.'));
  writeLine(io.stdout, theme.muted('Run `agora sync` to write it back to your hosts.'));
  return ExitCode.OK;
};
