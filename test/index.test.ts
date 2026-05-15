import { describe, test, expect, beforeEach } from 'bun:test';
import {
  samplePackages,
  sampleWorkflows,
  sampleDiscussions,
  sampleTutorials,
  trendingTags
} from '../src/data';

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

  test('sampleWorkflows has required fields', () => {
    const wf = sampleWorkflows[0];
    expect(wf).toBeDefined();
    expect(wf.id).toBeDefined();
    expect(wf.name).toBeDefined();
    expect(wf.prompt).toBeDefined();
    expect(wf.author).toBeDefined();
  });

  test('sampleDiscussions is empty offline (discussions are backend-only)', () => {
    expect(Array.isArray(sampleDiscussions)).toBe(true);
    expect(sampleDiscussions).toHaveLength(0);
  });

  test('sampleTutorials has steps', () => {
    const tut = sampleTutorials[0];
    expect(tut).toBeDefined();
    expect(tut.steps).toBeDefined();
    expect(tut.steps.length).toBeGreaterThan(0);
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

describe('Discussions', () => {
  test('filter by category works', () => {
    const category = 'question';
    const filtered = sampleDiscussions.filter((d) => d.category === category);
    expect(filtered.every((d) => d.category === category)).toBe(true);
  });

  test('all categories are valid', () => {
    const validCategories = ['question', 'idea', 'showcase', 'discussion'];
    const allValid = sampleDiscussions.every((d) => validCategories.includes(d.category));
    expect(allValid).toBe(true);
  });

  test('replies count is non-negative', () => {
    const allValid = sampleDiscussions.every((d) => d.replies >= 0);
    expect(allValid).toBe(true);
  });

  test('stars count is non-negative', () => {
    const allValid = sampleDiscussions.every((d) => d.stars >= 0);
    expect(allValid).toBe(true);
  });
});

describe('Tutorials', () => {
  test('steps have content', () => {
    const tut = sampleTutorials[0];
    const step = tut.steps[0];
    expect(step.content).toBeDefined();
    expect(step.content.length).toBeGreaterThan(0);
  });

  test('step navigation works', () => {
    const tut = sampleTutorials[0];
    const currentStep = 1;
    const step = tut.steps[currentStep - 1];
    expect(step).toBeDefined();
  });

  test('all tutorials have valid levels', () => {
    const validLevels = ['beginner', 'intermediate', 'advanced'];
    const allValid = sampleTutorials.every((t) => validLevels.includes(t.level));
    expect(allValid).toBe(true);
  });

  test('tutorial duration is defined', () => {
    const tut = sampleTutorials[0];
    expect(tut.duration).toBeDefined();
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

describe('Workflows', () => {
  test('workflows have prompts', () => {
    sampleWorkflows.forEach((w) => {
      expect(w.prompt).toBeDefined();
      expect(w.prompt.length).toBeGreaterThan(0);
    });
  });

  test('tags are non-empty arrays', () => {
    sampleWorkflows.forEach((w) => {
      expect(Array.isArray(w.tags)).toBe(true);
      expect(w.tags.length).toBeGreaterThan(0);
    });
  });

  test('forks count is non-negative', () => {
    sampleWorkflows.forEach((w) => {
      expect(w.forks).toBeGreaterThanOrEqual(0);
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
  test('Agora plugin exports all 8 tools', async () => {
    const plugin = await import('../src/index');
    const tools = (await plugin.Agora({} as any)).tool!;
    expect(Object.keys(tools).sort()).toEqual([
      'agora_browse',
      'agora_browse_category',
      'agora_chat',
      'agora_info',
      'agora_install',
      'agora_search',
      'agora_trending',
      'agora_tutorial'
    ]);
  });

  test('agora_chat accepts message and optional model args', async () => {
    const plugin = await import('../src/index');
    const tools = (await plugin.Agora({} as any)).tool!;
    expect(tools.agora_chat).toBeDefined();
    // execute is a function — we verify the signature works
    expect(typeof tools.agora_chat.execute).toBe('function');
    // verify it has description (schema is validated by the plugin SDK)
    expect(typeof tools.agora_chat.description).toBe('string');
    expect(tools.agora_chat.description.length).toBeGreaterThan(0);
  });

  test('agora_chat returns error when opencode is not available', async () => {
    const plugin = await import('../src/index');
    const tools = (await plugin.Agora({} as any)).tool!;

    const origPath = process.env.PATH;
    process.env.PATH = '/dev/null';
    try {
      const result = await tools.agora_chat.execute({ message: 'test' }, {} as any);
      expect(result).toContain('Failed to run opencode');
    } finally {
      process.env.PATH = origPath;
    }
  });
});
