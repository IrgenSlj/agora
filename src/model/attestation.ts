import { z } from 'zod';

// The attestation container Agora emits: an in-toto Statement inside a DSSE
// envelope. Receipts (docs/PLAN.md, phase 2) are one predicate type carried in
// this container; nothing here is specific to them.

/** The thing a statement is about, named and pinned by content digest. */
export const StatementSubject = z.object({
  name: z.string().describe('What the subject is, e.g. "git:commit"'),
  digest: z
    .record(z.string(), z.string())
    .describe('Algorithm → hex digest, e.g. gitCommit or sha256')
});
export type StatementSubject = z.infer<typeof StatementSubject>;

export const InTotoStatement = z.object({
  _type: z.literal('https://in-toto.io/Statement/v1'),
  subject: z.array(StatementSubject).min(1),
  predicateType: z.string().url(),
  predicate: z.record(z.string(), z.unknown())
});
export type InTotoStatement = z.infer<typeof InTotoStatement>;

/**
 * How strongly an envelope is signed. The receipt states its own strength, so a
 * reader never has to infer it from the shape of the signature list.
 */
export const SignerLevel = z.enum(['none', 'local-keychain', 'runner-oidc']);
export type SignerLevel = z.infer<typeof SignerLevel>;

export const DSSEEnvelope = z.object({
  payloadType: z.literal('application/vnd.in-toto+json'),
  payload: z.string().describe('Base64 of the canonical JSON statement'),
  signatures: z.array(z.object({ keyid: z.string(), sig: z.string() }))
});
export type DSSEEnvelope = z.infer<typeof DSSEEnvelope>;
