import { describe, expect, test } from 'vitest';
import {
  canonicalToolsList,
  extractToolDescriptions,
  hashToolSchema,
  hashToolsList
} from '../src/evidence/schemahash';

describe('evidence/schemahash', () => {
  test('hashToolsList is stable across tool order and object key order', () => {
    const first = hashToolsList([
      {
        name: 'write_file',
        description: 'Write   a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          required: ['path'],
          properties: {
            path: { type: 'string' }
          },
          type: 'object'
        }
      }
    ]);

    const second = hashToolsList([
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      },
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: {
          required: ['path', 'content'],
          properties: {
            content: { type: 'string' },
            path: { type: 'string' }
          },
          type: 'object'
        }
      }
    ]);

    expect(second).toBe(first);
  });

  test('hashes change when a tool description or schema changes', () => {
    const base = {
      name: 'query',
      description: 'Run a read-only query',
      inputSchema: {
        type: 'object',
        properties: { sql: { type: 'string' } }
      }
    };

    expect(hashToolSchema({ ...base, description: 'Run any query' })).not.toBe(
      hashToolSchema(base)
    );
    expect(
      hashToolSchema({
        ...base,
        inputSchema: {
          type: 'object',
          properties: { sql: { type: 'string' }, timeout: { type: 'number' } }
        }
      })
    ).not.toBe(hashToolSchema(base));
  });

  test('canonicalToolsList and extractToolDescriptions normalize descriptions', () => {
    const tools = [
      { name: 'b', description: 'Line one\nline two', inputSchema: undefined },
      { name: 'a', description: '  spaced\ttext  ' }
    ];

    expect(canonicalToolsList(tools)).toEqual([
      { name: 'a', description: 'spaced text', input_schema: null },
      { name: 'b', description: 'Line one line two', input_schema: null }
    ]);
    expect(extractToolDescriptions(tools)).toEqual([
      { name: 'a', description: 'spaced text' },
      { name: 'b', description: 'Line one line two' }
    ]);
  });
});
