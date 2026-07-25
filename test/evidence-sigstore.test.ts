import { describe, expect, test } from 'vitest';
import type { NpmProvenanceContext } from '../src/evidence/provenance';
import { verifyNpmProvenance } from '../src/evidence/provenance';
import { purlForNpmPackage } from '../src/evidence/resolve-provenance';
import {
  createSigstoreVerifier,
  declaredRepository,
  GITHUB_OIDC_ISSUER,
  ProvenanceIdentityMismatch,
  ProvenanceVerifierUnavailable,
  repositoryFromSan
} from '../src/evidence/sigstore';
import type { FetchLike } from '../src/retry';
import type { ProvenanceEvidenceSummary } from '../src/scan';
import { scanItem } from '../src/scan';

const PURL = 'pkg:npm/sigstore@4.1.0';
const REPO = 'https://github.com/sigstore/sigstore-js';
const WORKFLOW_SAN = `${REPO}/.github/workflows/release.yml@refs/heads/main`;

function slsaStatement(repository = REPO): Record<string, unknown> {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: PURL, digest: { sha512: 'abc123' } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: { repository, ref: 'refs/heads/main', path: '.github/workflows/release.yml' }
        },
        resolvedDependencies: [
          {
            uri: `git+${repository}@refs/heads/main`,
            digest: { gitCommit: 'c4ad6141eb947a20690837888e5d90d9a30b5af3' }
          }
        ]
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner/github-hosted' } }
    }
  };
}

function contextFor(statement: Record<string, unknown>): NpmProvenanceContext {
  return {
    purl: PURL,
    packageName: 'sigstore',
    version: '4.1.0',
    attestationUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/sigstore@4.1.0',
    statement,
    bundle: { mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.3' }
  };
}

/** Stands in for sigstore.verify(), which we never call for real in tests. */
function fakeVerify(san: string | undefined) {
  return (async () => ({
    key: {} as never,
    identity: san ? { subjectAlternativeName: san } : undefined
  })) as never;
}

function throwingVerify(message: string) {
  return (async () => {
    throw new Error(message);
  }) as never;
}

describe('repositoryFromSan', () => {
  test('reduces a workflow SAN to its repository', () => {
    expect(repositoryFromSan(WORKFLOW_SAN)).toBe('https://github.com/sigstore/sigstore-js');
  });

  test('handles a SAN with no ref suffix', () => {
    expect(repositoryFromSan(`${REPO}/.github/workflows/release.yml`)).toBe(
      'https://github.com/sigstore/sigstore-js'
    );
  });

  test('returns undefined for a non-GitHub or absent SAN', () => {
    expect(repositoryFromSan(undefined)).toBeUndefined();
    expect(repositoryFromSan('https://gitlab.com/foo/bar')).toBeUndefined();
  });
});

describe('declaredRepository', () => {
  test('reads the workflow repository out of a SLSA statement', () => {
    expect(declaredRepository(slsaStatement())).toBe('https://github.com/sigstore/sigstore-js');
  });

  test('normalizes a git+ prefix and .git suffix', () => {
    const statement = slsaStatement('git+https://github.com/sigstore/sigstore-js.git');
    expect(declaredRepository(statement)).toBe('https://github.com/sigstore/sigstore-js');
  });

  test('returns undefined when the statement declares no source', () => {
    expect(declaredRepository({ predicate: {} })).toBeUndefined();
  });
});

describe('createSigstoreVerifier', () => {
  test('verifies when the signing identity matches the declared repository', async () => {
    const verifier = createSigstoreVerifier({ verifyBundle: fakeVerify(WORKFLOW_SAN) });
    const result = await verifier(contextFor(slsaStatement()));

    expect(result.verified).toBe(true);
    expect(result.source_repo).toBe('https://github.com/sigstore/sigstore-js');
    expect(result.builder).toBe(WORKFLOW_SAN);
  });

  test('REFUSES a valid signature from a different repository', async () => {
    // The attack identity binding exists to stop: the bundle is cryptographically
    // perfect and was genuinely signed inside GitHub Actions — just not by the
    // repository the package claims to come from.
    const verifier = createSigstoreVerifier({
      verifyBundle: fakeVerify('https://github.com/attacker/evil/.github/workflows/go.yml@main')
    });

    await expect(verifier(contextFor(slsaStatement()))).rejects.toBeInstanceOf(
      ProvenanceIdentityMismatch
    );
  });

  test('refuses when the certificate carries no subject alternative name', async () => {
    const verifier = createSigstoreVerifier({ verifyBundle: fakeVerify(undefined) });
    await expect(verifier(contextFor(slsaStatement()))).rejects.toBeInstanceOf(
      ProvenanceIdentityMismatch
    );
  });

  test('refuses when the statement declares no source repository', async () => {
    const verifier = createSigstoreVerifier({ verifyBundle: fakeVerify(WORKFLOW_SAN) });
    await expect(verifier(contextFor({ predicate: {} }))).rejects.toBeInstanceOf(
      ProvenanceIdentityMismatch
    );
  });

  test('propagates a cryptographic failure rather than swallowing it', async () => {
    const verifier = createSigstoreVerifier({
      verifyBundle: throwingVerify('invalid signature')
    });
    await expect(verifier(contextFor(slsaStatement()))).rejects.toThrow('invalid signature');
  });

  test('pins the GitHub Actions OIDC issuer', async () => {
    let seen: Record<string, unknown> | undefined;
    const verifier = createSigstoreVerifier({
      verifyBundle: (async (_bundle: unknown, opts: Record<string, unknown>) => {
        seen = opts;
        return { key: {} as never, identity: { subjectAlternativeName: WORKFLOW_SAN } };
      }) as never
    });

    await verifier(contextFor(slsaStatement()));
    expect(seen?.certificateIssuer).toBe(GITHUB_OIDC_ISSUER);
  });

  test('offline mode forces the cached trusted root', async () => {
    let seen: Record<string, unknown> | undefined;
    const verifier = createSigstoreVerifier({
      offline: true,
      tufCachePath: '/tmp/agora-tuf',
      verifyBundle: (async (_bundle: unknown, opts: Record<string, unknown>) => {
        seen = opts;
        return { key: {} as never, identity: { subjectAlternativeName: WORKFLOW_SAN } };
      }) as never
    });

    await verifier(contextFor(slsaStatement()));
    expect(seen?.tufForceCache).toBe(true);
    expect(seen?.tufCachePath).toBe('/tmp/agora-tuf');
  });
});

describe('verifyNpmProvenance with a live verifier wired in', () => {
  function attestationFetcher(statement: Record<string, unknown>): FetchLike {
    return async () =>
      new Response(
        JSON.stringify({
          attestations: [
            {
              predicateType: 'https://slsa.dev/provenance/v1',
              bundle: {
                verificationMaterial: { tlogEntries: [{ logIndex: '42' }] },
                dsseEnvelope: {
                  payloadType: 'application/vnd.in-toto+json',
                  payload: Buffer.from(JSON.stringify(statement)).toString('base64')
                }
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
  }

  test('reports provenance-verified end to end', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: attestationFetcher(slsaStatement()),
      verifier: createSigstoreVerifier({ verifyBundle: fakeVerify(WORKFLOW_SAN) })
    });

    expect(evidence.predicate.verified).toBe(true);
    expect(evidence.predicate.reason).toBe('provenance-verified');
    expect(evidence.predicate.rekor_log_index).toBe(42);
  });

  test('a mismatched identity lands as verification-failed, not verified', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: attestationFetcher(slsaStatement()),
      verifier: createSigstoreVerifier({
        verifyBundle: fakeVerify('https://github.com/attacker/evil/.github/workflows/go.yml@main')
      })
    });

    expect(evidence.predicate.verified).toBe(false);
    expect(evidence.predicate.reason).toBe('verification-failed');
  });
});

describe('scan gate — the registry_provenance check', () => {
  const item = {
    kind: 'package' as const,
    id: 'mcp-x',
    name: 'mcp-x',
    description: 'A server',
    author: 'someone',
    version: '1.0.0',
    category: 'mcp' as const,
    tags: [],
    stars: 0,
    installs: 0,
    createdAt: '2026-01-01T00:00:00Z',
    npmPackage: 'mcp-x'
  };

  async function checksFor(
    provenance: ((npmPackage: string) => Promise<ProvenanceEvidenceSummary | null>) | undefined
  ) {
    const result = await scanItem(item, {
      offline: false,
      fetcher: (async () =>
        new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 })) as FetchLike,
      provenance
    });
    return result.checks.find((c) => c.name === 'registry_provenance');
  }

  test('passes and names the signing repository when verified', async () => {
    const check = await checksFor(async () => ({
      verified: true,
      reason: 'provenance-verified' as const,
      source_repo: 'https://github.com/acme/mcp-x'
    }));
    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('acme/mcp-x');
  });

  test('fails when an attestation exists but does not verify', async () => {
    const check = await checksFor(async () => ({
      verified: false,
      reason: 'verification-failed' as const
    }));
    expect(check?.status).toBe('fail');
  });

  test('fails loudly on a publisher mismatch', async () => {
    const check = await checksFor(async () => ({
      verified: false,
      reason: 'publisher-mismatch' as const
    }));
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('different repository');
  });

  test('stays silent when the package simply has no provenance', async () => {
    // The common case by far. A warning here would fire on nearly every scan
    // and drain the meaning out of every other warning.
    const check = await checksFor(async () => ({
      verified: false,
      reason: 'no-provenance' as const
    }));
    expect(check).toBeUndefined();
  });

  test('stays silent when the network prevented checking', async () => {
    const check = await checksFor(async () => ({
      verified: false,
      reason: 'network-error' as const
    }));
    expect(check).toBeUndefined();
  });

  test('is skipped entirely when no resolver is wired', async () => {
    expect(await checksFor(undefined)).toBeUndefined();
  });
});

describe('purlForNpmPackage', () => {
  test('percent-encodes the scope, matching what npm puts in the attestation subject', () => {
    // Regression: a hand-built `pkg:npm/${name}@${version}` produced
    // `pkg:npm/@modelcontextprotocol/server-filesystem@x`, which does not match
    // the subject npm signs, so verifyNpmProvenance rejected it and every
    // scoped package — most MCP servers — came back `verification-failed`.
    expect(purlForNpmPackage('@modelcontextprotocol/server-filesystem', '2026.7.10')).toBe(
      'pkg:npm/%40modelcontextprotocol/server-filesystem@2026.7.10'
    );
  });

  test('leaves an unscoped package alone', () => {
    expect(purlForNpmPackage('sigstore', '4.1.0')).toBe('pkg:npm/sigstore@4.1.0');
  });
});

describe('an unavailable verifier is not a failed verification', () => {
  test('a TUF trusted-root error is classified as unavailable, not as tampering', async () => {
    const verifier = createSigstoreVerifier({
      verifyBundle: throwingVerify('root was signed by 0/3 keys')
    });
    await expect(verifier(contextFor(slsaStatement()))).rejects.toBeInstanceOf(
      ProvenanceVerifierUnavailable
    );
  });

  test('a genuine signature failure still propagates as a real failure', async () => {
    const verifier = createSigstoreVerifier({
      verifyBundle: throwingVerify('signature verification failed')
    });
    await expect(verifier(contextFor(slsaStatement()))).rejects.not.toBeInstanceOf(
      ProvenanceVerifierUnavailable
    );
  });
});
