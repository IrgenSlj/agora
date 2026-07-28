// Turning the four planes into something a person can read.
//
// The shell and the TUI are the highest-touch surfaces in the product, and
// until now neither imported anything from `evidence/`, `policy/`,
// `revocation/` or `observe/` — they showed catalog rows where they should
// show verdicts. This is the shared view model that fixes that, kept pure so
// the rules below are testable without a terminal.
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
//
// **Absence of evidence is never rendered as a positive finding.** Every plane
// here can be in a state that is neither good nor bad but *unknown*, and each
// of those states is a different sentence:
//
//   · no attestation published        ≠ signature failed  ≠ signed
//   · policy reached with rules off   ≠ permit
//   · no revocation feed cached       ≠ not revoked
//   · never observed running          ≠ behaved well
//
// Collapsing any of those into "ok" would make the product lie in exactly the
// place a user is most likely to trust it. Hence `tone: 'unknown'` is a
// first-class outcome and never falls back to 'ok'.

import type { Divergence } from '../model/observed.js';
import type { PolicyDecision } from '../policy/engine.js';
import type { RevocationStatus } from '../revocation/client.js';
import type { ScanResult } from '../scan.js';

export type TrustTone = 'ok' | 'warn' | 'bad' | 'unknown';

export type TrustPlane = 'scan' | 'provenance' | 'policy' | 'revocation' | 'observed';

export interface TrustRow {
  plane: TrustPlane;
  label: string;
  tone: TrustTone;
  detail: string;
}

/** The provenance subset this view needs; see `src/evidence/provenance.ts`. */
export interface ProvenanceSummary {
  verified: boolean;
  reason?: string;
  sourceRepo?: string;
}

export interface ObservationSummary {
  sessions: number;
  toolCalls: number;
  networkSampled: boolean;
  hostsContacted: readonly string[];
  divergences: readonly Divergence[];
}

/**
 * Every field is optional, and `undefined` means *not checked* — which is
 * reported as such rather than skipped. A row silently missing from the panel
 * would let a user believe the check passed.
 */
export interface TrustInputs {
  scan?: ScanResult;
  provenance?: ProvenanceSummary | null;
  policy?: PolicyDecision | null;
  revocation?: RevocationStatus | null;
  observation?: ObservationSummary | null;
}

function hoursAgo(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m old`;
  if (hours < 48) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

function scanRow(scan: ScanResult | undefined): TrustRow {
  if (!scan) {
    return { plane: 'scan', label: 'scan', tone: 'unknown', detail: 'not run' };
  }
  const { pass, warn, fail } = scan.summary;
  const detail = `${pass} pass · ${warn} warn · ${fail} fail`;
  if (fail > 0) return { plane: 'scan', label: 'scan', tone: 'bad', detail };
  if (warn > 0) return { plane: 'scan', label: 'scan', tone: 'warn', detail };
  // Even an all-pass scan is "no known red flags", never "safe".
  return { plane: 'scan', label: 'scan', tone: 'ok', detail: `${detail} — no known red flags` };
}

function provenanceRow(p: ProvenanceSummary | null | undefined): TrustRow {
  const label = 'provenance';
  if (p === undefined) {
    return { plane: 'provenance', label, tone: 'unknown', detail: 'not checked' };
  }
  if (p === null || p.reason === 'no-provenance') {
    // Most of npm publishes no attestation. Treating that as a failure would
    // flag nearly everything and drain the meaning from every real warning.
    return {
      plane: 'provenance',
      label,
      tone: 'unknown',
      detail: 'no attestation published — nothing to verify'
    };
  }
  if (p.reason === 'network-error' || p.reason === 'verification-skipped') {
    // "Could not check" is not "failed". Reporting a runtime or network
    // problem as tampering would condemn correctly-signed packages.
    return { plane: 'provenance', label, tone: 'unknown', detail: 'could not check' };
  }
  if (p.reason === 'publisher-mismatch') {
    return {
      plane: 'provenance',
      label,
      tone: 'bad',
      detail: `signed, but by ${p.sourceRepo ?? 'another repository'} — identity mismatch`
    };
  }
  if (!p.verified) {
    return { plane: 'provenance', label, tone: 'bad', detail: 'signature verification failed' };
  }
  return {
    plane: 'provenance',
    label,
    tone: 'ok',
    detail: p.sourceRepo ? `signed by ${p.sourceRepo}` : 'signed and verified'
  };
}

function policyRow(decision: PolicyDecision | null | undefined): TrustRow {
  const label = 'policy';
  if (decision === undefined) {
    return { plane: 'policy', label, tone: 'unknown', detail: 'not evaluated' };
  }
  if (decision === null) {
    return { plane: 'policy', label, tone: 'unknown', detail: 'no policy configured' };
  }
  if (decision.decision === 'deny') {
    const by = decision.determining.length > 0 ? ` (${decision.determining.join(', ')})` : '';
    return { plane: 'policy', label, tone: 'bad', detail: `forbid${by}` };
  }
  if (decision.skipped.length > 0 || decision.errors.length > 0) {
    // The Cedar trap: a rule reading a missing attribute is skipped and the
    // decision comes back permissive. An allow reached with rules switched off
    // is not an allow, and must never be rendered as one.
    const n = decision.skipped.length;
    return {
      plane: 'policy',
      label,
      tone: 'unknown',
      detail: `inconclusive — ${n} rule${n === 1 ? '' : 's'} could not be evaluated`
    };
  }
  return { plane: 'policy', label, tone: 'ok', detail: 'permit' };
}

function revocationRow(status: RevocationStatus | null | undefined): TrustRow {
  const label = 'revocation';
  if (status === undefined || status === null) {
    return { plane: 'revocation', label, tone: 'unknown', detail: 'not checked' };
  }
  if (status.unknown) {
    // No feed cached — and with no key pinned yet, this is the normal state.
    // "Not revoked" would be a claim nothing supports.
    return {
      plane: 'revocation',
      label,
      tone: 'unknown',
      detail: 'no feed cached — nothing has been checked against it'
    };
  }
  if (status.blocked) {
    const reason = status.matches[0]?.entry.reason;
    return {
      plane: 'revocation',
      label,
      tone: 'bad',
      detail: `REVOKED${reason ? ` — ${reason}` : ''}`
    };
  }
  const age = status.ageMs === undefined ? '' : ` (feed ${hoursAgo(status.ageMs)})`;
  if (status.matches.length > 0) {
    return {
      plane: 'revocation',
      label,
      tone: 'warn',
      detail: `${status.matches.length} advisory match${status.matches.length === 1 ? '' : 'es'}${age}`
    };
  }
  if (status.stale) {
    return {
      plane: 'revocation',
      label,
      tone: 'warn',
      detail: `no match, but feed is stale${age}`
    };
  }
  return { plane: 'revocation', label, tone: 'ok', detail: `no match${age}` };
}

function observedRow(o: ObservationSummary | null | undefined): TrustRow {
  const label = 'observed';
  if (o === undefined || o === null || o.sessions === 0) {
    // Never running a server is not evidence that it behaves. Say so plainly
    // and point at the thing that would produce evidence.
    return {
      plane: 'observed',
      label,
      tone: 'unknown',
      detail: 'never run through `agora run` — no behaviour recorded'
    };
  }

  const critical = o.divergences.filter((d) => d.severity === 'critical');
  const network = !o.networkSampled
    ? 'network not observed'
    : o.hostsContacted.length === 0
      ? 'no peers seen while sampling'
      : o.hostsContacted.join(', ');
  const base = `${o.sessions} session${o.sessions === 1 ? '' : 's'} · ${o.toolCalls} tool calls · ${network}`;

  if (critical.length > 0) {
    return { plane: 'observed', label, tone: 'bad', detail: `${critical[0]!.detail} · ${base}` };
  }
  if (o.divergences.length > 0) {
    return {
      plane: 'observed',
      label,
      tone: 'warn',
      detail: `${o.divergences[0]!.detail} · ${base}`
    };
  }
  // Observed-and-clean is still only "nothing seen", because sampling polls.
  return { plane: 'observed', label, tone: 'ok', detail: `nothing undeclared seen · ${base}` };
}

/** Builds the trust rows in the order a reader should scan them. */
export function buildTrustRows(inputs: TrustInputs): TrustRow[] {
  return [
    provenanceRow(inputs.provenance),
    scanRow(inputs.scan),
    policyRow(inputs.policy),
    revocationRow(inputs.revocation),
    observedRow(inputs.observation)
  ];
}

/**
 * The single-line summary.
 *
 * `bad` wins over everything, and `unknown` outranks `ok` — a verdict built on
 * checks that did not run is reported as incomplete, not as clean.
 */
export function summarizeTrust(rows: readonly TrustRow[]): {
  tone: TrustTone;
  headline: string;
} {
  if (rows.some((r) => r.tone === 'bad')) {
    const bad = rows.filter((r) => r.tone === 'bad');
    return {
      tone: 'bad',
      headline: `${bad.length} blocking finding(s): ${bad.map((r) => r.label).join(', ')}`
    };
  }
  const unknown = rows.filter((r) => r.tone === 'unknown');
  const warn = rows.filter((r) => r.tone === 'warn');
  if (unknown.length > 0) {
    return {
      tone: 'unknown',
      headline: `incomplete — ${unknown.map((r) => r.label).join(', ')} not established`
    };
  }
  if (warn.length > 0) {
    return {
      tone: 'warn',
      headline: `${warn.length} warning(s): ${warn.map((r) => r.label).join(', ')}`
    };
  }
  return { tone: 'ok', headline: 'no known red flags — not a guarantee of safety' };
}
