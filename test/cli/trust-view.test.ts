import { describe, expect, test } from 'vitest';
import { buildTrustRows, summarizeTrust, type TrustRow } from '../../src/cli/trust-view';
import type { PolicyDecision } from '../../src/policy/engine';
import type { RevocationStatus } from '../../src/revocation/client';
import type { ScanResult } from '../../src/scan';

function row(rows: TrustRow[], plane: string): TrustRow {
  return rows.find((r) => r.plane === plane)!;
}

const cleanScan: ScanResult = {
  id: 'x',
  itemKind: 'package',
  checks: [],
  summary: { pass: 5, warn: 0, fail: 0 }
};

const permit: PolicyDecision = {
  decision: 'allow',
  determining: ['baseline'],
  skipped: [],
  errors: []
} as PolicyDecision;

const cleanFeed: RevocationStatus = {
  matches: [],
  blocked: false,
  unknown: false,
  stale: false,
  ageMs: 3_600_000
};

// ── The property this whole module exists for ────────────────────────────────

describe('absence of evidence is never rendered as a positive finding', () => {
  test('an entirely unchecked item reports unknown everywhere, never ok', () => {
    const rows = buildTrustRows({});
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.tone, `${r.plane} must not read as ok when nothing was checked`).not.toBe('ok');
    }
    expect(summarizeTrust(rows).tone).toBe('unknown');
  });

  test('no published attestation is unknown, not a failure', () => {
    // Most of npm publishes none. Rendering that as bad would flag nearly
    // everything and destroy the meaning of a real signature failure.
    const rows = buildTrustRows({ provenance: null });
    expect(row(rows, 'provenance').tone).toBe('unknown');
    expect(row(rows, 'provenance').detail).toContain('no attestation');
  });

  test('a verifier that could not run is unknown, not a failure', () => {
    // bun cannot verify the Sigstore TUF root; reporting that as tampering
    // would condemn every correctly-signed package.
    for (const reason of ['network-error', 'verification-skipped']) {
      const rows = buildTrustRows({ provenance: { verified: false, reason } });
      expect(row(rows, 'provenance').tone, reason).toBe('unknown');
      expect(row(rows, 'provenance').detail).toContain('could not check');
    }
  });

  test('an allow reached with rules switched off is NOT a permit', () => {
    // The Cedar trap: a rule reading a missing attribute is silently skipped
    // and the decision returns permissive.
    const inconclusive: PolicyDecision = {
      decision: 'allow',
      determining: [],
      skipped: ['forbid-undeclared-egress'],
      errors: []
    } as PolicyDecision;
    const rows = buildTrustRows({ policy: inconclusive });
    expect(row(rows, 'policy').tone).not.toBe('ok');
    expect(row(rows, 'policy').detail).toContain('inconclusive');
  });

  test('no cached revocation feed is unknown, not "not revoked"', () => {
    // With no key pinned this is the normal state, so it is the most likely
    // row to be misread as a clean result.
    const rows = buildTrustRows({
      revocation: { matches: [], blocked: false, unknown: true, stale: false }
    });
    expect(row(rows, 'revocation').tone).toBe('unknown');
    expect(row(rows, 'revocation').detail).not.toMatch(/no match|clean|not revoked/i);
  });

  test('a server never run is unknown, not well-behaved', () => {
    const rows = buildTrustRows({
      observation: {
        sessions: 0,
        toolCalls: 0,
        networkSampled: false,
        hostsContacted: [],
        divergences: []
      }
    });
    expect(row(rows, 'observed').tone).toBe('unknown');
    expect(row(rows, 'observed').detail).toContain('never run');
  });

  test('observed but unsampled network never reads as "contacted nothing"', () => {
    const rows = buildTrustRows({
      observation: {
        sessions: 2,
        toolCalls: 9,
        networkSampled: false,
        hostsContacted: [],
        divergences: []
      }
    });
    expect(row(rows, 'observed').detail).toContain('network not observed');
    expect(row(rows, 'observed').detail).not.toMatch(/no peers|contacted nothing/i);
  });
});

// ── Positive findings still read correctly ───────────────────────────────────

describe('real findings', () => {
  test('a verified signature names the repository it is bound to', () => {
    const rows = buildTrustRows({
      provenance: { verified: true, reason: 'provenance-verified', sourceRepo: 'mcp/servers' }
    });
    expect(row(rows, 'provenance').tone).toBe('ok');
    expect(row(rows, 'provenance').detail).toContain('mcp/servers');
  });

  test('an identity mismatch is bad, and says it was signed by someone else', () => {
    const rows = buildTrustRows({
      provenance: { verified: false, reason: 'publisher-mismatch', sourceRepo: 'evil/fork' }
    });
    expect(row(rows, 'provenance').tone).toBe('bad');
    expect(row(rows, 'provenance').detail).toContain('evil/fork');
  });

  test('a policy deny names the determining rule', () => {
    const deny: PolicyDecision = {
      decision: 'deny',
      determining: ['forbid-unsigned'],
      skipped: [],
      errors: []
    } as PolicyDecision;
    const rows = buildTrustRows({ policy: deny });
    expect(row(rows, 'policy').tone).toBe('bad');
    expect(row(rows, 'policy').detail).toContain('forbid-unsigned');
  });

  test('a blocking revocation is bad and carries the reason', () => {
    const revoked: RevocationStatus = {
      matches: [{ entry: { reason: 'credential exfiltration' } }] as never,
      blocked: true,
      unknown: false,
      stale: false
    };
    const rows = buildTrustRows({ revocation: revoked });
    expect(row(rows, 'revocation').tone).toBe('bad');
    expect(row(rows, 'revocation').detail).toContain('credential exfiltration');
  });

  test('a critical divergence outranks the session summary', () => {
    const rows = buildTrustRows({
      observation: {
        sessions: 1,
        toolCalls: 3,
        networkSampled: true,
        hostsContacted: ['10.0.0.1:443'],
        divergences: [
          {
            kind: 'undeclared-egress',
            detail: 'contacted 10.0.0.1:443 while declaring no network access',
            severity: 'critical'
          }
        ]
      }
    });
    expect(row(rows, 'observed').tone).toBe('bad');
    expect(row(rows, 'observed').detail).toContain('10.0.0.1:443');
  });

  test('a stale feed with no match is a warning, not a pass', () => {
    const rows = buildTrustRows({
      revocation: { ...cleanFeed, stale: true, ageMs: 90 * 3_600_000 }
    });
    expect(row(rows, 'revocation').tone).toBe('warn');
    expect(row(rows, 'revocation').detail).toContain('stale');
  });
});

// ── The summary line ─────────────────────────────────────────────────────────

describe('summarizeTrust', () => {
  test('a fully clean item still refuses to claim safety', () => {
    const rows = buildTrustRows({
      scan: cleanScan,
      provenance: { verified: true, reason: 'provenance-verified', sourceRepo: 'a/b' },
      policy: permit,
      revocation: cleanFeed,
      observation: {
        sessions: 3,
        toolCalls: 12,
        networkSampled: true,
        hostsContacted: [],
        divergences: []
      }
    });
    const summary = summarizeTrust(rows);
    expect(summary.tone).toBe('ok');
    // "Passed the gate" is never "safe", and the headline is the most likely
    // line to be quoted out of context.
    expect(summary.headline).toContain('not a guarantee');
  });

  test('unknown outranks ok — a partial check is reported as incomplete', () => {
    const rows = buildTrustRows({
      scan: cleanScan,
      provenance: { verified: true, reason: 'provenance-verified', sourceRepo: 'a/b' },
      policy: permit,
      revocation: cleanFeed
      // observation omitted
    });
    const summary = summarizeTrust(rows);
    expect(summary.tone).toBe('unknown');
    expect(summary.headline).toContain('incomplete');
    expect(summary.headline).toContain('observed');
  });

  test('bad outranks everything', () => {
    const rows = buildTrustRows({
      scan: cleanScan,
      provenance: { verified: false, reason: 'verification-failed' },
      policy: permit,
      revocation: cleanFeed
    });
    expect(summarizeTrust(rows).tone).toBe('bad');
  });

  test('an unconfirmed advisory says the version is unknown, not that you are hit', () => {
    // A package-level advisory with no pinned version is two facts, and both
    // must survive: the advisory is real, and whether it applies to *this*
    // copy was never established. Rendering it as a plain "advisory match"
    // overstates it; dropping it understates it far worse.
    const row = buildTrustRows({
      revocation: {
        matches: [
          {
            entry: {
              id: 'GHSA-1',
              purl_pattern: 'pkg:npm/x',
              versions: '<=0.6.2',
              reason: 'path traversal',
              severity: 'high',
              refs: [],
              added_at: '2026-01-01T00:00:00Z'
            },
            purl: 'pkg:npm/x',
            confirmed: false
          }
        ],
        blocked: false,
        unknown: false,
        stale: false
      }
    }).find((r) => r.plane === 'revocation');

    expect(row?.tone).toBe('warn');
    expect(row?.detail).toContain('unknown whether yours is affected');
  });
});
