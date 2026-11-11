import { describe, expect, it } from 'vitest';
import { decodeStatement, envelope, preAuthEncoding, statement } from '../src/evidence/dsse.js';

const subject = [{ name: 'git:commit', digest: { gitCommit: 'a'.repeat(40) } }];

describe('dsse', () => {
  it('refuses a statement without a digest', () => {
    expect(() => statement([{ name: 'x', digest: {} }], 'https://example.com/p/v1', {})).toThrow();
    expect(() => statement([], 'https://example.com/p/v1', {})).toThrow();
  });

  it('round-trips and is byte-stable regardless of key order', () => {
    const a = envelope(statement(subject, 'https://example.com/p/v1', { b: 1, a: 2 }));
    const b = envelope(statement(subject, 'https://example.com/p/v1', { a: 2, b: 1 }));
    expect(a.payload).toBe(b.payload);
    expect(a.signatures).toEqual([]);
    expect(decodeStatement(a).predicate).toEqual({ a: 2, b: 1 });
  });

  it('builds the DSSE v1 pre-authentication encoding', () => {
    const pae = preAuthEncoding('application/vnd.in-toto+json', Buffer.from('hello'));
    expect(pae.toString('utf8')).toBe('DSSEv1 28 application/vnd.in-toto+json 5 hello');
  });
});
