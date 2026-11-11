// Placeholder until the signer lands (phase 2, task 4): no signer, level none.

import type { DSSEEnvelope } from '../model/attestation.js';
import type { SignerLevel } from '../receipt/predicate.js';

export async function signerAvailable(
  _env: Record<string, string | undefined>
): Promise<SignerLevel> {
  return 'none';
}

export async function signReceiptEnvelope(
  env: DSSEEnvelope,
  _envVars: Record<string, string | undefined>
): Promise<DSSEEnvelope> {
  return env;
}
