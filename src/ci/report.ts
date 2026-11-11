// `agora ci`: the check a repository runs on every pull request.
//
// In 0.9 it asks one question, whether any MCP server this repository
// configures has a published advisory. Receipt verification replaces and
// extends it in a later release (docs/PLAN.md, phase 2).
//
// The standing rule: an absent answer is not a passing answer. A check that
// could not run is `not_established` or `unavailable`, never `pass`.

import { type AdvisorySweep, sweepAdvisories } from '../cli/commands/audit.js';
import type { CliIo } from '../cli/flags.js';
import { readAllServers } from '../stack/registry.js';

/**
 * Deliberately four states, not two.
 *
 * `not_established` is the one that matters: it is the difference between "I
 * checked and found nothing wrong" and "I could not check." Collapsing them
 * into `pass` is the single most tempting shortcut here and the one that would
 * make the whole command dishonest.
 */
export type CheckState = 'pass' | 'fail' | 'not_established' | 'unavailable';

export type CheckName = 'advisories';

export interface CiFinding {
  /** Short label — becomes an annotation title. */
  title: string;
  detail: string;
  /** Host config or lockfile the finding points at, when there is one. */
  where?: string;
  url?: string;
}

export interface CiCheck {
  name: CheckName;
  state: CheckState;
  /** One line a human reads first. */
  summary: string;
  findings: CiFinding[];
}

export interface CiReport {
  checks: CiCheck[];
  ok: boolean;
  failed: CheckName[];
  notEstablished: CheckName[];
  unavailable: CheckName[];
}

export interface CiOptions {
  /** Treat `not_established` as a failure. */
  failOnUnknown?: boolean;
}

function advisoriesCheck(sweep: AdvisorySweep): CiCheck {
  const findings: CiFinding[] = sweep.findings.flatMap((f) =>
    f.advisories.map((a) => ({
      title: `${a.severity} ${a.id} — ${f.server}`,
      detail: a.summary || `${a.id} affects ${f.purl}`,
      where: f.configPath,
      url: a.url
    }))
  );

  if (sweep.blocking.length) {
    return {
      name: 'advisories',
      state: 'fail',
      summary: `${sweep.blocking.length} server${sweep.blocking.length === 1 ? '' : 's'} with a MALWARE/CRITICAL/HIGH advisory`,
      findings
    };
  }

  // A failed lookup means the set was never established. Reporting "no
  // advisories" beside "1 server could not be checked" states a conclusion the
  // run did not earn, so the whole check degrades rather than the reassuring
  // half being printed first.
  if (sweep.unreachable.length) {
    return {
      name: 'advisories',
      state: 'unavailable',
      summary: `${sweep.unreachable.length} of ${sweep.scanned} server${sweep.scanned === 1 ? '' : 's'} could not be checked — OSV unreachable`,
      findings: [
        ...findings,
        ...sweep.unreachable.map((u) => ({
          title: `not checked — ${u.purl}`,
          detail: `OSV unreachable: ${u.reason}. Not checked is not the same as clean.`
        }))
      ]
    };
  }

  if (!sweep.scanned) {
    return {
      name: 'advisories',
      state: 'not_established',
      summary:
        sweep.unidentifiable > 0
          ? `no server could be identified as an npm package (${sweep.unidentifiable} remote or custom launcher)`
          : 'no MCP servers found in any host config',
      findings: []
    };
  }

  return {
    name: 'advisories',
    state: 'pass',
    summary: findings.length
      ? `${sweep.scanned} server${sweep.scanned === 1 ? '' : 's'} checked — advisories found, none blocking`
      : `${sweep.scanned} server${sweep.scanned === 1 ? '' : 's'} checked, no published advisories`,
    findings
  };
}

export async function runCiChecks(io: CliIo, opts: CiOptions = {}): Promise<CiReport> {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };
  const servers = readAllServers(env).filter((s) => s.enabled);
  const checks: CiCheck[] = [advisoriesCheck(await sweepAdvisories(io, servers))];

  const failed = checks.filter((c) => c.state === 'fail').map((c) => c.name);
  const notEstablished = checks.filter((c) => c.state === 'not_established').map((c) => c.name);
  const unavailable = checks.filter((c) => c.state === 'unavailable').map((c) => c.name);

  return {
    checks,
    failed,
    notEstablished,
    unavailable,
    ok: failed.length === 0 && (!opts.failOnUnknown || notEstablished.length === 0)
  };
}
