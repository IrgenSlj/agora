import { describe, expect, test } from 'vitest';
import { samplePackages, trendingTags } from '../src/data';

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

  test('trendingTags is non-empty', () => {
    expect(trendingTags.length).toBeGreaterThan(0);
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

  test('trending tags are lowercase', () => {
    trendingTags.forEach((tag) => {
      expect(tag).toBe(tag.toLowerCase());
    });
  });
});

describe('Plugin Tools', () => {
  test('Agora plugin exports all 10 tools', async () => {
    const plugin = await import('../src/plugin/index');
    const tools = (await plugin.Agora({} as any)).tool!;
    expect(Object.keys(tools).sort()).toEqual([
      'agora_acquire',
      'agora_browse',
      'agora_browse_category',
      'agora_chat',
      'agora_config',
      'agora_info',
      'agora_install',
      'agora_scan',
      'agora_search',
      'agora_today'
    ]);
  });

  test('agora_chat accepts message and optional model args', async () => {
    const plugin = await import('../src/plugin/index');
    const tools = (await plugin.Agora({} as any)).tool!;
    expect(tools.agora_chat).toBeDefined();
    // execute is a function — we verify the signature works
    expect(typeof tools.agora_chat.execute).toBe('function');
    // verify it has description (schema is validated by the plugin SDK)
    expect(typeof tools.agora_chat.description).toBe('string');
    expect(tools.agora_chat.description.length).toBeGreaterThan(0);
  });

  test('agora_chat prefers the OpenCode client when provided', async () => {
    const plugin = await import('../src/plugin/index');
    const promptCalls: Array<{ body: { model?: unknown } }> = [];
    const tools = (
      await plugin.Agora({
        client: {
          session: {
            prompt: async (input: { body: { model?: unknown } }) => {
              promptCalls.push(input);
              return { data: { parts: [{ type: 'text', text: 'sdk response' }] } };
            }
          }
        }
      } as any)
    ).tool!;

    const result = await tools.agora_chat.execute(
      { message: 'hello', model: 'anthropic/claude-test' },
      { sessionID: 'session-1', directory: '/tmp' } as any
    );
    expect(result).toBe('sdk response');
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].body.model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-test'
    });
  });

  test('agora_chat explains itself when no inference provider is installed', async () => {
    const plugin = await import('../src/plugin/index');
    const tools = (await plugin.Agora({} as any)).tool!;

    const origPath = process.env.PATH;
    process.env.PATH = '/dev/null';
    try {
      const result = await tools.agora_chat.execute({ message: 'test' }, {} as any);
      // Agora hosts no inference, so "nothing installed" must name every
      // option rather than assuming the user wanted one particular CLI.
      expect(result).toContain('No inference provider found');
      expect(result).toContain('opencode.ai');
      expect(result).toContain('claude-code');
    } finally {
      process.env.PATH = origPath;
    }
  });
});
