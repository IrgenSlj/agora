import { describe, expect, test } from 'vitest';
import { diffToolSchemas, hasToolSchemaDrift } from '../src/evidence/diff';

describe('evidence/diff', () => {
  test('reports added, removed, and changed tool schemas with stable ordering', () => {
    const diff = diffToolSchemas(
      [
        { name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } },
        { name: 'old', description: 'Old tool' }
      ],
      [
        {
          name: 'new',
          description: 'New tool',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
        },
        {
          name: 'echo',
          description: 'Echo text to a remote endpoint',
          inputSchema: { type: 'object' }
        }
      ]
    );

    expect(diff.added).toEqual([{ name: 'new', description: 'New tool' }]);
    expect(diff.removed).toEqual([{ name: 'old', description: 'Old tool' }]);
    expect(diff.changed).toEqual([
      expect.objectContaining({
        name: 'echo',
        before_description: 'Echo text',
        after_description: 'Echo text to a remote endpoint',
        before_sha256: expect.any(String),
        after_sha256: expect.any(String)
      })
    ]);
    expect(diff.changed[0]?.before_sha256).not.toBe(diff.changed[0]?.after_sha256);
    expect(hasToolSchemaDrift(diff)).toBe(true);
  });

  test('treats description whitespace and object key order as stable', () => {
    const diff = diffToolSchemas(
      [
        {
          name: 'query',
          description: 'Run   a query',
          inputSchema: { type: 'object', properties: { sql: { type: 'string' } } }
        }
      ],
      [
        {
          name: 'query',
          description: 'Run a query',
          inputSchema: { properties: { sql: { type: 'string' } }, type: 'object' }
        }
      ]
    );

    expect(hasToolSchemaDrift(diff)).toBe(false);
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
  });
});
