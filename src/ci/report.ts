// The post-install question, asked where it can actually be answered on a
// schedule: continuous integration.
//
// Everything else in Agora runs when a person decides to run it. That is the
// wrong shape for the problem this product exists for. A server that was fine
// when you installed it does not announce the day it stops being fine — the
// advisory lands, the maintainer changes, the tool descriptions are rewritten,
// and nothing on the machine says a word. Somebody has to keep asking, and
// people do not keep asking. CI does.
//
// So this composes the three questions that together mean "nothing I trusted
// has changed" into one answer with one exit code:
//
//   advisories  — is anything I run now known-vulnerable?  (OSV, live)
//   drift       — do the artifacts still hash to what I approved?  (agora.lock)
//   health      — does the stack still resolve?  (host configs; reported, never fatal)
//
// The rule that governs all three is the product's standing rule: an absent
// answer is not a passing answer. A repository with no lockfile has not proved
// the absence of drift, and this reports that as `not_established` rather than
// letting a green check imply a guarantee nobody earned. `--fail-on-unknown`
// exists for people who want the absence itself to break the build.

import { type AdvisorySweep, sweepAdvisories } from '../cli/commands/audit.js';
import type { CliIo } from '../cli/flags.js';
import { checkStack } from '../stack/doctor.js';
import { type ManifestEntry, manifestPath, readManifest } from '../stack/manifest.js';
import { readAllServers } from '../stack/registry.js';
import type { ConfiguredServer } from '../stack/types.js';

/**
 * Deliberately four states, not two.
 *
 * `not_established` is the one that matters: it is the difference between "I
 * checked and found nothing wrong" and "I could not check." Collapsing them
 * into `pass` is the single most tempting shortcut here and the one that would
 * make the whole command dishonest.
 */
export type CheckState = 'pass' | 'fail' | 'not_established' | 'unavailable';

export type CheckName = 'advisories' | 'drift' | 'health';

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
  /** Treat `not_established` as a failure. Off by default: most repositories
   *  have no lockfile yet, and breaking their build on day one to punish them
   *  for not having adopted a feature is how a security tool gets uninstalled. */
  failOnUnknown?: boolean;
  /** Verify lockfile drift. Requires an `agora.lock` in the working directory. */
  lockVerify?: (io: CliIo) => Promise<{ ok: boolean; drifts: CiFinding[] } | null>;
}

/**
 * The servers this run is about.
 *
 * Host configs are the obvious source and the wrong one to rely on alone. A CI
 * runner is not somebody's laptop: it has the repository, and what a repository
 * commits is `agora.toml` — the portable manifest this product spends a whole
 * plane telling people to commit. Reading only host adapters meant the users who
 * had adopted Agora *correctly* were the ones who got an empty report, which is
 * close to the worst possible failure for an adoption surface.
 *
 * So both are read and merged by name. A manifest entry wins over a host entry
 * of the same name, because the manifest is the declared intent and the host
 * config is a local materialisation of it.
 */
function serversForRun(io: CliIo): { servers: ConfiguredServer[]; fromManifest: number } {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };
  const hostServers = readAllServers(env).filter((s) => s.enabled);

  const path = manifestPath(env);
  const manifest = readManifest(path);
  if (!manifest) return { servers: hostServers, fromManifest: 0 };

  const byName = new Map(hostServers.map((s) => [s.name, s]));
  let fromManifest = 0;

  for (const [name, entry] of Object.entries(manifest.mcp ?? {})) {
    const e = entry as ManifestEntry;
    if (e.enabled === false) {
      byName.delete(name);
      continue;
    }
    fromManifest++;
    byName.set(name, {
      name,
      // Not a host: this entry came from the portable manifest, and naming one
      // of the four adapters would be a small lie in every annotation that says
      // where a finding lives.
      tool: 'agora',
      scope: 'project',
      configPath: path,
      transport: e.url ? 'remote' : 'local',
      ...(e.command ? { command: e.command } : {}),
      ...(e.url ? { url: e.url } : {}),
      ...(e.env ? { env: e.env } : {}),
      enabled: true,
      raw: e
    });
  }

  return { servers: [...byName.values()], fromManifest };
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

async function driftCheck(io: CliIo, opts: CiOptions): Promise<CiCheck> {
  const verify = opts.lockVerify;
  if (!verify) {
    return {
      name: 'drift',
      state: 'not_established',
      summary: 'no lockfile verifier available',
      findings: []
    };
  }

  const result = await verify(io);
  if (result === null) {
    return {
      name: 'drift',
      state: 'not_established',
      summary: 'no agora.lock — nothing is pinned, so nothing can be proved unchanged',
      findings: [
        {
          title: 'no agora.lock',
          detail:
            'Drift detection compares what is installed against what was approved. Without a ' +
            'lockfile there is no record of what was approved, so this is unknown rather than clean.'
        }
      ]
    };
  }

  if (!result.ok) {
    return {
      name: 'drift',
      state: 'fail',
      summary: `${result.drifts.length} artifact${result.drifts.length === 1 ? ' no longer matches' : 's no longer match'} the lockfile`,
      findings: result.drifts
    };
  }

  return {
    name: 'drift',
    state: 'pass',
    summary: 'every locked artifact still hashes to what was approved',
    findings: []
  };
}

/**
 * Health is reported here and never fails the build. That is a deliberate
 * asymmetry with `doctor --strict`, and the reason is what a CI runner is.
 *
 * A runner has your repository, not your machine. MCP servers live in host
 * configs as `npx`-resolved commands, so on a fresh runner almost none of them
 * resolve — not because anything is wrong, but because they were never
 * installed there. A gate that goes red on every first run for an environmental
 * reason is a gate people delete in week two, and it would be lying anyway:
 * this command promises that nothing you trusted has *changed*, and a server
 * that was never installed on this machine has not changed.
 *
 * So an unresolvable server is `not_established` — Agora could not ask the
 * question here — which is the same answer it gives for a missing lockfile, and
 * for the same reason. Somebody who does install their servers in CI and wants
 * this strict already has `--fail-on-unknown`, and `agora doctor --strict`
 * remains the command that exists to fail on a broken stack.
 */
async function healthCheck(io: CliIo, servers: ConfiguredServer[]): Promise<CiCheck> {
  const env = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  if (!servers.length) {
    return {
      name: 'health',
      state: 'not_established',
      summary: 'no enabled MCP servers configured',
      findings: []
    };
  }

  // Never `--probe` here. Probing starts every configured server, and starting
  // untrusted processes is precisely what a CI runner should not be talked into
  // doing on a pull request from a stranger.
  const health = await checkStack(servers, env);
  const broken = health.servers.filter((s) => s.status === 'error');

  if (broken.length) {
    return {
      name: 'health',
      state: 'not_established',
      summary: `${broken.length} of ${health.servers.length} configured server${health.servers.length === 1 ? '' : 's'} could not be resolved in this environment — usually means they are not installed on this runner`,
      findings: broken.map((s) => ({
        title: `${s.name} could not be checked`,
        detail: s.checks
          .filter((c) => !c.ok)
          .map((c) => c.detail ?? c.name)
          .join('; '),
        where: s.instances[0]?.configPath
      }))
    };
  }

  return {
    name: 'health',
    state: 'pass',
    summary: `${health.servers.length} configured server${health.servers.length === 1 ? ' resolves' : 's resolve'} cleanly`,
    findings: []
  };
}

export async function runCiChecks(io: CliIo, opts: CiOptions = {}): Promise<CiReport> {
  const { servers } = serversForRun(io);
  const sweep = await sweepAdvisories(io, servers);

  const checks: CiCheck[] = [
    advisoriesCheck(sweep),
    await driftCheck(io, opts),
    await healthCheck(io, servers)
  ];

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
