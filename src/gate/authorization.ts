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
}

export interface AuthorizationDecision {
  verdict: AuthorizationVerdict;
  action: string;
  reasons: string[];
  signals: AuthorizationSignal[];
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

  if (request.actor === 'agent') {
    const forbidden = request.effects.filter((effect) => AGENT_FORBIDDEN_EFFECTS.has(effect));
    if (forbidden.length > 0) {
      reasons.push(
        `agent callers cannot authorize ${[...new Set(forbidden)].sort().join(', ')} mutations`
      );
    }
  }

  const denied = request.signals.filter((signal) => signal.verdict === 'deny');
  reasons.push(...denied.map((signal) => `${signal.source}: ${signal.detail}`));

  if (reasons.length > 0) {
    return { verdict: 'deny', action: request.action, reasons, signals: request.signals };
  }

  const bySource = new Map(request.signals.map((signal) => [signal.source, signal]));
  for (const source of request.requiredSignals) {
    const signal = bySource.get(source);
    if (!signal) reasons.push(`${source}: required decision was not produced`);
    else if (signal.verdict === 'unknown') reasons.push(`${source}: ${signal.detail}`);
  }
  if (reasons.length > 0) {
    return { verdict: 'inconclusive', action: request.action, reasons, signals: request.signals };
  }

  const warnings = request.signals.filter((signal) => signal.verdict === 'warn');
  if (warnings.length > 0) {
    return {
      verdict: 'review',
      action: request.action,
      reasons: warnings.map((signal) => `${signal.source}: ${signal.detail}`),
      signals: request.signals
    };
  }

  return { verdict: 'allow', action: request.action, reasons: [], signals: request.signals };
}
