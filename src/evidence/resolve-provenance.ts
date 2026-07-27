// Joins the two halves of the provenance plane: `scan.ts` wants a
// `(npmPackage) => evidence` function, `provenance.ts` wants a purl and a
// verifier. This is the only place that knows about both.
//
// Kept out of scan.ts on purpose — importing it there would drag the whole
// Sigstore dependency tree into every code path that scans anything, and would
// make the hermetic scan tests reach for Fulcio and Rekor.

import type { FetchLike } from '../fetch.js';
import { buildPurl } from '../model/purl.js';
import type { ProvenanceEvidenceSummary } from '../scan.js';
import { verifyNpmProvenance } from './provenance.js';
import { createSigstoreVerifier, ProvenanceVerifierUnavailable } from './sigstore.js';

/**
 * Builds the purl for an npm package, splitting a scoped name into its
 * namespace so `buildPurl` can encode it per the purl spec.
 *
 * This matters more than it looks. npm publishes attestations whose subject is
 * `pkg:npm/%40scope/name@version` — the `@` percent-encoded. Concatenating
 * `pkg:npm/${name}@${version}` instead yields `pkg:npm/@scope/name@version`,
 * which fails the subject match inside verifyNpmProvenance and comes back as
 * `verification-failed` — i.e. every scoped package, which is most MCP servers,
 * would have been reported as a supply-chain red flag by a string bug.
 */
export function purlForNpmPackage(npmPackage: string, version: string): string {
  const scoped = npmPackage.startsWith('@');
  const slash = npmPackage.indexOf('/');
  if (scoped && slash > 0) {
    return buildPurl({
      type: 'npm',
      namespace: npmPackage.slice(0, slash),
      name: npmPackage.slice(slash + 1),
      version
    });
  }
  return buildPurl({ type: 'npm', name: npmPackage, version });
}

export interface ProvenanceResolverOptions {
  fetcher?: FetchLike;
  offline?: boolean;
  /** TUF trusted-root cache location; defaults to sigstore's own. */
  tufCachePath?: string;
}

/**
 * Resolves an npm package name to a provenance verdict, with live Sigstore
 * verification wired in.
 *
 * Version resolution: the npm attestation endpoint is version-specific, so we
 * ask the registry which version `latest` currently points at. A failure here
 * is reported as a network error rather than as "no provenance" — not knowing
 * is not the same as knowing there is none.
 */
export function createProvenanceResolver(
  options: ProvenanceResolverOptions = {}
): (npmPackage: string) => Promise<ProvenanceEvidenceSummary | null> {
  const verifier = createSigstoreVerifier({
    offline: options.offline,
    ...(options.tufCachePath ? { tufCachePath: options.tufCachePath } : {})
  });

  return async (npmPackage: string) => {
    if (options.offline) return { verified: false, reason: 'network-error' };

    const fetcher = options.fetcher ?? globalThis.fetch;
    let version: string;
    try {
      const encoded = encodeURIComponent(npmPackage).replace('%40', '@').replace('%2F', '/');
      const res = await fetcher(`https://registry.npmjs.org/${encoded}/latest`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return { verified: false, reason: 'network-error' };
      const json = (await res.json()) as { version?: string };
      if (!json.version) return { verified: false, reason: 'network-error' };
      version = json.version;
    } catch {
      return { verified: false, reason: 'network-error' };
    }

    // An unavailable verifier must not be reported as a failed verification —
    // see ProvenanceVerifierUnavailable. Wrapping here (rather than letting
    // provenance.ts flatten every throw to `verification-failed`) is what keeps
    // "we could not check" out of the red-flag column.
    let unavailable = false;
    const guardedVerifier: typeof verifier = async (context) => {
      try {
        return await verifier(context);
      } catch (err) {
        if (err instanceof ProvenanceVerifierUnavailable) unavailable = true;
        throw err;
      }
    };

    const evidence = await verifyNpmProvenance(purlForNpmPackage(npmPackage, version), {
      fetcher: options.fetcher,
      verifier: guardedVerifier
    });

    if (unavailable) {
      return { verified: false, reason: 'verification-skipped' };
    }

    return {
      verified: evidence.predicate.verified,
      reason: evidence.predicate.reason,
      source_repo: evidence.predicate.source_repo
    };
  };
}
