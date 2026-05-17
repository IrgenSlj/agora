import { describe, expect, test } from 'bun:test';
import { extractSnippet, validateSearchQuery } from '../../src/community/search.js';
import { BOARD_IDS } from '../../src/community/types.js';

// ── extractSnippet ─────────────────────────────────────────────────────────────

describe('extractSnippet', () => {
  test('match in middle wraps with brackets', () => {
    const content = 'This is some content with langchain inside it and more text after.';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toContain('[langchain]');
  });

  test('match at start of content', () => {
    const content = 'langchain is a framework for building LLM apps.';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toContain('[langchain]');
    // No leading ellipsis when match is at start
    expect(snippet.startsWith('…')).toBe(false);
  });

  test('match at end of content', () => {
    const content = 'I tried many frameworks and eventually settled on langchain';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toContain('[langchain]');
    // No trailing ellipsis when match ends at end of string
    expect(snippet.endsWith('…')).toBe(false);
  });

  test('match in middle adds leading ellipsis when content before match exceeds 60 chars', () => {
    const prefix = 'a'.repeat(61);
    const content = prefix + 'langchain' + ' more text';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet).toContain('[langchain]');
  });

  test('match in middle adds trailing ellipsis when content after match exceeds 60 chars', () => {
    const suffix = 'z'.repeat(61);
    const content = 'some text langchain' + suffix;
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('[langchain]');
  });

  test('no match falls back to first 120 chars without markers', () => {
    const content = 'a'.repeat(200);
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).not.toContain('[');
    expect(snippet).not.toContain(']');
    expect(snippet.endsWith('…')).toBe(true);
    // 120 chars + ellipsis character
    const withoutEllipsis = snippet.replace('…', '');
    expect(withoutEllipsis.length).toBe(120);
  });

  test('no match short content returns content without markers', () => {
    const content = 'short content';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toBe('short content');
    expect(snippet).not.toContain('[');
  });

  test('case-insensitive matching', () => {
    const content = 'Using LangChain in production';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toContain('[LangChain]');
  });

  test('empty content returns empty string', () => {
    expect(extractSnippet('', 'query')).toBe('');
  });

  test('preserves original casing in matched text', () => {
    const content = 'The LANGCHAIN framework';
    const snippet = extractSnippet(content, 'langchain');
    expect(snippet).toContain('[LANGCHAIN]');
  });
});

// ── validateSearchQuery ────────────────────────────────────────────────────────

describe('validateSearchQuery', () => {
  test('valid query passes', () => {
    expect(validateSearchQuery('langchain', undefined, BOARD_IDS)).toBeNull();
  });

  test('empty string is rejected', () => {
    const err = validateSearchQuery('', undefined, BOARD_IDS);
    expect(err).not.toBeNull();
    expect(err).toContain('2');
  });

  test('single char is rejected (too short)', () => {
    const err = validateSearchQuery('a', undefined, BOARD_IDS);
    expect(err).not.toBeNull();
    expect(err).toContain('2');
  });

  test('two chars is accepted', () => {
    expect(validateSearchQuery('ab', undefined, BOARD_IDS)).toBeNull();
  });

  test('query exceeding 200 chars is rejected', () => {
    const longQ = 'a'.repeat(201);
    const err = validateSearchQuery(longQ, undefined, BOARD_IDS);
    expect(err).not.toBeNull();
    expect(err).toContain('200');
  });

  test('exactly 200 chars is accepted', () => {
    const q = 'a'.repeat(200);
    expect(validateSearchQuery(q, undefined, BOARD_IDS)).toBeNull();
  });

  test('valid board restriction passes', () => {
    expect(validateSearchQuery('query', 'mcp', BOARD_IDS)).toBeNull();
  });

  test('invalid board is rejected', () => {
    const err = validateSearchQuery('query', 'invalid-board', BOARD_IDS);
    expect(err).not.toBeNull();
    expect(err).toContain('board');
  });

  test('empty string board is treated as no board (allowed)', () => {
    expect(validateSearchQuery('query', '', BOARD_IDS)).toBeNull();
  });

  test('non-string q is rejected', () => {
    const err = validateSearchQuery(42 as any, undefined, BOARD_IDS);
    expect(err).not.toBeNull();
  });
});
