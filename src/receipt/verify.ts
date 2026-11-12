// Verifying a receipt read from git notes.
//
// Valid means: the envelope and statement are well formed, the subject is this
// commit, the predicate matches the schema, the policy hash matches the
// commit's agora.cedar, and any signer level the receipt claims is backed by a
// signature from a key the repository trusts. A receipt that claims more than
// it can prove is invalid, not downgraded: the claim itself is the defect.

import { verify as verifySignature } from 'node:crypto';
import { preAuthEncoding } from '../evidence/dsse.js';
import { DSSEEnvelope, InTotoStatement } from '../model/attestation.js';
import { type BundleVerifier, type TrustedRunner, verifyRunnerBundle } from '../signer/runner.js';
import type { TrustedKey } from './keys.js';
import { RECEIPT_PREDICATE_TYPE, ReceiptPredicate, type SignerLevel } from './predicate.js';

export interface ReceiptVerdict {
  valid: boolean;
  /** The signer level actually proven: never more than the receipt claims. */
  level: SignerLevel;
  problems: string[];
  predicate?: ReceiptPredicate;
  /** The runner identity that signed, for runner-oidc receipts. */
  runner?: string;
}

export interface VerifyContext {
  policySha256: string | null;
  trusted: readonly TrustedKey[];
  /** Workflow identities trusted to sign runner-oidc receipts. */
  runners?: readonly TrustedRunner[];
  /** Injected in tests; the default checks against Sigstore's public trust root. */
  verifyBundle?: BundleVerifier;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A note holds either a DSSE envelope (unsigned or locally signed) or, for a
 * runner-signed receipt, a Sigstore bundle that wraps one.
 */
function unwrap(note: unknown): { envelope: unknown; bundle?: unknown } {
  if (
    isObj(note) &&
    typeof note.mediaType === 'string' &&
    note.mediaType.startsWith('application/vnd.dev.sigstore.bundle') &&
    isObj(note.dsseEnvelope)
  ) {
    return { envelope: note.dsseEnvelope, bundle: note };
  }
  return { envelope: note };
}

export async function verifyReceipt(
  note: string,
  sha: string,
  ctx: VerifyContext
): Promise<ReceiptVerdict> {
  const invalid = (problem: string, predicate?: ReceiptPredicate): ReceiptVerdict => ({
    valid: false,
    level: 'none',
    problems: [problem],
    ...(predicate ? { predicate } : {})
  });

  let envelope: DSSEEnvelope;
  let bundle: unknown;
  try {
    const unwrapped = unwrap(JSON.parse(note));
    bundle = unwrapped.bundle;
    const parsed = DSSEEnvelope.safeParse(unwrapped.envelope);
    if (!parsed.success) return invalid('note is not a DSSE envelope');
    envelope = parsed.data;
  } catch {
    return invalid('note is not JSON');
  }

  const payload = Buffer.from(envelope.payload, 'base64');
  let stmt: InTotoStatement;
  try {
    const parsed = InTotoStatement.safeParse(JSON.parse(payload.toString('utf8')));
    if (!parsed.success) return invalid('payload is not an in-toto statement');
    stmt = parsed.data;
  } catch {
    return invalid('payload is not JSON');
  }

  if (stmt.predicateType !== RECEIPT_PREDICATE_TYPE) return invalid('not an Agora receipt');
  const subject = stmt.subject.find((s) => s.name === 'git:commit');
  if (subject?.digest.gitCommit !== sha) return invalid('receipt is for a different commit');

  const pred = ReceiptPredicate.safeParse(stmt.predicate);
  if (!pred.success) return invalid('predicate does not match the receipt schema');
  const predicate = pred.data;

  const problems: string[] = [];
  if (predicate.policy_sha256 !== ctx.policySha256) {
    problems.push(
      ctx.policySha256
        ? "receipt's policy hash does not match this commit's agora.cedar"
        : 'receipt names a policy, but this commit has no agora.cedar'
    );
  }

  const pae = preAuthEncoding(envelope.payloadType, payload);
  const signedBy = envelope.signatures.filter((s) => {
    const key = ctx.trusted.find((k) => k.keyid === s.keyid);
    if (!key) return false;
    try {
      return verifySignature(null, pae, key.key, Buffer.from(s.sig, 'base64'));
    } catch {
      return false;
    }
  });

  let level: SignerLevel = 'none';
  let runner: string | undefined;
  if (predicate.signer === 'local-keychain') {
    if (signedBy.length) level = 'local-keychain';
    else
      problems.push(
        'claims a local-keychain signature, but no signature verifies against a trusted key'
      );
  } else if (predicate.signer === 'runner-oidc') {
    if (!bundle) problems.push('claims a runner signature, but carries no Sigstore bundle');
    else {
      const r = await verifyRunnerBundle(bundle, ctx.runners ?? [], ctx.verifyBundle);
      if ('runner' in r) {
        level = 'runner-oidc';
        runner = r.runner.identity;
      } else problems.push(r.problem);
    }
  }

  return {
    valid: problems.length === 0,
    level: problems.length ? 'none' : level,
    problems,
    predicate,
    ...(runner && !problems.length ? { runner } : {})
  };
}
