/**
 * Tests for src/api.ts — the legacy offline-fallback thin wrapper.
 *
 * When AGORA_API_URL is not set (the CI default), every function in api.ts
 * short-circuits to an empty result.  These tests cover that guaranteed
 * offline-fallback path without making any network requests.
 */
import { describe, expect, test } from 'bun:test';
import {
  createDiscussion,
  getDiscussions,
  getMcpPackage,
  getGitHubRepo,
  getPackage,
  getTrending,
  getUser,
  getWorkflow,
  searchNpmPackages,
  searchPackages,
  searchWorkflows
} from '../src/api';

// All tests run with no AGORA_API_URL set — every function must return
// the documented empty value without throwing.

describe('src/api.ts — offline-fallback path (AGORA_API_URL unset)', () => {
  test('searchPackages returns an empty array', async () => {
    const results = await searchPackages('mcp');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test('searchPackages with empty query returns an empty array', async () => {
    const results = await searchPackages('');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test('searchWorkflows returns an empty array', async () => {
    const results = await searchWorkflows('test');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test('searchWorkflows with empty query returns an empty array', async () => {
    const results = await searchWorkflows('');
    expect(Array.isArray(results)).toBe(true);
  });

  test('getTrending returns empty packages and workflows arrays', async () => {
    const result = await getTrending();
    expect(Array.isArray(result.packages)).toBe(true);
    expect(Array.isArray(result.workflows)).toBe(true);
    expect(result.packages.length).toBe(0);
    expect(result.workflows.length).toBe(0);
  });

  test('getDiscussions returns an empty array', async () => {
    const results = await getDiscussions();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test('getDiscussions with a category returns an empty array', async () => {
    const results = await getDiscussions('question');
    expect(Array.isArray(results)).toBe(true);
  });

  test('getPackage returns null', async () => {
    const result = await getPackage('mcp-github');
    expect(result).toBeNull();
  });

  test('getWorkflow returns null', async () => {
    const result = await getWorkflow('wf-tdd-cycle');
    expect(result).toBeNull();
  });

  test('getUser returns null', async () => {
    const result = await getUser('alice');
    expect(result).toBeNull();
  });

  test('searchNpmPackages returns empty npm and mcp arrays', async () => {
    const result = await searchNpmPackages('filesystem');
    expect(Array.isArray(result.npm)).toBe(true);
    expect(Array.isArray(result.mcp)).toBe(true);
    expect(result.npm.length).toBe(0);
    expect(result.mcp.length).toBe(0);
  });

  test('getMcpPackage returns null', async () => {
    const result = await getMcpPackage('@modelcontextprotocol/server-filesystem');
    expect(result).toBeNull();
  });

  test('getMcpPackage with invalid package name returns null', async () => {
    const result = await getMcpPackage('nonexistent-package-that-does-not-exist');
    expect(result).toBeNull();
  });

  test('getGitHubRepo returns null', async () => {
    const result = await getGitHubRepo('modelcontextprotocol', 'server-filesystem');
    expect(result).toBeNull();
  });

  test('getGitHubRepo with invalid owner/repo returns null', async () => {
    const result = await getGitHubRepo('invalid-user', 'nonexistent-repo');
    expect(result).toBeNull();
  });

  test('createDiscussion throws when AGORA_API_URL is unset', async () => {
    await expect(
      createDiscussion({ title: 'test', content: 'test', category: 'question' })
    ).rejects.toThrow();
  });
});
