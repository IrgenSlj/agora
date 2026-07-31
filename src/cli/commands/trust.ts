// `agora trust <id>` — every plane's verdict for one artifact, in one view.
//
// `agora scan` answers "does the heuristic gate object?". This answers the
// question the product is actually about: what does each plane know, and what
// does it *not* know? The second half is why `src/cli/trust-view.ts` treats
// `unknown` as a first-class outcome instead of rounding it to a pass.

import { findMarketplaceItem } from '../../catalog/bundled.js';
import { createProvenanceResolver } from '../../evidence/resolve-provenance.js';
import { aggregate, divergences } from '../../observe/profile.js';
import { readSessions } from '../../observe/session.js';
import { checkRevocations } from '../../revocation/client.js';
import { npmPackageFromCommand, npmPurl } from '../../revocation/installed.js';
import { scanItem } from '../../scan.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import {
  buildTrustRows,
  type ObservationSummary,
  type ProvenanceSummary,
  summarizeTrust,
  type TrustRow,
  type TrustTone
} from '../trust-view.js';
import type { CommandHandler } from './types.js';

function glyphFor(tone: TrustTone, theme: ReturnType<typeof cliTheme>): string {
  if (tone === 'ok') return theme.accent('✓');
  if (tone === 'bad') return theme.error('✗');
  if (tone === 'warn') return theme.warning('⚠');
  // Deliberately not a tick or a cross: this is "we do not know", and it must
  // not look like either verdict at a glance.
  return theme.muted('?');
}

/** Finds recorded behaviour for an item, matched by npm purl or raw command. */
function observationFor(
  dataDir: string,
  npmPackage: string | undefined
): ObservationSummary | null {
  if (!npmPackage) return null;
  const wanted = npmPurl(npmPackage);
  const observed = aggregate(readSessions(dataDir)).find((o) => {
    if (o.key === wanted) return true;
    return npmPackageFromCommand(o.command) === npmPackage;
  });
  if (!observed) return null;

  return {
    sessions: observed.sessions,
    toolCalls: Object.values(observed.toolCalls).reduce((a, b) => a + b, 0),
    networkSampled: observed.networkSampled,
    hostsContacted: observed.hostsContacted,
    divergences: divergences(observed, {})
  };
}

export const commandTrust: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) {
    return usageError(io, 'trust requires an item id: agora trust <id> [--json]');
  }

  const item = findMarketplaceItem(id);
  if (!item) {
    return usageError(io, `Item not found: ${id}. Run \`agora search <query>\` to find one.`);
  }

  const dataDir = detectDataDir(parsed, io);
  const offline = Boolean(parsed.flags.offline);

  const resolveProvenance = createProvenanceResolver({ fetcher: io.fetcher, offline });

  const scan = await scanItem(item, {
    fetcher: io.fetcher,
    githubToken: io.env?.AGORA_GITHUB_TOKEN,
    offline,
    provenance: resolveProvenance
  });

  // Resolved directly rather than read back off the scan check. The gate
  // deliberately collapses `no-provenance`, `network-error` and
  // `verification-skipped` into *no row at all*, which is correct for a gate
  // that must not raise false alarms — but it erases the difference between
  // "nothing was published" and "we could not look", and that difference is
  // the entire point of this view.
  let provenance: ProvenanceSummary | null | undefined;
  if (!item.npmPackage) {
    provenance = undefined;
  } else {
    const evidence = await resolveProvenance(item.npmPackage);
    provenance = evidence
      ? {
          verified: evidence.verified,
          reason: evidence.reason,
          sourceRepo: evidence.source_repo?.replace('https://github.com/', '')
        }
      : null;
  }

  // Revocation is answered here now. It used to be left `undefined` because
  // there was no feed to answer from — with no key pinned, nothing applied. A
  // feed now ships inside the package, so this is a local, offline, instant
  // lookup, and omitting it from the one command whose job is "every plane's
  // verdict" would understate what Agora knows. The opposite failure to the
  // one that comment was guarding against, and just as bad.
  const revocation = item.npmPackage
    ? checkRevocations(dataDir, [npmPurl(item.npmPackage)])
    : undefined;

  const rows: TrustRow[] = buildTrustRows({
    scan,
    provenance,
    revocation,
    observation: observationFor(dataDir, item.npmPackage)
    // policy is still left `undefined` — "not evaluated here" — rather than
    // faked. `agora acquire` runs it as a gate against a real target config;
    // claiming a verdict this command did not compute would be exactly the
    // failure this view exists to prevent.
  });
  const summary = summarizeTrust(rows);

  if (parsed.flags.json) {
    writeJson(io.stdout, { id: item.id, name: item.name, summary, rows });
    return summary.tone === 'bad' ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  const theme = cliTheme(style, io);
  writeLine(io.stdout, `${theme.bold(item.name)} ${theme.dim('(' + item.id + ')')}`);
  writeLine(io.stdout, '');
  for (const r of rows) {
    writeLine(
      io.stdout,
      `  ${glyphFor(r.tone, theme)} ${theme.muted(r.label.padEnd(11))}${r.detail}`
    );
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  ${theme.dim(summary.headline)}`);
  writeLine(
    io.stdout,
    theme.muted('  Run `agora acquire ' + item.id + '` to evaluate policy against a real target.')
  );

  return summary.tone === 'bad' ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
