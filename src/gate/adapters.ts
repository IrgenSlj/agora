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

function acquireEffects(save: boolean | undefined): MutationEffect[] {
  return save ? ['host-config', 'portable-manifest', 'local-state'] : ['host-config'];
}

export interface AcquireAuthorizationInput {
  actor: AuthorizationActor;
  scan: ScanResult;
  policy: PolicyDecision;
  revocation?: RevocationStatus;
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
  return authorizeMutation({
    action: 'Acquire',
    actor: input.actor,
    effects: acquireEffects(input.save),
    requiredSignals: ['scan', 'policy'],
    signals: [
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
