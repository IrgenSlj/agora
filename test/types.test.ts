import { describe, expect, test } from 'vitest';
import { samplePackages } from '../src/data';
import type { Package } from '../src/types';

describe('TypeScript Types', () => {
  test('Package type matches sample data', () => {
    const pkg = samplePackages[0];

    const typed: Package = {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      author: pkg.author,
      version: pkg.version,
      category: pkg.category,
      tags: pkg.tags,
      stars: pkg.stars,
      installs: pkg.installs,
      repository: pkg.repository,
      npmPackage: pkg.npmPackage,
      createdAt: pkg.createdAt
    };

    expect(typed.id).toBeDefined();
    expect(typed.category).toBe('mcp');
  });
});

describe('Type Validation', () => {
  test('Package category is valid', () => {
    samplePackages.forEach((pkg) => {
      const validCategories = ['mcp', 'prompt', 'workflow', 'skill'];
      expect(validCategories).toContain(pkg.category);
    });
  });
});

describe('Type Compatibility', () => {
  test('Package can be converted to JSON', () => {
    const pkg = samplePackages[0];
    const json = JSON.stringify(pkg);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe(pkg.id);
    expect(parsed.name).toBe(pkg.name);
  });
});
