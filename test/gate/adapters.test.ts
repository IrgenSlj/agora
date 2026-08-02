import { describe, expect, test } from 'vitest';
import {
  authorizeAcquireEvidence,
  authorizeInstallRequestEvidence,
  policyAuthorizationSignal,
  revocationAuthorizationSignal,
  scanAuthorizationSignal
} from '../../src/gate/adapters';
import type { PolicyDecision } from '../../src/policy/engine';
import type { RevocationStatus } from '../../src/revocation/client';
import type { ScanResult } from '../../src/scan';

function scan(warn = 0, fail = 0): ScanResult {
  return {
    id: 'pkg',
    itemKind: 'package',
    checks: [],
    summary: { pass: warn || fail ? 0 : 1, warn, fail }
  };
}

function policy(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    decision: 'allow',
    determining: [],
    skipped: [],
    errors: [],
    ...overrides
  };
}

function revocation(overrides: Partial<RevocationStatus> = {}): RevocationStatus {
  return {
    matches: [],
    blocked: false,
    unknown: false,
    stale: false,
    ...overrides
  };
}

describe('authorization evidence adapters', () => {
  test('maps scan pass, warning, and failure without collapsing them', () => {
    expect(scanAuthorizationSignal(scan()).verdict).toBe('allow');
    expect(scanAuthorizationSignal(scan(1)).verdict).toBe('warn');
    expect(scanAuthorizationSignal(scan(0, 1)).verdict).toBe('deny');
  });

  test('maps unavailable and skipped Cedar evaluations to unknown', () => {
    expect(policyAuthorizationSignal(policy({ unavailable: 'WASM missing' })).verdict).toBe(
      'unknown'
    );
    expect(policyAuthorizationSignal(policy({ skipped: ['policy-1'] })).verdict).toBe('unknown');
    expect(
      policyAuthorizationSignal(policy({ decision: 'deny', unavailable: 'engine failed' })).verdict
    ).toBe('unknown');
    expect(policyAuthorizationSignal(policy({ decision: 'deny' })).verdict).toBe('deny');
  });

  test('keeps absent revocation evidence unknown and stale evidence visible', () => {
    expect(revocationAuthorizationSignal(undefined).verdict).toBe('unknown');
    expect(revocationAuthorizationSignal(revocation({ stale: true })).verdict).toBe('warn');
    expect(revocationAuthorizationSignal(revocation()).verdict).toBe('allow');
  });

  test('allows a clean human acquire and requires review for warnings', () => {
    expect(
      authorizeAcquireEvidence({
        actor: 'human-cli',
        scan: scan(),
        policy: policy(),
        revocation: revocation()
      }).verdict
    ).toBe('allow');

    expect(
      authorizeAcquireEvidence({
        actor: 'human-cli',
        scan: scan(1),
        policy: policy(),
        revocation: revocation()
      }).verdict
    ).toBe('review');
  });

  test('denies an agent write even when every trust signal allows it', () => {
    const decision = authorizeAcquireEvidence({
      actor: 'agent',
      scan: scan(),
      policy: policy(),
      revocation: revocation(),
      save: true
    });
    expect(decision.verdict).toBe('deny');
    expect(decision.reasons[0]).toContain('agent callers cannot authorize');
  });

  test('lets warnings enter the inert human-review queue without becoming an install allow', () => {
    const decision = authorizeInstallRequestEvidence({
      actor: 'agent',
      scan: scan(1),
      policy: policy(),
      revocation: revocation()
    });
    expect(decision.verdict).toBe('review');
    expect(decision.reasons).toContain('scan: 1 check(s) require review');
  });

  test('blocks an install request when required evidence is absent', () => {
    expect(
      authorizeInstallRequestEvidence({ actor: 'agent', revocation: revocation() }).verdict
    ).toBe('inconclusive');
  });
});
