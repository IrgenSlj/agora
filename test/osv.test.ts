import { describe, expect, test } from 'vitest';
import { queryPurl, queryPurls } from '../src/osv/client';
import { severityFor, toRevocationEntry, versionRangeFor } from '../src/osv/to-revocation';
import type { OsvVulnerability } from '../src/osv/types';
import { versionInRange } from '../src/revocation/match';

// Fixtures are captured verbatim from live OSV responses on 2026-07-31, not
// written from the schema — the schema permits far more than any database
// emits, and a mapper tested against invented shapes passes while producing
// empty ranges against real ones.

const GHSA: OsvVulnerability = {
  id: 'GHSA-hc55-p739-j48w',
  summary: '@modelcontextprotocol/server-filesystem vulnerability allows for path traversal',
  modified: '2025-07-02T18:57:22Z',
  published: '2025-07-01T20:14:00Z',
  affected: [
    {
      package: { name: '@modelcontextprotocol/server-filesystem', ecosystem: 'npm' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { last_affected: '0.6.2' }] }],
      versions: null
    }
  ],
  references: [
    {
      type: 'ADVISORY',
      url: 'https://github.com/modelcontextprotocol/servers/security/advisories/GHSA-hc55-p739-j48w'
    }
  ],
  severity: [{ type: 'CVSS_V4', score: 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:N/VA:H' }],
  database_specific: { severity: 'HIGH', cwe_ids: ['CWE-22'] }
};

const MALWARE: OsvVulnerability = {
  id: 'MAL-2026-6740',
  summary: 'Malicious code in decode-sdks (npm)',
  modified: '2026-07-10T17:02:00Z',
  affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }]
};

const PURL = 'pkg:npm/%40modelcontextprotocol/server-filesystem';

describe('severity mapping', () => {
  test('MAL-* is critical — the package is hostile, not merely flawed', () => {
    expect(severityFor(MALWARE)).toBe('critical');
  });

  test("GitHub's HIGH and CRITICAL block; everything else only reports", () => {
    expect(severityFor(GHSA)).toBe('high');
    expect(severityFor({ ...GHSA, database_specific: { severity: 'CRITICAL' } })).toBe('high');
    expect(severityFor({ ...GHSA, database_specific: { severity: 'MODERATE' } })).toBe('advisory');
    expect(severityFor({ ...GHSA, database_specific: {} })).toBe('advisory');
    expect(severityFor({ ...GHSA, database_specific: undefined })).toBe('advisory');
  });

  test('an unlabelled advisory never silently becomes blocking', () => {
    // Erring toward `advisory` means an over-broad entry costs a warning, not
    // a refused install.
    expect(severityFor({ id: 'GHSA-unknown' })).toBe('advisory');
  });
});

describe('version range mapping', () => {
  test('last_affected becomes an inclusive upper bound the matcher understands', () => {
    const range = versionRangeFor(GHSA);
    expect(range).toBe('<=0.6.2');
    // The real assertion: the range must work in the matcher that consumes it.
    expect(versionInRange('0.6.2', range)).toBe(true);
    expect(versionInRange('0.6.1', range)).toBe(true);
    expect(versionInRange('0.7.0', range)).toBe(false);
  });

  test('fixed becomes an exclusive upper bound', () => {
    const v: OsvVulnerability = {
      id: 'X',
      affected: [
        { ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.2.3' }] }] }
      ]
    };
    expect(versionRangeFor(v)).toBe('<1.2.3');
    expect(versionInRange('1.2.2', '<1.2.3')).toBe(true);
    expect(versionInRange('1.2.3', '<1.2.3')).toBe(false);
  });

  test('an introduced floor is carried through', () => {
    const v: OsvVulnerability = {
      id: 'X',
      affected: [
        { ranges: [{ type: 'SEMVER', events: [{ introduced: '2.0.0' }, { fixed: '2.4.0' }] }] }
      ]
    };
    expect(versionRangeFor(v)).toBe('>=2.0.0 <2.4.0');
    expect(versionInRange('1.9.0', '>=2.0.0 <2.4.0')).toBe(false);
    expect(versionInRange('2.1.0', '>=2.0.0 <2.4.0')).toBe(true);
    expect(versionInRange('2.4.0', '>=2.0.0 <2.4.0')).toBe(false);
  });

  test('"every version" is undefined, not an empty string', () => {
    // `versions: ''` would reach the matcher as a range and be parsed; absent
    // is what means "all versions".
    expect(versionRangeFor(MALWARE)).toBeUndefined();
    expect(versionInRange('9.9.9', undefined)).toBe(true);
  });
});

describe('entry construction', () => {
  test('the entry is keyed by the catalog purl, not by what OSV echoed back', () => {
    // An entry keyed by anything but Agora's own purl would never match.
    expect(toRevocationEntry(GHSA, PURL).purl_pattern).toBe(PURL);
  });

  test('every entry carries a resolvable reference', () => {
    // `refs` is what makes a revocation checkable by a human rather than an
    // assertion they have to take on faith.
    expect(toRevocationEntry(MALWARE, 'pkg:npm/decode-sdks').refs).toContain(
      'https://osv.dev/vulnerability/MAL-2026-6740'
    );
    expect(toRevocationEntry(GHSA, PURL).refs.length).toBeGreaterThan(1);
  });

  test('malware gets a stable machine reason rather than prose', () => {
    expect(toRevocationEntry(MALWARE, 'pkg:npm/decode-sdks').reason).toBe('malicious-package');
  });

  test('the produced entry validates as a RevocationEntry', async () => {
    const { RevocationEntry } = await import('../src/model/revocation');
    for (const [v, purl] of [
      [GHSA, PURL],
      [MALWARE, 'pkg:npm/decode-sdks']
    ] as const) {
      const parsed = RevocationEntry.safeParse(toRevocationEntry(v, purl));
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    }
  });
});

describe('client', () => {
  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

  test('a withdrawn advisory is dropped — the database took the claim back', async () => {
    const fetcher = () => ok({ vulns: [GHSA, { ...MALWARE, withdrawn: '2026-01-01T00:00:00Z' }] });
    const res = await queryPurl(PURL, { fetcher });
    expect(res.status).toBe('ok');
    expect(res.status === 'ok' && res.vulns.map((v) => v.id)).toEqual(['GHSA-hc55-p739-j48w']);
  });

  test('an unreachable OSV is unreachable, never an empty result', async () => {
    // The whole product rule in one test: absence of evidence is not a clean
    // bill of health. Collapsing this into `{vulns: []}` would publish "no
    // advisories" for every package the day OSV had an outage.
    const down = () => Promise.reject(new Error('ECONNREFUSED'));
    const res = await queryPurl(PURL, { fetcher: down });
    expect(res.status).toBe('unreachable');

    const http500 = () => Promise.resolve(new Response('nope', { status: 500 }));
    const res2 = await queryPurl(PURL, { fetcher: http500 });
    expect(res2.status).toBe('unreachable');
    expect(res2.status === 'unreachable' && res2.reason).toContain('500');
  });

  test('duplicate purls are queried once', async () => {
    let calls = 0;
    const fetcher = () => {
      calls++;
      return ok({ vulns: [] });
    };
    await queryPurls([PURL, PURL, 'pkg:npm/other'], { fetcher });
    expect(calls).toBe(2);
  });
});
