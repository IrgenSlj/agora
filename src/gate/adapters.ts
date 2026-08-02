import { isConclusive, type PolicyDecision } from '../policy/engine.js';
import type { RevocationStatus } from '../revocation/client.js';
import { isBlockingMatch } from '../revocation/match.js';
import type { ScanResult } from '../scan.js';
import {
  type AuthorizationActor,
  type AuthorizationDecision,
  type AuthorizationSignal,
  authorizeMutation
} from './authorization.js';
import type { MutationEffect } from './mutations.js';

/** Convert the existing heuristic scan into the shared authorization vocabulary. */
export function scanAuthorizationSignal(scan: ScanResult): AuthorizationSignal {
  if (scan.summary.fail > 0) {
    return {
      source: 'scan',
      verdict: 'deny',
      detail: `${scan.summary.fail} check(s) failed`
    };
  }
  if (scan.summary.warn > 0) {
    return {
      source: 'scan',
      verdict: 'warn',
      detail: `${scan.summary.warn} check(s) require review`
    };
  }
  return { source: 'scan', verdict: 'allow', detail: 'no known scan red flags' };
}

/** Convert Cedar's nuanced result without turning skipped rules into an allow. */
export function policyAuthorizationSignal(policy: PolicyDecision): AuthorizationSignal {
  if (policy.unavailable) {
    return { source: 'policy', verdict: 'unknown', detail: policy.unavailable };
  }
  if (policy.decision === 'deny') {
    return {
      source: 'policy',
      verdict: 'deny',
      detail: policy.determining.length
        ? `denied by ${policy.determining.join(', ')}`
        : 'denied by the active policy set'
    };
  }
  if (!isConclusive(policy)) {
    return {
      source: 'policy',
      verdict: 'unknown',
      detail: `${policy.skipped.length} rule(s) skipped and ${policy.errors.length} error(s) reported`
    };
  }
  return { source: 'policy', verdict: 'allow', detail: 'active policy set permitted the action' };
}

/**
 * Convert the offline revocation lookup while preserving unknown, stale, and
 * advisory states. Revocation is currently an optional acquire signal because
 * the public acquire service historically accepted no data directory; a known
 * blocking match still dominates every decision.
 */
export function revocationAuthorizationSignal(
  revocation: RevocationStatus | undefined
): AuthorizationSignal {
  if (!revocation || revocation.unknown) {
    return {
      source: 'revocation',
      verdict: 'unknown',
      detail: 'no revocation feed was available'
    };
  }

  const blocking = revocation.matches.filter(isBlockingMatch);
  if (blocking.length > 0) {
    return {
      source: 'revocation',
      verdict: 'deny',
      detail: `${blocking.length} confirmed high/critical revocation match(es)`
    };
  }

  if (revocation.matches.length > 0) {
    return {
      source: 'revocation',
      verdict: 'warn',
      detail: `${revocation.matches.length} advisory or unconfirmed match(es) require review`
    };
  }

  if (revocation.stale) {
    return {
      source: 'revocation',
      verdict: 'warn',
      detail: 'the fetched revocation feed is stale'
    };
  }

  return { source: 'revocation', verdict: 'allow', detail: 'no matching revocation entry' };
}

/**
 * Bind a decision to the artifact it was made about.
 *
 * An approval is granted for one thing. If resolution later produces a
 * different package or a different version, the recorded review no longer
 * describes what would be installed — so this is a mismatch, not a warning.
 * An artifact that cannot be addressed by purl at all is `unknown`: the
 * expectation cannot be checked, and an unverifiable identity claim is not a
 * satisfied one.
 */
export function identityAuthorizationSignal(
  expected: string,
  actual: string | undefined
): AuthorizationSignal {
  if (!actual) {
    return {
      source: 'identity',
      verdict: 'unknown',
      detail: `expected ${expected}, but the resolved artifact has no comparable package identity`
    };
  }
  if (actual !== expected) {
    return {
      source: 'identity',
      verdict: 'deny',
      detail: `expected ${expected}, but resolution produced ${actual}`
    };
  }
  return { source: 'identity', verdict: 'allow', detail: `resolved artifact is ${expected}` };
}

function acquireEffects(save: boolean | undefined): MutationEffect[] {
  return save ? ['host-config', 'portable-manifest', 'local-state'] : ['host-config'];
}

export interface AcquireAuthorizationInput {
  actor: AuthorizationActor;
  scan: ScanResult;
  policy: PolicyDecision;
  revocation?: RevocationStatus;
  /** Set when the caller acquires a specific artifact it has already reviewed. */
  expectedPurl?: string;
  resolvedPurl?: string;
  save?: boolean;
}

export interface InstallRequestAuthorizationInput {
  actor: AuthorizationActor;
  scan?: ScanResult;
  policy?: PolicyDecision;
  revocation?: RevocationStatus;
}

/** One auditable authorization decision for the complete acquire evidence set. */
export function authorizeAcquireEvidence(input: AcquireAuthorizationInput): AuthorizationDecision {
  const identity = input.expectedPurl
    ? [identityAuthorizationSignal(input.expectedPurl, input.resolvedPurl)]
    : [];
  return authorizeMutation({
    action: 'Acquire',
    actor: input.actor,
    effects: acquireEffects(input.save),
    requiredSignals: input.expectedPurl ? ['identity', 'scan', 'policy'] : ['scan', 'policy'],
    signals: [
      ...identity,
      scanAuthorizationSignal(input.scan),
      revocationAuthorizationSignal(input.revocation),
      policyAuthorizationSignal(input.policy)
    ]
  });
}

/**
 * Authorize creation of an inert install intent. A warning produces `review`:
 * that is allowed to enter the human review queue, but is never upgraded to an
 * install permit. Denies and missing required evidence prevent even a request.
 */
export function authorizeInstallRequestEvidence(
  input: InstallRequestAuthorizationInput
): AuthorizationDecision {
  const signals = [
    ...(input.scan ? [scanAuthorizationSignal(input.scan)] : []),
    revocationAuthorizationSignal(input.revocation),
    ...(input.policy ? [policyAuthorizationSignal(input.policy)] : [])
  ];
  return authorizeMutation({
    action: 'RequestInstall',
    actor: input.actor,
    effects: ['install-intent'],
    requiredSignals: ['scan', 'policy'],
    signals
  });
}

/**
 * Decide whether resolution produced the artifact the caller was promised.
 *
 * Separate from the evidence gate on purpose: this is not a question about the
 * caller's authority or the artifact's trustworthiness, so it is answered
 * before any scan runs and it applies to previews too. A dry run that reports
 * on a different package than the one requested is misinformation.
 */
export function authorizeAcquireIdentity(
  actor: AuthorizationActor,
  expectedPurl: string,
  resolvedPurl: string | undefined,
  save?: boolean
): AuthorizationDecision {
  return authorizeMutation({
    action: 'Acquire',
    actor,
    effects: acquireEffects(save),
    requiredSignals: ['identity'],
    signals: [identityAuthorizationSignal(expectedPurl, resolvedPurl)]
  });
}

/** Scan evidence that was never gathered, kept distinct from scan evidence that came back clean. */
export function skippedScanSignal(): AuthorizationSignal {
  return {
    source: 'scan',
    verdict: 'unknown',
    detail: 'the pre-install scan was skipped, so nothing is known about this artifact'
  };
}

export interface LegacyMutationAuthorizationInput {
  action: string;
  actor: AuthorizationActor;
  effects: MutationEffect[];
  /** Absent when the caller skipped it; the gate then has an unknown, not a pass. */
  scan?: ScanResult;
  /**
   * Whether a scan belongs in this decision at all. Acquiring or running an
   * artifact must be informed by one, so the default is true and a missing scan
   * is an unknown. Reconciling a manifest of servers the user already
   * configured is a different question: there is no new artifact to triage, and
   * pretending an absent scan is an accepted risk would put a false
   * acknowledgement in the audit log. Then the signal is simply not part of the
   * decision — recorded as absent, never as a pass.
   */
  scanRequired?: boolean;
  policy: PolicyDecision;
  revocation?: RevocationStatus;
  /** Sources a human explicitly accepted, typically `['scan']` via --accept-risk. */
  acknowledged?: string[];
}

/**
 * The decision for the command paths that used to reach a write with a bypass
 * flag, a partial check, or nothing at all.
 *
 * Revocation is *required* here, unlike primary acquire, because these paths
 * always have a data directory to look one up in — there is no honest reason
 * for them to proceed without checking whether the artifact is known bad.
 */
export function authorizeLegacyMutation(
  input: LegacyMutationAuthorizationInput
): AuthorizationDecision {
  const scanRequired = input.scanRequired !== false;
  const scanSignals = scanRequired
    ? [input.scan ? scanAuthorizationSignal(input.scan) : skippedScanSignal()]
    : input.scan
      ? [scanAuthorizationSignal(input.scan)]
      : [];
  return authorizeMutation({
    action: input.action,
    actor: input.actor,
    effects: input.effects,
    requiredSignals: scanRequired ? ['scan', 'revocation', 'policy'] : ['revocation', 'policy'],
    signals: [
      ...scanSignals,
      revocationAuthorizationSignal(input.revocation),
      policyAuthorizationSignal(input.policy)
    ],
    ...(input.acknowledged ? { acknowledged: input.acknowledged } : {})
  });
}

/** Fast-path decision when a blocking revocation is known before scan/Cedar. */
export function authorizeAcquireRevocationPreflight(
  actor: AuthorizationActor,
  revocation: RevocationStatus,
  save?: boolean
): AuthorizationDecision {
  return authorizeMutation({
    action: 'Acquire',
    actor,
    effects: acquireEffects(save),
    requiredSignals: ['revocation'],
    signals: [revocationAuthorizationSignal(revocation)]
  });
}
