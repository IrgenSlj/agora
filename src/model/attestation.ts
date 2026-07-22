import { z } from 'zod';

/**
 * Attestation predicate types — the kind of evidence in an attestation.
 * Source: AGORA_BRIEF_v2.md §5.4
 */
export const PredicateType = z.enum([
  'https://agora-hub.dev/attestations/declared-manifest/v1',
  'https://agora-hub.dev/attestations/observed-profile/v1',
  'https://agora-hub.dev/attestations/provenance-verification/v1'
]);
export type PredicateType = z.infer<typeof PredicateType>;

/**
 * In-toto Statement subject — identifies the artifact being attested.
 * Source: AGORA_BRIEF_v2.md §5.4
 */
export const StatementSubject = z
  .object({
    name: z.string().describe('purl of the artifact'),
    digest: z
      .object({
        sha256: z.string().describe('SHA-256 hash of the artifact')
      })
      .describe('Content hash')
  })
  .describe('Subject of an in-toto Statement');
export type StatementSubject = z.infer<typeof StatementSubject>;

/**
 * In-toto Statement — the core attestation format.
 * Source: AGORA_BRIEF_v2.md §5.4
 */
export const InTotoStatement = z
  .object({
    _type: z.literal('https://in-toto.io/Statement/v1').describe('in-toto Statement type URI'),
    subject: z.array(StatementSubject).describe('Artifacts this statement attests about'),
    predicateType: PredicateType,
    predicate: z
      .record(z.string(), z.unknown())
      .describe('The attestation data (DeclaredManifest, ObservedProfile, or provenance result)')
  })
  .describe('In-toto Statement (AGORA_BRIEF_v2.md §5.4)');
export type InTotoStatement = z.infer<typeof InTotoStatement>;

/**
 * Signing tier — how the attestation was signed.
 * Source: AGORA_BRIEF_v2.md §5.4
 */
export const SigningTier = z.enum(['sigstore', 'local', 'none']);
export type SigningTier = z.infer<typeof SigningTier>;

/**
 * DSSE envelope — the attestation wrapper with signature.
 * Source: AGORA_BRIEF_v2.md §5.4
 */
export const DSSEEnvelope = z
  .object({
    payloadType: z
      .literal('application/vnd.in-toto+json')
      .describe('MIME type for in-toto Statements'),
    payload: z.string().describe('Base64-encoded InTotoStatement'),
    signatures: z
      .array(
        z.object({
          keyid: z.string().describe('Identifier of the signing key'),
          sig: z.string().describe('Base64-encoded signature')
        })
      )
      .describe('At least one signature'),
    tier: SigningTier.describe('How this envelope was signed')
  })
  .describe('DSSE envelope wrapping an in-toto Statement (AGORA_BRIEF_v2.md §5.4)');
export type DSSEEnvelope = z.infer<typeof DSSEEnvelope>;

/**
 * Provenance verification result — output of evidence/provenance.ts.
 * Source: AGORA_BRIEF_v2.md §6.1
 */
export const ProvenanceVerification = z
  .object({
    verified: z.boolean().describe('Whether provenance was successfully verified'),
    builder: z.string().optional().describe("Builder identity (e.g. 'github-actions')"),
    source_repo: z.string().optional().describe('Source repository URL'),
    commit: z.string().optional().describe('Git commit hash'),
    reason: z
      .enum([
        'provenance-verified',
        'no-provenance',
        'publisher-mismatch',
        'network-error',
        'verification-failed'
      ])
      .optional()
      .describe('Why verification succeeded or failed'),
    rekor_log_index: z.number().optional().describe('Rekor transparency log entry index')
  })
  .describe('Provenance verification result (AGORA_BRIEF_v2.md §6.1)');
export type ProvenanceVerification = z.infer<typeof ProvenanceVerification>;
