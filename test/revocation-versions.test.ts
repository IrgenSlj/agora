import { describe, expect, it } from 'vitest';
import feed from '../feed/revocations.json' with { type: 'json' };
import type { RevocationEntry } from '../src/model/revocation.js';
import { versionRangeFor } from '../src/osv/to-revocation.js';
import type { OsvVulnerability } from '../src/osv/types.js';
import { npmPackageFromCommand, versionFromCommand } from '../src/revocation/installed.js';
import { matchRevocations, versionInRange } from '../src/revocation/match.js';

describe('OSV version translation', () => {
  it('emits an explicit version list instead of "all versions"', () => {
    // Shape of MAL-2025-190909: the advisory names the bad versions and no range.
    const vuln: OsvVulnerability = {
      id: 'MAL-2025-190909',
      affected: [{ versions: ['2.4.11', '2.4.10', '2.4.12'] }]
    } as OsvVulnerability;
    expect(versionRangeFor(vuln)).toBe('2.4.10 || 2.4.11 || 2.4.12');
  });

  it('ORs disjoint ranges instead of keeping only the first', () => {
    const vuln = {
      id: 'GHSA-x',
      affected: [
        {
          ranges: [
            { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.2.0' }] },
            { type: 'SEMVER', events: [{ introduced: '2.0.0' }, { fixed: '2.0.5' }] }
          ]
        }
      ]
    } as OsvVulnerability;
    expect(versionRangeFor(vuln)).toBe('<1.2.0 || >=2.0.0 <2.0.5');
  });

  it('still says "all versions" when the advisory really covers every version', () => {
    const vuln = {
      id: 'MAL-y',
      affected: [{ ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }]
    } as OsvVulnerability;
    expect(versionRangeFor(vuln)).toBeUndefined();
  });
});

describe('version ranges', () => {
  it('evaluates semver ranges, including OR', () => {
    expect(versionInRange('2.4.11', '2.4.10 || 2.4.11 || 2.4.12')).toBe(true);
    expect(versionInRange('2.4.13', '2.4.10 || 2.4.11 || 2.4.12')).toBe(false);
    expect(versionInRange('1.10.0', '<1.9.0')).toBe(false);
    expect(versionInRange('1.0.0-beta.2', '<1.0.0')).toBe(true);
    expect(versionInRange('0.6.2', '>=0.5 <=0.6.2')).toBe(true);
  });

  it('treats an unreadable range as a match, never as clean', () => {
    expect(versionInRange('1.0.0', 'not a range ???')).toBe(true);
  });
});

describe('launch commands with tags', () => {
  it('strips a dist-tag from the package name', () => {
    expect(npmPackageFromCommand(['npx', '-y', '@scope/server@latest'])).toBe('@scope/server');
    expect(npmPackageFromCommand(['npx', 'server@next'])).toBe('server');
    expect(npmPackageFromCommand(['npx', '@scope/server'])).toBe('@scope/server');
  });

  it('reports a tag or a range as an unknown version, not as a version', () => {
    expect(versionFromCommand(['npx', '-y', '@scope/server@latest'])).toBeUndefined();
    expect(versionFromCommand(['npx', '-y', 'server@^1.2.0'])).toBeUndefined();
    expect(versionFromCommand(['npx', '-y', 'server@1.2.3'])).toBe('1.2.3');
  });
});

describe('bundled feed', () => {
  const entries = (feed as { entries: RevocationEntry[] }).entries;

  // Popular servers at versions people run today. None of these may be blocked.
  const current = [
    'pkg:npm/%40postman/postman-mcp-server@2.5.0',
    'pkg:npm/%40browserbasehq/mcp-server-browserbase@2.4.3',
    'pkg:npm/%40antv/mcp-server-chart@0.12.0',
    'pkg:npm/%40modelcontextprotocol/server-filesystem@2026.1.14'
  ];

  for (const purl of current) {
    it(`does not block ${purl}`, () => {
      const hits = matchRevocations(entries, purl).filter((m) => m.confirmed);
      expect(hits.map((h) => h.entry.id)).toEqual([]);
    });
  }

  it('still blocks the malicious versions themselves', () => {
    const hits = matchRevocations(entries, 'pkg:npm/%40postman/postman-mcp-server@2.4.11');
    expect(hits.map((h) => h.entry.id)).toContain('MAL-2025-190909');
  });
});
