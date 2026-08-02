import { describe, expect, test } from 'vitest';
import {
  authorizeAcquireEvidence,
  authorizeInstallRequestEvidence,
  identityAuthorizationSignal,
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

  test('binds a decision to the artifact it was made about', () => {
    const reviewed = 'pkg:npm/example@1.0.0';
    expect(identityAuthorizationSignal(reviewed, reviewed).verdict).toBe('allow');
    // A newer version is a different artifact, not a better one: no evidence
    // has been gathered about it and no human has looked at it.
    expect(identityAuthorizationSignal(reviewed, 'pkg:npm/example@1.0.1').verdict).toBe('deny');
    expect(identityAuthorizationSignal(reviewed, 'pkg:npm/other@1.0.0').verdict).toBe('deny');
    // An unverifiable identity claim is not a satisfied one.
    expect(identityAuthorizationSignal(reviewed, undefined).verdict).toBe('unknown');
  });

  test('an expected identity is required evidence, so an unmatchable one is inconclusive', () => {
    const clean = { actor: 'human-cli', scan: scan(), policy: policy(), revocation: revocation() };

    expect(
      authorizeAcquireEvidence({
        ...clean,
        actor: 'human-cli',
        expectedPurl: 'pkg:npm/example@1.0.0',
        resolvedPurl: 'pkg:npm/example@1.0.0'
      }).verdict
    ).toBe('allow');

    expect(
      authorizeAcquireEvidence({
        ...clean,
        actor: 'human-cli',
        expectedPurl: 'pkg:npm/example@1.0.0',
        resolvedPurl: 'pkg:npm/example@2.0.0'
      }).verdict
    ).toBe('deny');

    expect(
      authorizeAcquireEvidence({
        ...clean,
        actor: 'human-cli',
        expectedPurl: 'pkg:npm/example@1.0.0'
      }).verdict
    ).toBe('inconclusive');
  });

  test('an acquire without an expectation records no identity signal at all', () => {
    // Most acquires legitimately have nothing to compare against. Inventing an
    // `unknown` identity for them would make every ordinary install
    // inconclusive.
    const decision = authorizeAcquireEvidence({
      actor: 'human-cli',
      scan: scan(),
      policy: policy(),
      revocation: revocation()
    });
    expect(decision.verdict).toBe('allow');
    expect(decision.signals.map((signal) => signal.source)).not.toContain('identity');
  });
});
