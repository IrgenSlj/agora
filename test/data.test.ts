/**
 * Data integrity contract tests for src/data.ts.
 * Every assertion covers the FULL dataset, not just the first element.
 */
import { describe, expect, test } from 'bun:test';
import { samplePackages, sampleTutorials, sampleWorkflows, trendingTags } from '../src/data';

// npm package-name shape: optional scope (@scope/) + package name
const NPM_PKG_RE = /^@?[a-z0-9][\w.-]*(\/[\w.-]+)?$/;

describe('samplePackages — data integrity', () => {
  test('ids are unique', () => {
    const ids = samplePackages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every package has non-empty required string fields', () => {
    for (const pkg of samplePackages) {
      expect(pkg.id.length).toBeGreaterThan(0);
      expect(pkg.name.length).toBeGreaterThan(0);
      expect(pkg.description.length).toBeGreaterThan(0);
      expect(pkg.author.length).toBeGreaterThan(0);
      expect(pkg.version.length).toBeGreaterThan(0);
      expect(pkg.createdAt.length).toBeGreaterThan(0);
    }
  });

  test('every package has a valid category', () => {
    const validCategories = new Set(['mcp', 'prompt', 'workflow', 'skill']);
    for (const pkg of samplePackages) {
      expect(validCategories.has(pkg.category)).toBe(true);
    }
  });

  test('every package has a non-empty tags array', () => {
    for (const pkg of samplePackages) {
      expect(Array.isArray(pkg.tags)).toBe(true);
      expect(pkg.tags.length).toBeGreaterThan(0);
    }
  });

  test('MCP packages with npmPackage have non-empty values', () => {
    const npmMcp = samplePackages.filter((p) => p.category === 'mcp' && p.npmPackage);
    expect(npmMcp.length).toBeGreaterThan(0);
    for (const pkg of npmMcp) {
      expect(pkg.npmPackage!.length).toBeGreaterThan(0);
    }
  });

  test('non-MCP packages do not have npmPackage', () => {
    const nonMcp = samplePackages.filter((p) => p.category !== 'mcp');
    for (const pkg of nonMcp) {
      expect(pkg.npmPackage).toBeUndefined();
    }
  });

  test('every npmPackage matches the npm package-name shape', () => {
    for (const pkg of samplePackages) {
      if (pkg.npmPackage) {
        expect(pkg.npmPackage).toMatch(NPM_PKG_RE);
      }
    }
  });

  test('MCP packages missing npmPackage are still valid (browsable-only)', () => {
    const noNpm = samplePackages.filter((p) => p.category === 'mcp' && !p.npmPackage);
    // These entries can be browsed but not installed — that's intentional
    // for community servers not published on npm.
    for (const pkg of noNpm) {
      expect(pkg.id.length).toBeGreaterThan(0);
      expect(pkg.repository?.length || pkg.name.length).toBeGreaterThan(0);
    }
  });

  test('stars and installs are non-negative numbers', () => {
    for (const pkg of samplePackages) {
      expect(pkg.stars).toBeGreaterThanOrEqual(0);
      expect(pkg.installs).toBeGreaterThanOrEqual(0);
    }
  });

  test('dataset contains at least 31 entries', () => {
    expect(samplePackages.length).toBeGreaterThanOrEqual(31);
  });

  test('MCP package ids are prefixed with mcp-', () => {
    for (const pkg of samplePackages.filter((p) => p.category === 'mcp')) {
      expect(pkg.id.startsWith('mcp-')).toBe(true);
    }
  });

  test('prompt package ids are prefixed with prompt-', () => {
    for (const pkg of samplePackages.filter((p) => p.category === 'prompt')) {
      expect(pkg.id.startsWith('prompt-')).toBe(true);
    }
  });

  test('createdAt values are valid ISO date strings', () => {
    const isoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;
    for (const pkg of samplePackages) {
      expect(pkg.createdAt).toMatch(isoDate);
    }
  });
});

describe('sampleWorkflows — data integrity', () => {
  test('ids are unique', () => {
    const ids = sampleWorkflows.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every workflow has non-empty required string fields', () => {
    for (const wf of sampleWorkflows) {
      expect(wf.id.length).toBeGreaterThan(0);
      expect(wf.name.length).toBeGreaterThan(0);
      expect(wf.description.length).toBeGreaterThan(0);
      expect(wf.author.length).toBeGreaterThan(0);
      expect(wf.prompt.length).toBeGreaterThan(0);
    }
  });

  test('stars and forks are non-negative', () => {
    for (const wf of sampleWorkflows) {
      expect(wf.stars).toBeGreaterThanOrEqual(0);
      expect(wf.forks).toBeGreaterThanOrEqual(0);
    }
  });

  test('every workflow has non-empty tags', () => {
    for (const wf of sampleWorkflows) {
      expect(Array.isArray(wf.tags)).toBe(true);
      expect(wf.tags.length).toBeGreaterThan(0);
    }
  });

  test('workflow ids are prefixed with wf-', () => {
    for (const wf of sampleWorkflows) {
      expect(wf.id.startsWith('wf-')).toBe(true);
    }
  });

  test('createdAt values are valid ISO date strings', () => {
    const isoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;
    for (const wf of sampleWorkflows) {
      expect(wf.createdAt).toMatch(isoDate);
    }
  });

  test('prompt field is non-empty for every workflow', () => {
    for (const wf of sampleWorkflows) {
      expect(wf.prompt.length).toBeGreaterThan(50);
    }
  });
});

describe('sampleTutorials — data integrity', () => {
  test('ids are unique', () => {
    const ids = sampleTutorials.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every tutorial has non-empty required string fields', () => {
    for (const tut of sampleTutorials) {
      expect(tut.id.length).toBeGreaterThan(0);
      expect(tut.title.length).toBeGreaterThan(0);
      expect(tut.description.length).toBeGreaterThan(0);
      expect(tut.duration.length).toBeGreaterThan(0);
    }
  });

  test('every tutorial has a valid level', () => {
    const validLevels = new Set(['beginner', 'intermediate', 'advanced']);
    for (const tut of sampleTutorials) {
      expect(validLevels.has(tut.level)).toBe(true);
    }
  });

  test('every tutorial has at least one step', () => {
    for (const tut of sampleTutorials) {
      expect(Array.isArray(tut.steps)).toBe(true);
      expect(tut.steps.length).toBeGreaterThan(0);
    }
  });

  test('every tutorial step has non-empty title and content', () => {
    for (const tut of sampleTutorials) {
      for (const step of tut.steps) {
        expect(step.title.length).toBeGreaterThan(0);
        expect(step.content.length).toBeGreaterThan(0);
      }
    }
  });

  test('tutorial ids are prefixed with tut-', () => {
    for (const tut of sampleTutorials) {
      expect(tut.id.startsWith('tut-')).toBe(true);
    }
  });

  test('duration follows the pattern "N min"', () => {
    const durRe = /^\d+\s+min$/;
    for (const tut of sampleTutorials) {
      expect(tut.duration).toMatch(durRe);
    }
  });
});

describe('trendingTags', () => {
  test('is non-empty', () => {
    expect(trendingTags.length).toBeGreaterThan(0);
  });

  test('all tags are lowercase non-empty strings', () => {
    for (const tag of trendingTags) {
      expect(typeof tag).toBe('string');
      expect(tag.length).toBeGreaterThan(0);
      expect(tag).toBe(tag.toLowerCase());
    }
  });
});

// ── Permissions backfill ──────────────────────────────────────────────────────

describe('samplePackages — permissions backfill', () => {
  const byId = (id: string) => samplePackages.find((p) => p.id === id)!;

  test('mcp-filesystem has fs permission', () => {
    const pkg = byId('mcp-filesystem');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.fs).toEqual(['./**/*']);
    expect(pkg.permissions!.net).toBeUndefined();
    expect(pkg.permissions!.exec).toBeUndefined();
  });

  test('mcp-brave-search has net permissions with api.brave.com', () => {
    const pkg = byId('mcp-brave-search');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.net).toContain('api.brave.com');
    expect(pkg.permissions!.fs).toBeUndefined();
  });

  test('mcp-openai has net permissions with api.openai.com', () => {
    const pkg = byId('mcp-openai');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.net).toContain('api.openai.com');
    expect(pkg.permissions!.net).toContain('api.anthropic.com');
    expect(pkg.permissions!.fs).toBeUndefined();
  });

  test('mcp-docker has exec and fs permissions', () => {
    const pkg = byId('mcp-docker');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.exec).toContain('docker');
    expect(pkg.permissions!.fs).toContain('./**/*');
  });

  test('mcp-firecrawl has wildcard net permission', () => {
    const pkg = byId('mcp-firecrawl');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.net).toEqual(['*']);
    expect(pkg.permissions!.exec).toBeUndefined();
  });

  test('mcp-kubernetes has exec permissions for kubectl and helm', () => {
    const pkg = byId('mcp-kubernetes');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.exec).toContain('kubectl');
    expect(pkg.permissions!.exec).toContain('helm');
    expect(pkg.permissions!.fs).toBeUndefined();
  });

  test('mcp-obsidian has fs permissions for vault access', () => {
    const pkg = byId('mcp-obsidian');
    expect(pkg.permissions).toBeDefined();
    expect(pkg.permissions!.fs).toBeDefined();
    expect(pkg.permissions!.fs!.some((p) => p.includes('.obsidian'))).toBe(true);
    expect(pkg.permissions!.net).toBeUndefined();
  });

  test('permissions shape is valid — all values are string arrays', () => {
    for (const pkg of samplePackages) {
      if (!pkg.permissions) continue;
      if (pkg.permissions.fs !== undefined) {
        expect(Array.isArray(pkg.permissions.fs)).toBe(true);
        for (const v of pkg.permissions.fs) expect(typeof v).toBe('string');
      }
      if (pkg.permissions.net !== undefined) {
        expect(Array.isArray(pkg.permissions.net)).toBe(true);
        for (const v of pkg.permissions.net) expect(typeof v).toBe('string');
      }
      if (pkg.permissions.exec !== undefined) {
        expect(Array.isArray(pkg.permissions.exec)).toBe(true);
        for (const v of pkg.permissions.exec) expect(typeof v).toBe('string');
      }
    }
  });
});

// ── Network-gated test — only runs when AGORA_NETWORK_TESTS=1 ──────────────
describe('samplePackages — npm registry reachability (network-gated)', () => {
  test.if(!!process.env.AGORA_NETWORK_TESTS)(
    'every npmPackage resolves to HTTP 200 on the npm registry',
    async () => {
      const mcpPkgs = samplePackages.filter((p) => p.npmPackage);
      const results = await Promise.all(
        mcpPkgs.map(async (pkg) => {
          const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.npmPackage!)}/latest`;
          const res = await fetch(url);
          return { id: pkg.id, npm: pkg.npmPackage, status: res.status };
        })
      );

      const failures = results.filter((r) => r.status !== 200);
      if (failures.length > 0) {
        throw new Error(
          `npm registry returned non-200 for:\n${failures.map((f) => `  ${f.id} (${f.npm}) → ${f.status}`).join('\n')}`
        );
      }
    },
    60_000
  );
});
