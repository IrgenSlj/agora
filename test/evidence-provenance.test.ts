import { describe, expect, test } from 'vitest';
import {
  extractProvenanceVerification,
  npmAttestationsUrl,
  verifyNpmProvenance
} from '../src/evidence/provenance';
import type { FetchLike } from '../src/retry';

const PURL = 'pkg:npm/sigstore@4.1.0';

function bundleFor(statement: Record<string, unknown>, logIndex = '42'): unknown {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.1',
    verificationMaterial: {
      tlogEntries: [{ logIndex }]
    },
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      signatures: [{ keyid: 'test', sig: 'test' }]
    }
  };
}

function slsaStatement(purl = PURL): Record<string, unknown> {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: purl, digest: { sha512: 'abc123' } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            repository: 'https://github.com/sigstore/sigstore-js',
            ref: 'refs/heads/main',
            path: '.github/workflows/release.yml'
          }
        },
        resolvedDependencies: [
          {
            uri: 'git+https://github.com/sigstore/sigstore-js@refs/heads/main',
            digest: { gitCommit: 'c4ad6141eb947a20690837888e5d90d9a30b5af3' }
          }
        ]
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: {
          invocationId: 'https://github.com/sigstore/sigstore-js/actions/runs/20376538760'
        }
      }
    }
  };
}

function attestationResponse(statement = slsaStatement()): unknown {
  return {
    attestations: [
      {
        predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
        bundle: bundleFor({
          _type: 'https://in-toto.io/Statement/v0.1',
          subject: [{ name: PURL, digest: { sha512: 'abc123' } }],
          predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
          predicate: { name: 'sigstore', version: '4.1.0' }
        })
      },
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: bundleFor(statement, '10960848')
      }
    ]
  };
}

function jsonFetcher(status: number, body: unknown): FetchLike {
  return async () => new Response(JSON.stringify(body), { status });
}

describe('evidence/provenance', () => {
  test('builds npm attestation URLs for scoped and unscoped packages', () => {
    expect(npmAttestationsUrl('sigstore', '4.1.0')).toBe(
      'https://registry.npmjs.org/-/npm/v1/attestations/sigstore@4.1.0'
    );
    expect(npmAttestationsUrl('@scope/pkg', '1.2.3')).toBe(
      'https://registry.npmjs.org/-/npm/v1/attestations/@scope%2Fpkg@1.2.3'
    );
  });

  test('extracts SLSA builder, repository, commit, and Rekor index', () => {
    const statement = slsaStatement();
    const predicate = extractProvenanceVerification(
      statement,
      bundleFor(statement, '10960848'),
      true,
      'provenance-verified'
    );

    expect(predicate).toEqual({
      verified: true,
      builder: 'https://github.com/actions/runner/github-hosted',
      source_repo: 'https://github.com/sigstore/sigstore-js',
      commit: 'c4ad6141eb947a20690837888e5d90d9a30b5af3',
      reason: 'provenance-verified',
      rekor_log_index: 10960848
    });
  });

  test('returns verification-skipped when npm provenance exists but no verifier is supplied', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: jsonFetcher(200, attestationResponse())
    });

    expect(evidence).toMatchObject({
      purl: PURL,
      version: '4.1.0',
      predicateType: 'https://agora-hub.dev/attestations/provenance-verification/v1',
      predicate: {
        verified: false,
        reason: 'verification-skipped',
        source_repo: 'https://github.com/sigstore/sigstore-js',
        commit: 'c4ad6141eb947a20690837888e5d90d9a30b5af3'
      }
    });
  });

  test('marks provenance verified when an injected verifier accepts the bundle', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: jsonFetcher(200, attestationResponse()),
      verifier: async (context) => {
        expect(context.packageName).toBe('sigstore');
        expect(context.version).toBe('4.1.0');
        return { verified: true };
      }
    });

    expect(evidence.predicate.verified).toBe(true);
    expect(evidence.predicate.reason).toBe('provenance-verified');
  });

  test('returns no-provenance for a 404 attestation endpoint', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: jsonFetcher(404, { error: 'not_found' })
    });

    expect(evidence.predicate).toEqual({ verified: false, reason: 'no-provenance' });
  });

  test('fails verification when the signed subject does not match the requested purl', async () => {
    const evidence = await verifyNpmProvenance(PURL, {
      fetcher: jsonFetcher(200, attestationResponse(slsaStatement('pkg:npm/other@4.1.0')))
    });

    expect(evidence.predicate).toEqual({ verified: false, reason: 'verification-failed' });
  });
});
