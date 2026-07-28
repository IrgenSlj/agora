import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  evaluatePolicy,
  isConclusive,
  lintPolicyText,
  loadPolicies,
  readBaselinePolicy,
  referencedAttributes,
  schemaAttributeNames,
  validatePolicyText
} from '../src/policy/engine';
import {
  artifactAttributes,
  buildEntities,
  divergenceFromObservation,
  divergenceFromScan
} from '../src/policy/entities';
import type { ScanResult } from '../src/scan';

const PURL = 'pkg:npm/thing@1.0.0';

function scanWith(summary: { pass: number; warn: number; fail: number }): ScanResult {
  return { id: 'thing', itemKind: 'package', checks: [], summary };
}

describe('evidence → Cedar attributes', () => {
  test('an unchecked fact is ABSENT, not false', () => {
    // The distinction the whole file exists for: `false` asserts something,
    // absence admits ignorance. 60 of the 67 bundled packages declare no
    // permissions at all — emitting `exec: false` for them would claim they
    // execute nothing, and a policy forbidding exec would pass them all.
    const attrs = artifactAttributes({ purl: PURL });
    expect(attrs.provenance_verified).toBeUndefined();
    expect(attrs.attestation_tier).toBeUndefined();
    expect(attrs.revoked).toBeUndefined();
    expect(attrs.canary_triggered).toBeUndefined();
    expect(attrs.divergence_max).toBeUndefined();
    expect(attrs.exec).toBeUndefined();
    // ...but whether a manifest exists at all is always knowable.
    expect(attrs.permissions_declared).toBe(false);
  });

  test('a consulted-and-clean revocation is recorded, and differs from unchecked', () => {
    expect(artifactAttributes({ purl: PURL, revoked: false }).revoked).toBe(false);
    expect(artifactAttributes({ purl: PURL }).revoked).toBeUndefined();
  });

  test('no fs_read/fs_write split is invented — the data carries none', () => {
    const attrs = artifactAttributes({ purl: PURL, permissions: { fs: ['./**'] } });
    expect(attrs.fs).toBe(true);
    expect('fs_read' in attrs).toBe(false);
    expect('fs_write' in attrs).toBe(false);
  });

  test('only a verified signature earns the sigstore tier', () => {
    expect(
      artifactAttributes({ purl: PURL, provenance: { verified: true } }).attestation_tier
    ).toBe('sigstore');
    // "checked and failed" must not be dressed up as a lesser tier.
    expect(
      artifactAttributes({
        purl: PURL,
        provenance: { verified: false, reason: 'verification-failed' }
      }).attestation_tier
    ).toBe('none');
  });

  test('divergence takes the worst scan status, and is absent with no scan', () => {
    expect(divergenceFromScan(undefined)).toBeUndefined();
    expect(divergenceFromScan(scanWith({ pass: 3, warn: 0, fail: 0 }))).toBe('none');
    expect(divergenceFromScan(scanWith({ pass: 1, warn: 2, fail: 0 }))).toBe('warn');
    expect(divergenceFromScan(scanWith({ pass: 1, warn: 2, fail: 1 }))).toBe('critical');
  });

  test('divergenceFromObservation distinguishes unobserved from observed-clean', () => {
    expect(divergenceFromObservation(undefined)).toBeUndefined();
    expect(divergenceFromObservation([])).toBe('none');
    expect(
      divergenceFromObservation([{ kind: 'undeclared-egress', detail: 'x', severity: 'warn' }])
    ).toBe('warn');
    expect(
      divergenceFromObservation([
        { kind: 'undeclared-egress', detail: 'x', severity: 'warn' },
        { kind: 'undeclared-egress', detail: 'y', severity: 'critical' }
      ])
    ).toBe('critical');
  });

  test('permissions map onto the declared surface', () => {
    const attrs = artifactAttributes({
      purl: PURL,
      permissions: { fs: ['./**'], exec: ['node'], net: ['api.example.com'] }
    });
    expect(attrs.permissions_declared).toBe(true);
    expect(attrs.fs).toBe(true);
    expect(attrs.exec).toBe(true);
    expect(attrs.net_hosts).toEqual(['api.example.com']);
  });

  test('builds a Project principal and an Artifact resource', () => {
    const entities = buildEntities({ purl: PURL });
    expect(entities.map((e) => e.uid.type).sort()).toEqual(['Artifact', 'Project']);
    expect(entities.find((e) => e.uid.type === 'Artifact')?.uid.id).toBe(PURL);
  });
});

describe('the shipped baseline policy', () => {
  test('parses', async () => {
    const result = await validatePolicyText(readBaselinePolicy().text);
    expect(result.ok).toBe(true);
  });

  test('permits a clean artifact — a default nobody can work under is a default nobody runs', async () => {
    const decision = await evaluatePolicy({ purl: PURL });
    expect(decision.unavailable).toBeUndefined();
    expect(decision.decision).toBe('allow');
  });

  test('forbids a revoked artifact', async () => {
    const decision = await evaluatePolicy({ purl: PURL, revoked: true });
    expect(decision.decision).toBe('deny');
    expect(decision.determining.length).toBeGreaterThan(0);
  });

  test('forbids an artifact that tripped a canary', async () => {
    expect((await evaluatePolicy({ purl: PURL, canaryTriggered: true })).decision).toBe('deny');
  });

  test('forbids installing something OBSERVED diverging from its declaration', async () => {
    const decision = await evaluatePolicy({
      purl: PURL,
      action: 'Install',
      observedDivergences: [
        {
          kind: 'undeclared-egress',
          detail: 'contacted 10.0.0.1:443 while declaring no network access',
          severity: 'critical'
        }
      ]
    });
    expect(decision.decision).toBe('deny');
  });

  test("a failing SCAN alone does not deny — that is the scan gate's job", async () => {
    // divergence_max used to be derived from the scan, which meant the policy
    // plane was grading the heuristic it was built to replace — and because
    // policy runs before the scan-fail gate, a failing scan surfaced to the
    // user as a *policy denial*. acquire still refuses on scan failure; it
    // just says so honestly now.
    const decision = await evaluatePolicy({
      purl: PURL,
      action: 'Install',
      scan: scanWith({ pass: 0, warn: 0, fail: 2 })
    });
    expect(decision.decision).toBe('allow');
  });

  test('an unobserved server is not treated as a clean one', async () => {
    const attrs = artifactAttributes({ purl: PURL, scan: scanWith({ pass: 3, warn: 0, fail: 0 }) });
    // Absent, not "none" — nobody watched it.
    expect(attrs.divergence_max).toBeUndefined();
    expect(attrs.scan_max).toBe('none');
  });

  test('observed-and-clean is a real finding, distinct from unobserved', async () => {
    const attrs = artifactAttributes({ purl: PURL, observedDivergences: [] });
    expect(attrs.divergence_max).toBe('none');
  });

  test('critical divergence still permits Sync, so an installed artifact stays visible', async () => {
    const decision = await evaluatePolicy({
      purl: PURL,
      action: 'Sync',
      observedDivergences: [
        { kind: 'undeclared-egress', detail: 'contacted 10.0.0.1:443', severity: 'critical' }
      ]
    });
    expect(decision.decision).toBe('allow');
  });

  test('warnings alone do not deny — that is what the heuristic gate is for', async () => {
    const decision = await evaluatePolicy({
      purl: PURL,
      scan: scanWith({ pass: 1, warn: 3, fail: 0 })
    });
    expect(decision.decision).toBe('allow');
  });

  test('an unsigned artifact is permitted by the baseline', async () => {
    // Forbidding unsigned by default would block essentially the whole MCP
    // ecosystem; tightening that is a project's decision, not Agora's.
    const decision = await evaluatePolicy({
      purl: PURL,
      provenance: { verified: false, reason: 'no-provenance' }
    });
    expect(decision.decision).toBe('allow');
  });
});

describe('project policy files', () => {
  test('a project file can only make the baseline stricter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-policy-'));
    const file = join(dir, 'team.cedar');
    writeFileSync(
      file,
      'forbid (principal, action, resource)\nwhen { resource.provenance_verified == false };\n',
      'utf8'
    );

    const denied = await evaluatePolicy({
      purl: PURL,
      policyFiles: [file],
      provenance: { verified: false, reason: 'no-provenance' }
    });
    expect(denied.decision).toBe('deny');

    const allowed = await evaluatePolicy({
      purl: PURL,
      policyFiles: [file],
      provenance: { verified: true }
    });
    expect(allowed.decision).toBe('allow');

    rmSync(dir, { recursive: true, force: true });
  });

  test('a project file cannot re-permit what the baseline forbids', async () => {
    // Cedar is order-independent and forbid always beats permit — this is the
    // property that makes shipping a baseline meaningful.
    const dir = mkdtempSync(join(tmpdir(), 'agora-policy-override-'));
    const file = join(dir, 'permissive.cedar');
    writeFileSync(file, 'permit (principal, action, resource);\n', 'utf8');

    const decision = await evaluatePolicy({ purl: PURL, policyFiles: [file], revoked: true });
    expect(decision.decision).toBe('deny');

    rmSync(dir, { recursive: true, force: true });
  });

  test('a missing policy file is skipped rather than throwing', () => {
    const sources = loadPolicies(['/nonexistent/team.cedar']);
    expect(sources).toHaveLength(1);
  });

  test('an invalid policy is reported, not silently ignored', async () => {
    const result = await validatePolicyText('this is not cedar');
    expect(result.ok).toBe(false);
  });
});

describe('a forbid that reads missing evidence must never fail open silently', () => {
  test('an unguarded forbid is SKIPPED by Cedar and reported, not hidden', async () => {
    // This is the failure mode the whole design turns on. Cedar treats a policy
    // reading an absent attribute as an error, skips it, and returns the
    // remaining decision — so this `forbid` produces `allow`. The decision is
    // only safe to act on because `skipped` says a rule was switched off.
    const dir = mkdtempSync(join(tmpdir(), 'agora-policy-failopen-'));
    const file = join(dir, 'unguarded.cedar');
    writeFileSync(file, 'forbid (principal, action, resource) when { resource.exec };\n', 'utf8');

    const decision = await evaluatePolicy({ purl: PURL, policyFiles: [file] });

    expect(decision.decision).toBe('allow');
    expect(decision.skipped.length).toBeGreaterThan(0);
    expect(isConclusive(decision)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test('the same rule, guarded, is conclusive and applies correctly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-policy-guarded-'));
    const file = join(dir, 'guarded.cedar');
    writeFileSync(
      file,
      'forbid (principal, action, resource) when { resource has exec && resource.exec };\n',
      'utf8'
    );

    const unknown = await evaluatePolicy({ purl: PURL, policyFiles: [file] });
    expect(unknown.decision).toBe('allow');
    expect(isConclusive(unknown)).toBe(true);

    const declared = await evaluatePolicy({
      purl: PURL,
      policyFiles: [file],
      permissions: { exec: ['node'] }
    });
    expect(declared.decision).toBe('deny');

    rmSync(dir, { recursive: true, force: true });
  });

  test('the shipped baseline is conclusive even with no evidence at all', async () => {
    // Every baseline rule guards with `has`, so a bare artifact produces a
    // clean allow rather than an allow-with-rules-disabled.
    const decision = await evaluatePolicy({ purl: PURL });
    expect(decision.decision).toBe('allow');
    expect(isConclusive(decision)).toBe(true);
  });

  test('a policy requiring declared permissions is expressible and honest', async () => {
    // The rule that only becomes possible once absence is first-class.
    const dir = mkdtempSync(join(tmpdir(), 'agora-policy-require-'));
    const file = join(dir, 'require-manifest.cedar');
    writeFileSync(
      file,
      'forbid (principal, action, resource) when { resource.permissions_declared == false };\n',
      'utf8'
    );

    const undeclared = await evaluatePolicy({ purl: PURL, policyFiles: [file] });
    expect(undeclared.decision).toBe('deny');
    expect(isConclusive(undeclared)).toBe(true);

    const declared = await evaluatePolicy({
      purl: PURL,
      policyFiles: [file],
      permissions: { fs: ['./**'] }
    });
    expect(declared.decision).toBe('allow');

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('policy linting catches rules that can never fire', () => {
  test('the shipped baseline lints clean against its own schema', async () => {
    expect((await lintPolicyText(readBaselinePolicy().text)).ok).toBe(true);
  });

  test('an unguarded read of an optional attribute is rejected', async () => {
    const lint = await lintPolicyText(
      'forbid (principal, action, resource) when { resource.exec };'
    );
    expect(lint.ok).toBe(false);
    expect(lint.schemaViolations.join(' ')).toMatch(/optional attribute/i);
  });

  test('a misspelt attribute is rejected even when correctly `has`-guarded', async () => {
    // Cedar itself accepts this: `has` on an undeclared attribute is legal and
    // simply evaluates false — so the rule parses, validates, and can never
    // fire. That is the exact silent failure this plane exists to prevent.
    const lint = await lintPolicyText(
      'forbid (principal, action, resource) when { resource has revoke && resource.revoke };'
    );
    expect(lint.ok).toBe(false);
    expect(lint.schemaViolations.join(' ')).toContain('revoke');
  });

  test('a correctly guarded rule on a real attribute passes', async () => {
    const lint = await lintPolicyText(
      'forbid (principal, action, resource) when { resource has exec && resource.exec };'
    );
    expect(lint.ok).toBe(true);
  });

  test('the schema attribute list is parsed, not hardcoded', () => {
    const names = schemaAttributeNames();
    expect(names.has('revoked')).toBe(true);
    expect(names.has('permissions_declared')).toBe(true);
    expect(names.has('fs_write')).toBe(false);
  });

  test('referencedAttributes finds both access forms', () => {
    expect(referencedAttributes('resource has exec && resource.divergence_max').sort()).toEqual([
      'divergence_max',
      'exec'
    ]);
  });
});
