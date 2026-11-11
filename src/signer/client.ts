// Signing receipts with the key in the OS keystore.
//
// What `local-keychain` proves: the receipt was signed by a key that never
// existed as a file, so an agent confined by the host's sandbox, which cannot
// reach the keystore, could not have rewritten the log and re-signed it. An
// unsandboxed agent running as the same user may be able to ask the keystore
// itself; that is the limit of a local signer, and `runner-oidc` (phase 5)
// exists to remove the developer's machine from the trust base entirely.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { preAuthEncoding } from '../evidence/dsse.js';
import type { DSSEEnvelope } from '../model/attestation.js';
import { keyIdFor } from '../receipt/keys.js';
import type { SignerLevel } from '../receipt/predicate.js';
import { detectKeyStore, type KeyStore } from './keystore.js';

export interface SignerIdentity {
  keyid: string;
  /** SPKI DER, base64. */
  public_key: string;
}

export function identityOf(pkcs8Der: Buffer): SignerIdentity {
  const pub = createPublicKey(createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' }));
  const spki = pub.export({ format: 'der', type: 'spki' });
  return { keyid: keyIdFor(spki), public_key: spki.toString('base64') };
}

export function generateKey(): Buffer {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' });
}

/** Signs an envelope's payload, appending the signature. */
export function signWith(env: DSSEEnvelope, pkcs8Der: Buffer): DSSEEnvelope {
  const key = createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const pae = preAuthEncoding(env.payloadType, Buffer.from(env.payload, 'base64'));
  const sig = sign(null, pae, key).toString('base64');
  return { ...env, signatures: [...env.signatures, { keyid: identityOf(pkcs8Der).keyid, sig }] };
}

export async function signerAvailable(
  env: Record<string, string | undefined>,
  store: KeyStore | undefined = detectKeyStore(env)
): Promise<SignerLevel> {
  return store?.get() ? 'local-keychain' : 'none';
}

export async function signReceiptEnvelope(
  env: DSSEEnvelope,
  envVars: Record<string, string | undefined>,
  store: KeyStore | undefined = detectKeyStore(envVars)
): Promise<DSSEEnvelope> {
  const key = store?.get();
  if (!key) throw new Error('no signing key in the keystore; run `agora signer init`');
  return signWith(env, key);
}
