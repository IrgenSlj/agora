import { z } from 'zod';

/**
 * Revocation severity — how severe the revocation is.
 * Source: AGORA_BRIEF_v2.md §5.6
 */
export const RevocationSeverity = z.enum(['critical', 'high', 'advisory']);
export type RevocationSeverity = z.infer<typeof RevocationSeverity>;

/**
 * Revocation entry — a single revoked artifact or pattern.
 * Source: AGORA_BRIEF_v2.md §5.6
 */
export const RevocationEntry = z
  .object({
    id: z.string().describe('Unique identifier (e.g. AGR-2026-0007)'),
    purl_pattern: z
      .string()
      .describe('Purl pattern to match (e.g. pkg:npm/postmark-mcp matches all versions)'),
    versions: z.string().optional().describe('Version range constraint (e.g. <=1.0.16)'),
    reason: z.string().describe('Reason for revocation (e.g. credential-exfiltration)'),
    severity: RevocationSeverity,
    refs: z.array(z.string().url()).describe('Reference URLs (advisories, discussions)'),
    added_at: z.string().datetime().describe('ISO timestamp when added to the feed')
  })
  .describe('A single revocation entry (AGORA_BRIEF_v2.md §5.6)');
export type RevocationEntry = z.infer<typeof RevocationEntry>;

/**
 * Revocation feed — signed JSON feed with monotonic version counter.
 * Source: AGORA_BRIEF_v2.md §5.6
 */
export const RevocationFeed = z
  .object({
    feed_version: z.number().int().describe('Strictly monotonic version counter'),
    generated_at: z.string().datetime().describe('ISO timestamp when the feed was generated'),
    key_id: z
      .string()
      .optional()
      .describe('Identifier of the signing key, when the feed is signed'),
    entries: z.array(RevocationEntry).describe('Revocation entries'),
    /**
     * Optional, because a feed's integrity does not have to come from a
     * signature. The bundled copy ships inside the npm package and is covered
     * by that package's provenance attestation; a fetched copy is constrained
     * by monotonic merge, which lets it add revocations but never remove one.
     * A signature is a third, stronger option — it is what would allow a
     * fetched feed to *withdraw* an entry — and remains supported.
     */
    signature: z
      .string()
      .optional()
      .describe('Base64-encoded ed25519 signature over JCS(feed sans signature)')
  })
  .describe('Revocation feed (AGORA_BRIEF_v2.md §5.6)');
export type RevocationFeed = z.infer<typeof RevocationFeed>;
