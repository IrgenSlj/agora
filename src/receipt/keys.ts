// Signing keys a repository trusts, listed in `.agora/signers.json`.
//
// CI reads this file from the base of a pull request, never from its head:
// a pull request that adds its own key must not be able to vouch for itself.

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';

export const SIGNERS_FILE = '.agora/signers.json';

export const SignersFile = z.object({
  keys: z.array(
    z.object({
      keyid: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      /** SPKI DER, base64. */
      public_key: z.string(),
      name: z.string().max(128).optional()
    })
  )
});
export type SignersFile = z.infer<typeof SignersFile>;

export interface TrustedKey {
  keyid: string;
  key: KeyObject;
  name?: string;
}

export function keyIdFor(spkiDer: Buffer): string {
  return `sha256:${createHash('sha256').update(spkiDer).digest('hex')}`;
}

/** Parses a signers file. Keys whose id does not match their bytes are dropped. */
export function parseSigners(text: string | undefined): TrustedKey[] {
  if (!text) return [];
  const parsed = SignersFile.safeParse(JSON.parse(text));
  if (!parsed.success) return [];
  return parsed.data.keys.flatMap((k) => {
    const der = Buffer.from(k.public_key, 'base64');
    if (keyIdFor(der) !== k.keyid) return [];
    try {
      const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
      return [{ keyid: k.keyid, key, ...(k.name ? { name: k.name } : {}) }];
    } catch {
      return [];
    }
  });
}
