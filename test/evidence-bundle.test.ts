import { describe, expect, test } from 'vitest';
import { type BundleEvidence, buildEvidenceBundle, decodeStatement } from '../src/evidence/bundle';
import { InTotoStatement } from '../src/model/attestation';

// The bundle is the only place Agora's evidence leaves the machine, so it is
// the easiest place for an unknown to quietly become a pass. Each test here
// pins one way that could happen.

const DIGEST = 'a'.repeat(64);

const fullEvidence: BundleEvidence = {
  provenance: { verified: true, sourceRepo: 'modelcontextprotocol/servers' },
  scan: { pass: 6, warn: 2, fail: 0, checks: [{ id: 'injection', status: 'pass' }] },
  observation: {
    sessions: 3,
    toolCalls: 41,
    networkSampled: true,
    hostsContacted: ['registry.npmjs.org'],
    divergences: []
  }
};

function build(subjectSha: string | undefined, evidence: BundleEvidence) {
  return buildEvidenceBundle({
    version: '0.7.0',
    subject: { name: 'pkg:npm/example', ...(subjectSha ? { sha256: subjectSha } : {}) },
    evidence,
    now: new Date('2026-07-31T00:00:00.000Z')
  });
}

describe('evidence bundle', () => {
  test('every plane is either attested or explained — never both, never neither', () => {
    // The bug this pins: each plane used to read `else if (pinned)`, so an
    // artifact with real provenance but no digest produced no statement AND no
    // gap. The evidence vanished, and the bundle just looked shorter. Found by
    // running the built binary against an unlocked catalog item.
    const planes = ['provenance', 'scan', 'observed', 'policy', 'revocation'] as const;

    for (const sha of [DIGEST, undefined]) {
      for (const evidence of [fullEvidence, {} as BundleEvidence]) {
        const bundle = build(sha, evidence);
        const attested = new Set(
          bundle.attestations
            .map((a) => decodeStatement(a).predicateType)
            .map((p) => p.split('/attestations/')[1]?.split('/')[0])
        );
        const explained = new Set(bundle.not_established.map((n) => n.plane));

        for (const plane of planes) {
          const key = {
            provenance: 'provenance-verification',
            scan: 'declared-manifest',
            observed: 'observed-profile',
            policy: null,
            revocation: null
          }[plane];
          const isAttested = key ? attested.has(key) : false;
          expect(
            isAttested !== explained.has(plane),
            `plane "${plane}" must be exactly one of attested or explained (sha=${!!sha})`
          ).toBe(true);
        }
      }
    }
  });

  test('no digest means no attestations at all — a hash is never invented', () => {
    const bundle = build(undefined, fullEvidence);
    expect(bundle.attestations).toEqual([]);
    expect(bundle.not_established.map((n) => n.plane)).toContain('subject');
  });

  test('held-but-unattestable is distinguished from absent', () => {
    // "we verified provenance but cannot bind it" and "there is no provenance"
    // are different facts. Collapsing them would understate the first and
    // overstate the second.
    const held = build(undefined, fullEvidence).not_established.find(
      (n) => n.plane === 'provenance'
    );
    const absent = build(undefined, { provenance: null }).not_established.find(
      (n) => n.plane === 'provenance'
    );
    expect(held?.reason).toContain('not attestable');
    expect(absent?.reason).toContain('no published attestation');
    expect(held?.reason).not.toBe(absent?.reason);
  });

  test('with a digest, statements are emitted and are valid in-toto', () => {
    const bundle = build(DIGEST, fullEvidence);
    expect(bundle.attestations).toHaveLength(3);

    for (const env of bundle.attestations) {
      const parsed = InTotoStatement.safeParse(decodeStatement(env));
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
      expect(decodeStatement(env).subject[0]?.digest.sha256).toBe(DIGEST);
    }
  });

  test('envelopes are unsigned and say so, rather than looking endorsed', () => {
    // Agora has no attestation-signing identity. tier 'none' with an empty
    // signature list is the honest encoding; anything else would let a reader
    // infer an endorsement that does not exist.
    for (const env of build(DIGEST, fullEvidence).attestations) {
      expect(env.tier).toBe('none');
      expect(env.signatures).toEqual([]);
    }
  });

  test('policy and revocation are never attested by export', () => {
    // They are gates `agora acquire` evaluates, not standing evidence. An
    // export claiming a policy verdict it never computed is the whole failure
    // mode in one line.
    const bundle = build(DIGEST, fullEvidence);
    const predicates = bundle.attestations.map((a) => decodeStatement(a).predicateType);
    expect(predicates.some((p) => p.includes('policy'))).toBe(false);
    expect(predicates.some((p) => p.includes('revocation'))).toBe(false);
    expect(bundle.not_established.map((n) => n.plane)).toEqual(
      expect.arrayContaining(['policy', 'revocation'])
    );
  });

  test('the same evidence produces the same bytes', () => {
    // Payloads are canonicalised before encoding so two exports of an
    // unchanged artifact diff cleanly.
    const a = build(DIGEST, fullEvidence).attestations.map((e) => e.payload);
    const b = build(DIGEST, fullEvidence).attestations.map((e) => e.payload);
    expect(a).toEqual(b);
  });
});
