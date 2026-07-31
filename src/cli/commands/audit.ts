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
import { ExitCode } from '../exit-codes.js';
import { writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

interface Finding {
  server: string;
  purl: string;
  configPath: string;
  advisories: { id: string; severity: string; summary: string; url: string }[];
}

/** GitHub's label, or the malware marker. Kept separate from the feed's severity mapping. */
function labelFor(v: OsvVulnerability): string {
  if (v.id.startsWith('MAL-')) return 'MALWARE';
  return (v.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
}

const BLOCKING = new Set(['MALWARE', 'CRITICAL', 'HIGH']);

export const commandAudit: CommandHandler = async (parsed, io, style) => {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };
  const servers = readAllServers(env).filter((s) => s.enabled);
  const { addressable, unaddressable } = installedPurls(servers);

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

  const blocking = findings.filter((f) => f.advisories.some((a) => BLOCKING.has(a.severity)));

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      scanned: addressable.length,
      // Never folded into `scanned`: a server Agora could not identify has not
      // been checked, and reporting it as clean would be the same lie the rest
      // of the product is arranged against.
      unidentifiable: unaddressable.length,
      unreachable,
      findings,
      blocking: blocking.length
    });
    return blocking.length ? ExitCode.POLICY_FORBID : ExitCode.OK;
  }

  const theme = cliTheme(style, io);

  if (!addressable.length) {
    writeLine(io.stdout, 'No MCP servers found in any host config.');
    writeLine(io.stdout, theme.muted('Run `agora doctor` to see what Agora can detect.'));
    return ExitCode.OK;
  }

  writeLine(
    io.stdout,
    `Checked ${theme.bold(String(addressable.length))} MCP server${addressable.length === 1 ? '' : 's'} against OSV.`
  );
  writeLine(io.stdout, '');

  for (const f of findings) {
    const worst = f.advisories.some((a) => BLOCKING.has(a.severity));
    const glyph = worst ? theme.error('✗') : theme.warning('⚠');
    writeLine(io.stdout, `  ${glyph} ${theme.bold(f.server)}  ${theme.muted(f.purl)}`);
    for (const a of f.advisories) {
      writeLine(io.stdout, `      ${a.severity.padEnd(8)} ${a.id}  ${a.summary}`);
      writeLine(io.stdout, theme.muted(`      ${a.url}`));
    }
    writeLine(io.stdout, theme.muted(`      configured in ${f.configPath}`));
    writeLine(io.stdout, '');
  }

  // Only claim a clean sweep when every server was actually reached. A single
  // failed lookup means the set was never established, and printing "no
  // published advisories" next to "1 server could not be checked" states a
  // conclusion the run did not earn — with the reassuring half first, which is
  // the half people read. Caught by test/audit.test.ts against this very file.
  if (!findings.length && !unreachable.length) {
    writeLine(
      io.stdout,
      `  ${theme.accent('✓')} No published advisories for any configured server.`
    );
    // The product's standing rule, at the one moment a user is most likely to
    // read a clean result as a guarantee.
    writeLine(
      io.stdout,
      theme.muted('    "No known advisories" is not "safe" — only what has been reported.')
    );
    writeLine(io.stdout, '');
  } else if (!findings.length && unreachable.length) {
    writeLine(
      io.stdout,
      `  ${theme.muted('?')} No advisories found among the servers that could be checked.`
    );
    writeLine(io.stdout, '');
  }

  if (unreachable.length) {
    writeLine(
      io.stdout,
      theme.warning(
        `  ? ${unreachable.length} server${unreachable.length === 1 ? '' : 's'} could not be checked — OSV unreachable`
      )
    );
    writeLine(io.stdout, theme.muted('    Not checked is not the same as clean.'));
    writeLine(io.stdout, '');
  }

  if (unaddressable.length) {
    writeLine(
      io.stdout,
      theme.muted(
        `  ${unaddressable.length} server${unaddressable.length === 1 ? '' : 's'} could not be identified as an npm package (remote, or a custom launcher) — not checked.`
      )
    );
    writeLine(io.stdout, '');
  }

  if (findings.length) {
    writeLine(
      io.stdout,
      theme.dim(
        'None of these appear in any package.json, which is why `npm audit` reports nothing.'
      )
    );
  }

  return blocking.length ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
