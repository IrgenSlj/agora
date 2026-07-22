import { z } from 'zod';

/**
 * Cedar entity types — the schema for Cedar policy evaluation.
 * Source: AGORA_BRIEF_v2.md §7.1
 */

/**
 * Project entity — the principal in Cedar policy.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarProject = z
  .object({
    type: z.literal('Project'),
    id: z.string().describe('Project identifier (e.g. directory path or name)')
  })
  .describe('Cedar Project entity — the principal in policy evaluation');
export type CedarProject = z.infer<typeof CedarProject>;

/**
 * Publisher entity — namespace and verification status.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarPublisher = z
  .object({
    namespace: z.string(),
    identity_verified: z.boolean()
  })
  .describe('Cedar Publisher entity attributes');
export type CedarPublisher = z.infer<typeof CedarPublisher>;

/**
 * Cedar entity attributes for an Artifact — used in policy evaluation.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarArtifactAttributes = z
  .object({
    kind: z.string().describe('Artifact kind (mcp-server or agent-skill)'),
    publisher: CedarPublisher,
    provenance_verified: z.boolean(),
    attestation_tier: z.string().describe('"sigstore" | "local" | "none"'),
    revoked: z.boolean(),
    canary_triggered: z.boolean(),
    fs_read: z.boolean(),
    fs_write: z.boolean(),
    exec: z.boolean(),
    net_hosts: z.array(z.string()).describe('Set of contacted hostnames'),
    divergence_max: z.string().describe('"none" | "info" | "warn" | "critical"')
  })
  .describe('Cedar Artifact entity attributes (AGORA_BRIEF_v2.md §7.1)');
export type CedarArtifactAttributes = z.infer<typeof CedarArtifactAttributes>;

/**
 * Cedar Artifact entity — the resource in policy evaluation.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarArtifact = z
  .object({
    type: z.literal('Artifact'),
    id: z.string().describe('purl of the artifact'),
    attributes: CedarArtifactAttributes
  })
  .describe('Cedar Artifact entity — the resource in policy evaluation');
export type CedarArtifact = z.infer<typeof CedarArtifact>;

/**
 * Cedar action — the action in policy evaluation.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarAction = z.enum(['Install', 'Sync', 'Serve']);
export type CedarAction = z.infer<typeof CedarAction>;

/**
 * Cedar policy request — the input to Cedar's isAuthorized.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarPolicyRequest = z
  .object({
    principal: CedarProject,
    action: CedarAction,
    resource: CedarArtifact,
    context: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Additional context for policy evaluation')
  })
  .describe('Input to Cedar policy evaluation');
export type CedarPolicyRequest = z.infer<typeof CedarPolicyRequest>;

/**
 * Cedar policy decision — the output of Cedar's isAuthorized.
 * Source: AGORA_BRIEF_v2.md §7.1
 */
export const CedarPolicyDecision = z
  .object({
    decision: z.enum(['Allow', 'Deny']),
    determining_policies: z
      .array(z.string())
      .describe('The Cedar policies that determined this decision')
  })
  .describe('Output of Cedar policy evaluation');
export type CedarPolicyDecision = z.infer<typeof CedarPolicyDecision>;
