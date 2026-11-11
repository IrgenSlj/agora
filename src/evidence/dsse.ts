// Building and reading in-toto statements in DSSE envelopes.
//
// Two rules: a statement always names a content digest (no digest, no
// statement), and the payload is canonical JSON so the same evidence always
// produces the same bytes. Signing is a separate step that appends to
// `signatures`; an envelope with none is honest about being unsigned.

import type { DSSEEnvelope, InTotoStatement, StatementSubject } from '../model/attestation.js';
import { canonicalJson } from '../model/hash.js';

export const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export function statement(
  subject: readonly StatementSubject[],
  predicateType: string,
  predicate: Record<string, unknown>
): InTotoStatement {
  if (subject.length === 0 || subject.some((s) => Object.keys(s.digest).length === 0)) {
    throw new Error('A statement needs at least one subject, each with a digest.');
  }
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [...subject],
    predicateType,
    predicate
  };
}

/** Wraps a statement in an unsigned envelope. */
export function envelope(stmt: InTotoStatement): DSSEEnvelope {
  return {
    payloadType: PAYLOAD_TYPE,
    payload: Buffer.from(canonicalJson(stmt), 'utf8').toString('base64'),
    signatures: []
  };
}

/**
 * DSSE pre-authentication encoding: the exact bytes a signature covers.
 * https://github.com/secure-systems-lab/dsse/blob/master/protocol.md
 */
export function preAuthEncoding(payloadType: string, payload: Buffer): Buffer {
  const type = Buffer.from(payloadType, 'utf8');
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, 'utf8'),
    type,
    Buffer.from(` ${payload.length} `, 'utf8'),
    payload
  ]);
}

export function decodeStatement(env: DSSEEnvelope): InTotoStatement {
  return JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')) as InTotoStatement;
}
