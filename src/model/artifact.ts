import { z } from 'zod';

/**
 * Artifact kind — two first-class artifact kinds (D8).
 * Source: AGORA_BRIEF_v2.md §5.1
 */
export const ArtifactKind = z.enum(['mcp-server', 'agent-skill']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/**
 * Source adapter identifier — which upstream registry knows this artifact.
 * Source: AGORA_BRIEF_v2.md §5.1
 */
export const SourceAdapter = z.enum(['official', 'glama', 'pulsemcp', 'skills-github', 'manual']);
export type SourceAdapter = z.infer<typeof SourceAdapter>;

/**
 * Source reference — an upstream registry that knows about an artifact.
 * Source: AGORA_BRIEF_v2.md §5.1
 */
export const ArtifactSource = z.object({
  adapter: SourceAdapter,
  upstream_id: z.string().describe('Identifier in the upstream registry'),
  url: z.string().url().describe('URL of the artifact in the upstream registry'),
  first_seen: z
    .string()
    .datetime()
    .describe('ISO timestamp when this source first reported the artifact')
});
export type ArtifactSource = z.infer<typeof ArtifactSource>;

/**
 * Publisher information — namespace and verification status.
 * Source: AGORA_BRIEF_v2.md §5.1
 */
export const Publisher = z.object({
  namespace: z
    .string()
    .describe('e.g. reverse-DNS from official registry, npm scope, or github owner'),
  identity_verified: z
    .boolean()
    .describe('provenance chain ties publisher to source (D2: evidence over scores)')
});
export type Publisher = z.infer<typeof Publisher>;

/**
 * ArtifactRef — the primary identity of an artifact in Agora.
 * purl is the primary key everywhere (D16).
 * Source: AGORA_BRIEF_v2.md §5.1
 */
export const ArtifactRef = z.object({
  purl: z.string().describe('Package URL (purl) — primary key. e.g. pkg:npm/@org/server@1.2.3'),
  kind: ArtifactKind,
  display_name: z.string().describe('Human-readable name'),
  publisher: Publisher,
  sources: z.array(ArtifactSource).describe('Which upstream registries know this artifact')
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;
