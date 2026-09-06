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

describe('reason classification', () => {
  // `reason` used to be the advisory's summary sentence, truncated. That made
  // it a headline rather than a field: no consumer can branch on "MCP Server
  // Kubernetes has an Argument Injection in port_forward tool via
  // space-splitting", and the whole point of publishing a feed other tools
  // consume is that they can act on it without parsing English.
  const reason = (v: Partial<OsvVulnerability>) =>
    toRevocationEntry({ id: 'GHSA-x', ...v } as OsvVulnerability, PURL).reason;

  test('MAL-* is malicious-package on the id alone, never on keywords', () => {
    // Not a heuristic. The OpenSSF malicious-packages feed is an assertion that
    // the package is hostile, and it must not depend on the summary wording.
    expect(reason({ id: 'MAL-2026-1', summary: 'anything at all' })).toBe('malicious-package');
    expect(reason({ id: 'MAL-2026-2' })).toBe('malicious-package');
  });

  test('classifies the classes that actually show up in this ecosystem', () => {
    expect(reason({ summary: 'kubectl-generic flag injection enables token exfiltration' })).toBe(
      'credential-exfiltration'
    );
    expect(reason({ summary: 'Argument Injection in port_forward tool via space-splitting' })).toBe(
      'command-injection'
    );
    expect(reason({ summary: 'allows for path validation bypass via colliding prefix' })).toBe(
      'path-traversal'
    );
    expect(reason({ summary: 'vulnerable to DNS Rebinding Attack' })).toBe('ssrf');
    expect(reason({ summary: 'Tool Access Control Bypass via presentation-layer filtering' })).toBe(
      'access-control'
    );
  });

  test('reads details as well as summary', () => {
    expect(reason({ summary: 'A problem', details: 'This allows prompt injection.' })).toBe(
      'prompt-injection'
    );
  });

  test('an unmatched advisory lands on the honest general case', () => {
    // The important half of a crude classifier: everything it cannot place goes
    // to `vulnerability` rather than to a confident wrong label. A consumer
    // that branches on the slug is misled by a bad guess, not by a vague one.
    expect(reason({ summary: 'Something nobody has a keyword for' })).toBe('vulnerability');
    expect(reason({})).toBe('vulnerability');
  });

  test('exfiltration outranks injection when an advisory describes both', () => {
    // Both are true of "flag injection enables token exfiltration". The
    // consequence is what a consumer needs to act on, so the more severe
    // outcome wins rather than the mechanism.
    expect(reason({ summary: 'command injection leading to credential exfiltration' })).toBe(
      'credential-exfiltration'
    );
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

  test('the advisory sentence survives, in the field where prose belongs', () => {
    const entry = toRevocationEntry(GHSA, PURL);
    expect(entry.summary).toBe(GHSA.summary);
    expect(entry.reason).not.toContain(' ');
  });

  test('an advisory with no summary carries no summary field', () => {
    // Absent, not an empty string. A consumer rendering `summary` should show
    // nothing rather than a blank line where a description would be.
    expect(toRevocationEntry({ id: 'GHSA-y' } as OsvVulnerability, PURL).summary).toBeUndefined();
  });

  test('a long summary is truncated rather than dropped', () => {
    const long = 'x'.repeat(400);
    const entry = toRevocationEntry({ id: 'GHSA-z', summary: long } as OsvVulnerability, PURL);
    // The invariant is the ceiling, not an exact width — asserting the precise
    // length just pins the arithmetic of the slice.
    expect(entry.summary!.length).toBeLessThanOrEqual(200);
    expect(entry.summary!.endsWith('…')).toBe(true);
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

  // ── queryPurls: batch first, full records only for the hits ───────────────
  //
  // The artifact universe went from thirty hand-listed servers to the whole
  // registry. One request per package was fine at thirty and is thousands of
  // sequential round trips at scale, nearly all of them returning nothing.

  /** Routes batch and single-query URLs to separate handlers, counting both. */
  function osv(opts: {
    batch: (purls: string[]) => Promise<Response>;
    single?: (purl: string) => Promise<Response>;
  }) {
    const calls = { batch: 0, single: 0 };
    const fetcher = ((url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}');
      if (String(url).includes('querybatch')) {
        calls.batch++;
        return opts.batch(
          (body.queries as { package: { purl: string } }[]).map((q) => q.package.purl)
        );
      }
      calls.single++;
      return (opts.single ?? (() => ok({ vulns: [] })))(body.package.purl);
    }) as never;
    return { fetcher, calls };
  }

  const noHits = (purls: string[]) => ok({ results: purls.map(() => ({})) });

  test('asks once per batch, not once per package, and deduplicates', async () => {
    const { fetcher, calls } = osv({ batch: noHits });
    const res = await queryPurls([PURL, PURL, 'pkg:npm/other'], { fetcher });

    expect(calls.batch).toBe(1);
    expect(calls.single).toBe(0);
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.status === 'ok')).toBe(true);
  });

  test('fetches the full record only for packages the batch flagged', async () => {
    // Batch returns ids and nothing a revocation entry needs — no severity, no
    // version ranges — so a hit still costs a second request. A miss must not.
    const { fetcher, calls } = osv({
      batch: (purls) =>
        ok({ results: purls.map((p) => (p === PURL ? { vulns: [{ id: GHSA.id }] } : {})) }),
      single: () => ok({ vulns: [GHSA] })
    });

    const res = await queryPurls([PURL, 'pkg:npm/clean'], { fetcher });

    expect(calls.batch).toBe(1);
    expect(calls.single).toBe(1);
    const hit = res.find((r) => r.purl === PURL)!;
    expect(hit.status === 'ok' && hit.vulns).toHaveLength(1);
    const clean = res.find((r) => r.purl === 'pkg:npm/clean')!;
    expect(clean.status === 'ok' && clean.vulns).toEqual([]);
  });

  test('a failed batch marks every package in it unreachable, never clean', async () => {
    // The dangerous failure. "OSV was down" and "OSV said nothing is wrong"
    // are the same shape downstream, and only one is safe to publish.
    const { fetcher } = osv({
      batch: () => Promise.resolve(new Response('nope', { status: 503 }))
    });

    const res = await queryPurls([PURL, 'pkg:npm/other'], { fetcher });
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.status === 'unreachable')).toBe(true);
  });

  test('a misaligned batch response is unreachable rather than mis-attributed', async () => {
    // Results are positional, never keyed by package. Two results for three
    // queries cannot be matched to packages safely at all — guessing would
    // attach one package's advisories to another's name.
    const { fetcher } = osv({ batch: () => ok({ results: [{}, {}] }) });

    const res = await queryPurls([PURL, 'pkg:npm/b', 'pkg:npm/c'], { fetcher });
    expect(res).toHaveLength(3);
    expect(res.every((r) => r.status === 'unreachable')).toBe(true);
    expect(res[0].status === 'unreachable' && res[0].reason).toContain('2 results for 3 queries');
  });

  test('one bad batch does not take down the batches around it', async () => {
    let n = 0;
    const { fetcher } = osv({
      batch: (purls) => {
        n++;
        return n === 1
          ? Promise.resolve(new Response('', { status: 500 }))
          : ok({ results: purls.map(() => ({})) });
      }
    });

    // BATCH_SIZE is 100, so 150 purls is two chunks.
    const many = Array.from({ length: 150 }, (_, i) => `pkg:npm/p${i}`);
    const res = await queryPurls(many, { fetcher });

    expect(res).toHaveLength(150);
    expect(res.filter((r) => r.status === 'unreachable')).toHaveLength(100);
    expect(res.filter((r) => r.status === 'ok')).toHaveLength(50);
  });
});
