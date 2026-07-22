import { z } from 'zod';

/**
 * Vet level — how deeply the artifact was observed.
 * Source: AGORA_BRIEF_v2.md §5.3
 */
export const VetLevel = z.enum(['L0-offline', 'L1-proxied-net']);
export type VetLevel = z.infer<typeof VetLevel>;

/**
 * Sandbox backend used for vetting.
 * Source: AGORA_BRIEF_v2.md §5.3, D9
 */
export const VetBackend = z.enum(['docker', 'bwrap', 'sandbox-exec']);
export type VetBackend = z.infer<typeof VetBackend>;

/**
 * Network contact observed during vetting.
 * Source: AGORA_BRIEF_v2.md §5.3
 */
export const NetworkContact = z
  .object({
    host: z.string().describe('Hostname or IP contacted'),
    port: z.number().describe('Port number'),
    during: z.enum(['startup', 'handshake', 'tool-call']).describe('Phase when contact occurred')
  })
  .describe('A network connection observed during vetting');
export type NetworkContact = z.infer<typeof NetworkContact>;

/**
 * Divergence between declared and observed behavior.
 * Source: AGORA_BRIEF_v2.md §5.3
 */
export const DivergenceKind = z.enum([
  'undeclared-egress',
  'undeclared-fs-write',
  'undeclared-exec',
  'undeclared-credential-use',
  'canary-exfiltration'
]);
export type DivergenceKind = z.infer<typeof DivergenceKind>;

export const DivergenceSeverity = z.enum(['info', 'warn', 'critical']);
export type DivergenceSeverity = z.infer<typeof DivergenceSeverity>;

export const Divergence = z
  .object({
    kind: DivergenceKind,
    detail: z.string().describe('Human-readable description of the divergence'),
    severity: DivergenceSeverity
  })
  .describe('Computed difference between declared capabilities and observed behavior');
export type Divergence = z.infer<typeof Divergence>;

/**
 * Observed behavior — what the artifact actually did during vetting.
 * Source: AGORA_BRIEF_v2.md §5.3
 */
export const ObservedBehavior = z
  .object({
    files_read: z.array(z.string()).describe('Normalized paths of files read (capped at 200)'),
    files_written: z.array(z.string()).describe('Normalized paths of files written'),
    hosts_contacted: z.array(NetworkContact).describe('Network connections observed'),
    processes_spawned: z.array(z.string()).describe('argv[0] of spawned processes'),
    env_read: z.array(z.string()).describe('Environment variable names accessed (best effort)'),
    canary_triggered: z.boolean().describe('ANY use of injected canary credentials')
  })
  .describe('Raw observations from sandboxed execution');
export type ObservedBehavior = z.infer<typeof ObservedBehavior>;

/**
 * ObservedProfile — the complete record of what an artifact actually did.
 * Output of `agora vet` (Section 6.2).
 * Source: AGORA_BRIEF_v2.md §5.3
 */
export const ObservedProfile = z
  .object({
    purl: z.string().describe('Package URL — matches the ArtifactRef'),
    version: z.string().describe('Semantic version'),
    vet_level: VetLevel,
    backend: VetBackend,
    duration_ms: z.number().describe('Total vet duration in milliseconds'),
    handshake_ok: z.boolean().describe('Whether MCP initialize + tools/list succeeded'),
    tools_listed: z.number().describe('Number of tools returned by tools/list'),
    observed: ObservedBehavior,
    divergence: z.array(Divergence).describe('Differences between declared and observed behavior')
  })
  .describe('What the artifact actually did during sandboxed execution (AGORA_BRIEF_v2.md §5.3)');
export type ObservedProfile = z.infer<typeof ObservedProfile>;
