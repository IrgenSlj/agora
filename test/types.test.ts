import { describe, expect, test } from 'vitest';
import { samplePackages, sampleWorkflows } from '../src/data';
import type { Package, Review, Workflow } from '../src/types';

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

  test('Workflow type matches sample data', () => {
    const wf = sampleWorkflows[0];

    const typed: Workflow = {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      author: wf.author,
      prompt: wf.prompt,
      model: wf.model,
      tags: wf.tags,
      stars: wf.stars,
      forks: wf.forks,
      createdAt: wf.createdAt
    };

    expect(typed.id).toBeDefined();
    expect(typed.prompt).toBeDefined();
  });
});

describe('Type Validation', () => {
  test('Package category is valid', () => {
    samplePackages.forEach((pkg) => {
      const validCategories = ['mcp', 'prompt', 'workflow', 'skill'];
      expect(validCategories).toContain(pkg.category);
    });
  });

  test('Review rating is between 1 and 5', () => {
    const mockReview: Review = {
      id: 'rev-1',
      itemId: 'pkg-1',
      itemType: 'package',
      author: 'user1',
      rating: 5,
      content: 'Great!',
      createdAt: '2025-01-01'
    };

    expect(mockReview.rating).toBeGreaterThanOrEqual(1);
    expect(mockReview.rating).toBeLessThanOrEqual(5);
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

  test('Workflow can be converted to JSON', () => {
    const wf = sampleWorkflows[0];
    const json = JSON.stringify(wf);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe(wf.id);
    expect(parsed.prompt).toBe(wf.prompt);
  });
});
