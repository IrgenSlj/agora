// Live Sigstore verification of npm provenance bundles — the concrete
// `NpmProvenanceVerifier` that `provenance.ts` declares a seam for.
//
// Without this, verifyNpmProvenance() parses an attestation and honestly
// reports `verification-skipped`: it can read what a bundle *claims* but
// cannot say whether the signature is real. This module answers that.
//
// Two checks, and the second is the one that matters:
//
//   1. Cryptographic verification of the DSSE bundle against Sigstore's
//      trusted root — Fulcio's certificate chain, the certificate transparency
//      log, and Rekor's inclusion proof. `sigstore.verify()` throws if any of
//      that fails.
//
//   2. **Identity binding.** A signature being valid only means *somebody*
//      signed it inside GitHub Actions. Anyone can run a workflow. So the
//      signing certificate's SAN must also point at the same repository the
//      provenance statement claims to come from — otherwise an attacker
//      publishes `evil-pkg`, signs it with their own perfectly valid workflow,
//      and a check that stopped at step 1 would call it verified.

import { verify as sigstoreVerify } from 'sigstore';
import type { NpmProvenanceContext, NpmProvenanceVerifier } from './provenance.js';

/** GitHub Actions' OIDC issuer — the only issuer npm provenance is minted by. */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

export interface SigstoreVerifierOptions {
  /** Where the TUF trusted-root cache lives. Defaults to sigstore's own location. */
  tufCachePath?: string;
  /** Never reach the network for the trusted root; use the cache as-is. */
  offline?: boolean;
  /** Seam for tests: replaces the real `sigstore.verify`. */
  verifyBundle?: typeof sigstoreVerify;
}

interface CertificateIdentityLike {
  subjectAlternativeName?: string;
}

/**
 * `https://github.com/owner/repo/.github/workflows/x.yml@refs/heads/main`
 * → `https://github.com/owner/repo`
 *
 * The SAN on a GitHub Actions signing certificate is the workflow URI, so the
 * repository is its first three path segments.
 */
export function repositoryFromSan(san: string | undefined): string | undefined {
  if (!san) return undefined;
  const withoutRef = san.split('@')[0] ?? san;
  const match = withoutRef.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)/i);
  return match?.[1]?.toLowerCase();
}

function normalizeRepo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** The repository the provenance statement itself claims to be built from. */
export function declaredRepository(statement: Record<string, unknown>): string | undefined {
  const predicate = statement.predicate;
  if (typeof predicate !== 'object' || predicate === null) return undefined;
  const record = predicate as Record<string, unknown>;

  const buildDefinition = record.buildDefinition as Record<string, unknown> | undefined;
  const external = buildDefinition?.externalParameters as Record<string, unknown> | undefined;
  const workflow = external?.workflow as Record<string, unknown> | undefined;
  const fromWorkflow = normalizeRepo(
    typeof workflow?.repository === 'string' ? workflow.repository : undefined
  );
  if (fromWorkflow) return fromWorkflow;

  const invocation = record.invocation as Record<string, unknown> | undefined;
  const configSource = invocation?.configSource as Record<string, unknown> | undefined;
  const uri = typeof configSource?.uri === 'string' ? configSource.uri : undefined;
  return repositoryFromSan(normalizeRepo(uri));
}

export class ProvenanceIdentityMismatch extends Error {
  constructor(
    readonly declared: string,
    readonly signed: string
  ) {
    super(`provenance claims ${declared} but the signing identity is ${signed}`);
    this.name = 'ProvenanceIdentityMismatch';
  }
}

/**
 * The verifier itself could not run — a TUF trusted-root problem, a network
 * failure fetching it, or a runtime whose crypto the TUF stack cannot use.
 *
 * This is emphatically NOT the same as "the signature is invalid", and keeping
 * them apart is a safety property, not a nicety: an unavailable verifier that
 * reported `verification-failed` would mark every correctly-signed package in
 * the ecosystem as a red flag and block it at the gate.
 *
 * Concretely: under Bun, tuf-js fails to verify the Sigstore root's own
 * signatures ("root was signed by 0/3 keys") while the identical bundle
 * verifies cleanly under Node. Agora ships as a Node CLI, so users are
 * unaffected — but the distinction is what keeps a runtime quirk from
 * masquerading as a supply-chain attack.
 */
export class ProvenanceVerifierUnavailable extends Error {
  constructor(readonly detail: string) {
    super(`provenance could not be checked: ${detail}`);
    this.name = 'ProvenanceVerifierUnavailable';
  }
}

/** TUF/trusted-root problems, which say nothing about the artifact itself. */
function isInfrastructureFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TUFError' || err.name === 'TUFDownloadError') return true;
  return /\broot\b.*\bsigned by\b|trusted root|tuf|metadata|expired metadata/i.test(err.message);
}

/**
 * Builds the verifier `verifyNpmProvenance({ verifier })` expects.
 *
 * Throwing (rather than returning `{ verified: false }`) is deliberate:
 * provenance.ts already maps a thrown verifier to a `verification-failed`
 * predicate, and it keeps "we could not check" from being confused with "we
 * checked and it was fine".
 */
export function createSigstoreVerifier(
  options: SigstoreVerifierOptions = {}
): NpmProvenanceVerifier {
  const verifyBundle = options.verifyBundle ?? sigstoreVerify;

  return async (context: NpmProvenanceContext) => {
    // sigstore.verify() throws on any cryptographic failure: bad signature,
    // untrusted chain, missing/invalid Rekor inclusion proof, expired cert
    // outside its validity window. It also throws when the TUF trusted root
    // cannot be loaded at all — which is a completely different claim, so the
    // two are separated here before anything downstream sees them.
    let signer: Awaited<ReturnType<typeof sigstoreVerify>>;
    try {
      signer = await verifyBundle(context.bundle as never, {
        certificateIssuer: GITHUB_OIDC_ISSUER,
        ...(options.tufCachePath ? { tufCachePath: options.tufCachePath } : {}),
        ...(options.offline ? { tufForceCache: true } : {})
      });
    } catch (err) {
      if (isInfrastructureFailure(err)) {
        throw new ProvenanceVerifierUnavailable(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }

    const identity = (signer as { identity?: CertificateIdentityLike }).identity;
    const san = identity?.subjectAlternativeName;
    const signedRepo = repositoryFromSan(san);
    const claimedRepo = declaredRepository(context.statement);

    // Both sides must be present AND agree. A missing SAN is not a pass: it
    // means we cannot bind this signature to the claimed source at all.
    if (!signedRepo || !claimedRepo || signedRepo !== claimedRepo) {
      throw new ProvenanceIdentityMismatch(claimedRepo ?? 'unknown', signedRepo ?? 'unknown');
    }

    return {
      verified: true,
      source_repo: claimedRepo,
      ...(san ? { builder: san } : {})
    };
  };
}
