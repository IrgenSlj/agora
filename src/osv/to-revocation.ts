// Turning OSV advisories into revocation entries.
//
// This is the load-bearing translation in the automated feed, and both of its
// failure directions are bad in different ways: too broad and Agora blocks
// installs of packages that are fine, too narrow and it waves through a version
// that is known-malicious. Where the two conflict, this file errs toward
// *reporting* rather than *blocking* — an advisory-severity entry is shown but
// does not stop an acquire, so an over-broad advisory costs a user a warning
// while an over-narrow critical costs them a compromise.

import semver from 'semver';
import { parsePurl } from '../model/purl.js';
import type { RevocationEntry, RevocationSeverity } from '../model/revocation.js';
import type { OsvVulnerability } from './types.js';

/**
 * Severity mapping.
 *
 * `MAL-*` ids come from the OpenSSF malicious-packages feed by way of
 * `ghsa-malware`: the package is not vulnerable, it is hostile. That is the one
 * case where blocking without argument is right, so it maps to `critical`.
 *
 * Everything else follows GitHub's own label. CRITICAL and HIGH block;
 * MODERATE, LOW and unlabelled are reported and do not. A CVSS vector is
 * present too, but parsing one to re-derive a severity GitHub already assigned
 * would add a parser and a disagreement for no gain.
 */
export function severityFor(vuln: OsvVulnerability): RevocationSeverity {
  if (vuln.id.startsWith('MAL-')) return 'critical';

  const label = vuln.database_specific?.severity?.toUpperCase();
  if (label === 'CRITICAL' || label === 'HIGH') return 'high';
  return 'advisory';
}

/**
 * Version range as a semver range, which `src/revocation/match.ts` evaluates.
 *
 * Returns `undefined` only when the advisory covers every version. Malware
 * advisories usually carry no range at all, just the exact versions that were
 * hostile; those become an explicit `a || b || c` list. Treating them as "all
 * versions" used to block every release of packages like the official Postman
 * server because three of its versions were compromised.
 *
 * Disjoint ranges are ORed, so a package fixed on two release lines is
 * described exactly rather than by its first range only.
 */
export function versionRangeFor(vuln: OsvVulnerability): string | undefined {
  const ranges = (vuln.affected ?? [])
    .flatMap((a) => a.ranges ?? [])
    .filter((r) => r.type !== 'GIT');
  const parts: string[] = [];
  let coversEverything = false;

  for (const range of ranges) {
    let introduced: string | undefined;
    let upper: string | undefined;
    let upperOp: '<' | '<=' | undefined;
    for (const event of range.events ?? []) {
      if (event.introduced !== undefined) {
        introduced = event.introduced === '0' ? undefined : event.introduced;
      }
      if (event.fixed) {
        upper = event.fixed;
        upperOp = '<';
      } else if (event.last_affected) {
        upper = event.last_affected;
        upperOp = '<=';
      }
    }
    const clauses: string[] = [];
    if (introduced) clauses.push(`>=${introduced}`);
    if (upper && upperOp) clauses.push(`${upperOp}${upper}`);
    if (clauses.length) parts.push(clauses.join(' '));
    else coversEverything = true;
  }

  // An explicit version list is more precise than an open-ended range event,
  // which is how OSV writes "introduced: 0" for a malware report.
  const listed = [
    ...new Set((vuln.affected ?? []).flatMap((a) => a.versions ?? []).filter(Boolean))
  ].sort(compareLoose);
  if (listed.length && (parts.length === 0 || coversEverything)) return listed.join(' || ');

  if (coversEverything || parts.length === 0) return undefined;
  return parts.join(' || ');
}

function compareLoose(a: string, b: string): number {
  const va = semver.valid(a, { loose: true });
  const vb = semver.valid(b, { loose: true });
  if (va && vb) return semver.compare(va, vb);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Classify an advisory into a machine-readable reason.
 *
 * `reason` used to carry the advisory's own summary sentence, truncated to 160
 * characters — which made it a headline, not a field. A consumer cannot branch
 * on "MCP Server Kubernetes has an Argument Injection in port_forward tool via
 * space-splitting", and the data model documents this field as a slug
 * (`credential-exfiltration`) precisely so that it can. The sentence is still
 * worth keeping, so it moved to `summary` where prose belongs.
 *
 * Classification is keyword matching over the summary, which is crude and is
 * chosen deliberately over something cleverer: every unmatched advisory lands
 * on `vulnerability`, which is the honest general case, and no consumer is
 * misled by a confident wrong label. CWE ids would be more precise where they
 * exist, and most GHSA entries for MCP servers carry none.
 */
function reasonFor(vuln: OsvVulnerability): string {
  // Not a heuristic. `MAL-*` comes from the OpenSSF malicious-packages feed:
  // the package is hostile, not flawed.
  if (vuln.id.startsWith('MAL-')) return 'malicious-package';

  const text = `${vuln.summary ?? ''} ${vuln.details ?? ''}`.toLowerCase();
  const match = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (match('exfiltrat', 'steal', 'leak credential', 'token exfiltration')) {
    return 'credential-exfiltration';
  }
  if (match('command injection', 'argument injection', 'os command', 'flag injection')) {
    return 'command-injection';
  }
  if (match('path traversal', 'path validation', 'directory traversal', '../')) {
    return 'path-traversal';
  }
  if (match('prompt injection')) return 'prompt-injection';
  if (match('tool poisoning', 'tool description')) return 'tool-poisoning';
  if (match('typosquat')) return 'typosquat';
  if (match('sql injection')) return 'sql-injection';
  if (match('ssrf', 'server-side request forgery', 'dns rebinding')) return 'ssrf';
  if (match('access control', 'authorization bypass', 'authentication bypass', 'privilege')) {
    return 'access-control';
  }
  return 'vulnerability';
}

function refsFor(vuln: OsvVulnerability): string[] {
  const urls = (vuln.references ?? [])
    .map((r) => r.url)
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  // An OSV permalink always resolves, so an advisory never ends up with an
  // empty `refs` — the field is what makes a revocation checkable by a human.
  return [...new Set([`https://osv.dev/vulnerability/${vuln.id}`, ...urls])].slice(0, 5);
}

/**
 * One advisory can name several packages, each with its own fixed version.
 * Only the package this entry is about may contribute its range: mixing in a
 * sibling's `<2.31.3` would mark versions of this package as affected that are
 * not. When no affected block names the package, the advisory is kept whole.
 */
export function narrowToPackage(vuln: OsvVulnerability, purl: string): OsvVulnerability {
  let name: string;
  try {
    const p = parsePurl(purl);
    name = p.namespace ? `${p.namespace}/${p.name}` : p.name;
  } catch {
    return vuln;
  }
  const own = (vuln.affected ?? []).filter((a) => a.package?.name === name);
  return own.length ? { ...vuln, affected: own } : vuln;
}

/**
 * One advisory → one revocation entry.
 *
 * `purl` is passed in rather than read from the advisory: OSV echoes the
 * package it matched, but Agora's catalog purl is the identifier its own
 * lockfile and matcher use, and an entry keyed by anything else would silently
 * never match.
 */
export function toRevocationEntry(
  vuln: OsvVulnerability,
  purl: string,
  now: Date = new Date()
): RevocationEntry {
  const versions = versionRangeFor(narrowToPackage(vuln, purl));
  const summary = vuln.summary?.trim();
  return {
    id: vuln.id,
    purl_pattern: purl,
    ...(versions ? { versions } : {}),
    reason: reasonFor(vuln),
    ...(summary ? { summary: summary.length > 200 ? `${summary.slice(0, 197)}…` : summary } : {}),
    severity: severityFor(vuln),
    refs: refsFor(vuln),
    added_at: vuln.published ?? vuln.modified ?? now.toISOString()
  };
}
