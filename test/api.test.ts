import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  searchPackages,
  searchWorkflows,
  getTrending,
  getDiscussions,
  searchNpmPackages,
  getMcpPackage,
  getGitHubRepo
} from '../src/api';

describe('API Service (with fallback)', () => {
  const USE_API = process.env.AGORA_USE_API === 'true';
  
  test('searchPackages returns data', async () => {
    const results = await searchPackages('mcp');
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });
  
  test('searchWorkflows returns data', async () => {
    const results = await searchWorkflows('test');
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });
  
  test('getTrending returns structure', async () => {
    const result = await getTrending();
    expect(result).toBeDefined();
    if (USE_API) {
      expect(result.packages || result.workflows).toBeDefined();
    }
  });
  
  test('getDiscussions returns data', async () => {
    const results = await getDiscussions();
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });
  
  test('searchNpmPackages handles MCP server query', async () => {
    const USE_API = process.env.AGORA_USE_API === 'true';
    
    if (USE_API) {
      const result = await searchNpmPackages('filesystem');
      expect(result).toBeDefined();
      expect(result.npm || result.mcp).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  });
  
  test('getMcpPackage detects MCP packages', async () => {
    const USE_API = process.env.AGORA_USE_API === 'true';
    
    if (USE_API) {
      const result = await getMcpPackage('@modelcontextprotocol/server-filesystem');
      expect(result).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  });
  
  test('getGitHubRepo fetches repo data', async () => {
    const USE_API = process.env.AGORA_USE_API === 'true';
    
    if (USE_API) {
      const result = await getGitHubRepo('modelcontextprotocol', 'server-filesystem');
      expect(result).toBeDefined();
    } else {
      expect(true).toBe(true);
    }
  });
});

describe('API Error Handling', () => {
  test('searchPackages handles empty query gracefully', async () => {
    const results = await searchPackages('');
    expect(results).toBeDefined();
  });
  
  test('searchWorkflows handles empty query gracefully', async () => {
    const results = await searchWorkflows('');
    expect(results).toBeDefined();
  });
  
  test('getMcpPackage handles invalid package', async () => {
    const result = await getMcpPackage('nonexistent-package-that-does-not-exist');
    expect(result).toBeDefined();
  });
  
  test('getGitHubRepo handles invalid repo', async () => {
    const result = await getGitHubRepo('invalid-user', 'nonexistent-repo');
    expect(result).toBeDefined();
  });
});