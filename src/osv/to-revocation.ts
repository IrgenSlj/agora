// Turning OSV advisories into revocation entries.
//
// This is the load-bearing translation in the automated feed, and both of its
// failure directions are bad in different ways: too broad and Agora blocks
// installs of packages that are fine, too narrow and it waves through a version
// that is known-malicious. Where the two conflict, this file errs toward
// *reporting* rather than *blocking* — an advisory-severity entry is shown but
// does not stop an acquire, so an over-broad advisory costs a user a warning
// while an over-narrow critical costs them a compromise.

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
 * Version range, in the syntax `src/revocation/match.ts` evaluates.
 *
 * Returns `undefined` when the advisory covers every version, which the matcher
 * treats as "all versions" — correct, and different from an empty string.
 *
 * Only the first SEMVER-ish range is read. OSV can express several disjoint
 * ranges and the matcher ANDs its clauses, so emitting all of them would build
 * an expression that matches nothing. One range that is too broad is the safe
 * direction; an AND of disjoint ranges is silently empty.
 */
export function versionRangeFor(vuln: OsvVulnerability): string | undefined {
  const range = vuln.affected?.flatMap((a) => a.ranges ?? []).find((r) => r.type !== 'GIT');
  if (!range) return undefined;

  let introduced: string | undefined;
  let upper: string | undefined;
  let upperOp: '<' | '<=' | undefined;

  for (const event of range.events ?? []) {
    if (event.introduced && event.introduced !== '0') introduced = event.introduced;
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

  return clauses.length ? clauses.join(' ') : undefined;
}

function reasonFor(vuln: OsvVulnerability): string {
  if (vuln.id.startsWith('MAL-')) return 'malicious-package';
  const summary = vuln.summary?.trim();
  if (summary) return summary.length > 160 ? `${summary.slice(0, 157)}…` : summary;
  return 'security-advisory';
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
  const versions = versionRangeFor(vuln);
  return {
    id: vuln.id,
    purl_pattern: purl,
    ...(versions ? { versions } : {}),
    reason: reasonFor(vuln),
    severity: severityFor(vuln),
    refs: refsFor(vuln),
    added_at: vuln.published ?? vuln.modified ?? now.toISOString()
  };
}
