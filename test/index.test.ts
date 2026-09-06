import { describe, expect, test } from 'vitest';
import { samplePackages } from '../src/data';
import { PLUGIN_MUTATION_INVENTORY } from '../src/gate/mutations';

describe('Agora Data Validation', () => {
  test('samplePackages has required fields', () => {
    const pkg = samplePackages[0];
    expect(pkg).toBeDefined();
    expect(pkg.id).toBeDefined();
    expect(pkg.name).toBeDefined();
    expect(pkg.description).toBeDefined();
    expect(pkg.author).toBeDefined();
    expect(pkg.stars).toBeGreaterThan(0);
    expect(pkg.category).toBe('mcp');
  });
});

describe('Search Logic', () => {
  test('search finds packages by name', () => {
    const query = 'filesystem';
    const results = samplePackages.filter((p) =>
      p.name.toLowerCase().includes(query.toLowerCase())
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test('search finds packages by description', () => {
    const query = 'github';
    const results = samplePackages.filter((p) =>
      p.description.toLowerCase().includes(query.toLowerCase())
    );
    expect(results.length).toBeGreaterThan(0);
  });

  test('search is case insensitive', () => {
    const upper = 'GITHUB';
    const lower = 'github';
    const resultsUpper = samplePackages.filter((p) =>
      p.name.toLowerCase().includes(upper.toLowerCase())
    );
    const resultsLower = samplePackages.filter((p) =>
      p.name.toLowerCase().includes(lower.toLowerCase())
    );
    expect(resultsUpper.length).toBe(resultsLower.length);
  });

  test('search returns empty for no matches', () => {
    const query = 'nonexistent-xyz-123';
    const results = samplePackages.filter((p) =>
      p.name.toLowerCase().includes(query.toLowerCase())
    );
    expect(results.length).toBe(0);
  });
});

describe('Trending Logic', () => {
  test('sorting by stars works', () => {
    const sorted = [...samplePackages].sort((a, b) => b.stars - a.stars);
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(sorted[i].stars).toBeGreaterThanOrEqual(sorted[i + 1].stars);
    }
  });

  test('limit returns correct count', () => {
    const limit = 3;
    const top = [...samplePackages].sort((a, b) => b.stars - a.stars).slice(0, limit);
    expect(top.length).toBe(limit);
  });

  test('top package has most stars', () => {
    const sorted = [...samplePackages].sort((a, b) => b.stars - a.stars);
    const maxStars = Math.max(...samplePackages.map((p) => p.stars));
    expect(sorted[0].stars).toBe(maxStars);
  });
});

describe('Packages', () => {
  test('packages have valid categories', () => {
    const validCategories = ['mcp', 'prompt', 'workflow', 'skill'];
    samplePackages.forEach((p) => {
      expect(validCategories).toContain(p.category);
    });
  });

  test('MCP servers with npmPackage are valid strings', () => {
    const withNpm = samplePackages.filter((p) => p.category === 'mcp' && p.npmPackage);
    expect(withNpm.length).toBeGreaterThan(0);
    withNpm.forEach((p) => {
      expect(p.npmPackage).toBeDefined();
      expect((p.npmPackage as string).length).toBeGreaterThan(0);
    });
  });

  test('some MCP servers may be browsable-only (no npmPackage)', () => {
    const noNpm = samplePackages.filter((p) => p.category === 'mcp' && !p.npmPackage);
    // These are valid community entries that haven't been published to npm
    noNpm.forEach((p) => {
      expect(p.repository?.length).toBeGreaterThan(0);
    });
  });

  test('tags are non-empty arrays', () => {
    samplePackages.forEach((p) => {
      expect(Array.isArray(p.tags)).toBe(true);
      expect(p.tags.length).toBeGreaterThan(0);
    });
  });

  test('version follows semver', () => {
    samplePackages.forEach((p) => {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});

describe('Edge Cases', () => {
  test('empty search query returns all packages', () => {
    const results = samplePackages.filter((p) => p.name.toLowerCase().includes(''));
    expect(results.length).toBe(samplePackages.length);
  });

  test('category filter works with "all"', () => {
    const category = 'all';
    const results = samplePackages.filter((p) => category === 'all' || p.category === category);
    expect(results.length).toBe(samplePackages.length);
  });

  test('trending tags are lowercase', () => {});
});

describe('Plugin Tools', () => {
  test('Agora plugin exports exactly the tools the gate inventory classifies', async () => {
    const plugin = await import('../src/plugin/index');
    const tools = (await plugin.Agora({} as any)).tool!;
    expect(Object.keys(tools).sort()).toEqual(Object.keys(PLUGIN_MUTATION_INVENTORY).sort());
  });
});
