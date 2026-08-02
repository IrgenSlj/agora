import { describe, expect, test } from 'vitest';
import { type AuthorizationRequest, authorizeMutation } from '../../src/gate/authorization';

function request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    action: 'Acquire',
    actor: 'human-cli',
    effects: ['host-config'],
    requiredSignals: ['scan', 'revocation', 'policy'],
    signals: [
      { source: 'scan', verdict: 'allow', detail: 'no known red flags' },
      { source: 'revocation', verdict: 'allow', detail: 'no confirmed match' },
      { source: 'policy', verdict: 'allow', detail: 'permit' }
    ],
    ...overrides
  };
}

describe('central authorization decision contract', () => {
  test('allows a human mutation only when every required signal is conclusive', () => {
    expect(authorizeMutation(request())).toMatchObject({ verdict: 'allow', reasons: [] });
  });

  test('deny dominates warnings and allows', () => {
    const decision = authorizeMutation(
      request({
        signals: [
          { source: 'scan', verdict: 'warn', detail: 'undeclared capability' },
          { source: 'revocation', verdict: 'deny', detail: 'confirmed critical advisory' },
          { source: 'policy', verdict: 'allow', detail: 'permit' }
        ]
      })
    );
    expect(decision.verdict).toBe('deny');
    expect(decision.reasons).toContain('revocation: confirmed critical advisory');
  });

  test('missing or unknown required evidence is inconclusive, never allow', () => {
    const missing = authorizeMutation(
      request({ signals: [{ source: 'scan', verdict: 'allow', detail: 'pass' }] })
    );
    expect(missing.verdict).toBe('inconclusive');
    expect(missing.reasons).toContain('revocation: required decision was not produced');

    const unknown = authorizeMutation(
      request({
        signals: [
          { source: 'scan', verdict: 'allow', detail: 'pass' },
          { source: 'revocation', verdict: 'unknown', detail: 'feed unavailable' },
          { source: 'policy', verdict: 'allow', detail: 'permit' }
        ]
      })
    );
    expect(unknown.verdict).toBe('inconclusive');
    expect(unknown.reasons).toContain('revocation: feed unavailable');
  });

  test('warnings require review rather than becoming an implicit allow', () => {
    const decision = authorizeMutation(
      request({
        signals: [
          { source: 'scan', verdict: 'warn', detail: 'undeclared capability' },
          { source: 'revocation', verdict: 'allow', detail: 'no confirmed match' },
          { source: 'policy', verdict: 'allow', detail: 'permit' }
        ]
      })
    );
    expect(decision.verdict).toBe('review');
    expect(decision.reasons).toEqual(['scan: undeclared capability']);
  });

  test('agent callers cannot authorize host/project/manifest writes', () => {
    const decision = authorizeMutation(
      request({
        actor: 'agent',
        effects: ['host-config', 'portable-manifest']
      })
    );
    expect(decision.verdict).toBe('deny');
    expect(decision.reasons[0]).toContain('agent callers cannot authorize');
  });

  test('an agent may write an inert install intent when evidence is conclusive', () => {
    const decision = authorizeMutation(
      request({
        action: 'RequestInstall',
        actor: 'agent',
        effects: ['install-intent']
      })
    );
    expect(decision.verdict).toBe('allow');
  });
});
