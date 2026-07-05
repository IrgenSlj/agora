/**
 * Unit tests for src/search/catalog-index.ts
 * Pure in-memory, no network, no filesystem.
 */
import { describe, expect, test } from 'bun:test';
import {
  tokenize,
  tokenizeQuery,
  buildIndex,
  searchIndex,
  STOPWORDS,
  SYNONYMS
} from '../src/search/catalog-index';
import type { IndexableItem } from '../src/search/catalog-index';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<IndexableItem> & { id: string }): IndexableItem {
  return {
    name: overrides.id,
    description: '',
    author: 'test',
    category: 'mcp',
    tags: [],
    ...overrides
  };
}

// ── tokenize ─────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  test('lowercases input', () => {
    expect(tokenize('GITHUB')).toEqual(['github']);
  });

  test('splits on punctuation and whitespace', () => {
    expect(tokenize('mcp-filesystem')).toContain('mcp');
    expect(tokenize('mcp-filesystem')).toContain('filesystem');
  });

  test('drops tokens shorter than 2 characters', () => {
    const result = tokenize('a b c go do');
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
    expect(result).not.toContain('c');
    // 'go' and 'do' are 2 chars but may be stopwords — 'go' is not a stopword
    expect(result).toContain('go');
  });

  test('drops stopwords', () => {
    const result = tokenize('the quick brown fox');
    expect(result).not.toContain('the');
    expect(result).toContain('quick');
    expect(result).toContain('brown');
    expect(result).toContain('fox');
  });

  test('strips intent words from natural-language queries', () => {
    // "find a tool that does X" → content tokens only
    const result = tokenize('find a tool that does postgres');
    expect(result).not.toContain('find');
    expect(result).not.toContain('tool');
    expect(result).not.toContain('that');
    expect(result).not.toContain('does');
    expect(result).not.toContain('a');
    expect(result).toContain('postgres');
  });

  test('"find a tool that talks to postgres" reduces to content terms', () => {
    const result = tokenize('find a tool that talks to postgres');
    // "talks" and "to" are in stopwords; intent words stripped; postgres kept
    expect(result).toContain('postgres');
    // Only content terms should remain
    for (const token of result) {
      expect(STOPWORDS.has(token)).toBe(false);
    }
  });

  test('is deterministic', () => {
    const a = tokenize('GitHub MCP server for files');
    const b = tokenize('GitHub MCP server for files');
    expect(a).toEqual(b);
  });

  test('empty string returns empty array', () => {
    expect(tokenize('')).toEqual([]);
  });

  test('string of only stopwords returns empty array', () => {
    expect(tokenize('find the a to')).toEqual([]);
  });
});

// ── tokenizeQuery (synonym expansion) ────────────────────────────────────────

describe('tokenizeQuery', () => {
  test('expands "db" to include "database"', () => {
    const result = tokenizeQuery('db');
    expect(result).toContain('database');
  });

  test('expands "k8s" to include "kubernetes"', () => {
    const result = tokenizeQuery('k8s');
    expect(result).toContain('kubernetes');
  });

  test('expands "postgres" to include "postgresql" and "database"', () => {
    const result = tokenizeQuery('postgres');
    expect(result).toContain('postgresql');
    expect(result).toContain('database');
  });

  test('expands "ts" to include "typescript"', () => {
    const result = tokenizeQuery('ts');
    expect(result).toContain('typescript');
  });

  test('expands "js" to include "javascript"', () => {
    const result = tokenizeQuery('js');
    expect(result).toContain('javascript');
  });

  test('expands "auth" to include "authentication"', () => {
    const result = tokenizeQuery('auth');
    expect(result).toContain('authentication');
  });

  test('result is deduplicated', () => {
    // "pg" expands to ["postgresql","database"] — no duplicates in final set
    const result = tokenizeQuery('pg database');
    const counts = new Map<string, number>();
    for (const t of result) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [, count] of counts) {
      expect(count).toBe(1);
    }
  });

  test('non-synonym token passes through unchanged', () => {
    const result = tokenizeQuery('filesystem');
    expect(result).toContain('filesystem');
  });
});

// ── buildIndex / searchIndex ─────────────────────────────────────────────────

describe('buildIndex and searchIndex', () => {
  test('empty items list builds a valid empty index', () => {
    const index = buildIndex([]);
    expect(index.N).toBe(0);
    expect(index.postings.size).toBe(0);
  });

  test('nonsense query returns empty array', () => {
    const items = [makeItem({ id: 'item-a', name: 'GitHub Tool', description: 'version control' })];
    const index = buildIndex(items);
    const results = searchIndex(index, 'zzz-nonexistent-xyzzy-impossible');
    expect(results).toEqual([]);
  });

  test('empty query returns empty array', () => {
    const items = [makeItem({ id: 'item-a', name: 'GitHub Tool' })];
    const index = buildIndex(items);
    expect(searchIndex(index, '')).toEqual([]);
    expect(searchIndex(index, '   ')).toEqual([]);
  });

  test('query with only stopwords returns empty array', () => {
    const items = [makeItem({ id: 'item-a', name: 'GitHub Tool' })];
    const index = buildIndex(items);
    expect(searchIndex(index, 'find the tool')).toEqual([]);
  });

  test('basic match returns the matching item', () => {
    const items = [
      makeItem({
        id: 'postgres-mcp',
        name: 'PostgreSQL MCP',
        description: 'SQL database access',
        tags: ['database', 'sql']
      }),
      makeItem({
        id: 'filesystem-mcp',
        name: 'Filesystem MCP',
        description: 'File operations',
        tags: ['files']
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('postgres-mcp');
  });

  test('items not matching the query are excluded', () => {
    const items = [
      makeItem({ id: 'postgres-mcp', name: 'PostgreSQL MCP', description: 'SQL database' }),
      makeItem({ id: 'filesystem-mcp', name: 'Filesystem MCP', description: 'File operations' })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('filesystem-mcp');
  });

  test('name field match outranks description-only match for same term', () => {
    // item-name has the query term in its name (weight ×3)
    // item-desc has it only in description (weight ×1)
    const items = [
      makeItem({ id: 'item-desc', name: 'Generic Tool', description: 'postgresql integration' }),
      makeItem({ id: 'item-name', name: 'postgresql connector', description: 'database tool' })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('item-name');
    expect(results[1].id).toBe('item-desc');
  });

  test('tags field match (×2) beats description-only (×1) for same term', () => {
    const items = [
      makeItem({ id: 'item-desc', name: 'Tool A', description: 'postgresql support' }),
      makeItem({
        id: 'item-tags',
        name: 'Tool B',
        description: 'database query',
        tags: ['postgresql']
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('item-tags');
  });

  test('BM25 monotonicity: item with term in name AND tags outscores name-only match', () => {
    const items = [
      makeItem({
        id: 'item-name-only',
        name: 'postgresql tool',
        description: 'generic stuff',
        tags: []
      }),
      makeItem({
        id: 'item-name-and-tags',
        name: 'postgresql connector',
        description: 'fast',
        tags: ['postgresql']
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('item-name-and-tags');
  });

  test('rarer term (lower df) outranks common term in scoring', () => {
    // "database" appears in both items; "postgresql" appears only in item-a.
    // A query for "postgresql" should rank item-a above item-b via IDF.
    const items = [
      makeItem({ id: 'item-a', name: 'postgresql database', description: 'postgresql sql' }),
      makeItem({ id: 'item-b', name: 'generic database', description: 'generic database access' })
    ];
    const index = buildIndex(items);
    // Query for the rare term
    const results = searchIndex(index, 'postgresql');
    // Only item-a should appear (item-b has no "postgresql")
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('item-a');
  });

  test('synonym expansion: "db" matches item with "database" in description', () => {
    const items = [
      makeItem({
        id: 'db-item',
        name: 'Data connector',
        description: 'database integration tool',
        tags: ['database']
      }),
      makeItem({
        id: 'other',
        name: 'File manager',
        description: 'file system operations',
        tags: ['files']
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'db');
    const ids = results.map((r) => r.id);
    expect(ids).toContain('db-item');
    expect(ids).not.toContain('other');
  });

  test('synonym expansion: "k8s" matches item with "kubernetes" in name', () => {
    const items = [
      makeItem({
        id: 'k8s-item',
        name: 'kubernetes orchestrator',
        description: 'cluster management',
        tags: ['kubernetes']
      }),
      makeItem({
        id: 'other',
        name: 'file manager',
        description: 'file operations',
        tags: ['files']
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'k8s');
    const ids = results.map((r) => r.id);
    expect(ids).toContain('k8s-item');
  });

  test('results are sorted by score descending', () => {
    const items = [
      makeItem({
        id: 'strong',
        name: 'postgresql database',
        description: 'postgresql access',
        tags: ['postgresql', 'database']
      }),
      makeItem({ id: 'weak', name: 'basic tool', description: 'postgresql mentions once' })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
    expect(results[0].id).toBe('strong');
  });

  test('all returned scores are positive', () => {
    const items = [
      makeItem({ id: 'item-a', name: 'github integration', description: 'version control' }),
      makeItem({ id: 'item-b', name: 'filesystem tool', description: 'file operations' })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'github');
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  test('multi-token query matches items containing any of the tokens', () => {
    const items = [
      makeItem({
        id: 'github-item',
        name: 'GitHub connector',
        description: 'pull requests and issues'
      }),
      makeItem({ id: 'fs-item', name: 'Filesystem tool', description: 'directory operations' }),
      makeItem({
        id: 'both',
        name: 'GitHub filesystem bridge',
        description: 'syncs github to filesystem'
      })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'github filesystem');
    const ids = results.map((r) => r.id);
    // All three match at least one term; "both" matches both → highest score
    expect(ids).toContain('github-item');
    expect(ids).toContain('fs-item');
    expect(ids).toContain('both');
    expect(results[0].id).toBe('both');
  });

  test('field weighting: id field (×2) beats description-only (×1)', () => {
    const items = [
      makeItem({
        id: 'description-only',
        name: 'Tool A',
        description: 'postgresql connector for databases'
      }),
      makeItem({ id: 'postgresql-server', name: 'Server', description: 'generic tool' })
    ];
    const index = buildIndex(items);
    const results = searchIndex(index, 'postgresql');
    expect(results.length).toBe(2);
    // id 'postgresql-server' has weight ×2; description-only has weight ×1
    expect(results[0].id).toBe('postgresql-server');
  });
});

// ── STOPWORDS and SYNONYMS constants ─────────────────────────────────────────

describe('STOPWORDS', () => {
  test('contains English function words', () => {
    expect(STOPWORDS.has('the')).toBe(true);
    expect(STOPWORDS.has('a')).toBe(true);
    expect(STOPWORDS.has('for')).toBe(true);
    expect(STOPWORDS.has('with')).toBe(true);
  });

  test('contains intent words', () => {
    expect(STOPWORDS.has('find')).toBe(true);
    expect(STOPWORDS.has('search')).toBe(true);
    expect(STOPWORDS.has('tool')).toBe(true);
    expect(STOPWORDS.has('help')).toBe(true);
    expect(STOPWORDS.has('need')).toBe(true);
  });
});

describe('SYNONYMS', () => {
  test('db maps to database', () => {
    expect(SYNONYMS['db']).toContain('database');
  });

  test('k8s maps to kubernetes', () => {
    expect(SYNONYMS['k8s']).toContain('kubernetes');
  });

  test('postgres maps to postgresql', () => {
    expect(SYNONYMS['postgres']).toContain('postgresql');
  });

  test('js maps to javascript', () => {
    expect(SYNONYMS['js']).toContain('javascript');
  });

  test('ts maps to typescript', () => {
    expect(SYNONYMS['ts']).toContain('typescript');
  });

  test('auth maps to authentication', () => {
    expect(SYNONYMS['auth']).toContain('authentication');
  });

  test('vcs maps to git', () => {
    expect(SYNONYMS['vcs']).toContain('git');
  });
});
