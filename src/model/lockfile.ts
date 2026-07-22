import { z } from 'zod';

/**
 * Policy verdict — the outcome of evaluating an artifact against Cedar policy.
 * Source: AGORA_BRIEF_v2.md §5.5
 */
export const PolicyDecision = z.enum(['allow', 'forbid']);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export const PolicyVerdict = z
  .object({
    decision: PolicyDecision,
    policy_sha256: z.string().describe('SHA-256 hash of the policy files used for evaluation'),
    evaluated_at: z.string().datetime().describe('ISO timestamp of evaluation'),
    determining_rule: z.string().optional().describe('The Cedar rule that determined the verdict')
  })
  .describe('Outcome of Cedar policy evaluation for an artifact');
export type PolicyVerdict = z.infer<typeof PolicyVerdict>;

/**
 * Artifact lock entry — exactly what is installed, hashed, verified.
 * Source: AGORA_BRIEF_v2.md §5.5
 */
export const ArtifactLockEntry = z
  .object({
    purl: z.string().describe('Package URL — primary key'),
    kind: z.enum(['mcp-server', 'agent-skill']),
    integrity: z
      .object({
        tarball_sha256: z.string().describe('SHA-256 hash of the downloaded tarball'),
        manifest_sha256: z.string().describe('JCS hash of the declared manifest')
      })
      .describe('Content integrity hashes'),
    provenance: z
      .object({
        verified: z.boolean().describe('Whether provenance was verified'),
        builder: z.string().optional().describe('Builder identity'),
        source_repo: z.string().optional().describe('Source repository'),
        rekor_log_index: z.number().optional().describe('Rekor transparency log entry')
      })
      .describe('Provenance verification result'),
    tools: z
      .array(
        z.object({
          name: z.string().describe('Tool name'),
          description_sha256: z.string().describe('SHA-256 of tool description'),
          input_schema_sha256: z.string().describe('JCS hash of input schema')
        })
      )
      .describe('Declared tools with their hashes'),
    policy_verdict: PolicyVerdict,
    hosts: z
      .array(z.string())
      .describe('Hosts where this artifact is synced (e.g. claudecode, cursor)'),
    state: z
      .enum(['installed', 'quarantined'])
      .optional()
      .describe('Current state — quarantined if drift or revocation detected')
  })
  .describe('A single artifact entry in the lockfile (AGORA_BRIEF_v2.md §5.5)');
export type ArtifactLockEntry = z.infer<typeof ArtifactLockEntry>;

/**
 * Lockfile — committed to VCS, machine truth of exactly what is installed.
 * Source: AGORA_BRIEF_v2.md §5.5
 */
export const Lockfile = z
  .object({
    lockfile_version: z.literal(1).describe('Lockfile schema version'),
    generated_by: z.string().describe('Agora version that generated this lockfile'),
    artifacts: z.array(ArtifactLockEntry).describe('All installed artifacts')
  })
  .describe('Lockfile — machine truth of installed artifacts (AGORA_BRIEF_v2.md §5.5)');
export type Lockfile = z.infer<typeof Lockfile>;
