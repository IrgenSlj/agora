// Runner signing: Sigstore keyless, with the CI runner's OIDC identity.
//
// On a GitHub Actions runner with `permissions: id-token: write`, the runner can
// ask GitHub for an identity token naming the workflow that is running. Sigstore
// (Fulcio) turns that into a short-lived certificate, the receipt is signed with
// a key that exists only for this signature, and the signature is logged in
// Rekor, the public transparency log. Verifying needs no key from anyone: the
// certificate says which workflow signed, and `.agora/signers.json` says which
// workflows this repository trusts.
//
// Uses the `sigstore` package (https://github.com/sigstore/sigstore-js, v5,
// read 2026-11-12): `attest()` builds a DSSE bundle with ambient GitHub Actions
// credentials, `verify()` checks the bundle against Sigstore's public trust
// root and a certificate issuer and identity. It is imported only when a
// receipt is runner-signed or verified, so no other command pays for it.

import type { DSSEEnvelope } from '../model/attestation.js';

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

export interface TrustedRunner {
  issuer: string;
  /** The certificate identity: a workflow URI with its ref, matched exactly. */
  identity: string;
  name?: string;
}

/** True on a GitHub Actions runner that may request an OIDC token. */
export function runnerAvailable(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.GITHUB_ACTIONS === 'true' &&
      env.ACTIONS_ID_TOKEN_REQUEST_URL &&
      env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  );
}

/** The identity this runner will sign as, for `agora signer trust --runner`. */
export function runnerIdentity(env: Record<string, string | undefined>): string | undefined {
  const ref = env.GITHUB_WORKFLOW_REF; // owner/repo/.github/workflows/x.yml@refs/heads/main
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  return ref ? `${server}/${ref}` : undefined;
}

/** Signs the envelope's statement; returns the Sigstore bundle as the note body. */
export async function signWithRunner(env: DSSEEnvelope): Promise<string> {
  const { attest } = await import('sigstore');
  const bundle = await attest(Buffer.from(env.payload, 'base64'), env.payloadType);
  return JSON.stringify(bundle);
}

export type BundleVerifier = (
  bundle: unknown,
  opts: { certificateIssuer: string; certificateIdentityURI: string }
) => Promise<unknown>;

const sigstoreVerify: BundleVerifier = async (bundle, opts) => {
  const { verify } = await import('sigstore');
  return verify(bundle as never, opts);
};

/** The trusted runner that signed this bundle, or the reason none did. */
export async function verifyRunnerBundle(
  bundle: unknown,
  runners: readonly TrustedRunner[],
  verify: BundleVerifier = sigstoreVerify
): Promise<{ runner: TrustedRunner } | { problem: string }> {
  if (!runners.length)
    return { problem: 'runner-signed, but .agora/signers.json trusts no runner identity' };
  let last = '';
  for (const runner of runners) {
    try {
      await verify(bundle, {
        certificateIssuer: runner.issuer,
        certificateIdentityURI: runner.identity
      });
      return { runner };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  return { problem: `no trusted runner signed this receipt (${last})` };
}
