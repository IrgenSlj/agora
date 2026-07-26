import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  evaluatePolicy,
  loadPolicies,
  readBaselinePolicy,
  validatePolicyText
} from '../src/policy/engine';
import { artifactAttributes, buildEntities, divergenceFromScan } from '../src/policy/entities';
import type { ScanResult } from '../src/scan';

const PURL = 'pkg:npm/thing@1.0.0';

function scanWith(summary: { pass: number; warn: number; fail: number }): ScanResult {
  return { id: 'thing', itemKind: 'package', checks: [], summary };
}

describe('evidence → Cedar attributes', () => {
  test('a missing provenance verdict is not reported as verified', () => {
    const attrs = artifactAttributes({ purl: PURL });
    expect(attrs.provenance_verified).toBe(false);
    expect(attrs.attestation_tier).toBe('none');
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

  test('divergence takes the worst scan status', () => {
    expect(divergenceFromScan(scanWith({ pass: 3, warn: 0, fail: 0 }))).toBe('none');
    expect(divergenceFromScan(scanWith({ pass: 1, warn: 2, fail: 0 }))).toBe('warn');
    expect(divergenceFromScan(scanWith({ pass: 1, warn: 2, fail: 1 }))).toBe('critical');
  });

  test('permissions map onto the declared surface', () => {
    const attrs = artifactAttributes({
      purl: PURL,
      permissions: { fs: ['./**'], exec: ['node'], net: ['api.example.com'] }
    });
    expect(attrs.fs_read).toBe(true);
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

  test('forbids installing something with critical divergence', async () => {
    const decision = await evaluatePolicy({
      purl: PURL,
      action: 'Install',
      scan: scanWith({ pass: 0, warn: 0, fail: 2 })
    });
    expect(decision.decision).toBe('deny');
  });

  test('critical divergence still permits Sync, so an installed artifact stays visible', async () => {
    const decision = await evaluatePolicy({
      purl: PURL,
      action: 'Sync',
      scan: scanWith({ pass: 0, warn: 0, fail: 2 })
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
