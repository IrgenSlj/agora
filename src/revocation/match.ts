// Does a revocation entry cover a given artifact?
//
// Deliberately conservative in one direction: when a version range cannot be
// understood, the entry is treated as matching. A revocation exists because
// something is known to be harmful, so the failure mode that leaves a user
// running a revoked package is worse than the one that makes them look at a
// warning for a version that turns out to be fine.

import semver from 'semver';
import { parsePurl } from '../model/purl.js';
import type { RevocationEntry } from '../model/revocation.js';

/**
 * Whether `version` falls inside `range`, a semver range such as `<=1.0.16`,
 * `>=1.2.0 <1.9.0`, or an explicit list `2.4.10 || 2.4.11`.
 *
 * An empty range means every version. A range or version that cannot be read
 * returns `true` — see the note at the top of the file.
 */
export function versionInRange(version: string, range: string | undefined): boolean {
  if (!range?.trim()) return true;
  const target = semver.valid(version, { loose: true }) ?? semver.coerce(version)?.version;
  if (!target || !semver.validRange(range, { loose: true })) return true;
  return semver.satisfies(target, range, { loose: true, includePrerelease: true });
}

/**
 * A purl_pattern matches a purl when their type/namespace/name agree. The
 * pattern is version-less by convention ("all versions of this package"), and
 * `entry.versions` narrows it. A pattern that *does* carry a version must match
 * that version exactly.
 */
export function purlPatternMatches(pattern: string, purl: string): boolean {
  let p: ReturnType<typeof parsePurl>;
  let target: ReturnType<typeof parsePurl>;
  try {
    p = parsePurl(pattern);
    target = parsePurl(purl);
  } catch {
    // Fall back to a literal comparison rather than silently not matching:
    // a malformed pattern should still catch its exact string.
    return pattern === purl;
  }

  if (p.type !== target.type) return false;
  if ((p.namespace ?? '') !== (target.namespace ?? '')) return false;
  if (p.name !== target.name) return false;
  if (p.version && p.version !== target.version) return false;
  return true;
}

export interface RevocationMatch {
  entry: RevocationEntry;
  purl: string;
  /**
   * True when the artifact's version was known and fell inside the entry's
   * range — or when the entry covers every version, so no version was needed.
   *
   * False means "this package has a revocation for *some* versions and we could
   * not tell which one you have." That is a real warning and a bad block: three
   * of the most-used MCP servers carry a fixed CVE, and blocking every install
   * of them because a catalog purl has no version pinned would make Agora wrong
   * far more often than right.
   */
  confirmed: boolean;
}

/** Every entry in the feed that covers `purl`. */
export function matchRevocations(
  entries: readonly RevocationEntry[],
  purl: string
): RevocationMatch[] {
  let version: string | undefined;
  try {
    version = parsePurl(purl).version;
  } catch {
    version = undefined;
  }

  return entries
    .filter((entry) => {
      if (!purlPatternMatches(entry.purl_pattern, purl)) return false;
      // No version on the artifact means we cannot rule the entry out. It is
      // still reported — as unconfirmed, see `confirmed` below.
      if (!version) return true;
      return versionInRange(version, entry.versions);
    })
    .map((entry) => ({
      entry,
      purl,
      // An entry with no range covers every version, so nothing is left to
      // confirm. With a range, we need the artifact's version to say anything.
      confirmed: !entry.versions?.trim() || Boolean(version)
    }));
}

/**
 * `critical` and `high` block; `advisory` warns. Mirrors brief §5.6, and maps
 * onto the §9 exit codes: a blocking match is a policy refusal (exit 1).
 */
export function isBlocking(entry: RevocationEntry): boolean {
  return entry.severity === 'critical' || entry.severity === 'high';
}

/**
 * Whether a *match* should stop an install, as opposed to warn about one.
 *
 * Severity alone is not enough. A high-severity entry scoped to `<=0.6.2` says
 * nothing about the version a user is about to install if that version is
 * unknown, and treating it as a block would refuse every install of three of
 * the most widely used MCP servers — all of which have shipped fixes. Malware
 * entries carry no version range, so they still block unconditionally.
 */
export function isBlockingMatch(match: RevocationMatch): boolean {
  return isBlocking(match.entry) && match.confirmed;
}
