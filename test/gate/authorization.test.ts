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

describe('accepting a risk, which is what replaces a bypass flag', () => {
  const unknownScan = request({
    signals: [
      { source: 'scan', verdict: 'unknown', detail: 'the pre-install scan was skipped' },
      { source: 'revocation', verdict: 'allow', detail: 'no confirmed match' },
      { source: 'policy', verdict: 'allow', detail: 'permit' }
    ]
  });

  test('an unknown a human accepted stops being inconclusive and is reported back', () => {
    const decision = authorizeMutation({ ...unknownScan, acknowledged: ['scan'] });

    expect(decision.verdict).toBe('allow');
    // Reported back, because an acceptance nobody can find afterwards is just a
    // bypass with better manners.
    expect(decision.acknowledged).toHaveLength(1);
    expect(decision.acknowledged[0]).toContain('scan');
  });

  test('an acceptance is scoped to the source it names', () => {
    // Accepting an unrunnable scan says nothing about the policy engine having
    // failed to run, and must not quietly answer for it too.
    const decision = authorizeMutation({
      ...request({
        signals: [
          { source: 'scan', verdict: 'unknown', detail: 'skipped' },
          { source: 'revocation', verdict: 'allow', detail: 'no confirmed match' },
          { source: 'policy', verdict: 'unknown', detail: 'the engine could not run' }
        ]
      }),
      acknowledged: ['scan']
    });

    expect(decision.verdict).toBe('inconclusive');
    expect(decision.reasons.join(' ')).toContain('the engine could not run');
  });

  test('a deny is not acknowledgeable, however it is named', () => {
    // Otherwise the flag is a veto over the user's own policy and over a
    // published advisory, which is precisely the bypass being removed.
    const decision = authorizeMutation({
      ...request({
        signals: [
          { source: 'scan', verdict: 'unknown', detail: 'skipped' },
          { source: 'revocation', verdict: 'deny', detail: 'confirmed critical revocation' },
          { source: 'policy', verdict: 'deny', detail: 'denied by team.cedar' }
        ]
      }),
      acknowledged: ['scan', 'revocation', 'policy']
    });

    expect(decision.verdict).toBe('deny');
    expect(decision.acknowledged).toEqual([]);
  });

  test('an agent cannot accept risk on a human’s behalf', () => {
    // If a model could supply the acknowledgement, the acknowledgement would be
    // the bypass flag again, wearing the vocabulary of consent.
    const decision = authorizeMutation({
      ...unknownScan,
      action: 'RequestInstall',
      actor: 'agent',
      effects: ['install-intent'],
      acknowledged: ['scan']
    });

    expect(decision.verdict).toBe('deny');
    expect(decision.reasons.join(' ')).toContain('cannot accept risk');
  });

  test('warnings are never cleared by a risk acceptance', () => {
    // "I read the warnings" and "install knowing nothing" are different
    // statements; the caller answers the first where the human can read them.
    const decision = authorizeMutation({
      ...request({
        signals: [
          { source: 'scan', verdict: 'warn', detail: '3 check(s) require review' },
          { source: 'revocation', verdict: 'allow', detail: 'no confirmed match' },
          { source: 'policy', verdict: 'allow', detail: 'permit' }
        ]
      }),
      acknowledged: ['scan']
    });

    expect(decision.verdict).toBe('review');
  });
});
