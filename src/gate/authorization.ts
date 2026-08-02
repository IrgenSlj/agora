import type { MutationEffect } from './mutations.js';

export type AuthorizationActor = 'human-cli' | 'agent' | 'automation';
export type AuthorizationSignalVerdict = 'allow' | 'warn' | 'deny' | 'unknown';
export type AuthorizationVerdict = 'allow' | 'review' | 'deny' | 'inconclusive';

export interface AuthorizationSignal {
  source: string;
  verdict: AuthorizationSignalVerdict;
  detail: string;
}

export interface AuthorizationRequest {
  action: string;
  actor: AuthorizationActor;
  effects: MutationEffect[];
  /** Evidence/policy sources that must reach a conclusive result for this action. */
  requiredSignals: string[];
  signals: AuthorizationSignal[];
  /**
   * Required sources whose *unknown* result a human has explicitly accepted —
   * "proceed although this was never established."
   *
   * This is what replaces a bypass flag. A bypass answers "don't check"; an
   * acknowledgement answers "this could not be checked, I accept that" — it is
   * scoped to named sources, it is reported back in the decision so it can be
   * recorded, and it can never clear a `deny`. A revoked package or a policy
   * the user wrote is not a risk anyone gets to accept on the command line.
   *
   * Warnings are a different question and are not covered here; a `review`
   * verdict is answered by the caller, where the human can read them first.
   */
  acknowledged?: string[];
}

export interface AuthorizationDecision {
  verdict: AuthorizationVerdict;
  action: string;
  reasons: string[];
  signals: AuthorizationSignal[];
  /** Non-conclusive results a human accepted, for the audit record. */
  acknowledged: string[];
}

const AGENT_FORBIDDEN_EFFECTS = new Set<MutationEffect>([
  'host-config',
  'portable-manifest',
  'project-files'
]);

/**
 * Pure decision kernel for the future shared gate.
 *
 * It intentionally does not collect evidence or write anything. Callers will
 * adapt scan/provenance/revocation/Cedar results into signals, ask this kernel,
 * and only then perform their existing mutation. Deny dominates; missing or
 * unknown required evidence is inconclusive; warnings require explicit review.
 */
export function authorizeMutation(request: AuthorizationRequest): AuthorizationDecision {
  const reasons: string[] = [];
  const acknowledged = new Set(request.acknowledged ?? []);
  const accepted: string[] = [];

  if (request.actor === 'agent') {
    const forbidden = request.effects.filter((effect) => AGENT_FORBIDDEN_EFFECTS.has(effect));
    if (forbidden.length > 0) {
      reasons.push(
        `agent callers cannot authorize ${[...new Set(forbidden)].sort().join(', ')} mutations`
      );
    }
    // Accepting a risk is a human act. If a model could supply the
    // acknowledgement it would simply be the bypass flag again, wearing the
    // vocabulary of consent.
    if (acknowledged.size > 0) {
      reasons.push('agent callers cannot accept risk on a human’s behalf');
    }
  }

  const denied = request.signals.filter((signal) => signal.verdict === 'deny');
  reasons.push(...denied.map((signal) => `${signal.source}: ${signal.detail}`));

  if (reasons.length > 0) {
    return { verdict: 'deny', action: request.action, reasons, signals: request.signals, acknowledged: [] };
  }

  const bySource = new Map(request.signals.map((signal) => [signal.source, signal]));
  for (const source of request.requiredSignals) {
    const signal = bySource.get(source);
    const conclusive = signal && signal.verdict !== 'unknown';
    if (conclusive) continue;
    if (acknowledged.has(source)) {
      accepted.push(
        `${source}: ${signal ? signal.detail : 'required decision was not produced'} (accepted)`
      );
      continue;
    }
    reasons.push(signal ? `${source}: ${signal.detail}` : `${source}: required decision was not produced`);
  }
  if (reasons.length > 0) {
    return {
      verdict: 'inconclusive',
      action: request.action,
      reasons,
      signals: request.signals,
      acknowledged: accepted
    };
  }

  // Warnings are deliberately NOT acknowledgeable here. "I read the warnings"
  // and "install without knowing anything" are different statements, and the
  // callers already distinguish them: `review` is answered by --accept-warnings
  // at the call site, where the human can see what they are agreeing to.
  const warnings = request.signals.filter((signal) => signal.verdict === 'warn');
  if (warnings.length > 0) {
    return {
      verdict: 'review',
      action: request.action,
      reasons: warnings.map((signal) => `${signal.source}: ${signal.detail}`),
      signals: request.signals,
      acknowledged: accepted
    };
  }

  return {
    verdict: 'allow',
    action: request.action,
    reasons: [],
    signals: request.signals,
    acknowledged: accepted
  };
}
