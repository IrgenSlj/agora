// `agora audit` — advisories against the MCP servers you actually run.
//
// The command exists because of a structural gap, not a missing feature
// elsewhere. MCP servers are not dependencies: they live in host configs as
// spawned commands (`npx @modelcontextprotocol/server-filesystem`) and appear
// in no package.json anywhere. `npm audit`, Dependabot and Snyk walk dependency
// trees, so they cannot see these by construction — not because they are
// deficient, but because nothing ever told them this surface exists.
//
// Agora knows which packages are MCP servers and reads the host configs, so it
// can ask a question nothing else is positioned to ask. This command is the
// shortest path from that fact to something a person can see.
//
// Deliberately queries OSV live rather than reading the signed revocation feed:
// the feed is the *offline, verified, blocking* path used by `acquire`, and it
// applies nothing until a key is pinned. This is the *reporting* path, and it
// should work on day one for someone who has just installed Agora.

import { queryPurl } from '../../osv/client.js';
import type { OsvVulnerability } from '../../osv/types.js';
import { installedPurls } from '../../revocation/installed.js';
import { readAllServers } from '../../stack/registry.js';
import type { ConfiguredServer } from '../../stack/types.js';
import { headerLine, rule, section, status, tally } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import type { CliIo } from '../flags.js';
import { writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export interface Finding {
  server: string;
  purl: string;
  configPath: string;
  advisories: { id: string; severity: string; summary: string; url: string }[];
}

export interface AdvisorySweep {
  /** Servers Agora could resolve to an npm purl and actually looked up. */
  scanned: number;
  /** Resolved but unreachable — never folded into `scanned`. */
  unreachable: { purl: string; reason: string }[];
  /** Remote or custom-launcher servers that no lookup can address. */
  unidentifiable: number;
  findings: Finding[];
  blocking: Finding[];
}

/** GitHub's label, or the malware marker. Kept separate from the feed's severity mapping. */
function labelFor(v: OsvVulnerability): string {
  if (v.id.startsWith('MAL-')) return 'MALWARE';
  return (v.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
}

const BLOCKING = new Set(['MALWARE', 'CRITICAL', 'HIGH']);

/**
 * Look up every addressable configured MCP server in OSV.
 *
 * Extracted so `agora ci` reports the same advisories, with the same
 * unreachable/unidentifiable distinctions, rather than growing a parallel
 * implementation that would eventually disagree with this one about what
 * "clean" means.
 */
export async function sweepAdvisories(
  io: CliIo,
  /** Server set to check. Defaults to what the host adapters report; `agora ci`
   *  passes a set that also includes the committed `agora.toml` manifest. */
  servers?: ConfiguredServer[]
): Promise<AdvisorySweep> {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };
  const subjects = servers ?? readAllServers(env).filter((s) => s.enabled);
  const { addressable, unaddressable } = installedPurls(subjects);

  const findings: Finding[] = [];
  const unreachable: { purl: string; reason: string }[] = [];

  for (const { server, purl } of addressable) {
    const res = await queryPurl(purl, { fetcher: io.fetcher });
    if (res.status === 'unreachable') {
      unreachable.push({ purl, reason: res.reason });
      continue;
    }
    if (!res.vulns.length) continue;
    findings.push({
      server: server.name,
      purl,
      configPath: server.configPath,
      advisories: res.vulns.map((v) => ({
        id: v.id,
        severity: labelFor(v),
        summary: v.summary ?? '',
        url: `https://osv.dev/vulnerability/${v.id}`
      }))
    });
  }

  return {
    scanned: addressable.length,
    unreachable,
    unidentifiable: unaddressable.length,
    findings,
    blocking: findings.filter((f) => f.advisories.some((a) => BLOCKING.has(a.severity)))
  };
}

export const commandAudit: CommandHandler = async (parsed, io, style) => {
  const sweep = await sweepAdvisories(io);
  const { findings, unreachable, blocking } = sweep;
  const addressable = { length: sweep.scanned };
  const unaddressable = { length: sweep.unidentifiable };

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      scanned: sweep.scanned,
      // Never folded into `scanned`: a server Agora could not identify has not
      // been checked, and reporting it as clean would be the same lie the rest
      // of the product is arranged against.
      unidentifiable: sweep.unidentifiable,
      unreachable,
      findings,
      blocking: blocking.length
    });
    return blocking.length ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  const theme = cliTheme(style, io);

  const out = (l = '') => writeLine(io.stdout, l);
  const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
  out('');
  out(
    headerLine(
      'audit',
      `${plural(addressable.length, 'server')} ${theme.glyph('arrow')} OSV.dev`,
      theme
    )
  );
  out('');
  if (!addressable.length) {
    out(`  ${status('unknown', 'no MCP servers found in any host config', theme)}`);
    out(`    ${theme.muted('agora doctor shows what Agora can detect')}`);
    out('');
    return ExitCode.OK;
  }

  if (findings.length) {
    out(
      section('Advisories', theme, String(findings.reduce((k, f) => k + f.advisories.length, 0)))
    );
    for (const f of findings) {
      const worst = f.advisories.some((a) => BLOCKING.has(a.severity));
      out(
        `  ${status(worst ? 'error' : 'warning', `${theme.bold(f.server)}  ${theme.muted(f.purl)}`, theme)}`
      );
      for (const a of f.advisories) {
        out(`    ${theme.bold(a.severity)} ${a.id}  ${a.summary}`);
        out(`    ${theme.muted(a.url)}`);
      }
      out(`    ${theme.muted(`configured in ${f.configPath}`)}`);
      out('');
    }
  }

  // Only claim a clean sweep when every server was actually reached. A single
  // failed lookup means the set was never established; "no published
  // advisories" next to "1 server could not be checked" states a conclusion
  // the run did not earn. test/audit.test.ts holds this.
  if (!findings.length && !unreachable.length) {
    out(`  ${status('success', 'No published advisories for any configured server.', theme)}`);
    // The standing rule, at the moment a clean result is most likely read as a guarantee.
    out(`    ${theme.muted('"No known advisories" is not "safe": only what has been reported.')}`);
  } else if (!findings.length && unreachable.length) {
    out(`  ${status('unknown', 'no advisories among the servers that could be checked', theme)}`);
  }
  if (unreachable.length) {
    out(
      `  ${status('unknown', `${plural(unreachable.length, 'server')} could not be checked: OSV unreachable`, theme)}`
    );
    out(`    ${theme.muted('Not checked is not the same as clean.')}`);
  }
  if (unaddressable.length)
    out(
      `  ${status('unknown', `${plural(unaddressable.length, 'server')} not identifiable as an npm package; not checked`, theme)}`
    );
  out('');
  out(rule(theme));
  out(
    tally(
      [
        [addressable.length - unreachable.length, 'checked'],
        [findings.length, 'with advisories'],
        [unreachable.length + unaddressable.length, 'not checked']
      ],
      theme
    )
  );
  if (findings.length)
    out(
      `  ${theme.muted('None of these is in a package.json, which is why npm audit reports nothing.')}`
    );
  out('');

  return blocking.length ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
